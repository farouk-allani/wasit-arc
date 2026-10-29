/**
 * FundPanel — two-step USDC approve + fund for the buyer.
 * Checks existing allowance; skips approve when already sufficient.
 */
import { useEffect } from 'react'
import { CheckCircle, ExternalLink, Info } from 'lucide-react'
import { useFund } from '../../hooks/useDealActions'
import { fmtUsdc } from '../../lib/split'
import { buildTxExplorerUrl } from '../../onchain-facts'

interface Props {
  dealId: bigint
  total: bigint
  buyerAddress: `0x${string}` | undefined
  chainId: number | undefined
  onSuccess: () => void
}

export function FundPanel({ dealId, total, buyerAddress, chainId, onSuccess }: Props) {
  const {
    needsApprove, allowance, refetchAllowance,
    approve, approveHash, approvePending, approveConfirming, approveSuccess, approveError,
    fund, fundHash, fundPending, fundConfirming, fundSuccess, fundError,
  } = useFund(chainId, buyerAddress, total)

  // After approve confirms, re-check allowance and move on
  useEffect(() => {
    if (approveSuccess) void refetchAllowance()
  }, [approveSuccess, refetchAllowance])

  useEffect(() => {
    if (fundSuccess) onSuccess()
  }, [fundSuccess, onSuccess])

  const step = needsApprove ? 1 : 2

  return (
    <div style={{
      padding: '20px 24px',
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      marginBottom: '32px',
    }}>
      <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)', margin: '0 0 4px' }}>
        Fund this deal
      </p>
      <p style={{ fontSize: '12px', color: 'var(--muted-foreground)', margin: '0 0 20px' }}>
        Transfers{' '}
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--foreground)', fontVariantNumeric: 'tabular-nums' }}>
          {fmtUsdc(total)} USDC
        </span>{' '}
        into escrow. All milestones are released from this single deposit.
      </p>

      {/* Step indicators */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <StepBadge num={1} label="Approve USDC" active={step === 1} done={!needsApprove} />
        <StepBadge num={2} label="Fund deal" active={step === 2} done={fundSuccess} />
      </div>

      {/* Step 1: Approve */}
      {needsApprove && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <Info size={12} style={{ color: 'var(--muted-foreground)', flexShrink: 0 }} />
            <p style={{ fontSize: '12px', color: 'var(--muted-foreground)', margin: 0 }}>
              Current allowance:{' '}
              <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                {fmtUsdc(allowance)} USDC
              </span>
              {' '}— approval of{' '}
              <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                {fmtUsdc(total)} USDC
              </span>
              {' '}required.
            </p>
          </div>
          <button
            onClick={approve}
            disabled={approvePending || approveConfirming}
            style={primaryBtn(approvePending || approveConfirming)}
          >
            {approvePending ? 'Confirm in wallet…' : approveConfirming ? 'Approving…' : `Approve ${fmtUsdc(total)} USDC`}
          </button>
          <TxStatus hash={approveHash} pending={approvePending} confirming={approveConfirming} success={approveSuccess} error={approveError} chainId={chainId} />
        </div>
      )}

      {/* Step 2: Fund */}
      {!needsApprove && (
        <div>
          {!fundSuccess && (
            <button
              onClick={() => fund(dealId)}
              disabled={fundPending || fundConfirming}
              style={primaryBtn(fundPending || fundConfirming)}
            >
              {fundPending ? 'Confirm in wallet…' : fundConfirming ? 'Funding…' : `Fund deal — ${fmtUsdc(total)} USDC`}
            </button>
          )}
          <TxStatus hash={fundHash} pending={fundPending} confirming={fundConfirming} success={fundSuccess} error={fundError} chainId={chainId} />
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function StepBadge({ num, label, active, done }: { num: number; label: string; active: boolean; done: boolean | undefined }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '4px 10px',
      borderRadius: '99px',
      border: `1px solid ${active ? 'var(--primary)' : done ? 'rgb(92 196 154 / 0.3)' : 'var(--border)'}`,
      background: active ? 'rgb(221 184 134 / 0.08)' : done ? 'rgb(92 196 154 / 0.06)' : 'transparent',
    }}>
      {done ? (
        <CheckCircle size={12} style={{ color: 'var(--success)' }} />
      ) : (
        <span style={{
          width: '16px', height: '16px', borderRadius: '50%',
          background: active ? 'var(--primary)' : 'var(--elevated)',
          color: active ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
          fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          {num}
        </span>
      )}
      <span style={{ fontSize: '12px', fontWeight: 500, color: done ? 'var(--success)' : active ? 'var(--primary)' : 'var(--muted-foreground)' }}>
        {label}
      </span>
    </div>
  )
}

function TxStatus({ hash, pending, confirming, success, error, chainId }: {
  hash: `0x${string}` | undefined
  pending: boolean; confirming: boolean; success: boolean
  error: Error | null | undefined; chainId: number | undefined
}) {
  if (pending) return <p style={{ fontSize: '12px', color: 'var(--muted-foreground)', margin: '8px 0 0' }}>Confirm in wallet…</p>
  if (confirming) return (
    <div style={{ marginTop: '8px' }}>
      <p style={{ fontSize: '12px', color: 'var(--muted-foreground)', margin: 0 }}>Waiting for confirmation…</p>
      {hash && chainId && <TxHashLink hash={hash} chainId={chainId} />}
    </div>
  )
  if (success) return (
    <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
      <CheckCircle size={13} style={{ color: 'var(--success)' }} />
      <span style={{ fontSize: '12px', color: 'var(--success)' }}>Done</span>
      {hash && chainId && <TxHashLink hash={hash} chainId={chainId} />}
    </div>
  )
  if (error) return (
    <p style={{ fontSize: '12px', color: 'var(--destructive)', margin: '8px 0 0', maxWidth: '360px' }}>
      {(error as { shortMessage?: string }).shortMessage ?? error.message}
    </p>
  )
  return null
}

function TxHashLink({ hash, chainId }: { hash: `0x${string}`; chainId: number }) {
  return (
    <a
      href={buildTxExplorerUrl(chainId, hash)}
      target="_blank" rel="noopener noreferrer"
      style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}
    >
      {hash.slice(0, 10)}…{hash.slice(-6)} <ExternalLink size={10} />
    </a>
  )
}

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: '9px 20px',
    borderRadius: 'var(--radius)',
    border: 'none',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: '13px',
    fontWeight: 600,
    fontFamily: 'var(--font-ui)',
    minHeight: '38px',
    background: 'var(--primary)',
    color: 'var(--primary-foreground)',
    opacity: disabled ? 0.65 : 1,
  }
}
