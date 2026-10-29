import { ConnectKitButton } from 'connectkit'
import { useAccount } from 'wagmi'
import { useEffect, useState } from 'react'
import { WasitLogo } from './WasitLogo'
import { NetworkBadge } from './NetworkBadge'
import { UsdcBalance } from './UsdcBalance'
import { SUPPORTED_CHAIN_IDS } from '../lib/wasit-config'

interface Props {
  currentPage: 'home' | 'create' | 'deals' | 'deal'
  onNavigate: (page: 'home' | 'create' | 'deals') => void
  /** When true, starts transparent and becomes solid on scroll */
  isHero?: boolean
}

export function Header({ currentPage, onNavigate, isHero }: Props) {
  const { address, chainId } = useAccount()
  const isSupported =
    chainId !== undefined &&
    (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId)

  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    if (!isHero) return
    const onScroll = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [isHero])

  const transparent = isHero && !scrolled

  return (
    <header
      className={transparent ? 'header-transparent' : 'header-solid'}
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 40,
        height: '64px',
        background: 'rgba(11, 22, 36, 0.92)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: '12px',
        transition: 'background 0.25s ease, border-color 0.25s ease, backdrop-filter 0.25s ease',
      }}
    >
      {/* Logo + wordmark */}
      <button
        onClick={() => onNavigate('home')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '4px 0',
          marginRight: '4px',
          flexShrink: 0,
        }}
        aria-label="Wasit home"
      >
        <WasitLogo size={30} />
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: '17px',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: 'var(--foreground)',
          }}
        >
          Wasit
        </span>
      </button>

      {/* Nav links */}
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
          flex: 1,
          minWidth: 0,
        }}
        role="navigation"
        aria-label="Main navigation"
      >
        <NavLink
          label="Home"
          active={currentPage === 'home'}
          onClick={() => onNavigate('home')}
        />
        <NavLink
          label="Create"
          active={currentPage === 'create'}
          onClick={() => onNavigate('create')}
        />
        <NavLink
          label="My deals"
          active={currentPage === 'deals'}
          onClick={() => onNavigate('deals')}
        />
      </nav>

      {/* Right side */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        {/* Network badge — only when connected */}
        {address && (
          <NetworkBadge
            chainId={chainId}
            warn={!isSupported}
          />
        )}

        {/* USDC balance — hidden on very small screens */}
        <span className="header-balance">
          <UsdcBalance />
        </span>

        {/* Wallet connect */}
        <ConnectKitButton.Custom>
          {({ isConnected, show, address: addr }) => (
            <button
              onClick={show}
              style={{
                padding: '7px 16px',
                borderRadius: 'var(--radius)',
                background: isConnected ? 'var(--elevated)' : 'var(--primary)',
                color: isConnected ? 'var(--foreground)' : 'var(--primary-foreground)',
                border: isConnected ? '1px solid var(--border)' : 'none',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'var(--font-ui)',
                letterSpacing: '0.01em',
                whiteSpace: 'nowrap',
                minHeight: '36px',
              }}
            >
              {isConnected && addr
                ? `${addr.slice(0, 6)}…${addr.slice(-4)}`
                : 'Connect wallet'}
            </button>
          )}
        </ConnectKitButton.Custom>
      </div>
    </header>
  )
}

function NavLink({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        border: 'none',
        cursor: 'pointer',
        padding: '6px 12px',
        borderRadius: 'calc(var(--radius) - 0.125rem)',
        fontSize: '13px',
        fontWeight: active ? 600 : 400,
        color: active ? 'var(--foreground)' : 'var(--muted-foreground)',
        background: active ? 'var(--elevated)' : 'transparent',
        fontFamily: 'var(--font-ui)',
        letterSpacing: '0.01em',
        transition: 'color 0.15s, background 0.15s',
        minHeight: '36px',
      }}
    >
      {label}
    </button>
  )
}
