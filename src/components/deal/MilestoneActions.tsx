/**
 * MilestoneActions — role-aware action panel for a single milestone.
 * Shows only actions the connected wallet can perform; explains who else
 * can act when the wallet isn't the right role.
 */
import { useState, useEffect } from 'react'
import { keccak256, toBytes } from 'viem'
import { ExternalLink, Clock, CheckCircle, Info } from 'lucide-react'
import type { MilestoneData, DealData } from '../../hooks/useDeal'
import {
  useAttest, useApproveMilestone, useRelease, useDispute,
  useResolve, useRefundExpired, useReleaseStalled,
} from '../../hooks/useDealActions'
import { fmtUsdc, type PayeeInput } from '../../lib/split'
import { buildTxExplorerUrl } from '../../onchain-facts'

// ── Button styles ─────────────────────────────────────────────────────────────
const btn = (variant: 'primary' | 'ghost' | 'danger' | 'warning'): React.CSSProperties => ({
  padding: '8px 18px',
  borderRadius: 'var(--radius)',
  border: variant === 'ghost' ? '1px solid var(--border)' : 'none',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 600,
  fontFamily: 'var(--font-ui)',
  minHeight: '36px',
  background:
    variant === 'primary' ? 'var(--primary)' :
    variant === 'danger'  ? 'var(--destructive)' :
    variant === 'warning' ? 'rgb(231 176 87 / 0.15)' :
    'var(--elevated)',
  color:
    variant === 'primary' ? 'var(--primary-foreground)' :
    variant === 'danger'  ? '#fff' :
    variant === 'warning' ? 'var(--warning)' :
    'var(--foreground)',
})

// ── Shared sub-components ─────────────────────────────────────────────────────
function TxLink({ hash, chainId }: { hash: `0x${string}` | undefined; chainId: number | undefined }) {
  if (!hash || !chainId) return null
  return (
    <a
      href={buildTxExplorerUrl(chainId, hash)}
      target="_blank"
      rel="noopener noreferrer"
      style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--primary)', fontFamily: 'var(--font-mono)', marginTop: '8px' }}
    >
      {hash.slice(0, 10)}…{hash.slice(-6)} <ExternalLink size={10} />
    </a>
  )
}

function StatusMsg({ isPending, isConfirming, isSuccess, isError, error, hash, chainId }: {
  isPending: boolean; isConfirming: boolean; isSuccess: boolean; isError: boolean
  error: Error | null; hash: `0x${string}` | undefined; chainId: number | undefined
}) {
  if (isPending) return <p style={{ fontSize: '12px', color: 'var(--muted-foreground)', margin: '8px 0 0' }}>Confirm in wallet…</p>
  if (isConfirming) return (
    <div style={{ marginTop: '8px' }}>
      <p style={{ fontSize: '12px', color: 'var(--muted-foreground)', margin: 0 }}>Waiting for confirmation…</p>
      <TxLink hash={hash} chainId={chainId} />
    </div>
  )
  if (isSuccess) return (
    <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
      <CheckCircle size={13} style={{ color: 'var(--success)' }} />
      <span style={{ fontSize: '12px', color: 'var(--success)' }}>Done</span>
      <TxLink hash={hash} chainId={chainId} />
    </div>
  )
  if (isError && error) return (
    <p style={{ fontSize: '12px', color: 'var(--destructive)', margin: '8px 0 0', maxWidth: '340px' }}>
      {(error as { shortMessage?: string }).shortMessage ?? error.message}
    </p>
  )
  return null
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: '12px', color: 'var(--muted-foreground)', margin: '6px 0 0', display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
      <Info size={12} style={{ marginTop: '2px', flexShrink: 0 }} />
      {children}
    </p>
  )
}

function ActionPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: '14px 16px',
      background: 'var(--elevated)',
      borderRadius: 'calc(var(--radius) - 0.125rem)',
      border: '1px solid var(--border)',
    }}>
      <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--foreground)', margin: '0 0 10px', letterSpacing: '0.02em' }}>{title}</p>
      {children}
    </div>
  )
}

