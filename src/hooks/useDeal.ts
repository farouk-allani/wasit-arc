/**
 * useDeal — loads deal header, milestones (including timestamps from the
 * widened getMilestone getter), arbitration window, feeBps, owed balance,
 * and payout events for each milestone.
 *
 * Arc RPC rejects getLogs ranges > ~5 000 blocks, so we use a named constant
 * and batch if needed. Timestamps (attestedAt, disputedAt) are read directly
 * from getMilestone — never from events.
 */
import { useReadContract, useAccount } from 'wagmi'
import { usePublicClient } from 'wagmi'
import { useEffect, useState, useCallback, useRef } from 'react'
import { decodeEventLog, parseAbiItem, type Log } from 'viem'
import { WASIT_ESCROW_ABI } from '../lib/wasit-abi'
import { getContractAddress } from '../lib/wasit-config'
import { isDealNotFoundError } from '../lib/parse-contract-error'

// Arc RPC hard limit: requests over ~5 000 blocks return -32012 "range too large".
const LOG_BATCH_BLOCKS = 5_000n

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
  attestedAt: number    // unix timestamp, 0 if not yet attested — from getMilestone()
  disputedAt: number    // unix timestamp, 0 if not yet disputed — from getMilestone()
  buyerApproved: boolean
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
  /** True when the contract reverted with DealNotFound — i.e. the id doesn't exist. */
  isDealNotFound: boolean
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
    error: dealError,
    refetch: refetchDeal,
  } = useReadContract({
    address: contractAddress ?? undefined,
    abi: WASIT_ESCROW_ABI,
    functionName: 'getDeal',
    args: [dealIdNum],
    chainId,
    query: { enabled: !!contractAddress },
  })

  // Detect the DealNotFound revert using the full ABI-aware decoder.
  const isDealNotFound = errorDeal && isDealNotFoundError(dealError)

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

  // ── getMilestone × MAX_MILESTONES — includes attestedAt, disputedAt, buyerApproved ──
  const ms0 = useReadContract({ address: contractAddress ?? undefined, abi: WASIT_ESCROW_ABI, functionName: 'getMilestone', args: [dealIdNum, 0n], chainId, query: { enabled: !!contractAddress } })
  const ms1 = useReadContract({ address: contractAddress ?? undefined, abi: WASIT_ESCROW_ABI, functionName: 'getMilestone', args: [dealIdNum, 1n], chainId, query: { enabled: !!contractAddress } })
  const ms2 = useReadContract({ address: contractAddress ?? undefined, abi: WASIT_ESCROW_ABI, functionName: 'getMilestone', args: [dealIdNum, 2n], chainId, query: { enabled: !!contractAddress } })
  const ms3 = useReadContract({ address: contractAddress ?? undefined, abi: WASIT_ESCROW_ABI, functionName: 'getMilestone', args: [dealIdNum, 3n], chainId, query: { enabled: !!contractAddress } })
  const ms4 = useReadContract({ address: contractAddress ?? undefined, abi: WASIT_ESCROW_ABI, functionName: 'getMilestone', args: [dealIdNum, 4n], chainId, query: { enabled: !!contractAddress } })
  const msHooks = [ms0, ms1, ms2, ms3, ms4]

  // wagmi guarantees each query's .refetch is stable — list them explicitly so
  // exhaustive-deps tools see the intent; the whole hook objects are not needed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const refetchMilestones = useCallback(() => {
    void ms0.refetch(); void ms1.refetch(); void ms2.refetch()
    void ms3.refetch(); void ms4.refetch()
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [ms0.refetch, ms1.refetch, ms2.refetch, ms3.refetch, ms4.refetch])

  // ── Payout events (getLogs, batched at LOG_BATCH_BLOCKS per call) ─────────
  // A ref-based trigger lets refetch() re-run the log fetch without
  // changing the effect dependencies array.
  const publicClient = usePublicClient({ chainId })
  const [payoutRows, setPayoutRows] = useState<PayoutRow[]>([])
  const logTrigger = useRef(0)
  const [logEpoch, setLogEpoch] = useState(0)

  const triggerLogRefetch = useCallback(() => {
    logTrigger.current += 1
    setLogEpoch(e => e + 1)
  }, [])

  useEffect(() => {
    if (!publicClient || !contractAddress) return
    let cancelled = false

    async function fetchLogs() {
      if (!publicClient || !contractAddress) return
      try {
        const dealId = BigInt(dealIdStr)
        const currentBlock = await publicClient.getBlockNumber()
        // Scan only the most recent LOG_BATCH_BLOCKS. Payout events are recent
        // (they happen after funding + milestone progression), so this covers all
        // realistic cases on Arc where blocks are ~0.5 s.
        const fromBlock = currentBlock > LOG_BATCH_BLOCKS ? currentBlock - LOG_BATCH_BLOCKS : 0n

        // Fetch payout events in a single batch — all within the safe range
        const [paidLogs, creditedLogs, refundLogs] = await Promise.all([
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
          } catch { /* skip malformed */ }
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
        if (!cancelled) setPayoutRows(rows)
      } catch (e) {
        if (!cancelled) console.error('useDeal getLogs error', e)
      }
    }

    void fetchLogs()
    return () => { cancelled = true }
    // logEpoch in deps ensures refetch() re-runs this effect
  }, [publicClient, contractAddress, dealIdStr, chainId, logEpoch])

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

  // ── Assemble milestones — timestamps come directly from getMilestone() ────
  const milestones: MilestoneData[] = []
  for (let i = 0; i < MAX_MILESTONES; i++) {
    const r = msHooks[i]
    if (!r?.data) continue
    const [amount, stateNum, attestedAt, disputedAt, buyerApproved] = r.data as [bigint, number, bigint, bigint, boolean]
    // A milestone with amount=0 and state=Pending means the deal doesn't have that many milestones
    if (amount === 0n && Number(stateNum) === 0) continue
    milestones.push({
      index: i,
      amount,
      state: msStateFromNum(Number(stateNum)),
      stateNum: Number(stateNum),
      attestedAt: Number(attestedAt),
      disputedAt: Number(disputedAt),
      buyerApproved,
    })
  }

  // ── refetch: refreshes both contract reads and log-based payout history ───
  // Wrapped in useCallback so the identity is stable across renders.
  // Consumers can safely put this in a useEffect dependency array without looping.
  const refetch = useCallback(() => {
    void refetchDeal()
    void refetchFee()
    void refetchArbWindow()
    void refetchOwed()
    void refetchMilestones()
    triggerLogRefetch()
  }, [refetchDeal, refetchFee, refetchArbWindow, refetchOwed, refetchMilestones, triggerLogRefetch])

  return {
    deal,
    milestones,
    feeBps: feeBpsRaw !== undefined ? Number(feeBpsRaw) : undefined,
    arbitrationWindow: arbWindowRaw !== undefined ? BigInt(arbWindowRaw) : undefined,
    owedBalance: owedRaw !== undefined ? BigInt(owedRaw) : 0n,
    payoutRows,
    isLoading: loadingDeal,
    isError: errorDeal,
    isDealNotFound: !!isDealNotFound,
    refetch,
  }
}
