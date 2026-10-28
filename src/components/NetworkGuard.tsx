import { useAccount, useSwitchChain } from 'wagmi'
import { SUPPORTED_CHAIN_IDS, ARC_TESTNET_CHAIN_ID } from '../lib/wasit-config'
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
}

/**
 * If the connected wallet is on an unsupported chain, renders a prompt to
 * switch to Arc Testnet. Otherwise renders children unchanged.
 */
export function NetworkGuard({ children }: Props) {
  const { address, chainId } = useAccount()
  const { switchChain, isPending } = useSwitchChain()

  // Not connected — nothing to guard
  if (!address) return <>{children}</>

  const isSupported =
    chainId !== undefined &&
    (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId)

  if (isSupported) return <>{children}</>

  return (
    <>
      <div
        style={{
          position: 'fixed',
          top: '64px',
          left: 0,
          right: 0,
          zIndex: 50,
          padding: '12px 20px',
          background: 'rgb(232 115 95 / 0.10)',
          borderBottom: '1px solid rgb(232 115 95 / 0.22)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ color: 'var(--destructive)', fontSize: '13px', fontWeight: 500 }}>
          Wasit runs on Arc. Please switch your wallet to Arc Testnet or Arc Mainnet.
        </span>
        <button
          onClick={() => switchChain({ chainId: ARC_TESTNET_CHAIN_ID })}
          disabled={isPending}
          style={{
            padding: '6px 16px',
            borderRadius: 'var(--radius)',
            background: 'var(--destructive)',
            color: '#fff',
            border: 'none',
            fontSize: '12px',
            fontWeight: 600,
            cursor: isPending ? 'not-allowed' : 'pointer',
            opacity: isPending ? 0.7 : 1,
            fontFamily: 'var(--font-ui)',
          }}
        >
          {isPending ? 'Switching…' : 'Switch to Arc Testnet'}
        </button>
      </div>
      {children}
    </>
  )
}
