import { useAccount, useReadContract, useBlockNumber } from 'wagmi'
import { erc20Abi } from 'viem'
import { useEffect } from 'react'
import { USDC_ADDRESS, SUPPORTED_CHAIN_IDS } from '../lib/wasit-config'

/**
 * Reads the USDC ERC-20 balance for the connected wallet.
 * Calls decimals() on the contract — never hardcodes 18 or 6.
 * Shows nothing when not connected or on an unsupported chain.
 */
export function UsdcBalance() {
  const { address, chainId } = useAccount()

  const isSupported = chainId !== undefined && (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId)

  // Watch new blocks so the balance refreshes automatically after each block
  const { data: blockNumber } = useBlockNumber({ watch: true, chainId })

  // Read decimals from the contract (never hardcode)
  const { data: decimals } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'decimals',
    chainId: chainId,
    query: { enabled: !!address && isSupported },
  })

  const { data: raw, isLoading, refetch: refetchBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: chainId,
    query: { enabled: !!address && isSupported && decimals !== undefined },
  })

  // Refetch whenever a new block arrives
  useEffect(() => {
    if (blockNumber !== undefined && isSupported) {
      void refetchBalance()
    }
  }, [blockNumber, isSupported, refetchBalance])

  if (!address || !isSupported) return null

  const dec = Number(decimals ?? 6)
  const divisor = 10n ** BigInt(dec)
  const formatted =
    raw !== undefined
      ? (() => {
          const whole = raw / divisor
          const frac = raw % divisor
          const fracStr = frac
            .toString()
            .padStart(dec, '0')
            .slice(0, 2)
          return `${whole.toLocaleString('en-US')}.${fracStr}`
        })()
      : null

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '5px 12px',
        borderRadius: 'var(--radius)',
        background: 'var(--elevated)',
        border: '1px solid var(--border)',
        fontSize: '13px',
      }}
    >
      <span style={{ color: 'var(--muted-foreground)', fontWeight: 500 }}>USDC</span>
      <span
        className="mono"
        style={{
          color: 'var(--foreground)',
          fontWeight: 600,
          minWidth: '5ch',
          textAlign: 'right',
        }}
      >
        {isLoading || formatted === null ? (
          <span style={{ color: 'var(--muted-foreground)', fontSize: '11px' }}>—</span>
        ) : (
          formatted
        )}
      </span>
    </div>
  )
}
