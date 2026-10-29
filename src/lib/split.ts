/**
 * Pure integer split-preview logic — mirrors the Solidity contract exactly.
 *
 * Contract arithmetic (from _releasePayout):
 *   fee          = A * feeBps / 10000          (integer division, rounds down)
 *   payee[j>=1]  = A * bps_j / 10000           (integer division, rounds down)
 *   seller       = A - fee - sum(other payees) (remainder — dust lands here)
 *
 * This ensures the rows always sum to exactly A.
 */

export interface PayeeInput {
  addr: string
  role: string
  bps: number // 0-10000 raw bps integer
}

export interface SplitRow {
  role: string
  addr: string
  bps: number
  amount: bigint // in raw USDC units (6 dec)
  isFee: boolean
  isSeller: boolean
}

export interface SplitPreview {
  rows: SplitRow[]
  total: bigint
  /** true when rows sum exactly to 'amount' */
  exact: boolean
}

const BPS_DENOM = 10_000n

/**
 * Compute the split for a release of `amount` raw USDC units.
 * Pass feeBps as a number (e.g. 200 for 2%).
 * payees[0] is always the seller — gets the remainder.
 */
export function computeSplit(
  amount: bigint,
  feeBps: number,
  payees: PayeeInput[],
): SplitPreview {
  if (payees.length === 0 || amount <= 0n) {
    return { rows: [], total: amount, exact: true }
  }

  const feeBpsN = BigInt(feeBps)
  const feeAmount = (amount * feeBpsN) / BPS_DENOM

  // payees[1..] (non-seller)
  let otherSum = 0n
  const otherRows: SplitRow[] = payees.slice(1).map((p) => {
    const a = (amount * BigInt(p.bps)) / BPS_DENOM
    otherSum += a
    return {
      role: p.role || `Payee`,
      addr: p.addr,
      bps: p.bps,
      amount: a,
      isFee: false,
      isSeller: false,
    }
  })

  // seller takes the remainder
  const sellerAmount = amount - feeAmount - otherSum
  const seller = payees[0]
  const sellerRow: SplitRow = {
    role: seller.role || 'Seller',
    addr: seller.addr,
    bps: seller.bps,
    amount: sellerAmount < 0n ? 0n : sellerAmount,
    isFee: false,
    isSeller: true,
  }

  const feeRow: SplitRow = {
    role: 'Platform fee',
    addr: '',
    bps: feeBps,
    amount: feeAmount,
    isFee: true,
    isSeller: false,
  }

  const rows = [sellerRow, ...otherRows, feeRow]
  const rowSum = rows.reduce((s, r) => s + r.amount, 0n)
  const exact = rowSum === amount

  return { rows, total: amount, exact }
}

/** Format a raw 6-decimal USDC bigint as "1,234.560000" */
export function fmtUsdc(raw: bigint, dec = 6): string {
  if (raw < 0n) return '-' + fmtUsdc(-raw, dec)
  const divisor = 10n ** BigInt(dec)
  const whole = raw / divisor
  const frac = (raw % divisor).toString().padStart(dec, '0')
  return `${whole.toLocaleString('en-US')}.${frac}`
}

/** Parse a human USDC string (e.g. "4.5") into raw 6-decimal units, or null on invalid */
export function parseUsdcInput(s: string): bigint | null {
  const trimmed = s.trim()
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) return null
  const [wholePart, fracPart = ''] = trimmed.split('.')
  const frac = fracPart.slice(0, 6).padEnd(6, '0')
  try {
    return BigInt(wholePart) * 1_000_000n + BigInt(frac)
  } catch {
    return null
  }
}
