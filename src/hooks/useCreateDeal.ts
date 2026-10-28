import { useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi'
import { decodeEventLog } from 'viem'
import { WASIT_ESCROW_ABI } from '../lib/wasit-abi'
import { GAS_FLOOR, getContractAddress } from '../lib/wasit-config'
import { parseUsdcInput } from '../lib/split'

export interface PayeeRow {
  addr: string
  role: string
  bps: string // raw user input, e.g. "8000"
}

export interface MilestoneRow {
  label: string
  amount: string // human USDC, e.g. "4.50"
}

export interface CreateDealArgs {
  payees: PayeeRow[]
  milestones: MilestoneRow[]
  inspector: string
  arbiter: string
  challengeWindowSecs: number
  deadlineDate: string // ISO string from <input type="datetime-local">
}

export function useCreateDeal(chainId: number | undefined) {
  const contractAddress = chainId ? getContractAddress(chainId) : null

  // Read feeBps live from contract
  const { data: feeBps } = useReadContract({
    address: contractAddress ?? undefined,
    abi: WASIT_ESCROW_ABI,
    functionName: 'feeBps',
    chainId,
    query: { enabled: !!contractAddress },
  })

  const {
    writeContract,
    data: txHash,
    isPending: isWritePending,
    error: writeError,
    reset,
  } = useWriteContract()

  const {
    data: receipt,
    isLoading: isConfirming,
    isSuccess,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash: txHash })

  // Extract dealId from DealCreated event in receipt
  let dealId: bigint | undefined
  if (receipt) {
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: WASIT_ESCROW_ABI,
          data: log.data,
          topics: log.topics,
          eventName: 'DealCreated',
        })
        dealId = decoded.args.dealId
        break
      } catch {
        // not DealCreated — skip
      }
    }
  }

  function submit(args: CreateDealArgs) {
    if (!contractAddress) return

    const payeesOnchain = args.payees.map((p) => ({
      addr: p.addr as `0x${string}`,
      bps: Number(p.bps) as unknown as bigint,
    }))

    const milestoneAmounts = args.milestones.map((m) => {
      const raw = parseUsdcInput(m.amount)
      if (raw === null) throw new Error(`Invalid amount: ${m.amount}`)
      return raw
    })

    const challengeWindow = BigInt(args.challengeWindowSecs)

    let deadlineTs: bigint
    if (args.deadlineDate) {
      deadlineTs = BigInt(Math.floor(new Date(args.deadlineDate).getTime() / 1000))
    } else {
      deadlineTs = BigInt(Math.floor(Date.now() / 1000) + 7200)
    }

    writeContract({
      address: contractAddress,
      abi: WASIT_ESCROW_ABI,
      functionName: 'createDeal',
      args: [
        payeesOnchain as unknown as { addr: `0x${string}`; bps: number }[],
        args.inspector as `0x${string}`,
        args.arbiter as `0x${string}`,
        milestoneAmounts,
        challengeWindow,
        deadlineTs,
      ],
      maxFeePerGas: GAS_FLOOR,
    })
  }

  return {
    feeBps: feeBps !== undefined ? Number(feeBps) : undefined,
    submit,
    txHash,
    isWritePending,
    isConfirming,
    isSuccess,
    dealId,
    error: writeError ?? receiptError,
    reset,
  }
}
