/**
 * MyDeals — list every deal the connected wallet is involved in.
 * Scans DealCreated events from the deploy block, filters client-side,
 * and enriches each row with live deal state.
 */
import { useState } from 'react'
import { useAccount, useChainId } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { AlertTriangle, ArrowRight, Plus, RefreshCw, Search, Zap } from 'lucide-react'
import { useMyDeals, type DealSummary } from '../hooks/useMyDeals'
import { fmtUsdc } from '../lib/split'
import { buildTxExplorerUrl } from '../onchain-facts'
import { PageHeader, Badge } from '../components/ui'

interface Props {
  onOpenDeal: (dealId: string) => void
  onCreateDeal: () => void
}

// ── Shared style helpers ────────────────────────────────────────────────────────
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }
const muted: React.CSSProperties = { color: 'var(--muted-foreground)', fontSize: '11px', letterSpacing: '0.05em', textTransform: 'uppercase' }

function fmtDeadline(ts: bigint): string {
  const d = new Date(Number(ts) * 1000)
  return d.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

type BadgeVariant = 'neutral' | 'success' | 'warning' | 'destructive' | 'primary'

function StatePill({ state }: { state: string }) {
  const variant: BadgeVariant =
    state === 'Funded' ? 'success' :
    state === 'Closed' ? 'neutral' : 'neutral'
  return <Badge variant={variant}>{state}</Badge>
}

function RolePill({ role }: { role: string }) {
  const isPrincipal = role === 'Buyer' || role === 'Seller'
  return <Badge variant={isPrincipal ? 'primary' : 'neutral'} dot={false}>{role}</Badge>
}

// ── Skeleton row ───────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <div style={{
      padding: '16px',
      borderBottom: '1px solid var(--border)',
      display: 'grid',
      gridTemplateColumns: '60px 1fr auto',
      gap: '12px',
      alignItems: 'center',
    }}>
      <div className="skeleton" style={{ height: '20px', borderRadius: '4px' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div className="skeleton" style={{ height: '14px', width: '60%', borderRadius: '4px' }} />
        <div className="skeleton" style={{ height: '12px', width: '40%', borderRadius: '4px' }} />
      </div>
      <div className="skeleton" style={{ height: '24px', width: '60px', borderRadius: '12px' }} />
    </div>
  )
}

// ── Progress bar ───────────────────────────────────────────────────────────────
function ScanProgress({ scannedBlock, headBlock }: { scannedBlock: bigint; headBlock: bigint }) {
  if (headBlock === 0n) return null
  const pct = headBlock > 0n ? Math.min(100, Math.round(Number((scannedBlock * 100n) / headBlock))) : 0
  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ ...muted }}>Scanning deal history…</span>
        <span style={{ ...mono, fontSize: '11px', color: 'var(--muted-foreground)' }}>
          block {scannedBlock.toLocaleString()} / {headBlock.toLocaleString()} ({pct}%)
        </span>
      </div>
      <div style={{
        height: '3px',
        background: 'var(--elevated)',
        borderRadius: '2px',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: 'var(--primary)',
          borderRadius: '2px',
          transition: 'width 0.4s ease',
        }} />
      </div>
    </div>
  )
}

