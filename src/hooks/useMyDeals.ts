/**
 * useMyDeals — scans DealCreated events from the contract deploy block,
 * filters for the connected wallet (buyer, payee, inspector, or arbiter),
 * and returns enriched deal summaries.
 *
 * Cache: results are kept in a module-level Map keyed by (chainId, address)
 * so navigating away and back doesn't rescan from scratch.
 *
 * Progress: exposes { scannedBlock, headBlock } so the UI can show a
 * progress bar during the initial scan.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { usePublicClient } from 'wagmi'
import { parseAbiItem, decodeEventLog, type Log } from 'viem'
import { WASIT_ESCROW_ABI } from '../lib/wasit-abi'
import { getContractAddress } from '../lib/wasit-config'
import { dealStateFromNum, msStateFromNum, type DealState, type MilestoneState } from './useDeal'

// ── Contract deploy blocks ─────────────────────────────────────────────────────
// Arc RPC rejects getLogs ranges > ~5 000 blocks (-32012 "range too large").
// Set each entry to the deploy block of the WasitEscrow contract on that chain
// so the scanner starts from the first possible DealCreated, not from genesis.
//
// If a chain entry is missing or 0n, the scanner falls back to a recent window
// (RECENT_FALLBACK_BLOCKS) and shows a "recent deals only" notice in the UI.
const DEPLOY_BLOCKS: Record<number, bigint> = {
  // Arc Testnet: WasitEscrow v3 (0xf8b07…) deployed in block 69844454 (2026-10-30T13:10:25Z)
  // Update this constant after every testnet redeployment.
  5042002: 69844454n,
  // Arc Mainnet: fill in after mainnet deploy.
  5042: 0n,
}

// Arc RPC hard cap: reject ranges > ~5 000 blocks.
const BATCH_SIZE = 4_900n  // stay comfortably under the limit

// Fallback when deploy block is unknown — scan only a recent window.
// At ~0.5s/block this is ~41 min of history; enough for a demo / recent deals.
const RECENT_FALLBACK_BLOCKS = 5_000n

// ── Module-level cache: (cacheKey) -> CachedResult ────────────────────────────
interface DealSummary {
  dealId: string
  buyer: `0x${string}`
  inspector: `0x${string}`
  arbiter: `0x${string}`
  payeeAddresses: `0x${string}`[]
  total: bigint
  deadline: bigint
  // Enriched from getDeal
  state: DealState
  milestoneStates: MilestoneState[]
  milestoneCount: number
  releasedCount: number
  // Action hints
  hasAction: boolean
  roles: string[]
}

interface ScanCache {
  deals: DealSummary[]
  lastScannedBlock: bigint
  chainId: number
  address: string
}

const scanCache = new Map<string, ScanCache>()

function cacheKey(chainId: number, address: string) {
  return `${chainId}:${address.toLowerCase()}`
}

export interface UseMyDealsResult {
  deals: DealSummary[]
  isScanning: boolean
  scannedBlock: bigint
  headBlock: bigint
  isError: boolean
  errorMessage: string
  rescan: () => void
  /** True when the deploy block for this chain is unknown — list shows recent deals only. */
  isRecentOnly: boolean
}

