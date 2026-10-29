/**
 * useDealActions — one hook per escrow write function.
 * Each returns { execute, txHash, isPending, isConfirming, isSuccess, error, reset }.
 * All calls include maxFeePerGas: GAS_FLOOR (Arc 20 gwei floor).
 */
import { useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi'
import { erc20Abi, keccak256, toBytes } from 'viem'
import { WASIT_ESCROW_ABI } from '../lib/wasit-abi'
import { GAS_FLOOR, getContractAddress, USDC_ADDRESS } from '../lib/wasit-config'

// ── Shared write + receipt pattern ────────────────────────────────────────────
function useEscrowWrite(chainId: number | undefined) {
  const contractAddress = chainId ? getContractAddress(chainId) : null
  const {
    writeContract,
    data: txHash,
    isPending,
    error: writeError,
    reset,
  } = useWriteContract()

  const {
    isLoading: isConfirming,
    isSuccess,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash: txHash })

  return {
    contractAddress,
    writeContract,
    txHash,
    isPending,
    isConfirming,
    isSuccess,
    error: writeError ?? receiptError,
    reset,
  }
}

// ── Fund (approve USDC + fund) ─────────────────────────────────────────────
export function useFund(chainId: number | undefined, ownerAddress: `0x${string}` | undefined, total: bigint) {
  const contractAddress = chainId ? getContractAddress(chainId) : null

  const { data: allowanceRaw, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [
      ownerAddress ?? '0x0000000000000000000000000000000000000000',
      contractAddress ?? '0x0000000000000000000000000000000000000000',
    ],
    chainId,
    query: { enabled: !!contractAddress && !!ownerAddress },
  })

  const approveHook = useEscrowWrite(chainId)
  const fundHook = useEscrowWrite(chainId)

  const allowance = allowanceRaw !== undefined ? BigInt(allowanceRaw) : 0n
  const needsApprove = allowance < total

  function approve() {
    if (!contractAddress) return
    approveHook.writeContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'approve',
      args: [contractAddress, total],
      maxFeePerGas: GAS_FLOOR,
    })
  }

  function fund(dealId: bigint) {
    if (!contractAddress) return
    fundHook.writeContract({
      address: contractAddress,
      abi: WASIT_ESCROW_ABI,
      functionName: 'fund',
      args: [dealId],
      maxFeePerGas: GAS_FLOOR,
    })
  }

  return {
    needsApprove,
    allowance,
    refetchAllowance,
    approve,
    approveHash: approveHook.txHash,
    approvePending: approveHook.isPending,
    approveConfirming: approveHook.isConfirming,
    approveSuccess: approveHook.isSuccess,
    approveError: approveHook.error,
    approveReset: approveHook.reset,
    fund,
    fundHash: fundHook.txHash,
    fundPending: fundHook.isPending,
    fundConfirming: fundHook.isConfirming,
    fundSuccess: fundHook.isSuccess,
    fundError: fundHook.error,
    fundReset: fundHook.reset,
  }
}

// ── Attest ────────────────────────────────────────────────────────────────────
export function useAttest(chainId: number | undefined) {
  const w = useEscrowWrite(chainId)
  function attest(dealId: bigint, i: bigint, evidenceRef: string) {
    if (!w.contractAddress) return
    // Hash the evidence reference string to bytes32
    const evidenceHash = keccak256(toBytes(evidenceRef || 'no evidence'))
    w.writeContract({
      address: w.contractAddress,
      abi: WASIT_ESCROW_ABI,
      functionName: 'attest',
      args: [dealId, i, evidenceHash],
      maxFeePerGas: GAS_FLOOR,
    })
  }
  return { ...w, attest }
}

// ── Approve milestone ─────────────────────────────────────────────────────────
export function useApproveMilestone(chainId: number | undefined) {
  const w = useEscrowWrite(chainId)
  function approveMilestone(dealId: bigint, i: bigint) {
    if (!w.contractAddress) return
    w.writeContract({
      address: w.contractAddress,
      abi: WASIT_ESCROW_ABI,
      functionName: 'approve',
      args: [dealId, i],
      maxFeePerGas: GAS_FLOOR,
    })
  }
  return { ...w, approveMilestone }
}

// ── Release ───────────────────────────────────────────────────────────────────
export function useRelease(chainId: number | undefined) {
  const w = useEscrowWrite(chainId)
  function release(dealId: bigint, i: bigint) {
    if (!w.contractAddress) return
    w.writeContract({
      address: w.contractAddress,
      abi: WASIT_ESCROW_ABI,
      functionName: 'release',
      args: [dealId, i],
      maxFeePerGas: GAS_FLOOR,
    })
  }
  return { ...w, release }
}

// ── Dispute ───────────────────────────────────────────────────────────────────
export function useDispute(chainId: number | undefined) {
  const w = useEscrowWrite(chainId)
  function dispute(dealId: bigint, i: bigint, reason: string) {
    if (!w.contractAddress) return
    w.writeContract({
      address: w.contractAddress,
      abi: WASIT_ESCROW_ABI,
      functionName: 'dispute',
      args: [dealId, i, reason],
      maxFeePerGas: GAS_FLOOR,
    })
  }
  return { ...w, dispute }
}

// ── Resolve ───────────────────────────────────────────────────────────────────
export function useResolve(chainId: number | undefined) {
  const w = useEscrowWrite(chainId)
  function resolve(dealId: bigint, i: bigint, sellerShareBps: number) {
    if (!w.contractAddress) return
    w.writeContract({
      address: w.contractAddress,
      abi: WASIT_ESCROW_ABI,
      functionName: 'resolve',
      args: [dealId, i, sellerShareBps],
      maxFeePerGas: GAS_FLOOR,
    })
  }
  return { ...w, resolve }
}

// ── Refund expired ────────────────────────────────────────────────────────────
export function useRefundExpired(chainId: number | undefined) {
  const w = useEscrowWrite(chainId)
  function refundExpired(dealId: bigint, i: bigint) {
    if (!w.contractAddress) return
    w.writeContract({
      address: w.contractAddress,
      abi: WASIT_ESCROW_ABI,
      functionName: 'refundExpired',
      args: [dealId, i],
      maxFeePerGas: GAS_FLOOR,
    })
  }
  return { ...w, refundExpired }
}

// ── Release stalled ───────────────────────────────────────────────────────────
export function useReleaseStalled(chainId: number | undefined) {
  const w = useEscrowWrite(chainId)
  function releaseStalled(dealId: bigint, i: bigint) {
    if (!w.contractAddress) return
    w.writeContract({
      address: w.contractAddress,
      abi: WASIT_ESCROW_ABI,
      functionName: 'releaseStalled',
      args: [dealId, i],
      maxFeePerGas: GAS_FLOOR,
    })
  }
  return { ...w, releaseStalled }
}

// ── Withdraw ──────────────────────────────────────────────────────────────────
export function useWithdraw(chainId: number | undefined) {
  const w = useEscrowWrite(chainId)
  function withdraw() {
    if (!w.contractAddress) return
    w.writeContract({
      address: w.contractAddress,
      abi: WASIT_ESCROW_ABI,
      functionName: 'withdraw',
      args: [],
      maxFeePerGas: GAS_FLOOR,
    })
  }
  return { ...w, withdraw }
}
