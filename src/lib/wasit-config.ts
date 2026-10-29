/**
 * Wasit contract configuration per chain.
 * Fill in MAINNET_CONTRACT_ADDRESS when deployed to Arc mainnet.
 *
 * GAS_FLOOR_GWEI: Arc requires maxFeePerGas >= 20 gwei. Every write transaction
 * in this app must include { maxFeePerGas: GAS_FLOOR } so Arc does not silently
 * drop transactions that fall below the floor.
 */
import { parseGwei } from 'viem'
import { arc, arcTestnet } from 'viem/chains'

// ── Gas floor (Arc: 20 gwei minimum) ─────────────────────────────────────────
export const GAS_FLOOR = parseGwei('20') // 20_000_000_000n

// ── Supported chains ─────────────────────────────────────────────────────────
export const ARC_TESTNET_CHAIN_ID = arcTestnet.id   // 5042002
export const ARC_MAINNET_CHAIN_ID = arc.id          // 5042

export const SUPPORTED_CHAIN_IDS = [ARC_TESTNET_CHAIN_ID, ARC_MAINNET_CHAIN_ID] as const
export type SupportedChainId = typeof SUPPORTED_CHAIN_IDS[number]

// ── Contract addresses ────────────────────────────────────────────────────────
const CONTRACT_ADDRESSES: Record<number, `0x${string}` | null> = {
  [ARC_TESTNET_CHAIN_ID]: '0xdb62589187fee9de76ae69e92b804485803bbb07',
  [ARC_MAINNET_CHAIN_ID]: null, // fill in when deployed
}

export function getContractAddress(chainId: number): `0x${string}` | null {
  return CONTRACT_ADDRESSES[chainId] ?? null
}

// ── USDC (same address on both Arc networks) ─────────────────────────────────
export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const