// ── Deal row ───────────────────────────────────────────────────────────────────
function DealRow({ deal, onOpen, chainId }: { deal: DealSummary; onOpen: () => void; chainId: number | undefined }) {
  const [nowSec] = useState<number>(() => Math.floor(Date.now() / 1000))
  const progressText = deal.milestoneCount > 0
    ? `${deal.releasedCount} of ${deal.milestoneCount} released`
    : '—'

  const isPast = Number(deal.deadline) < nowSec
  const explorerBase = chainId ? buildTxExplorerUrl(chainId, '0x').replace(/\/tx\/0x$/, '') : undefined

  return (
    <button
      onClick={onOpen}
      style={{
        width: '100%',
        textAlign: 'left',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: '0',
        display: 'block',
      }}
    >
      <div style={{
        padding: '14px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        transition: 'background 0.12s',
      }}
        onMouseEnter={e => ((e.currentTarget).style.background = 'var(--elevated)')}
        onMouseLeave={e => ((e.currentTarget).style.background = 'transparent')}
      >
        {/* Action dot + deal id */}
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', paddingTop: '2px' }}>
          {deal.hasAction && (
            <div style={{
              width: '7px', height: '7px', borderRadius: '50%',
              background: 'var(--primary)', flexShrink: 0,
            }} title="Action available" />
          )}
          <span style={{ ...mono, fontSize: '14px', fontWeight: 700, color: 'var(--foreground)' }}>
            #{deal.dealId}
          </span>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Roles + state */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
            {deal.roles.map(r => <RolePill key={r} role={r} />)}
            <StatePill state={deal.state} />
            {deal.hasAction && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '3px',
                fontSize: '10px', fontWeight: 600, color: 'var(--primary)',
                padding: '2px 7px', borderRadius: '99px',
                background: 'rgb(221 184 134 / 0.12)', border: '1px solid rgb(221 184 134 / 0.25)',
              }}>
                <Zap size={9} strokeWidth={2.5} /> Action needed
              </span>
            )}
          </div>

          {/* Amount + progress + deadline */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <span style={{ ...mono, fontSize: '13px', fontWeight: 600, color: 'var(--foreground)' }}>
              {fmtUsdc(deal.total)} USDC
            </span>
            <span style={{ fontSize: '12px', color: 'var(--muted-foreground)' }}>
              {progressText}
            </span>
            <span style={{
              fontSize: '12px',
              color: isPast && deal.state !== 'Closed' ? 'var(--destructive)' : 'var(--muted-foreground)',
            }}>
              {isPast && deal.state !== 'Closed' ? 'Deadline passed' : fmtDeadline(deal.deadline)}
            </span>
          </div>

          {/* Explorer link */}
          {explorerBase && (
            <a
              href={`${explorerBase}/address/${deal.buyer}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ display: 'none' }}
            />
          )}
        </div>

        {/* Arrow */}
        <ArrowRight size={14} strokeWidth={2} style={{ color: 'var(--muted-foreground)', flexShrink: 0, marginTop: '4px' }} />
      </div>
    </button>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────────
function EmptyDeals({ onCreateDeal }: { onCreateDeal: () => void }) {
  return (
    <div style={{
      padding: '48px 24px',
      textAlign: 'center',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '12px',
    }}>
      <div style={{
        width: '48px', height: '48px', borderRadius: '50%',
        background: 'var(--elevated)', border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Search size={20} strokeWidth={1.5} style={{ color: 'var(--muted-foreground)' }} />
      </div>
      <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>No deals found</p>
      <p style={{ fontSize: '13px', color: 'var(--muted-foreground)', margin: 0, maxWidth: '28ch' }}>
        You are not a party to any deal on this network yet.
      </p>
      <button
        onClick={onCreateDeal}
        style={{
          marginTop: '8px',
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '8px 18px', borderRadius: 'var(--radius)',
          background: 'var(--primary)', color: 'var(--primary-foreground)',
          border: 'none', cursor: 'pointer',
          fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-ui)',
        }}
      >
        <Plus size={14} /> Create your first deal
      </button>
    </div>
  )
}

// ── Open by ID ─────────────────────────────────────────────────────────────────
function OpenById({ onOpen }: { onOpen: (id: string) => void }) {
  const [value, setValue] = useState('')

  function handle() {
    const trimmed = value.trim()
    if (trimmed === '' || isNaN(Number(trimmed))) return
    onOpen(trimmed)
    setValue('')
  }

  return (
    <div style={{
      display: 'flex', gap: '8px', alignItems: 'center',
      padding: '12px 16px',
      borderTop: '1px solid var(--border)',
      background: 'var(--elevated)',
      borderBottomLeftRadius: 'var(--radius)',
      borderBottomRightRadius: 'var(--radius)',
    }}>
      <span style={{ ...muted, flexShrink: 0 }}>Open by ID</span>
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handle() }}
        placeholder="Deal number"
        style={{
          flex: 1, minWidth: 0,
          background: 'var(--background)',
          border: '1px solid var(--border)',
          borderRadius: 'calc(var(--radius) - 0.25rem)',
          padding: '6px 10px',
          fontSize: '13px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--foreground)',
        }}
      />
      <button
        onClick={handle}
        disabled={value.trim() === '' || isNaN(Number(value.trim()))}
        style={{
          padding: '6px 14px',
          borderRadius: 'calc(var(--radius) - 0.25rem)',
          background: 'var(--primary)',
          color: 'var(--primary-foreground)',
          border: 'none', cursor: 'pointer',
          fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-ui)',
          opacity: value.trim() === '' || isNaN(Number(value.trim())) ? 0.4 : 1,
          flexShrink: 0,
        }}
      >
        Go
      </button>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export function MyDeals({ onOpenDeal, onCreateDeal }: Props) {
  const { address } = useAccount()
  const chainId = useChainId()
  const { deals, isScanning, scannedBlock, headBlock, isError, errorMessage, rescan } = useMyDeals(chainId, address)

  // Disconnected
  if (!address) {
    return (
      <PageShell>
        <div style={{
          padding: '40px 24px', textAlign: 'center',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px',
        }}>
          <p style={{ color: 'var(--muted-foreground)', fontSize: '14px', margin: 0 }}>
            Connect your wallet to see your deals.
          </p>
          <ConnectKitButton />
        </div>
        <OpenById onOpen={onOpenDeal} />
      </PageShell>
    )
  }

  // Error state
  if (isError) {
    return (
      <PageShell>
        <div style={{
          padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: '12px',
          alignItems: 'flex-start',
        }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            <AlertTriangle size={18} strokeWidth={1.5} style={{ color: 'var(--destructive)', flexShrink: 0, marginTop: '2px' }} />
            <div>
              <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--foreground)', margin: '0 0 4px' }}>
                Could not load deals
              </p>
              <p style={{ fontSize: '13px', color: 'var(--muted-foreground)', margin: 0, maxWidth: '40ch' }}>
                {errorMessage || 'An error occurred while scanning deal history.'}
              </p>
            </div>
          </div>
          <button
            onClick={rescan}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '7px 14px', borderRadius: 'var(--radius)',
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--foreground)', fontSize: '13px', fontWeight: 500,
              cursor: 'pointer', fontFamily: 'var(--font-ui)',
            }}
          >
            <RefreshCw size={13} /> Retry
          </button>
        </div>
        <OpenById onOpen={onOpenDeal} />
      </PageShell>
    )
  }

  return (
    <PageShell>
      {/* Scan progress */}
      {isScanning && (
        <div style={{ padding: '16px 16px 0' }}>
          <ScanProgress scannedBlock={scannedBlock} headBlock={headBlock} />
        </div>
      )}

      {/* Skeleton rows while first scan in progress */}
      {isScanning && deals.length === 0 && (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      )}

      {/* Deal list */}
      {deals.length > 0 && (
        <>
          {/* Header row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '80px 1fr auto',
            gap: '0 12px',
            padding: '8px 16px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--elevated)',
          }}>
            {['ID', 'Deal', ''].map(h => (
              <span key={h} style={{ ...muted }}>{h}</span>
            ))}
          </div>

          {deals.map(deal => (
            <DealRow
              key={deal.dealId}
              deal={deal}
              onOpen={() => onOpenDeal(deal.dealId)}
              chainId={chainId}
            />
          ))}

          {/* Refresh button when scan is done */}
          {!isScanning && (
            <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={rescan}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px',
                  padding: '5px 12px', borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)', background: 'transparent',
                  color: 'var(--muted-foreground)', fontSize: '12px',
                  cursor: 'pointer', fontFamily: 'var(--font-ui)',
                }}
              >
                <RefreshCw size={11} /> Refresh
              </button>
            </div>
          )}
        </>
      )}

      {/* Empty — only show when scan is complete and truly empty */}
      {!isScanning && deals.length === 0 && (
        <EmptyDeals onCreateDeal={onCreateDeal} />
      )}

      <OpenById onOpen={onOpenDeal} />
    </PageShell>
  )
}

// ── Page shell ─────────────────────────────────────────────────────────────────
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ maxWidth: '800px', margin: '0 auto', padding: '0 16px 80px' }}>
      <PageHeader
        eyebrow="Wasit escrow"
        title="My deals"
        description="All deals where your wallet is buyer, payee, inspector, or arbiter."
      />
      <div style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
      }}>
        {children}
      </div>
    </main>
  )
}
