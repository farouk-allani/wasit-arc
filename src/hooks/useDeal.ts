/**
 * useDeal — loads deal header, milestones, arbitration window, feeBps,
 * owed balance for connected wallet, and payout events for each milestone.
 *
 * All reads target the explicit chainId so they stay on the right chain
 * regardless of what the wallet is currently set to.
 */
import { useReadContract, useAccount } from 'wagmi'
import { usePublicClient } from 'wagmi'
import { useEffect, useState } from 'react'
import { decodeEventLog, parseAbiItem, type Log } from 'viem'
import { WASIT_ESCROW_ABI } from '../lib/wasit-abi'
import { getContractAddress } from '../lib/wasit-config'

// ── Enums mirroring the contract ─────────────────────────────────────────────
export type DealState = 'Created' | 'Funded' | 'Closed'
export type MilestoneState =
  | 'Pending'
  | 'Attested'
  | 'Approved'
  | 'Released'
  | 'Disputed'
  | 'Resolved'
  | 'Refunded'

export function dealStateFromNum(n: number): DealState {
  return (['Created', 'Funded', 'Closed'] as DealState[])[n] ?? 'Created'
}
export function msStateFromNum(n: number): MilestoneState {
  return (
    (['Pending', 'Attested', 'Approved', 'Released', 'Disputed', 'Resolved', 'Refunded'] as MilestoneState[])[n] ??
    'Pending'
  )
}

export interface DealData {
  buyer: `0x${string}`
  inspector: `0x${string}`
  arbiter: `0x${string}`
  state: DealState
  stateNum: number
  challengeWindow: bigint   // seconds
  deadline: bigint          // unix timestamp
  total: bigint             // raw USDC
}

export interface MilestoneData {
  index: number
  amount: bigint
  state: MilestoneState
  stateNum: number
  attestedAt: number   // unix timestamp, 0 if unknown
  disputedAt: number   // unix timestamp, 0 if unknown
}

export interface PayoutRow {
  milestoneIndex: number
  to: `0x${string}`
  amount: bigint
  credited: boolean          // true = PayoutCredited (transfer failed), false = PayeePaid
  refund: boolean            // true = MilestoneRefunded
  txHash: `0x${string}`
  blockNumber: bigint
}

export interface UseDealResult {
  deal: DealData | undefined
  milestones: MilestoneData[]
  feeBps: number | undefined
  arbitrationWindow: bigint | undefined
  owedBalance: bigint
  payoutRows: PayoutRow[]
  isLoading: boolean
  isError: boolean
  refetch: () => void
}

const MAX_MILESTONES = 5

