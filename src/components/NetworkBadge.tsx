import { arc, arcTestnet } from 'viem/chains'
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID } from '../lib/wasit-config'

interface Props {
  chainId: number | undefined
  /** When true, shows a switch prompt style instead of a status badge */
  warn?: boolean
}

const CHAIN_LABELS: Record<number, string> = {
  [ARC_TESTNET_CHAIN_ID]: 'Arc Testnet',
  [ARC_MAINNET_CHAIN_ID]: 'Arc Mainnet',
}

/** Small pill that shows the active Arc network, or a warning if unsupported. */
export function NetworkBadge({ chainId, warn }: Props) {
  if (!chainId) return null

  const label = CHAIN_LABELS[chainId]
  const isTestnet = chainId === arcTestnet.id
  const isMainnet = chainId === arc.id
  const isSupported = isTestnet || isMainnet

  if (!isSupported || warn) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          padding: '3px 10px',
          borderRadius: '999px',
          fontSize: '12px',
          fontWeight: 600,
          letterSpacing: '0.04em',
          background: 'rgb(232 115 95 / 0.12)',
          color: 'var(--destructive)',
          border: '1px solid rgb(232 115 95 / 0.25)',
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--destructive)',
            display: 'inline-block',
          }}
        />
        Wrong network
      </span>
    )
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: '3px 10px',
        borderRadius: '999px',
        fontSize: '12px',
        fontWeight: 600,
        letterSpacing: '0.04em',
        background: isTestnet ? 'rgb(92 196 154 / 0.10)' : 'rgb(221 184 134 / 0.12)',
        color: isTestnet ? 'var(--success)' : 'var(--primary)',
        border: isTestnet
          ? '1px solid rgb(92 196 154 / 0.22)'
          : '1px solid rgb(221 184 134 / 0.22)',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: isTestnet ? 'var(--success)' : 'var(--primary)',
          display: 'inline-block',
        }}
      />
      {label}
    </span>
  )
}
