import { useState, useMemo, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { Plus, Trash2, ExternalLink, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { useCreateDeal } from '../hooks/useCreateDeal'
import { validateDeal } from '../lib/validate-deal'
import { computeSplit, fmtUsdc, parseUsdcInput } from '../lib/split'
import { shortAddress } from '../lib/format'
import { buildTxExplorerUrl } from '@/onchain-facts'

// ── Types ──────────────────────────────────────────────────────────────────────

interface PayeeRow { addr: string; role: string; bps: string }
interface MilestoneRow { label: string; amount: string }

const CHALLENGE_PRESETS = [
  { label: '2 minutes', secs: 120 },
  { label: '1 hour', secs: 3600 },
  { label: '1 day', secs: 86400 },
  { label: '3 days', secs: 259200 },
  { label: '7 days', secs: 604800 },
]

// Preview uses 100 USDC as the reference amount
const PREVIEW_AMOUNT = 100_000_000n // 100 USDC (6 dec)

interface Props {
  onSuccess?: (dealId: string) => void
}

// ── Component ──────────────────────────────────────────────────────────────────

export function CreateDeal({ onSuccess }: Props) {
  const { address, chainId } = useAccount()
  const { feeBps, submit, txHash, isWritePending, isConfirming, isSuccess, dealId, error, reset } =
    useCreateDeal(chainId)

  // ── Form state ──────────────────────────────────────────────────────────────
  const [payees, setPayees] = useState<PayeeRow[]>([
    { addr: '', role: 'Seller', bps: '' },
  ])
  const [milestones, setMilestones] = useState<MilestoneRow[]>([
    { label: 'Milestone 1', amount: '' },
  ])
  const [inspector, setInspector] = useState('')
  const [arbiter, setArbiter] = useState('')
  const [challengeWindowSecs, setChallengeWindowSecs] = useState(86400) // 1 day default
  const [deadlineDate, setDeadlineDate] = useState('')

  const effectiveFeeBps = feeBps ?? 200 // optimistic default while loading

  // ── Validation ──────────────────────────────────────────────────────────────
  const validation = useMemo(
    () =>
      validateDeal(
        payees,
        milestones,
        inspector,
        arbiter,
        challengeWindowSecs,
        deadlineDate,
        effectiveFeeBps,
        address ?? '',
      ),
    [payees, milestones, inspector, arbiter, challengeWindowSecs, deadlineDate, effectiveFeeBps, address],
  )

  // Running bps total
  const bpsSum = payees.reduce((s, p) => s + (parseInt(p.bps, 10) || 0), 0)
  const bpsTarget = 10000 - effectiveFeeBps
  const bpsDelta = bpsTarget - bpsSum

  // ── Split preview ───────────────────────────────────────────────────────────
  const splitPreview = useMemo(() => {
    const validPayees = payees.map((p, i) => ({
      addr: p.addr,
      role: p.role || (i === 0 ? 'Seller' : `Payee ${i + 1}`),
      bps: parseInt(p.bps, 10) || 0,
    }))
    return computeSplit(PREVIEW_AMOUNT, effectiveFeeBps, validPayees)
  }, [payees, effectiveFeeBps])

  // ── Payee handlers ──────────────────────────────────────────────────────────
  const updatePayee = useCallback((i: number, field: keyof PayeeRow, value: string) => {
    setPayees((prev) => prev.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)))
  }, [])

  const addPayee = useCallback(() => {
    if (payees.length < 6) {
      setPayees((prev) => [...prev, { addr: '', role: '', bps: '' }])
    }
  }, [payees.length])

  const removePayee = useCallback((i: number) => {
    if (i > 0) setPayees((prev) => prev.filter((_, idx) => idx !== i))
  }, [])

  // ── Milestone handlers ──────────────────────────────────────────────────────
  const updateMilestone = useCallback((i: number, field: keyof MilestoneRow, value: string) => {
    setMilestones((prev) => prev.map((m, idx) => (idx === i ? { ...m, [field]: value } : m)))
  }, [])

  const addMilestone = useCallback(() => {
    if (milestones.length < 5) {
      setMilestones((prev) => [...prev, { label: `Milestone ${prev.length + 1}`, amount: '' }])
    }
  }, [milestones.length])

  const removeMilestone = useCallback((i: number) => {
    if (milestones.length > 1) setMilestones((prev) => prev.filter((_, idx) => idx !== i))
  }, [milestones.length])

  // ── Submit ──────────────────────────────────────────────────────────────────
  function handleSubmit() {
    if (!validation.valid || !address) return
    submit({ payees, milestones, inspector, arbiter, challengeWindowSecs, deadlineDate })
  }

  // Navigate to deal page once confirmed
  if (isSuccess && dealId !== undefined && onSuccess) {
    // defer so the receipt card renders first
    setTimeout(() => onSuccess(dealId.toString()), 2000)
  }

  const explorerTxUrl = txHash && chainId ? buildTxExplorerUrl(chainId, txHash) : null

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!address) {
    return (
      <main style={pageStyle}>
        <PageHeader />
        <Card style={{ textAlign: 'center', padding: '40px 32px' }}>
          <p style={{ color: 'var(--muted-foreground)', fontSize: '14px', margin: '0 0 20px' }}>
            Connect your wallet to create a deal.
          </p>
          <ConnectKitButton />
        </Card>
      </main>
    )
  }

  if (isSuccess) {
    return (
      <main style={pageStyle}>
        <PageHeader />
        <Card style={{ padding: '40px 32px', textAlign: 'center' }}>
          <CheckCircle size={36} style={{ color: 'var(--success)', marginBottom: '16px' }} />
          <h2 style={{ ...headingStyle, fontSize: '20px', marginBottom: '8px' }}>Deal created</h2>
          {dealId !== undefined && (
            <p style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', fontSize: '13px', marginBottom: '16px' }}>
              Deal ID: {dealId.toString()}
            </p>
          )}
          {explorerTxUrl && (
            <a
              href={explorerTxUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={explorerLinkStyle}
            >
              View transaction <ExternalLink size={12} />
            </a>
          )}
          <p style={{ color: 'var(--muted-foreground)', fontSize: '13px', marginTop: '20px' }}>
            Redirecting to deal page…
          </p>
        </Card>
      </main>
    )
  }

  return (
    <main style={pageStyle}>
      <PageHeader />

      {/* ── Payees ── */}
      <Section label="Payees" hint="Row 0 is always the seller. Add up to 6 payees total.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {payees.map((p, i) => (
            <PayeeRowInput
              key={i}
              index={i}
              value={p}
              onChange={(f, v) => updatePayee(i, f, v)}
              onRemove={() => removePayee(i)}
              canRemove={i > 0}
            />
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '12px', flexWrap: 'wrap', gap: '8px' }}>
          <button
            onClick={addPayee}
            disabled={payees.length >= 6}
            style={ghostButtonStyle(payees.length >= 6)}
          >
            <Plus size={14} /> Add payee
          </button>
          {/* Running BPS total */}
          <BpsTally sum={bpsSum} target={bpsTarget} delta={bpsDelta} feeBps={effectiveFeeBps} />
        </div>
      </Section>

      {/* ── Milestones ── */}
      <Section label="Milestones" hint="Each milestone releases a fixed USDC amount when attested and approved.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {milestones.map((m, i) => (
            <MilestoneRowInput
              key={i}
              index={i}
              value={m}
              onChange={(f, v) => updateMilestone(i, f, v)}
              onRemove={() => removeMilestone(i)}
              canRemove={milestones.length > 1}
            />
          ))}
        </div>
        {milestones.length < 5 && (
          <button onClick={addMilestone} style={{ ...ghostButtonStyle(false), marginTop: '12px' }}>
            <Plus size={14} /> Add milestone
          </button>
        )}
      </Section>

      {/* ── Inspector & Arbiter ── */}
      <Section label="Roles">
        <FieldGroup>
          <Label>Inspector address</Label>
          <Hint>The party that attests milestone completion on behalf of the buyer.</Hint>
          <AddrInput value={inspector} onChange={setInspector} placeholder="0x…" />
        </FieldGroup>
        <FieldGroup style={{ marginTop: '16px' }}>
          <Label>Arbiter address</Label>
          <Hint>Resolves disputes. Must not be the buyer, seller, or any payee.</Hint>
          <AddrInput value={arbiter} onChange={setArbiter} placeholder="0x…" />
        </FieldGroup>
      </Section>

      {/* ── Challenge window ── */}
      <Section label="Challenge window">
        <Hint>After the inspector attests, the buyer has this long to dispute before anyone can release the milestone.</Hint>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
          {CHALLENGE_PRESETS.map((p) => (
            <button
              key={p.secs}
              onClick={() => setChallengeWindowSecs(p.secs)}
              style={presetButtonStyle(challengeWindowSecs === p.secs)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p style={{ marginTop: '8px', fontSize: '12px', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)' }}>
          {CHALLENGE_PRESETS.find((p) => p.secs === challengeWindowSecs)?.label ?? `${challengeWindowSecs}s`} selected
        </p>
      </Section>

      {/* ── Deadline ── */}
      <Section label="Deadline">
        <Hint>Milestones not attested by this time can be refunded to the buyer.</Hint>
        <input
          type="datetime-local"
          value={deadlineDate}
          onChange={(e) => setDeadlineDate(e.target.value)}
          style={{ ...textInputStyle, marginTop: '10px', fontFamily: 'var(--font-mono)', fontSize: '13px' }}
        />
      </Section>

      {/* ── Live split preview ── */}
      <Section label="Release preview" hint="How 100 USDC would be split on any milestone release, using the same integer arithmetic as the contract.">
        <SplitPreviewTable preview={splitPreview} />
      </Section>

      {/* ── Validation errors ── */}
      {!validation.valid && (
        <Card style={{ padding: '16px 20px', background: 'rgb(232 115 95 / 0.08)', border: '1px solid rgb(232 115 95 / 0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
            <AlertCircle size={16} style={{ color: 'var(--destructive)', flexShrink: 0, marginTop: '1px' }} />
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {validation.errors.map((e, i) => (
                <li key={i} style={{ fontSize: '13px', color: 'var(--destructive)' }}>{e}</li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {/* ── Tx error ── */}
      {error && (
        <Card style={{ padding: '16px 20px', background: 'rgb(232 115 95 / 0.08)', border: '1px solid rgb(232 115 95 / 0.2)', marginTop: '0' }}>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--destructive)' }}>
            {parseContractError(error)}
          </p>
          <button onClick={reset} style={{ ...ghostButtonStyle(false), marginTop: '8px', fontSize: '12px' }}>Dismiss</button>
        </Card>
      )}

      {/* ── Submit ── */}
      <div style={{ marginTop: '8px' }}>
        <button
          onClick={handleSubmit}
          disabled={!validation.valid || isWritePending || isConfirming}
          style={submitButtonStyle(!validation.valid || isWritePending || isConfirming)}
        >
          {isWritePending ? (
            <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Confirm in wallet…</>
          ) : isConfirming ? (
            <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Waiting for confirmation…</>
          ) : (
            'Create deal'
          )}
        </button>
        {(!validation.valid && address) && (
          <p style={{ marginTop: '8px', fontSize: '12px', color: 'var(--muted-foreground)' }}>
            Fix the errors above to enable this button.
          </p>
        )}
      </div>

      {/* tx hash while confirming */}
      {txHash && !isSuccess && (
        <p style={{ fontSize: '12px', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', marginTop: '8px', wordBreak: 'break-all' }}>
          Tx: {txHash}
          {explorerTxUrl && (
            <a href={explorerTxUrl} target="_blank" rel="noopener noreferrer" style={{ marginLeft: '6px', color: 'var(--primary)' }}>
              <ExternalLink size={11} />
            </a>
          )}
        </p>
      )}
    </main>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function PageHeader() {
  return (
    <>
      <h1 style={headingStyle}>Create a deal</h1>
      <p style={{ color: 'var(--muted-foreground)', fontSize: '14px', margin: '0 0 32px', maxWidth: '56ch', textWrap: 'pretty' }}>
        Set payees, milestones, inspector and arbiter. Your wallet becomes the buyer and funds the escrow after creation.
      </p>
    </>
  )
}

function Section({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card style={{ padding: '20px 24px', marginBottom: '16px' }}>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted-foreground)', margin: '0 0 6px' }}>
        {label}
      </p>
      {hint && <p style={{ fontSize: '13px', color: 'var(--secondary-foreground)', margin: '0 0 14px', maxWidth: '64ch', textWrap: 'pretty' }}>{hint}</p>}
      {children}
    </Card>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', ...style }}>
      {children}
    </div>
  )
}

function FieldGroup({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', ...style }}>{children}</div>
}

function Label({ children }: { children: React.ReactNode }) {
  return <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--secondary-foreground)', letterSpacing: '0.01em' }}>{children}</label>
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: '13px', color: 'var(--muted-foreground)', margin: 0, maxWidth: '60ch', textWrap: 'pretty' }}>{children}</p>
}

function AddrInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? '0x…'}
      spellCheck={false}
      style={{ ...textInputStyle, fontFamily: 'var(--font-mono)', fontSize: '12px' }}
    />
  )
}

function PayeeRowInput({
  index, value, onChange, onRemove, canRemove,
}: {
  index: number
  value: PayeeRow
  onChange: (f: keyof PayeeRow, v: string) => void
  onRemove: () => void
  canRemove: boolean
}) {
  const isSeller = index === 0
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 80px 32px', gap: '6px', alignItems: 'center' }}>
      <input
        type="text"
        value={value.addr}
        onChange={(e) => onChange('addr', e.target.value)}
        placeholder="0x address"
        spellCheck={false}
        style={{ ...textInputStyle, fontFamily: 'var(--font-mono)', fontSize: '12px' }}
      />
      <input
        type="text"
        value={value.role}
        onChange={(e) => onChange('role', e.target.value)}
        placeholder={isSeller ? 'Seller' : 'Role label'}
        style={{ ...textInputStyle, fontSize: '12px' }}
        readOnly={isSeller}
      />
      <div style={{ position: 'relative' }}>
        <input
          type="number"
          value={value.bps}
          onChange={(e) => onChange('bps', e.target.value)}
          placeholder="bps"
          min={isSeller ? 1 : 0}
          max={10000}
          style={{ ...textInputStyle, fontFamily: 'var(--font-mono)', fontSize: '12px', width: '100%', paddingRight: '32px' }}
        />
        <span style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '10px', color: 'var(--muted-foreground)', pointerEvents: 'none' }}>bps</span>
      </div>
      <button
        onClick={onRemove}
        disabled={!canRemove}
        title={isSeller ? 'Seller row cannot be removed' : 'Remove payee'}
        style={{
          background: 'none',
          border: '1px solid var(--border)',
          borderRadius: 'calc(var(--radius) - 0.25rem)',
          cursor: canRemove ? 'pointer' : 'not-allowed',
          color: canRemove ? 'var(--destructive)' : 'var(--border)',
          width: '32px',
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          flexShrink: 0,
        }}
      >
        <Trash2 size={13} />
      </button>
    </div>
  )
}

function MilestoneRowInput({
  index, value, onChange, onRemove, canRemove,
}: {
  index: number
  value: MilestoneRow
  onChange: (f: keyof MilestoneRow, v: string) => void
  onRemove: () => void
  canRemove: boolean
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 32px', gap: '6px', alignItems: 'center' }}>
      <input
        type="text"
        value={value.label}
        onChange={(e) => onChange('label', e.target.value)}
        placeholder={`Milestone ${index + 1}`}
        style={{ ...textInputStyle, fontSize: '13px' }}
      />
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          value={value.amount}
          onChange={(e) => onChange('amount', e.target.value)}
          placeholder="0.00"
          style={{ ...textInputStyle, fontFamily: 'var(--font-mono)', fontSize: '13px', width: '100%', paddingRight: '42px' }}
        />
        <span style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '10px', color: 'var(--muted-foreground)', pointerEvents: 'none' }}>USDC</span>
      </div>
      <button
        onClick={onRemove}
        disabled={!canRemove}
        style={{
          background: 'none',
          border: '1px solid var(--border)',
          borderRadius: 'calc(var(--radius) - 0.25rem)',
          cursor: canRemove ? 'pointer' : 'not-allowed',
          color: canRemove ? 'var(--destructive)' : 'var(--border)',
          width: '32px',
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          flexShrink: 0,
        }}
      >
        <Trash2 size={13} />
      </button>
    </div>
  )
}

function BpsTally({ sum, target, delta, feeBps }: { sum: number; target: number; delta: number; feeBps: number }) {
  const ok = delta === 0
  const over = delta < 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
      <span style={{ color: ok ? 'var(--success)' : over ? 'var(--destructive)' : 'var(--muted-foreground)' }}>
        {sum} / {target} bps
      </span>
      {!ok && (
        <span style={{ color: over ? 'var(--destructive)' : 'var(--warning)', fontSize: '11px' }}>
          ({over ? `${-delta} over` : `${delta} short`}, ${feeBps} fee reserved)
        </span>
      )}
      {ok && <CheckCircle size={13} style={{ color: 'var(--success)' }} />}
    </div>
  )
}

function SplitPreviewTable({ preview }: { preview: ReturnType<typeof computeSplit> }) {
  if (preview.rows.length === 0) {
    return <p style={{ color: 'var(--muted-foreground)', fontSize: '13px', margin: 0 }}>Add at least one payee to see the split.</p>
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Role', 'Address', 'Bps', 'USDC (per 100)'].map((h) => (
              <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: '11px', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted-foreground)', fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: i < preview.rows.length - 1 ? '1px solid var(--border)' : 'none', background: row.isFee ? 'rgb(180 191 207 / 0.04)' : 'transparent' }}>
              <td style={{ padding: '8px 8px', color: row.isFee ? 'var(--muted-foreground)' : 'var(--foreground)', fontStyle: row.isFee ? 'italic' : 'normal' }}>
                {row.role}
                {row.isSeller && <span style={{ marginLeft: '6px', fontSize: '10px', background: 'rgb(221 184 134 / 0.15)', color: 'var(--primary)', padding: '1px 5px', borderRadius: '4px', fontFamily: 'var(--font-mono)' }}>seller</span>}
              </td>
              <td style={{ padding: '8px 8px', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--muted-foreground)' }}>
                {row.addr ? shortAddress(row.addr) : '—'}
              </td>
              <td style={{ padding: '8px 8px', fontFamily: 'var(--font-mono)', color: 'var(--secondary-foreground)', fontVariantNumeric: 'tabular-nums' }}>
                {row.bps}
              </td>
              <td style={{ padding: '8px 8px', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: row.isFee ? 'var(--muted-foreground)' : 'var(--foreground)', fontWeight: row.isSeller ? 600 : 400 }}>
                {fmtUsdc(row.amount)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '1px solid var(--border)' }}>
            <td colSpan={3} style={{ padding: '8px 8px', fontSize: '11px', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>Total</td>
            <td style={{ padding: '8px 8px', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: preview.exact ? 'var(--success)' : 'var(--destructive)' }}>
              {fmtUsdc(preview.rows.reduce((s, r) => s + r.amount, 0n))}
              {preview.exact && <span style={{ marginLeft: '8px', fontSize: '10px', color: 'var(--success)' }}>= 100.000000 exactly</span>}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const pageStyle: React.CSSProperties = {
  maxWidth: '720px',
  margin: '0 auto',
  padding: '48px 20px 80px',
  display: 'flex',
  flexDirection: 'column',
  gap: '0',
}

const headingStyle: React.CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: '28px',
  fontWeight: 700,
  letterSpacing: '-0.02em',
  color: 'var(--foreground)',
  margin: '0 0 8px',
}

const textInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  background: 'var(--elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'calc(var(--radius) - 0.25rem)',
  color: 'var(--foreground)',
  fontSize: '13px',
  outline: 'none',
  boxSizing: 'border-box',
}

const explorerLinkStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  color: 'var(--primary)',
  fontSize: '13px',
  textDecoration: 'none',
  fontFamily: 'var(--font-mono)',
}

function ghostButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 'calc(var(--radius) - 0.25rem)',
    color: disabled ? 'var(--muted-foreground)' : 'var(--foreground)',
    fontSize: '13px',
    fontFamily: 'var(--font-ui)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  }
}