// ── Enrich a raw DealCreated summary with live chain state ────────────────────
// We batch-enrich with individual readContract calls via the public client.
async function enrichDeal(
  client: ReturnType<typeof usePublicClient>,
  contractAddress: `0x${string}`,
  summary: Omit<DealSummary, 'state' | 'milestoneStates' | 'milestoneCount' | 'releasedCount' | 'hasAction' | 'roles'>,
  connectedAddress: string,
  chainId: number,
): Promise<DealSummary> {
  if (!client) return { ...summary, state: 'Created', milestoneStates: [], milestoneCount: 0, releasedCount: 0, hasAction: false, roles: [] }

  const dealIdNum = BigInt(summary.dealId)

  // getDeal
  let state: DealState = 'Created'
  let milestoneStates: MilestoneState[] = []
  let milestoneCount = 0
  let owedBalance = 0n

  try {
    const dealRaw = await client.readContract({
      address: contractAddress,
      abi: WASIT_ESCROW_ABI,
      functionName: 'getDeal',
      args: [dealIdNum],
    })
    const [, , , stateNum] = dealRaw as [`0x${string}`, `0x${string}`, `0x${string}`, number, bigint, bigint, bigint]
    state = dealStateFromNum(Number(stateNum))
  } catch { /* leave as Created */ }

  // getMilestone × 5
  for (let i = 0; i < 5; i++) {
    try {
      const msRaw = await client.readContract({
        address: contractAddress,
        abi: WASIT_ESCROW_ABI,
        functionName: 'getMilestone',
        args: [dealIdNum, BigInt(i)],
      })
      const [amount, msStateNum] = msRaw as [bigint, number, bigint, bigint, boolean]
      if (amount === 0n && Number(msStateNum) === 0) break
      milestoneStates.push(msStateFromNum(Number(msStateNum)))
      milestoneCount++
    } catch { break }
  }

  // owed balance for connected wallet
  const addrLower = connectedAddress.toLowerCase()
  const isPayee = summary.payeeAddresses.some(p => p.toLowerCase() === addrLower)
  if (isPayee || summary.buyer.toLowerCase() === addrLower) {
    try {
      const owedRaw = await client.readContract({
        address: contractAddress,
        abi: WASIT_ESCROW_ABI,
        functionName: 'owed',
        args: [connectedAddress as `0x${string}`],
      })
      owedBalance = BigInt(owedRaw)
    } catch { /* skip */ }
  }

  // Roles
  const roles: string[] = []
  if (summary.buyer.toLowerCase() === addrLower) roles.push('Buyer')
  if (summary.inspector.toLowerCase() === addrLower) roles.push('Inspector')
  if (summary.arbiter.toLowerCase() === addrLower) roles.push('Arbiter')
  summary.payeeAddresses.forEach((p, i) => {
    if (p.toLowerCase() === addrLower) roles.push(i === 0 ? 'Seller' : `Payee ${i + 1}`)
  })

  const releasedCount = milestoneStates.filter(s => s === 'Released' || s === 'Resolved' || s === 'Refunded').length

  // Action detection
  const isBuyer = summary.buyer.toLowerCase() === addrLower
  const isInspector = summary.inspector.toLowerCase() === addrLower
  const isArbiter = summary.arbiter.toLowerCase() === addrLower
  const nowTs = Math.floor(Date.now() / 1000)

  let hasAction = false

  if (!hasAction && isBuyer && state === 'Created') hasAction = true  // needs to fund
  if (!hasAction && owedBalance > 0n) hasAction = true               // can withdraw
  if (!hasAction && state === 'Funded') {
    for (const ms of milestoneStates) {
      if (!hasAction && isInspector && ms === 'Pending') hasAction = true
      if (!hasAction && (ms === 'Attested' || ms === 'Approved')) hasAction = true  // anyone can release (approx)
      if (!hasAction && isArbiter && ms === 'Disputed') hasAction = true
    }
  }
  // refundExpired: deadline passed and there's a pending milestone
  if (!hasAction && state === 'Funded' && Number(summary.deadline) < nowTs) {
    if (milestoneStates.some(ms => ms === 'Pending')) hasAction = true
  }

  void chainId  // used by caller

  return {
    ...summary,
    state,
    milestoneStates,
    milestoneCount,
    releasedCount,
    hasAction,
    roles,
  }
}

