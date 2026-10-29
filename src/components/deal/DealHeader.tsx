/** Deal header — id, state badge, parties, total, window, deadline. */
import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { DealData } from '../../hooks/useDeal'
import { shortAddress } from '../../lib/format'
import { fmtUsdc } from '../../lib/split'
import { buildTxExplorerUrl } from '../../onchain-facts'

// ── Style helpers ─────────────────────────────────────────────────────────────
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' }
const muted: React.CSSProperties = { color: 'var(--muted-foreground)', fontSize: '11px', letterSpacing: '0.06em', textTransform: 'uppercase' }
const value: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--foreground)', fontVariantNumeric: 'tabular-nums' }

const STATE_STYLE: Record<string, React.CSSProperties> = {
  Created: { background: 'rgb(180 191 207 / 0.12)', color: 'var(--secondary-foreground)', border: '1px solid var(--border)' },
  Funded:  { background: 'rgb(92 196 154 / 0.12)',  color: 'var(--success)',               border: '1px solid rgb(92 196 154 / 0.3)' },
  Closed:  { background: 'rgb(180 191 207 / 0.08)', color: 'var(--muted-foreground)',       border: '1px solid var(--border)' },
}

function StateBadge({ state }: { state: string }) {
  return (
    <span style={{
      ...STATE_STYLE[state],
      padding: '2px 10px',
      borderRadius: '99px',
      fontSize: '11px',
      fontWeight: 600,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      fontFamily: 'var(--font-ui)',
    }}>
      {state}
    </span>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p style={muted}>{label}</p>
      <div style={{ marginTop: '4px' }}>{children}</div>
    </div>
  )
}

function AddrField({ label, addr, chainId }: { label: string; addr: string; chainId: number | undefined }) {
  const explorerUrl = chainId ? `${buildTxExplorerUrl(chainId, '0x').replace(/\/tx\/0x$/, '')}/address/${addr}` : undefined
  return (
    <Field label={label}>
      <span style={value}>
        {shortAddress(addr)}
        {explorerUrl && (
          <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
            style={{ marginLeft: '6px', color: 'var(--primary)', verticalAlign: 'middle' }}>
            <ExternalLink size={12} strokeWidth={2} />
          </a>
        )}
      </span>
    </Field>
  )
}

function fmtSeconds(secs: bigint): string {
  const s = Number(secs)
  if (s < 120) return `${s} seconds`
  if (s < 3600) return `${Math.round(s / 60)} minutes`
  if (s < 86400) return `${Math.round(s / 3600)} hours`
  return `${Math.round(s / 86400)} days`
}

function fmtDeadline(ts: bigint): string {
  const d = new Date(Number(ts) * 1000)
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

interface Props {
  dealId: string
  deal: DealData
  chainId: number | undefined
}

export function DealHeader({ dealId, deal, chainId }: Props) {
  const [nowSec] = useState<number>(() => Math.floor(Date.now() / 1000))
  const isPast = Number(deal.deadline) < nowSec

  return (
    <div style={{ marginBottom: '32px' }}>
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <p style={{ ...mono, fontSize: '11px', color: 'var(--muted-foreground)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
          Deal
        </p>
        <h1 style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '26px',
          fontWeight: 700,
          color: 'var(--foreground)',
          margin: 0,
          fontVariantNumeric: 'tabular-nums',
        }}>
          #{dealId}
        </h1>
        <StateBadge state={deal.state} />
      </div>

      {/* Info grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: '20px 32px',
        padding: '20px 24px',
        background: 'var(--card)',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
      }}>
        <AddrField label="Buyer" addr={deal.buyer} chainId={chainId} />
        <AddrField label="Inspector" addr={deal.inspector} chainId={chainId} />
        <AddrField label="Arbiter" addr={deal.arbiter} chainId={chainId} />

        <Field label="Total">
          <span style={{ ...value, color: 'var(--foreground)', fontWeight: 600 }}>
            {fmtUsdc(deal.total)} USDC
          </span>
        </Field>

        <Field label="Challenge window">
          <span style={value}>{fmtSeconds(deal.challengeWindow)}</span>
          <p style={{ ...muted, marginTop: '3px', textTransform: 'none', letterSpacing: 0, fontSize: '11px', color: 'var(--muted-foreground)' }}>
            after attest, the buyer has this long to dispute
          </p>
        </Field>

        <Field label="Deadline">
          <span style={{ ...value, color: isPast ? 'var(--destructive)' : 'var(--foreground)' }}>
            {fmtDeadline(deal.deadline)}
          </span>
          {isPast && (
            <p style={{ ...muted, marginTop: '3px', textTransform: 'none', color: 'var(--destructive)', fontSize: '11px', letterSpacing: 0 }}>
              deadline passed — unattested milestones can be refunded
            </p>
          )}
        </Field>
      </div>
    </div>
  )
}
