/** Payees table with live split preview for a reference 100 USDC release. */
import type { DealData } from '../../hooks/useDeal'
import { shortAddress } from '../../lib/format'
import { computeSplit, fmtUsdc, type PayeeInput } from '../../lib/split'

const REF_AMOUNT = 100_000_000n // 100 USDC at 6 decimals

interface Props {
  deal: DealData
  /** Payee list — reconstructed from payee addresses stored off-chain (from DealCreated event args or user-stored labels).
   *  In this version we reconstruct from what the contract tells us: the feeBps and total.
   *  Since the contract doesn't store payee list in a getter, we note that we can only show
   *  the split preview if we have the payee info from the DealCreated event (passed in from
   *  the parent). When not available we show a simplified fee-only preview.
   */
  payees?: PayeeInput[]
  feeBps: number
}

export function PartiesSplit({ deal, payees, feeBps }: Props) {
  // If we have full payee info, use it; otherwise show fee row only with a note
  const hasPayees = payees && payees.length > 0

  const preview = hasPayees
    ? computeSplit(REF_AMOUNT, feeBps, payees)
    : null

  return (
    <section style={{ marginBottom: '32px' }}>
      <h2 style={{
        fontFamily: 'var(--font-ui)',
        fontSize: '13px',
        fontWeight: 600,
        color: 'var(--muted-foreground)',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        margin: '0 0 12px',
      }}>
        Parties &amp; split
      </h2>

      <div className="table-scroll" style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 90px 70px 110px',
          gap: '0 12px',
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--elevated)',
          minWidth: '380px',
        }}>
          {['Role / Address', 'Bps', 'Share', '100 USDC release'].map((h) => (
            <span key={h} style={{
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--muted-foreground)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              fontFamily: 'var(--font-ui)',
            }}>{h}</span>
          ))}
        </div>

        {/* Rows */}
        {preview ? (
          preview.rows.map((row, idx) => (
            <SplitRow
              key={idx}
              role={row.role}
              addr={row.addr}
              bps={row.bps}
              amount={row.amount}
              total={REF_AMOUNT}
              isFee={row.isFee}
              isSeller={row.isSeller}
              last={idx === preview.rows.length - 1}
            />
          ))
        ) : (
          <div style={{ padding: '14px 16px' }}>
            <span style={{ fontSize: '13px', color: 'var(--muted-foreground)' }}>
              Payee details unavailable — platform fee is {feeBps / 100}% ({feeBps} bps).
              Buyer: <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{shortAddress(deal.buyer)}</span>
            </span>
          </div>
        )}

        {/* Total row */}
        {preview && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 90px 70px 110px',
            gap: '0 12px',
            padding: '10px 16px',
            borderTop: '1px solid var(--border)',
            background: 'var(--elevated)',
            minWidth: '380px',
          }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--foreground)' }}>Total</span>
            <span />
            <span />
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              fontWeight: 700,
              color: preview.exact ? 'var(--success)' : 'var(--destructive)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {fmtUsdc(REF_AMOUNT)} {preview.exact ? '= exactly' : '!= exactly'}
            </span>
          </div>
        )}
      </div>
    </section>
  )
}

function SplitRow({
  role, addr, bps, amount, total, isFee, isSeller, last,
}: {
  role: string; addr: string; bps: number; amount: bigint; total: bigint
  isFee: boolean; isSeller: boolean; last: boolean
}) {
  const pct = total > 0n ? (Number(amount) * 100 / Number(total)).toFixed(2) : '0.00'
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 90px 70px 110px',
      gap: '0 12px',
      padding: '10px 16px',
      borderBottom: last ? 'none' : '1px solid var(--border)',
      background: isFee ? 'rgb(221 184 134 / 0.04)' : 'transparent',
      alignItems: 'center',
      minWidth: '380px',
    }}>
      <div>
        <span style={{
          fontSize: '13px',
          fontWeight: isSeller ? 600 : 400,
          color: isFee ? 'var(--primary)' : 'var(--foreground)',
          fontFamily: 'var(--font-ui)',
        }}>
          {role}
        </span>
        {addr && (
          <span style={{
            display: 'block',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--muted-foreground)',
            marginTop: '1px',
          }}>
            {shortAddress(addr)}
          </span>
        )}
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--secondary-foreground)', fontVariantNumeric: 'tabular-nums' }}>
        {bps}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--muted-foreground)', fontVariantNumeric: 'tabular-nums' }}>
        {pct}%
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--foreground)', fontVariantNumeric: 'tabular-nums' }}>
        {fmtUsdc(amount)}
      </span>
    </div>
  )
}
