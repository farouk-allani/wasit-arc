/**
 * parseContractError — turns any thrown contract/wallet error into a short,
 * plain-English sentence a trader would understand.
 *
 * Decoding order:
 *  1. Wallet rejection (user cancelled in MetaMask / wallet UI).
 *  2. viem ContractFunctionRevertedError with a decoded errorName from the ABI.
 *  3. Known substrings in the raw message for errors that arrive un-decoded.
 *  4. Generic fallback.
 */
import { decodeErrorResult } from 'viem'
import { WASIT_ESCROW_ABI } from './wasit-abi'

// ── Sentence map — one readable sentence per error name ──────────────────────
const SENTENCES: Record<string, (args: Record<string, unknown>) => string> = {
  DealNotFound:                () => 'That deal does not exist.',
  DealNotFunded:               () => 'The deal has not been funded yet.',
  InvalidDealState:            () => 'This action cannot be taken in the current deal state.',
  UnauthorizedCaller:          () => 'This wallet is not authorised to do that on this deal.',
  MilestoneNotAttested:        () => 'The inspector has not attested this milestone yet.',
  MilestoneNotDisputed:        () => 'This milestone is not in dispute.',
  MilestoneNotPending:         () => 'This milestone is no longer pending.',
  MilestoneNotPendingForRefund:() => 'This milestone cannot be refunded — it is no longer pending.',
  MilestoneNotReleasable:      () => 'This milestone cannot be released yet.',
  MilestoneNotStalledDisputed: () => 'The arbitration window has not expired on this milestone.',
  MilestoneAmountMustBePositive: (a) => `Milestone ${String(a.index)} must have a non-zero amount.`,
  ChallengeWindowNotExpired: (a) =>
    `The challenge window has not closed yet. Release unlocks at block timestamp ${String(a.unlocksAt)}.`,
  ChallengeWindowExpired:      () => 'The challenge window has already expired.',
  ChallengeWindowTooLong:      () => 'The challenge window is too long.',
  ArbiterWindowNotExpired: (a) =>
    `Arbitration is still open. The arbiter window expires at block timestamp ${String(a.unlocksAt)}.`,
  AttestAfterDeadline:         () => 'The deal deadline has passed — attestation is no longer allowed.',
  DeadlineNotPassed:           () => 'The deal deadline has not passed yet.',
  InvalidBpsSum: (a) =>
    `Payee shares must add up to ${String(a.expected)} bps (got ${String(a.actual)}). Adjust the splits to match 10 000 minus the platform fee.`,
  InvalidPayeeCount:           () => 'The number of payees must be between 1 and 6.',
  InvalidMilestoneCount:       () => 'The number of milestones must be between 1 and 5.',
  DuplicatePayee: (a) => {
    const addr = String(a.payee)
    return `Address ${addr.slice(0, 6)}…${addr.slice(-4)} appears more than once in the payee list.`
  },
  ArbiterIsPayee:              () => 'The arbiter cannot also be a payee.',
  InvalidArbiter:              () => 'The arbiter address is not valid for this deal.',
  InvalidInspector:            () => 'The inspector address is not valid for this deal.',
  InvalidDeadline:             () => 'The deadline must be in the future.',
  FeeBpsTooHigh:               () => 'The platform fee is above the maximum allowed.',
  SellerShareBpsTooHigh:       () => 'The seller share is higher than the total milestone amount.',
  SellerShareMustBePositive:   () => 'The seller must receive at least 1 bps of the milestone.',
  NothingToWithdraw:           () => 'There is no balance to withdraw for this wallet.',
  TotalAmountOverflow:         () => 'The total milestone amount overflows the contract limit.',
  SafeERC20FailedOperation:    () => 'USDC transfer failed — the token operation was rejected.',
  ReentrancyGuardReentrantCall:() => 'Reentrancy detected — this call was rejected.',
  ZeroAddress:                 () => 'A zero address was supplied where a real address is required.',
}

// ── Main export ───────────────────────────────────────────────────────────────
export function parseContractError(error: unknown): string {
  if (!error) return 'An unknown error occurred.'

  const msg: string =
    (error as { message?: string })?.message ??
    (error as { shortMessage?: string })?.shortMessage ?? ''

  // 1. Wallet rejection
  const low = msg.toLowerCase()
  if (low.includes('user rejected') || low.includes('user denied') || low.includes('rejected the request')) {
    return 'Transaction cancelled by wallet.'
  }

  // 2. viem decoded revert — check the structured error data first
  const errData: unknown =
    (error as { cause?: { data?: unknown } })?.cause?.data ??
    (error as { data?: unknown })?.data

  if (errData) {
    try {
      const decoded = decodeErrorResult({
        abi: WASIT_ESCROW_ABI,
        data: errData as `0x${string}`,
      })
      const fn = SENTENCES[decoded.errorName]
      if (fn) return fn(decoded.args as unknown as Record<string, unknown>)
      return `Contract error: ${decoded.errorName}.`
    } catch {
      // fall through — data may not be a known selector
    }
  }

  // 3. viem ContractFunctionRevertedError already has errorName on the object
  const errorName: string =
    (error as { cause?: { data?: { errorName?: string } } })?.cause?.data?.errorName ??
    (error as { data?: { errorName?: string } })?.data?.errorName ?? ''

  if (errorName) {
    const fn = SENTENCES[errorName]
    if (fn) return fn({})
    return `Contract error: ${errorName}.`
  }

  // 4. Raw message substring fallback (handles servers / RPCs that return plain text)
  for (const [name, fn] of Object.entries(SENTENCES)) {
    if (msg.includes(name)) return fn({})
  }

  // 5. Generic
  if (low.includes('insufficient')) return 'Insufficient USDC balance or allowance.'
  if (low.includes('reverted')) return 'Transaction reverted by the contract.'
  return 'Transaction failed. Check the inputs and try again.'
}

/** True when the error is a DealNotFound revert from the contract. */
export function isDealNotFoundError(error: unknown): boolean {
  if (!error) return false
  const msg = (error as { message?: string })?.message ?? ''

  // Try structured decode first
  const errData: unknown =
    (error as { cause?: { data?: unknown } })?.cause?.data ??
    (error as { data?: unknown })?.data
  if (errData) {
    try {
      const decoded = decodeErrorResult({
        abi: WASIT_ESCROW_ABI,
        data: errData as `0x${string}`,
      })
      return decoded.errorName === 'DealNotFound'
    } catch { /* fall through */ }
  }

  // Structured errorName field
  const errorName =
    (error as { cause?: { data?: { errorName?: string } } })?.cause?.data?.errorName ??
    (error as { data?: { errorName?: string } })?.data?.errorName ?? ''
  if (errorName === 'DealNotFound') return true

  // Raw message substring
  return msg.includes('DealNotFound')
}
