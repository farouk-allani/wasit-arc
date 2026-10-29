/** Shared formatting utilities. */

/** Shorten an address to 0x1234…abcd */
export function shortAddress(addr: string): string {
  if (addr.length < 10) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/** Format a raw USDC amount (6-decimal bigint) as a human string, e.g. "4.00" */
export function formatUsdc(raw: bigint, decimals = 6): string {
  const divisor = 10n ** BigInt(decimals)
  const whole = raw / divisor
  const frac = raw % divisor
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '') || '0'
  const trimmed = fracStr.length > 2 ? fracStr.slice(0, 2) : fracStr.padEnd(2, '0')
  return `${whole.toString()}.${trimmed}`
}
