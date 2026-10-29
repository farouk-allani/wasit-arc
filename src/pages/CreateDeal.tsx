import { useState, useMemo, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { Plus, Trash2, ExternalLink, CheckCircle, AlertCircle } from 'lucide-react'
import { useCreateDeal } from '../hooks/useCreateDeal'
import { validateDeal } from '../lib/validate-deal'
import { computeSplit, fmtUsdc, parseUsdcInput } from '../lib/split'
import { shortAddress } from '../lib/format'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { PageHeader, Card, Button, Field, Input } from '../components/ui'

// ── Types ──────────────────────────────────────────────────────────────────────

interface PayeeRow { addr: string; role: string; bps: string }
interface MilestoneRow { label: string; amount: string }

const CHALLENGE_PRESETS = [
  { label: '2 min',  secs: 120 },
  { label: '1 hour', secs: 3600 },
  { label: '1 day',  secs: 86400 },
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
  const [arbiter, setArbiter]     = useState('')
  const [challengeWindowSecs, setChallengeWindowSecs] = useState(86400)
  const [deadlineDate, setDeadlineDate] = useState('')

  const effectiveFeeBps = feeBps ?? 200

  // ── Validation ──────────────────────────────────────────────────────────────
  const validation = useMemo(
    () =>
      validateDeal(
        payees, milestones, inspector, arbiter,
        challengeWindowSecs, deadlineDate, effectiveFeeBps, address ?? '',
      ),
    [payees, milestones, inspector, arbiter, challengeWindowSecs, deadlineDate, effectiveFeeBps, address],
  )

  // Running bps total
  const bpsSum    = payees.reduce((s, p) => s + (parseInt(p.bps, 10) || 0), 0)
  const bpsTarget = 10000 - effectiveFeeBps
  const bpsDelta  = bpsTarget - bpsSum

  // ── Split preview ───────────────────────────────────────────────────────────
  const splitPreview = useMemo(() => {
    const validPayees = payees.map((p, i) => ({
      addr: p.addr,
      role: p.role || (i === 0 ? 'Seller' : `Payee ${i + 1}`),
      bps:  parseInt(p.bps, 10) || 0,
    }))
    return computeSplit(PREVIEW_AMOUNT, effectiveFeeBps, validPayees)
  }, [payees, effectiveFeeBps])

  // ── Payee handlers ──────────────────────────────────────────────────────────
  const updatePayee = useCallback((i: number, field: keyof PayeeRow, value: string) => {
    setPayees((prev) => prev.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)))
  }, [])
  const addPayee = useCallback(() => {
    if (payees.length < 6) setPayees((prev) => [...prev, { addr: '', role: '', bps: '' }])
  }, [payees.length])
  const removePayee = useCallback((i: number) => {
    if (i > 0) setPayees((prev) => prev.filter((_, idx) => idx !== i))
  }, [])

  // ── Milestone handlers ──────────────────────────────────────────────────────
  const updateMilestone = useCallback((i: number, field: keyof MilestoneRow, value: string) => {
    setMilestones((prev) => prev.map((m, idx) => (idx === i ? { ...m, [field]: value } : m)))
  }, [])
  const addMilestone = useCallback(() => {
    if (milestones.length < 5)
      setMilestones((prev) => [...prev, { label: `Milestone ${prev.length + 1}`, amount: '' }])
  }, [milestones.length])
  const removeMilestone = useCallback((i: number) => {
    if (milestones.length > 1) setMilestones((prev) => prev.filter((_, idx) => idx !== i))
  }, [milestones.length])

  // ── Submit ──────────────────────────────────────────────────────────────────
  function handleSubmit() {
    if (!validation.valid || !address) return
    submit({ payees, milestones, inspector, arbiter, challengeWindowSecs, deadlineDate })
  }

  if (isSuccess && dealId !== undefined && onSuccess) {
    setTimeout(() => onSuccess(dealId.toString()), 2000)
  }

  const explorerTxUrl = txHash && chainId ? buildTxExplorerUrl(chainId, txHash) : null

  // ── Connect gate ────────────────────────────────────────────────────────────
  if (!address) {
    return (
      <main style={pageStyle}>
        <PageHeader
          eyebrow="Wasit escrow"
          title="Create a deal"
          description="Set payees, milestones, inspector and arbiter. Your wallet becomes the buyer and funds the escrow after creation."
        />
        <Card>
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <p style={{ color: 'var(--muted-foreground)', fontSize: '14px', margin: '0 0 20px' }}>
              Connect your wallet to create a deal.
            </p>
            <ConnectKitButton />
          </div>
        </Card>
      </main>
    )
  }

  // ── Success screen ──────────────────────────────────────────────────────────
  if (isSuccess) {
    return (
      <main style={pageStyle}>
        <PageHeader eyebrow="Wasit escrow" title="Create a deal" />
        <Card>
          <div style={{ padding: '16px 0', textAlign: 'center' }}>
            <CheckCircle size={36} style={{ color: 'var(--success)', marginBottom: '16px' }} />
            <h2 style={{ fontFamily: 'var(--font-ui)', fontSize: '20px', fontWeight: 700, margin: '0 0 8px', color: 'var(--foreground)' }}>
              Deal created
            </h2>
            {dealId !== undefined && (
              <p style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', fontSize: '13px', marginBottom: '16px' }}>
                Deal ID: {dealId.toString()}
              </p>
            )}
            {explorerTxUrl && (
              <a href={explorerTxUrl} target="_blank" rel="noopener noreferrer" style={explorerLinkStyle}>
                View transaction <ExternalLink size={12} />
              </a>
            )}
            <p style={{ color: 'var(--muted-foreground)', fontSize: '13px', marginTop: '20px' }}>
              Redirecting to deal page…
            </p>
          </div>
        </Card>
      </main>
    )
  }

  // ── Main form ───────────────────────────────────────────────────────────────
  const isPending = isWritePending || isConfirming

  return (
    <main style={pageStyle}>
      <PageHeader
        eyebrow="Wasit escrow"
        title="Create a deal"
        description="Set payees, milestones, inspector and arbiter. Your wallet becomes the buyer and funds the escrow after creation."
      />

      <div className="create-layout">
        {/* ── LEFT: form ──────────────────────────────────────────────────── */}
        <div className="create-form-col">

          {/* Payees */}
          <Card
            title="Payees"
            description="Row 0 is always the seller. Add up to 6 payees total. Shares are in basis points (bps) — 10 000 bps = 100 %."
          >
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
              <Button
                variant="ghost"
                onClick={addPayee}
                disabled={payees.length >= 6}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
              >
                <Plus size={13} aria-hidden /> Add payee
              </Button>
              <BpsTally sum={bpsSum} target={bpsTarget} delta={bpsDelta} feeBps={effectiveFeeBps} />
            </div>
          </Card>

          {/* Milestones */}
          <Card
            title="Milestones"
            description="Each milestone releases a fixed USDC amount when attested and approved. Up to 5 milestones."
          >
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
              <Button
                variant="ghost"
                onClick={addMilestone}
                style={{ marginTop: '12px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
              >
                <Plus size={13} aria-hidden /> Add milestone
              </Button>
            )}
          </Card>

          {/* Roles */}
          <Card
            title="Roles"
            description="Inspector attests milestone completion; arbiter resolves disputes. Both must be distinct addresses."
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <Field
                label="Inspector address"
                hint="The party that attests milestone completion on behalf of the buyer."
              >
                {({ inputId, hintId }) => (
                  <Input
                    id={inputId}
                    hintId={hintId}
                    mono
                    type="text"
                    value={inspector}
                    onChange={(e) => setInspector(e.target.value)}
                    placeholder="0x…"
                    spellCheck={false}
                  />
                )}
              </Field>
              <Field
                label="Arbiter address"
                hint="Resolves disputes. Must not be the buyer, seller, or any payee."
              >
                {({ inputId, hintId }) => (
                  <Input
                    id={inputId}
                    hintId={hintId}
                    mono
                    type="text"
                    value={arbiter}
                    onChange={(e) => setArbiter(e.target.value)}
                    placeholder="0x…"
                    spellCheck={false}
                  />
                )}
              </Field>
            </div>
          </Card>

          {/* Challenge window */}
          <Card
            title="Challenge window"
            description="After the inspector attests, the buyer has this long to dispute before anyone can release the milestone."
          >
            <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
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
          </Card>

          {/* Deadline */}
          <Card
            title="Deadline"
            description="Milestones not attested by this time can be refunded to the buyer."
          >
            <input
              type="datetime-local"
              value={deadlineDate}
              onChange={(e) => setDeadlineDate(e.target.value)}
              className="ws-input ws-input--mono"
              style={{ marginTop: '2px' }}
            />
          </Card>

          {/* Validation errors */}
          {!validation.valid && (
            <div style={{ padding: '14px 16px', background: 'rgb(232 115 95 / 0.07)', border: '1px solid rgb(232 115 95 / 0.2)', borderRadius: 'var(--radius)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <AlertCircle size={15} style={{ color: 'var(--destructive)', flexShrink: 0, marginTop: '2px' }} />
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {validation.errors.map((e, i) => (
                    <li key={i} style={{ fontSize: '13px', color: 'var(--destructive)' }}>{e}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Tx error */}
          {error && (
            <div style={{ padding: '14px 16px', background: 'rgb(232 115 95 / 0.07)', border: '1px solid rgb(232 115 95 / 0.2)', borderRadius: 'var(--radius)' }}>
              <p style={{ margin: '0 0 8px', fontSize: '13px', color: 'var(--destructive)' }}>
                {parseContractError(error)}
              </p>
              <Button variant="ghost" onClick={reset} style={{ fontSize: '12px' }}>Dismiss</Button>
            </div>
          )}

          {/* Submit */}
          <div style={{ paddingBottom: '16px' }}>
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={!validation.valid}
              pending={isPending}
              pendingLabel={isWritePending ? 'Confirm in wallet…' : 'Waiting for confirmation…'}
              style={{ minWidth: '200px', fontSize: '15px', padding: '12px 32px' }}
            >
              Create deal
            </Button>
            {!validation.valid && (
              <p style={{ marginTop: '8px', fontSize: '12px', color: 'var(--muted-foreground)' }}>
                Fix the errors above to enable this button.
              </p>
            )}
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
          </div>
        </div>

        {/* ── RIGHT: sticky Deal Sheet ─────────────────────────────────────── */}
        <div className="create-sheet-col">
          <DealSheet
            payees={payees}
            milestones={milestones}
            inspector={inspector}
            arbiter={arbiter}
            challengeWindowSecs={challengeWindowSecs}
            deadlineDate={deadlineDate}
            splitPreview={splitPreview}
            feeBps={effectiveFeeBps}
          />
        </div>
      </div>
    </main>
  )
}

// ── Deal Sheet (sticky summary) ────────────────────────────────────────────────

interface DealSheetProps {
  payees: PayeeRow[]
  milestones: MilestoneRow[]
  inspector: string
  arbiter: string
  challengeWindowSecs: number
  deadlineDate: string
  splitPreview: ReturnType<typeof computeSplit>
  feeBps: number
}

function challengeWindowLabel(secs: number): string {
  const preset = CHALLENGE_PRESETS.find((p) => p.secs === secs)
  if (preset) return preset.label
  if (secs < 3600) return `${secs} seconds`
  if (secs < 86400) return `${Math.round(secs / 3600)} hours`
  return `${Math.round(secs / 86400)} days`
}

function DealSheet({
  payees, milestones, inspector, arbiter,
  challengeWindowSecs, deadlineDate, splitPreview, feeBps,
}: DealSheetProps) {
  const DASH = <span style={{ color: 'var(--border)' }}>—</span>

  const totalUsdc = milestones.reduce((s, m) => {
    const v = parseUsdcInput(m.amount)
    return v === null ? s : s + v
  }, 0n)

  const deadlineLabel = deadlineDate
    ? new Date(deadlineDate).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : null

  return (
    <div className="ws-card" style={{ fontSize: '13px' }}>
      <div className="ws-card-header">
        <p className="ws-card-title">Deal sheet</p>
        <p className="ws-card-desc">Live summary as you fill in the form.</p>
      </div>

      {/* Totals */}
      <div style={{ padding: '14px 20px 0', borderBottom: '1px solid var(--border)' }}>
        <SheetRow label="Total">
          {totalUsdc > 0n
            ? <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--foreground)' }}>{fmtUsdc(totalUsdc)} USDC</span>
            : DASH}
        </SheetRow>
        <SheetRow label="Milestones">
          {milestones.length > 0
            ? <span style={{ fontFamily: 'var(--font-mono)' }}>{milestones.length}</span>
            : DASH}
        </SheetRow>
        <SheetRow label="Fee">
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
            {feeBps} bps ({(feeBps / 100).toFixed(1)} %)
          </span>
        </SheetRow>
      </div>

      {/* Payees */}
      <div style={{ padding: '14px 20px 0', borderBottom: '1px solid var(--border)' }}>
        <p style={{ margin: '0 0 8px', fontSize: '10px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
          Payees
        </p>
        {payees.length === 0
          ? <p style={{ color: 'var(--border)', marginBottom: '10px' }}>—</p>
          : payees.map((p, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', marginBottom: '6px' }}>
              <span style={{ color: 'var(--secondary-foreground)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {p.role || (i === 0 ? 'Seller' : `Payee ${i + 1}`)}
                {p.addr && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--muted-foreground)', marginLeft: '6px' }}>
                    {shortAddress(p.addr)}
                  </span>
                )}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', color: p.bps ? 'var(--foreground)' : 'var(--border)', flexShrink: 0 }}>
                {p.bps ? `${p.bps} bps` : '—'}
              </span>
            </div>
          ))
        }
      </div>

      {/* Inspector / Arbiter */}
      <div style={{ padding: '14px 20px 0', borderBottom: '1px solid var(--border)' }}>
        <SheetRow label="Inspector">
          {inspector
            ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{shortAddress(inspector)}</span>
            : DASH}
        </SheetRow>
        <SheetRow label="Arbiter">
          {arbiter
            ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{shortAddress(arbiter)}</span>
            : DASH}
        </SheetRow>
      </div>

      {/* Timing */}
      <div style={{ padding: '14px 20px 0', borderBottom: '1px solid var(--border)' }}>
        <SheetRow label="Challenge window">
          <span style={{ color: 'var(--secondary-foreground)' }}>{challengeWindowLabel(challengeWindowSecs)}</span>
        </SheetRow>
        <SheetRow label="Deadline">
          {deadlineLabel
            ? <span style={{ color: 'var(--secondary-foreground)' }}>{deadlineLabel}</span>
            : DASH}
        </SheetRow>
      </div>

      {/* 100 USDC split preview */}
      <div style={{ padding: '14px 20px 16px' }}>
        <p style={{ margin: '0 0 8px', fontSize: '10px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
          Split preview — per 100 USDC
        </p>
        {splitPreview.rows.length === 0
          ? <p style={{ color: 'var(--border)', margin: 0 }}>Add a payee to see the split.</p>
          : splitPreview.rows.map((row, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
              <span style={{ color: row.isFee ? 'var(--muted-foreground)' : 'var(--secondary-foreground)', fontStyle: row.isFee ? 'italic' : 'normal' }}>
                {row.role}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: row.isFee ? 'var(--muted-foreground)' : 'var(--foreground)' }}>
                {fmtUsdc(row.amount)}
              </span>
            </div>
          ))
        }
        {splitPreview.exact && (
          <p style={{ margin: '8px 0 0', fontSize: '11px', color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>
            ✓ exact — sums to 100.000000
          </p>
        )}
      </div>
    </div>
  )
}

function SheetRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
      <span style={{ color: 'var(--muted-foreground)', flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: 'right', minWidth: 0 }}>{children}</span>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

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
    <div className="payee-row">
      <input
        className="payee-addr ws-input ws-input--mono"
        type="text"
        value={value.addr}
        onChange={(e) => onChange('addr', e.target.value)}
        placeholder="0x address"
        spellCheck={false}
      />
      <input
        className="payee-role ws-input"
        type="text"
        value={value.role}
        onChange={(e) => onChange('role', e.target.value)}
        placeholder={isSeller ? 'Seller' : 'Role label'}
        readOnly={isSeller}
        style={isSeller ? { opacity: 0.6, cursor: 'default' } : {}}
      />
      <div className="payee-bps" style={{ position: 'relative' }}>
        <input
          type="number"
          value={value.bps}
          onChange={(e) => onChange('bps', e.target.value)}
          placeholder="bps"
          min={isSeller ? 1 : 0}
          max={10000}
          className="ws-input ws-input--mono"
          style={{ width: '100%', paddingRight: '34px' }}
        />
        <span style={{ position: 'absolute', right: '9px', top: '50%', transform: 'translateY(-50%)', fontSize: '10px', color: 'var(--muted-foreground)', pointerEvents: 'none' }}>
          bps
        </span>
      </div>
      <button
        className="payee-del"
        onClick={onRemove}
        disabled={!canRemove}
        title={isSeller ? 'Seller row cannot be removed' : 'Remove payee'}
        style={{
          background: 'none',
          border: '1px solid var(--border)',
          borderRadius: 'calc(var(--radius) - 0.25rem)',
          cursor: canRemove ? 'pointer' : 'not-allowed',
          color: canRemove ? 'var(--destructive)' : 'var(--border)',
          width: '36px',
          height: '36px',
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
    <div className="milestone-row">
      <input
        className="ms-label ws-input"
        type="text"
        value={value.label}
        onChange={(e) => onChange('label', e.target.value)}
        placeholder={`Milestone ${index + 1}`}
      />
      <div className="ms-amount" style={{ position: 'relative' }}>
        <input
          type="text"
          value={value.amount}
          onChange={(e) => onChange('amount', e.target.value)}
          placeholder="0.00"
          className="ws-input ws-input--mono"
          style={{ width: '100%', paddingRight: '46px' }}
        />
        <span style={{ position: 'absolute', right: '9px', top: '50%', transform: 'translateY(-50%)', fontSize: '10px', color: 'var(--muted-foreground)', pointerEvents: 'none' }}>
          USDC
        </span>
      </div>
      <button
        className="ms-del"
        onClick={onRemove}
        disabled={!canRemove}
        style={{
          background: 'none',
          border: '1px solid var(--border)',
          borderRadius: 'calc(var(--radius) - 0.25rem)',
          cursor: canRemove ? 'pointer' : 'not-allowed',
          color: canRemove ? 'var(--destructive)' : 'var(--border)',
          width: '36px',
          height: '36px',
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
  const ok   = delta === 0
  const over = delta < 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
      <span style={{ color: ok ? 'var(--success)' : over ? 'var(--destructive)' : 'var(--muted-foreground)' }}>
        {sum} / {target} bps
      </span>
      {!ok && (
        <span style={{ color: over ? 'var(--destructive)' : 'var(--warning)', fontSize: '11px' }}>
          ({over ? `${-delta} over` : `${delta} short`}, {feeBps} bps fee reserved)
        </span>
      )}
      {ok && <CheckCircle size={13} style={{ color: 'var(--success)' }} />}
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const pageStyle: React.CSSProperties = {
  maxWidth: '1160px',
  margin: '0 auto',
  padding: '0 24px 80px',
  display: 'flex',
  flexDirection: 'column',
  gap: '0',
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

function presetButtonStyle(active: boolean): React.CSSProperties {
  return {
    padding: '6px 14px',
    borderRadius: 'calc(var(--radius) - 0.25rem)',
    border: active ? '1px solid var(--primary)' : '1px solid var(--border)',
    background: active ? 'rgb(221 184 134 / 0.12)' : 'transparent',
    color: active ? 'var(--primary)' : 'var(--muted-foreground)',
    fontSize: '13px',
    fontFamily: 'var(--font-ui)',
    cursor: 'pointer',
    fontWeight: active ? 600 : 400,
  }
}

function parseContractError(error: unknown): string {
  const msg = (error as Error)?.message?.toLowerCase() ?? ''
  if (msg.includes('user rejected') || msg.includes('user denied')) return 'Transaction cancelled.'
  if (msg.includes('invalidbpssum')) return 'Bps sum does not equal 10 000 − feeBps.'
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