function shortAddrInline(addr: string) {
  return <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{addr.slice(0, 6)}…{addr.slice(-4)}</span>
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '11px', color: 'var(--muted-foreground)',
  marginBottom: '4px', letterSpacing: '0.04em',
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--background)', border: '1px solid var(--border)',
  borderRadius: 'calc(var(--radius) - 0.125rem)', padding: '7px 10px',
  fontSize: '13px', fontFamily: 'var(--font-mono)', color: 'var(--foreground)', boxSizing: 'border-box',
}

// ── Live countdown ────────────────────────────────────────────────────────────
function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function Countdown({ expiresAt, label }: { expiresAt: number; label: string }) {
  const now = useNow()
  const remaining = expiresAt - now
  if (expiresAt === 0) return <span style={{ color: 'var(--muted-foreground)', fontSize: '12px' }}>Timing unavailable — try releasing</span>
  if (remaining <= 0) return <span style={{ color: 'var(--success)', fontSize: '12px' }}>{label} — available now</span>
  const h = Math.floor(remaining / 3600)
  const m = Math.floor((remaining % 3600) / 60)
  const s = remaining % 60
  const fmt = h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`
  return (
    <span style={{ color: 'var(--warning)', fontSize: '12px', fontFamily: 'var(--font-mono)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      <Clock size={12} /> {fmt} — {label}
    </span>
  )
}

// ── Resolve preview ───────────────────────────────────────────────────────────
function ResolvePreview({ amount, sellerBps }: { amount: bigint; sellerBps: number }) {
  const sellerSideTotal = (amount * BigInt(Math.max(0, Math.min(10000, sellerBps)))) / 10000n
  const buyerRefund = amount - sellerSideTotal
  return (
    <div style={{ marginTop: '8px', padding: '10px 14px', background: 'var(--card)', borderRadius: 'calc(var(--radius) - 0.125rem)', border: '1px solid var(--border)' }}>
      <p style={{ fontSize: '11px', color: 'var(--muted-foreground)', margin: '0 0 6px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Resolve preview</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        <PreviewRow label="Seller side" value={`${fmtUsdc(sellerSideTotal)} USDC`} />
        <PreviewRow label="Buyer refund" value={`${fmtUsdc(buyerRefund)} USDC`} accent />
      </div>
    </div>
  )
}

function PreviewRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
      <span style={{ fontSize: '12px', color: 'var(--muted-foreground)' }}>{label}</span>
      <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: accent ? 'var(--primary)' : 'var(--foreground)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  dealId: bigint
  ms: MilestoneData
  deal: DealData
  connectedAddress: `0x${string}` | undefined
  arbitrationWindow: bigint
  feeBps: number
  payees?: PayeeInput[]
  chainId: number | undefined
  onSuccess: () => void
}

export function MilestoneActions({
  dealId, ms, deal, connectedAddress, arbitrationWindow, chainId, onSuccess,
}: Props) {
  const [evidenceRef, setEvidenceRef] = useState('')
  const [disputeReason, setDisputeReason] = useState('')
  const [sellerShareBps, setSellerShareBps] = useState('5000')

  const attest = useAttest(chainId)
  const approveMilestone = useApproveMilestone(chainId)
  const release = useRelease(chainId)
  const dispute = useDispute(chainId)
  const resolve = useResolve(chainId)
  const refundExpired = useRefundExpired(chainId)
  const releaseStalled = useReleaseStalled(chainId)

  // Trigger parent refresh after any success
  useEffect(() => { if (attest.isSuccess) onSuccess() }, [attest.isSuccess, onSuccess])
  useEffect(() => { if (approveMilestone.isSuccess) onSuccess() }, [approveMilestone.isSuccess, onSuccess])
  useEffect(() => { if (release.isSuccess) onSuccess() }, [release.isSuccess, onSuccess])
  useEffect(() => { if (dispute.isSuccess) onSuccess() }, [dispute.isSuccess, onSuccess])
  useEffect(() => { if (resolve.isSuccess) onSuccess() }, [resolve.isSuccess, onSuccess])
  useEffect(() => { if (refundExpired.isSuccess) onSuccess() }, [refundExpired.isSuccess, onSuccess])
  useEffect(() => { if (releaseStalled.isSuccess) onSuccess() }, [releaseStalled.isSuccess, onSuccess])

  const nowTs = useNow()
  const addr = connectedAddress?.toLowerCase()
  const isBuyer = addr === deal.buyer.toLowerCase()
  const isInspector = addr === deal.inspector.toLowerCase()
  const isArbiter = addr === deal.arbiter.toLowerCase()
  const isFunded = deal.state === 'Funded'
  const { state } = ms

  // Timing derived from on-chain event logs
  const challengeExpiresAt = ms.attestedAt > 0 ? ms.attestedAt + Number(deal.challengeWindow) : 0
  const challengeExpired = challengeExpiresAt > 0 ? nowTs >= challengeExpiresAt : false
  const arbitrationExpiresAt = ms.disputedAt > 0 ? ms.disputedAt + Number(arbitrationWindow) : 0
  const arbitrationExpired = arbitrationExpiresAt > 0 ? nowTs >= arbitrationExpiresAt : false
  const deadlinePassed = nowTs > Number(deal.deadline)

  // Computed evidence hash shown to user
  const evidenceHashDisplay = evidenceRef
    ? keccak256(toBytes(evidenceRef))
    : null

  const sellerBpsNum = Math.max(0, Math.min(10000, Number(sellerShareBps) || 0))

  // ── Build action panels ───────────────────────────────────────────────────
  const panels: React.ReactNode[] = []

  // ── ATTEST ────────────────────────────────────────────────────────────────
  if (isFunded && state === 'Pending') {
    if (isInspector) {
      panels.push(
        <ActionPanel key="attest" title="Attest milestone">
          <label style={labelStyle}>Evidence reference (optional)</label>
          <input
            style={inputStyle}
            value={evidenceRef}
            onChange={e => setEvidenceRef(e.target.value)}
            placeholder="URL, IPFS CID, or any text — hashed to bytes32"
          />
          {evidenceHashDisplay && (
            <p style={{ fontSize: '10px', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', margin: '4px 0 0', wordBreak: 'break-all' }}>
              keccak256: {evidenceHashDisplay}
            </p>
          )}
          <div style={{ marginTop: '12px' }}>
            <button
              style={{ ...btn('primary'), opacity: attest.isPending || attest.isConfirming ? 0.7 : 1 }}
              disabled={attest.isPending || attest.isConfirming}
              onClick={() => attest.attest(dealId, BigInt(ms.index), evidenceRef)}
            >
              {attest.isPending ? 'Confirm in wallet…' : attest.isConfirming ? 'Confirming…' : 'Attest'}
            </button>
          </div>
          <StatusMsg {...attest} isError={!!attest.error} hash={attest.txHash} chainId={chainId} />
        </ActionPanel>
      )
    } else if (!deadlinePassed) {
      panels.push(<Note key="attest-wait">Waiting for the inspector ({shortAddrInline(deal.inspector)}) to attest this milestone.</Note>)
    }
  }

  // ── APPROVE MILESTONE (buyer) — pending or attested ───────────────────────
  if (isFunded && (state === 'Pending' || state === 'Attested') && isBuyer) {
    panels.push(
      <ActionPanel key="approve-ms" title="Approve milestone">
        <Note>Approves immediately — releases payment without waiting for the challenge window to close.</Note>
        <div style={{ marginTop: '10px' }}>
          <button
            style={{ ...btn('primary'), opacity: approveMilestone.isPending || approveMilestone.isConfirming ? 0.7 : 1 }}
            disabled={approveMilestone.isPending || approveMilestone.isConfirming}
            onClick={() => approveMilestone.approveMilestone(dealId, BigInt(ms.index))}
          >
            {approveMilestone.isPending ? 'Confirm in wallet…' : approveMilestone.isConfirming ? 'Confirming…' : 'Approve milestone'}
          </button>
        </div>
        <StatusMsg {...approveMilestone} isError={!!approveMilestone.error} hash={approveMilestone.txHash} chainId={chainId} />
      </ActionPanel>
    )
  }

  // ── DISPUTE (buyer, attested, inside challenge window) ─────────────────────
  if (isFunded && state === 'Attested' && isBuyer) {
    panels.push(
      <ActionPanel key="dispute" title="Dispute milestone">
        {!challengeExpired && challengeExpiresAt > 0 && (
          <div style={{ marginBottom: '10px' }}>
            <Countdown expiresAt={challengeExpiresAt} label="challenge window open" />
          </div>
        )}
        {challengeExpired && (
          <Note>The challenge window has closed. You can still dispute, but only the arbiter can unblock it.</Note>
        )}
        <label style={labelStyle}>Reason</label>
        <input
          style={inputStyle}
          value={disputeReason}
          onChange={e => setDisputeReason(e.target.value)}
          placeholder="Briefly explain why this milestone is disputed"
        />
        <div style={{ marginTop: '10px' }}>
          <button
            style={{ ...btn('danger'), opacity: dispute.isPending || dispute.isConfirming || !disputeReason.trim() ? 0.6 : 1 }}
            disabled={dispute.isPending || dispute.isConfirming || !disputeReason.trim()}
            onClick={() => dispute.dispute(dealId, BigInt(ms.index), disputeReason)}
          >
            {dispute.isPending ? 'Confirm in wallet…' : dispute.isConfirming ? 'Confirming…' : 'Dispute'}
          </button>
        </div>
        <StatusMsg {...dispute} isError={!!dispute.error} hash={dispute.txHash} chainId={chainId} />
      </ActionPanel>
    )
  }

  // ── RELEASE (anyone, attested with window elapsed or buyer-approved) ────────
  if (isFunded && (state === 'Attested' || state === 'Approved')) {
    const canRelease = state === 'Approved' || challengeExpired
    panels.push(
      <ActionPanel key="release" title="Release milestone">
        {state === 'Attested' && challengeExpiresAt > 0 && (
          <div style={{ marginBottom: '10px' }}>
            <Countdown expiresAt={challengeExpiresAt} label="release window opens" />
          </div>
        )}
        {state === 'Approved' && (
          <Note>Buyer has approved — release is available immediately.</Note>
        )}
        <div style={{ marginTop: '10px' }}>
          <button
            style={{ ...btn('primary'), opacity: !canRelease || release.isPending || release.isConfirming ? 0.6 : 1 }}
            disabled={!canRelease || release.isPending || release.isConfirming}
            onClick={() => release.release(dealId, BigInt(ms.index))}
          >
            {release.isPending ? 'Confirm in wallet…' : release.isConfirming ? 'Confirming…' : 'Release'}
          </button>
        </div>
        {!canRelease && <Note>The challenge window has not yet closed. Wait for the countdown above.</Note>}
        <StatusMsg {...release} isError={!!release.error} hash={release.txHash} chainId={chainId} />
      </ActionPanel>
    )
  }

  // ── RESOLVE (arbiter, disputed) ────────────────────────────────────────────
  if (isFunded && state === 'Disputed') {
    if (isArbiter) {
      panels.push(
        <ActionPanel key="resolve" title="Resolve dispute">
          <label style={labelStyle}>Seller share in bps (0 = full refund to buyer, 10000 = full release to seller)</label>
          <input
            style={inputStyle}
            type="number"
            min={0}
            max={10000}
            value={sellerShareBps}
            onChange={e => setSellerShareBps(e.target.value)}
          />
          <ResolvePreview amount={ms.amount} sellerBps={sellerBpsNum} />
          <div style={{ marginTop: '10px' }}>
            <button
              style={{ ...btn('primary'), opacity: resolve.isPending || resolve.isConfirming ? 0.7 : 1 }}
              disabled={resolve.isPending || resolve.isConfirming}
              onClick={() => resolve.resolve(dealId, BigInt(ms.index), sellerBpsNum)}
            >
              {resolve.isPending ? 'Confirm in wallet…' : resolve.isConfirming ? 'Confirming…' : 'Resolve'}
            </button>
          </div>
          <StatusMsg {...resolve} isError={!!resolve.error} hash={resolve.txHash} chainId={chainId} />
        </ActionPanel>
      )
    } else {
      panels.push(<Note key="resolve-wait">Disputed — waiting for the arbiter ({shortAddrInline(deal.arbiter)}) to resolve.</Note>)
    }
  }

  // ── RELEASE STALLED (anyone, disputed > ARBITRATION_WINDOW) ───────────────
  if (isFunded && state === 'Disputed') {
    panels.push(
      <ActionPanel key="stalled" title="Release stalled dispute">
        <Note>
          The arbiter has {Number(arbitrationWindow) / 86400} days to rule. If they do not act,
          anyone can call this after the window expires — it settles to the attested outcome
          (the original payee split), not a buyer refund.
        </Note>
        {arbitrationExpiresAt > 0 && (
          <div style={{ margin: '8px 0' }}>
            <Countdown expiresAt={arbitrationExpiresAt} label="14-day arbitration window expires" />
          </div>
        )}
        <div style={{ marginTop: '10px' }}>
          <button
            style={{ ...btn('warning'), opacity: !arbitrationExpired || releaseStalled.isPending || releaseStalled.isConfirming ? 0.6 : 1 }}
            disabled={!arbitrationExpired || releaseStalled.isPending || releaseStalled.isConfirming}
            onClick={() => releaseStalled.releaseStalled(dealId, BigInt(ms.index))}
          >
            {releaseStalled.isPending ? 'Confirm in wallet…' : releaseStalled.isConfirming ? 'Confirming…' : 'Release stalled'}
          </button>
        </div>
        {!arbitrationExpired && arbitrationExpiresAt > 0 && (
          <Note>The 14-day arbitration window has not expired yet.</Note>
        )}
        <StatusMsg {...releaseStalled} isError={!!releaseStalled.error} hash={releaseStalled.txHash} chainId={chainId} />
      </ActionPanel>
    )
  }

  // ── REFUND EXPIRED (anyone, pending, deadline passed) ─────────────────────
  if (isFunded && state === 'Pending' && deadlinePassed) {
    panels.push(
      <ActionPanel key="refund" title="Refund expired milestone">
        <Note>The deadline has passed and this milestone was never attested. Anyone can refund it to the buyer.</Note>
        <div style={{ marginTop: '10px' }}>
          <button
            style={{ ...btn('ghost'), opacity: refundExpired.isPending || refundExpired.isConfirming ? 0.7 : 1 }}
            disabled={refundExpired.isPending || refundExpired.isConfirming}
            onClick={() => refundExpired.refundExpired(dealId, BigInt(ms.index))}
          >
            {refundExpired.isPending ? 'Confirm in wallet…' : refundExpired.isConfirming ? 'Confirming…' : 'Refund expired'}
          </button>
        </div>
        <StatusMsg {...refundExpired} isError={!!refundExpired.error} hash={refundExpired.txHash} chainId={chainId} />
      </ActionPanel>
    )
  }

  // ── Deal not funded ────────────────────────────────────────────────────────
  if (!isFunded && !['Released', 'Resolved', 'Refunded'].includes(state)) {
    panels.push(<Note key="not-funded">Actions unlock after the buyer funds this deal.</Note>)
  }

  if (panels.length === 0) return null

  return <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>{panels}</div>
}