export function useMyDeals(chainId: number | undefined, connectedAddress: `0x${string}` | undefined): UseMyDealsResult {
  const publicClient = usePublicClient({ chainId })
  const contractAddress = chainId ? getContractAddress(chainId) : null

  const [deals, setDeals] = useState<DealSummary[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [scannedBlock, setScannedBlock] = useState(0n)
  const [headBlock, setHeadBlock] = useState(0n)
  const [isError, setIsError] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [isRecentOnly, setIsRecentOnly] = useState(false)
  const [scanKey, setScanKey] = useState(0)  // increment to trigger rescan

  const abortRef = useRef<boolean>(false)

  const rescan = useCallback(() => {
    if (!chainId || !connectedAddress) return
    // Clear cache for this key so we re-scan
    const key = cacheKey(chainId, connectedAddress)
    scanCache.delete(key)
    setScanKey(k => k + 1)
  }, [chainId, connectedAddress])

  useEffect(() => {
    if (!publicClient || !contractAddress || !connectedAddress || !chainId) return

    abortRef.current = false
    const addrLower = connectedAddress.toLowerCase()
    const key = cacheKey(chainId, connectedAddress)
    const cached = scanCache.get(key)

    async function runScan() {
      if (!publicClient || !contractAddress) return
      setIsError(false)
      setErrorMessage('')

      try {
        const currentHead = await publicClient.getBlockNumber()
        setHeadBlock(currentHead)

        const knownDeploy = DEPLOY_BLOCKS[chainId!] ?? 0n
        // If deploy block is unknown (0n), fall back to a recent window only.
        const usingFallback = knownDeploy === 0n
        setIsRecentOnly(usingFallback)
        const deployBlock = usingFallback
          ? (currentHead > RECENT_FALLBACK_BLOCKS ? currentHead - RECENT_FALLBACK_BLOCKS : 0n)
          : knownDeploy
        const startBlock = cached ? cached.lastScannedBlock + 1n : deployBlock

        // If cache is fresh (already at head), just use it
        if (cached && startBlock > currentHead) {
          setDeals(cached.deals)
          setScannedBlock(currentHead)
          setIsScanning(false)
          return
        }

        setIsScanning(true)
        if (cached) {
          setDeals(cached.deals)
          setScannedBlock(cached.lastScannedBlock)
        }

        // Collect raw summaries from DealCreated events
        const rawSummaries: Map<string, Omit<DealSummary, 'state' | 'milestoneStates' | 'milestoneCount' | 'releasedCount' | 'hasAction' | 'roles'>> =
          new Map(cached ? cached.deals.map(d => [d.dealId, d]) : [])

        let from = startBlock
        while (from <= currentHead) {
          if (abortRef.current) return
          const to = from + BATCH_SIZE - 1n < currentHead ? from + BATCH_SIZE - 1n : currentHead

          try {
            const logs = await publicClient.getLogs({
              address: contractAddress,
              event: parseAbiItem(
                'event DealCreated(uint256 indexed dealId, address indexed buyer, address inspector, address arbiter, uint128 total, uint64 deadline)',
              ),
              fromBlock: from,
              toBlock: to,
            })

            for (const log of logs as Log[]) {
              try {
                const d = decodeEventLog({
                  abi: WASIT_ESCROW_ABI,
                  data: log.data,
                  topics: log.topics,
                  eventName: 'DealCreated',
                })

                const buyer = (d.args as { buyer: `0x${string}` }).buyer
                const inspector = (d.args as { inspector: `0x${string}` }).inspector
                const arbiter = (d.args as { arbiter: `0x${string}` }).arbiter
                const dealIdBig = (d.args as { dealId: bigint }).dealId
                const total = (d.args as { total: bigint }).total
                const deadline = (d.args as { deadline: bigint }).deadline
                const dealIdStr = dealIdBig.toString()

                // Also try extended decode for payees
                let payeeAddresses: `0x${string}`[] = []
                try {
                  const fullEvent = parseAbiItem(
                    'event DealCreated(uint256 indexed dealId, address indexed buyer, ' +
                    '(address addr, uint16 bps)[] payees, address inspector, address arbiter, ' +
                    'uint256[] milestoneAmounts, uint64 challengeWindow, uint64 deadline, uint128 total)'
                  )
                  const decoded = decodeEventLog({ abi: [fullEvent], data: log.data, topics: log.topics })
                  const args = (decoded as { args: { payees?: { addr: `0x${string}` }[] } }).args
                  if (args.payees) payeeAddresses = args.payees.map(p => p.addr)
                } catch { /* use empty */ }

                // Filter: is this wallet involved?
                const allAddresses = [buyer, inspector, arbiter, ...payeeAddresses].map(a => a.toLowerCase())
                if (!allAddresses.includes(addrLower)) continue

                rawSummaries.set(dealIdStr, {
                  dealId: dealIdStr,
                  buyer,
                  inspector,
                  arbiter,
                  payeeAddresses,
                  total,
                  deadline,
                })
              } catch { /* skip bad log */ }
            }
          } catch (e) {
            // RPC batch error — skip this range and continue
            console.warn('useMyDeals getLogs error for range', from, to, e)
          }

          setScannedBlock(to)
          from = to + 1n
        }

        if (abortRef.current) return

        // Enrich all summaries with live chain state
        const enriched: DealSummary[] = []
        for (const summary of rawSummaries.values()) {
          if (abortRef.current) return
          const full = await enrichDeal(publicClient, contractAddress, summary, connectedAddress!, chainId!)
          enriched.push(full)
        }

        // Sort newest first (highest dealId first)
        enriched.sort((a, b) => Number(BigInt(b.dealId) - BigInt(a.dealId)))

        if (!abortRef.current) {
          scanCache.set(key, { deals: enriched, lastScannedBlock: currentHead, chainId: chainId!, address: addrLower })
          setDeals(enriched)
          setScannedBlock(currentHead)
          setIsScanning(false)
        }
      } catch (e) {
        if (!abortRef.current) {
          const msg = e instanceof Error ? e.message : String(e)
          // Never dump raw RPC error — extract the readable part
          const clean = msg.length > 120 ? msg.slice(0, 120) + '…' : msg
          setIsError(true)
          setErrorMessage(clean)
          setIsScanning(false)
        }
      }
    }

    void runScan()

    return () => { abortRef.current = true }
  }, [publicClient, contractAddress, connectedAddress, chainId, scanKey])

  return { deals, isScanning, scannedBlock, headBlock, isError, errorMessage, rescan, isRecentOnly }
}

// Re-export DealSummary for consumers
export type { DealSummary }
