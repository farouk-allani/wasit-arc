/** Where-the-money-went table for a settled milestone. */
import { ExternalLink, AlertCircle } from 'lucide-react'
import type { PayoutRow } from '../../hooks/useDeal'
import { shortAddress } from '../../lib/format'
import { fmtUsdc } from '../../lib/split'
import { buildTxExplorerUrl } from '../../onchain-facts'

interface Props {
  rows: PayoutRow[]
  chainId: number | undefined
}

export function PayoutTable({ rows, chainId }: Props) {
  return (
    <div style={{ marginTop: '12px' }}>
      <p style={{
        fontSize: '11px',
        fontWeight: 600,
        color: 'var(--muted-foreground)',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        margin: '0 0 8px',
      }}>
        Where the money went
      </p>

      <div className="table-scroll" style={{
        border: '1px solid var(--border)',
        borderRadius: 'calc(var(--radius) - 0.125rem)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 110px 70px 100px',
          gap: '0 8px',
          padding: '8px 12px',
          background: 'var(--elevated)',
          borderBottom: '1px solid var(--border)',
          minWidth: '380px',
        }}>
          {['Recipient', 'Amount', 'Status', 'Tx'].map(h => (
            <span key={h} style={{
              fontSize: '10px',
              fontWeight: 600,
              color: 'var(--muted-foreground)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}>{h}</span>
          ))}
        </div>

        {rows.map((row, idx) => {
          const explorerUrl = chainId && row.txHash
            ? buildTxExplorerUrl(chainId, row.txHash)
            : undefined

          return (
            <div key={idx} style={{
              display: 'grid',
              gridTemplateColumns: '1fr 110px 70px 100px',
              gap: '0 8px',
              padding: '9px 12px',
              alignItems: 'center',
              borderBottom: idx < rows.length - 1 ? '1px solid var(--border)' : 'none',
              background: row.credited ? 'rgb(231 176 87 / 0.05)' : 'transparent',
              minWidth: '380px',
            }}>
              {/* Recipient */}
              <div>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  color: 'var(--foreground)',
                }}>
                  {shortAddress(row.to)}
                </span>
                {row.refund && (
                  <span style={{
                    display: 'block',
                    fontSize: '10px',
                    color: 'var(--muted-foreground)',
                    marginTop: '1px',
                  }}>
                    Buyer refund
                  </span>
                )}
              </div>

              {/* Amount */}
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: 'var(--foreground)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {fmtUsdc(row.amount)} USDC
              </span>

              {/* Status */}
              <div>
                {row.credited ? (
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '10px',
                    color: 'var(--warning)',
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}>
                    <AlertCircle size={10} /> Credited
                  </span>
                ) : (
                  <span style={{
                    fontSize: '10px',
                    color: 'var(--success)',
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}>
                    Paid
                  </span>
                )}
              </div>

              {/* Tx link */}
              <div>
                {explorerUrl && row.txHash ? (
                  <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--primary)',
                      textDecoration: 'none',
                    }}
                  >
                    {row.txHash.slice(0, 8)}…
                    <ExternalLink size={10} />
                  </a>
                ) : (
                  <span style={{ fontSize: '11px', color: 'var(--muted-foreground)' }}>—</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Explain credited status */}
      {rows.some(r => r.credited) && (
        <div style={{
          marginTop: '8px',
          padding: '8px 12px',
          background: 'rgb(231 176 87 / 0.06)',
          border: '1px solid rgb(231 176 87 / 0.20)',
          borderRadius: 'calc(var(--radius) - 0.25rem)',
          display: 'flex',
          gap: '8px',
          alignItems: 'flex-start',
        }}>
          <AlertCircle size={13} style={{ color: 'var(--warning)', marginTop: '1px', flexShrink: 0 }} />
          <p style={{ fontSize: '12px', color: 'var(--secondary-foreground)', margin: 0, lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--warning)' }}>Credited rows:</strong> this payee could not receive the direct transfer
            (e.g. blocklisted by USDC), so the amount is held in the contract for them to withdraw.
          </p>
        </div>
      )}
    </div>
  )
}