export function useDeal(dealIdStr: string, chainId: number | undefined): UseDealResult {
  const contractAddress = chainId ? getContractAddress(chainId) : null
  const { address: connectedAddress } = useAccount()

  const dealIdNum = BigInt(dealIdStr)

  // ── getDeal ───────────────────────────────────────────────────────────────
  const {
    data: dealRaw,
    isLoading: loadingDeal,
    isError: errorDeal,
    refetch: refetchDeal,
  } = useReadContract({
    address: contractAddress ?? undefined,
    abi: WASIT_ESCROW_ABI,
    functionName: 'getDeal',
    args: [dealIdNum],
    chainId,
    query: { enabled: !!contractAddress },
  })

  // ── feeBps ────────────────────────────────────────────────────────────────
  const { data: feeBpsRaw, refetch: refetchFee } = useReadContract({
    address: contractAddress ?? undefined,
    abi: WASIT_ESCROW_ABI,
    functionName: 'feeBps',
    chainId,
    query: { enabled: !!contractAddress },
  })

  // ── ARBITRATION_WINDOW ────────────────────────────────────────────────────
  const { data: arbWindowRaw, refetch: refetchArbWindow } = useReadContract({
    address: contractAddress ?? undefined,
    abi: WASIT_ESCROW_ABI,
    functionName: 'ARBITRATION_WINDOW',
    chainId,
    query: { enabled: !!contractAddress },
  })

  // ── owed balance for connected wallet ─────────────────────────────────────
  const { data: owedRaw, refetch: refetchOwed } = useReadContract({
    address: contractAddress ?? undefined,
    abi: WASIT_ESCROW_ABI,
    functionName: 'owed',
    args: [connectedAddress ?? '0x0000000000000000000000000000000000000000'],
    chainId,
    query: { enabled: !!contractAddress && !!connectedAddress },
  })

  // ── getMilestone × MAX_MILESTONES ─────────────────────────────────────────
  const ms0 = useReadContract({ address: contractAddress ?? undefined, abi: WASIT_ESCROW_ABI, functionName: 'getMilestone', args: [dealIdNum, 0n], chainId, query: { enabled: !!contractAddress } })
  const ms1 = useReadContract({ address: contractAddress ?? undefined, abi: WASIT_ESCROW_ABI, functionName: 'getMilestone', args: [dealIdNum, 1n], chainId, query: { enabled: !!contractAddress } })
  const ms2 = useReadContract({ address: contractAddress ?? undefined, abi: WASIT_ESCROW_ABI, functionName: 'getMilestone', args: [dealIdNum, 2n], chainId, query: { enabled: !!contractAddress } })
  const ms3 = useReadContract({ address: contractAddress ?? undefined, abi: WASIT_ESCROW_ABI, functionName: 'getMilestone', args: [dealIdNum, 3n], chainId, query: { enabled: !!contractAddress } })
  const ms4 = useReadContract({ address: contractAddress ?? undefined, abi: WASIT_ESCROW_ABI, functionName: 'getMilestone', args: [dealIdNum, 4n], chainId, query: { enabled: !!contractAddress } })
  const msHooks = [ms0, ms1, ms2, ms3, ms4]

  function refetchMilestones() {
    void ms0.refetch(); void ms1.refetch(); void ms2.refetch()
    void ms3.refetch(); void ms4.refetch()
  }

  // ── Payout events (getLogs) ───────────────────────────────────────────────
  const publicClient = usePublicClient({ chainId })
  const [payoutRows, setPayoutRows] = useState<PayoutRow[]>([])
  // attestedAt[i] and disputedAt[i] read from MilestoneAttested / MilestoneDisputed events
  const [msTimestamps, setMsTimestamps] = useState<Record<number, { attestedAt: number; disputedAt: number }>>( {} )

  useEffect(() => {
    if (!publicClient || !contractAddress) return
    let cancelled = false

    async function fetchLogs() {
      if (!publicClient || !contractAddress) return
      try {
        const dealId = BigInt(dealIdStr)
        const currentBlock = await publicClient.getBlockNumber()
        const fromBlock = currentBlock > 100_000n ? currentBlock - 100_000n : 0n

        const [paidLogs, creditedLogs, refundLogs, attestedLogs, disputedLogs] = await Promise.all([
          publicClient.getLogs({
            address: contractAddress,
            event: parseAbiItem(
              'event PayeePaid(uint256 indexed dealId, uint256 indexed i, address indexed to, uint128 amount)',
            ),
            args: { dealId },
            fromBlock,
            toBlock: 'latest',
          }),
          publicClient.getLogs({
            address: contractAddress,
            event: parseAbiItem(
              'event PayoutCredited(uint256 indexed dealId, uint256 indexed i, address indexed to, uint128 amount)',
            ),
            args: { dealId },
            fromBlock,
            toBlock: 'latest',
          }),
          publicClient.getLogs({
            address: contractAddress,
            event: parseAbiItem(
              'event MilestoneRefunded(uint256 indexed dealId, uint256 indexed i, address indexed buyer, uint128 amount)',
            ),
            args: { dealId },
            fromBlock,
            toBlock: 'latest',
          }),
          publicClient.getLogs({
            address: contractAddress,
            event: parseAbiItem(
              'event MilestoneAttested(uint256 indexed dealId, uint256 indexed i, bytes32 evidenceHash, uint64 attestedAt)',
            ),
            args: { dealId },
            fromBlock,
            toBlock: 'latest',
          }),
          publicClient.getLogs({
            address: contractAddress,
            event: parseAbiItem(
              'event MilestoneDisputed(uint256 indexed dealId, uint256 indexed i, address buyer, string reason)',
            ),
            args: { dealId },
            fromBlock,
            toBlock: 'latest',
          }),
        ])

        if (cancelled) return

        const rows: PayoutRow[] = []

        for (const log of paidLogs as Log[]) {
          try {
            const d = decodeEventLog({ abi: WASIT_ESCROW_ABI, data: log.data, topics: log.topics, eventName: 'PayeePaid' })
            rows.push({
              milestoneIndex: Number(d.args.i),
              to: d.args.to,
              amount: d.args.amount,
              credited: false,
              refund: false,
              txHash: log.transactionHash as `0x${string}`,
              blockNumber: log.blockNumber ?? 0n,
            })
          } catch { /* skip */ }
        }
        for (const log of creditedLogs as Log[]) {
          try {
            const d = decodeEventLog({ abi: WASIT_ESCROW_ABI, data: log.data, topics: log.topics, eventName: 'PayoutCredited' })
            rows.push({
              milestoneIndex: Number(d.args.i),
              to: d.args.to,
              amount: d.args.amount,
              credited: true,
              refund: false,
              txHash: log.transactionHash as `0x${string}`,
              blockNumber: log.blockNumber ?? 0n,
            })
          } catch { /* skip */ }
        }
        for (const log of refundLogs as Log[]) {
          try {
            const d = decodeEventLog({ abi: WASIT_ESCROW_ABI, data: log.data, topics: log.topics, eventName: 'MilestoneRefunded' })
            rows.push({
              milestoneIndex: Number(d.args.i),
              to: d.args.buyer,
              amount: d.args.amount,
              credited: false,
              refund: true,
              txHash: log.transactionHash as `0x${string}`,
              blockNumber: log.blockNumber ?? 0n,
            })
          } catch { /* skip */ }
        }

        rows.sort((a, b) => Number(a.blockNumber - b.blockNumber))
        setPayoutRows(rows)

        // Build milestone timestamp map from MilestoneAttested + MilestoneDisputed logs
        const timestamps: Record<number, { attestedAt: number; disputedAt: number }> = {}
        for (const log of attestedLogs as Log[]) {
          try {
            const d = decodeEventLog({ abi: WASIT_ESCROW_ABI, data: log.data, topics: log.topics, eventName: 'MilestoneAttested' })
            const idx = Number(d.args.i)
            timestamps[idx] = { attestedAt: Number(d.args.attestedAt), disputedAt: timestamps[idx]?.disputedAt ?? 0 }
          } catch { /* skip */ }
        }
        // For disputedAt we need the actual block timestamp (not block number)
        await Promise.all((disputedLogs as Log[]).map(async (log) => {
          try {
            const d = decodeEventLog({ abi: WASIT_ESCROW_ABI, data: log.data, topics: log.topics, eventName: 'MilestoneDisputed' })
            const idx = Number(d.args.i)
            let blockTs = 0
            if (log.blockNumber && publicClient) {
              try {
                const block = await publicClient.getBlock({ blockNumber: log.blockNumber })
                blockTs = Number(block.timestamp)
              } catch { /* fall back to 0 */ }
            }
            timestamps[idx] = { attestedAt: timestamps[idx]?.attestedAt ?? 0, disputedAt: blockTs }
          } catch { /* skip */ }
        }))
        if (!cancelled) setMsTimestamps(timestamps)
      } catch (e) {
        if (!cancelled) console.error('useDeal getLogs error', e)
      }
    }

    void fetchLogs()
    return () => { cancelled = true }
  }, [publicClient, contractAddress, dealIdStr, chainId])

  // ── Assemble deal ─────────────────────────────────────────────────────────
  let deal: DealData | undefined
  if (dealRaw) {
    const [buyer, inspector, arbiter, stateNum, challengeWindow, deadline, total] = dealRaw as [
      `0x${string}`, `0x${string}`, `0x${string}`, number, bigint, bigint, bigint
    ]
    deal = {
      buyer,
      inspector,
      arbiter,
      state: dealStateFromNum(Number(stateNum)),
      stateNum: Number(stateNum),
      challengeWindow,
      deadline,
      total,
    }
  }

  // ── Assemble milestones ───────────────────────────────────────────────────
  const milestones: MilestoneData[] = []
  for (let i = 0; i < MAX_MILESTONES; i++) {
    const r = msHooks[i]
    if (!r?.data) continue
    const [amount, stateNum] = r.data as [bigint, number]
    // A milestone with amount=0 and state=0 means the deal doesn't have that many milestones
    if (amount === 0n && Number(stateNum) === 0) continue
    milestones.push({
      index: i,
      amount,
      state: msStateFromNum(Number(stateNum)),
      stateNum: Number(stateNum),
      attestedAt: msTimestamps[i]?.attestedAt ?? 0,
      disputedAt: msTimestamps[i]?.disputedAt ?? 0,
    })
  }

  function refetch() {
    void refetchDeal()
    void refetchFee()
    void refetchArbWindow()
    void refetchOwed()
    void refetchMilestones()
  }

  return {
    deal,
    milestones,
    feeBps: feeBpsRaw !== undefined ? Number(feeBpsRaw) : undefined,
    arbitrationWindow: arbWindowRaw !== undefined ? BigInt(arbWindowRaw) : undefined,
    owedBalance: owedRaw !== undefined ? BigInt(owedRaw) : 0n,
    payoutRows,
    isLoading: loadingDeal,
    isError: errorDeal,
    refetch,
  }
}