function presetButtonStyle(active: boolean): React.CSSProperties {
  return {
    padding: '5px 12px',
    borderRadius: 'calc(var(--radius) - 0.25rem)',
    border: active ? '1px solid var(--primary)' : '1px solid var(--border)',
    background: active ? 'rgb(221 184 134 / 0.12)' : 'transparent',
    color: active ? 'var(--primary)' : 'var(--muted-foreground)',
    fontSize: '12px',
    fontFamily: 'var(--font-ui)',
    cursor: 'pointer',
    fontWeight: active ? 600 : 400,
  }
}

function submitButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '12px 28px',
    background: disabled ? 'var(--elevated)' : 'var(--primary)',
    color: disabled ? 'var(--muted-foreground)' : 'var(--primary-foreground)',
    border: 'none',
    borderRadius: 'var(--radius)',
    fontSize: '14px',
    fontWeight: 600,
    fontFamily: 'var(--font-ui)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.7 : 1,
    minWidth: '180px',
    minHeight: '44px',
    transition: 'opacity 0.15s',
  }
}

function parseContractError(error: unknown): string {
  const msg = (error as Error)?.message?.toLowerCase() ?? ''
  if (msg.includes('user rejected') || msg.includes('user denied')) return 'Transaction cancelled.'
  if (msg.includes('invalidbpssum')) return 'Bps sum does not equal 10000 − feeBps.'
  if (msg.includes('duplicatepayee')) return 'Duplicate payee address.'
  if (msg.includes('invalidarbiter') || msg.includes('arbiterisPayee')) return 'Arbiter is a payee address.'
  if (msg.includes('invalidinspector')) return 'Inspector must not be the seller.'
  if (msg.includes('invaliddeadline')) return 'Deadline is too soon.'
  if (msg.includes('insufficient')) return 'Insufficient USDC balance.'
  if (msg.includes('reverted')) {
    const m = msg.match(/reason="([^"]+)"/)
    return m ? `Transaction failed: ${m[1]}` : 'Transaction reverted.'
  }
  return 'Transaction failed. Check the form and try again.'
}

// Needed for parseUsdcInput re-export
export { parseUsdcInput }
