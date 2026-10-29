import { isAddress } from 'viem'
import { parseUsdcInput } from './split'
import type { PayeeRow, MilestoneRow } from '../hooks/useCreateDeal'

const MAX_CHALLENGE_WINDOW_SECS = 7 * 24 * 3600 // 7 days

export interface ValidationResult {
  errors: string[]
  /** true when the form is completely valid */
  valid: boolean
}

export function validateDeal(
  payees: PayeeRow[],
  milestones: MilestoneRow[],
  inspector: string,
  arbiter: string,
  challengeWindowSecs: number,
  deadlineDate: string,
  feeBps: number,
  buyerAddress: string,
): ValidationResult {
  const errors: string[] = []

  // ── Payee count ───────────────────────────────────────────────────────────
  if (payees.length < 1 || payees.length > 6) {
    errors.push(`Payees: must have 1–6 rows (have ${payees.length}).`)
  }

  // ── Per-payee ─────────────────────────────────────────────────────────────
  const seenAddrs = new Set<string>()
  for (let i = 0; i < payees.length; i++) {
    const p = payees[i]
    const label = i === 0 ? 'Seller' : `Payee ${i + 1}`

    if (!p.addr || !isAddress(p.addr)) {
      errors.push(`${label}: invalid address.`)
    } else {
      const lower = p.addr.toLowerCase()
      if (lower === '0x0000000000000000000000000000000000000000') {
        errors.push(`${label}: zero address not allowed.`)
      } else if (seenAddrs.has(lower)) {
        errors.push(`${label}: duplicate address ${p.addr.slice(0, 8)}…`)
      } else {
        seenAddrs.add(lower)
      }
    }

    const bpsN = parseInt(p.bps, 10)
    if (isNaN(bpsN) || bpsN < 0 || bpsN > 10000) {
      errors.push(`${label}: bps must be 0–10000.`)
    } else if (i === 0 && bpsN === 0) {
      errors.push(`Seller bps must be > 0.`)
    }
  }

  // ── BPS sum ───────────────────────────────────────────────────────────────
  const bpsSum = payees.reduce((s, p) => s + (parseInt(p.bps, 10) || 0), 0)
  const expectedSum = 10000 - feeBps
  if (bpsSum !== expectedSum && payees.length >= 1 && payees.length <= 6) {
    const diff = expectedSum - bpsSum
    if (diff > 0) {
      errors.push(`Bps total ${bpsSum} is ${diff} short of ${expectedSum} (10000 − ${feeBps} fee).`)
    } else {
      errors.push(`Bps total ${bpsSum} exceeds ${expectedSum} by ${-diff} (10000 − ${feeBps} fee).`)
    }
  }

  // ── Milestones ────────────────────────────────────────────────────────────
  if (milestones.length < 1 || milestones.length > 5) {
    errors.push(`Milestones: must have 1–5 rows (have ${milestones.length}).`)
  }
  for (let i = 0; i < milestones.length; i++) {
    const m = milestones[i]
    const raw = parseUsdcInput(m.amount)
    if (raw === null) {
      errors.push(`Milestone ${i + 1}: invalid amount "${m.amount}".`)
    } else if (raw === 0n) {
      errors.push(`Milestone ${i + 1}: amount must be > 0.`)
    }
  }

  // ── Inspector ─────────────────────────────────────────────────────────────
  if (!inspector || !isAddress(inspector)) {
    errors.push('Inspector: invalid address.')
  } else {
    const inspLower = inspector.toLowerCase()
    const sellerLower = payees[0]?.addr?.toLowerCase()
    if (inspLower === sellerLower) {
      errors.push('Inspector must not be the seller.')
    }
    if (inspLower === '0x0000000000000000000000000000000000000000') {
      errors.push('Inspector: zero address not allowed.')
    }
  }

  // ── Arbiter ───────────────────────────────────────────────────────────────
  if (!arbiter || !isAddress(arbiter)) {
    errors.push('Arbiter: invalid address.')
  } else {
    const arbLower = arbiter.toLowerCase()
    if (arbLower === '0x0000000000000000000000000000000000000000') {
      errors.push('Arbiter: zero address not allowed.')
    }
    if (buyerAddress && arbLower === buyerAddress.toLowerCase()) {
      errors.push('Arbiter must not be the connected wallet (the buyer).')
    }
    const sellerLower = payees[0]?.addr?.toLowerCase()
    if (sellerLower && isAddress(payees[0]?.addr) && arbLower === sellerLower) {
      errors.push('Arbiter must not be the seller.')
    }
    // Arbiter must not be any payee
    for (let i = 0; i < payees.length; i++) {
      if (isAddress(payees[i].addr) && payees[i].addr.toLowerCase() === arbLower) {
        const label = i === 0 ? 'seller' : `payee ${i + 1}`
        errors.push(`Arbiter must not be a payee (${label}).`)
        break
      }
    }
  }

  // ── Challenge window ──────────────────────────────────────────────────────
  if (challengeWindowSecs <= 0) {
    errors.push('Challenge window must be > 0.')
  } else if (challengeWindowSecs > MAX_CHALLENGE_WINDOW_SECS) {
    errors.push('Challenge window must be at most 7 days.')
  }

  // ── Deadline ──────────────────────────────────────────────────────────────
  if (!deadlineDate) {
    errors.push('Deadline is required.')
  } else {
    const deadlineMs = new Date(deadlineDate).getTime()
    const minDeadlineMs = Date.now() + challengeWindowSecs * 1000
    if (isNaN(deadlineMs)) {
      errors.push('Deadline: invalid date.')
    } else if (deadlineMs <= minDeadlineMs) {
      errors.push(
        `Deadline must be later than now + challenge window (${new Date(minDeadlineMs).toLocaleString()}).`,
      )
    }
  }

  return { errors, valid: errors.length === 0 }
}

export { MAX_CHALLENGE_WINDOW_SECS }
