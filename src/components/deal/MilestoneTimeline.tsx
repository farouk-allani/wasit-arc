/** Milestone timeline — one card per milestone with state, amount, and actions. */
import type { MilestoneData, DealData, PayoutRow } from '../../hooks/useDeal'
import type { PayeeInput } from '../../lib/split'
import { MilestoneActions } from './MilestoneActions'
import { PayoutTable } from './PayoutTable'
import { fmtUsdc } from '../../lib/split'

const MS_STATE_STYLE: Record<string, React.CSSProperties> = {
  Pending:  { background: 'rgb(154 168 186 / 0.10)', color: 'var(--muted-foreground)', border: '1px solid rgb(154 168 186 / 0.20)' },
  Attested: { background: 'rgb(231 176 87 / 0.12)',  color: 'var(--warning)',          border: '1px solid rgb(231 176 87 / 0.25)' },
  Approved: { background: 'rgb(92 196 154 / 0.10)',  color: 'var(--success)',           border: '1px solid rgb(92 196 154 / 0.20)' },
  Released: { background: 'rgb(92 196 154 / 0.10)',  color: 'var(--success)',           border: '1px solid rgb(92 196 154 / 0.20)' },
  Disputed: { background: 'rgb(232 115 95 / 0.10)',  color: 'var(--destructive)',       border: '1px solid rgb(232 115 95 / 0.20)' },
  Resolved: { background: 'rgb(154 168 186 / 0.10)', color: 'var(--secondary-foreground)', border: '1px solid var(--border)' },
  Refunded: { background: 'rgb(154 168 186 / 0.10)', color: 'var(--secondary-foreground)', border: '1px solid var(--border)' },
}

function MsStateBadge({ state }: { state: string }) {
  return (
    <span style={{
      ...MS_STATE_STYLE[state] ?? MS_STATE_STYLE.Pending,
      padding: '2px 8px',
      borderRadius: '99px',
      fontSize: '10px',
      fontWeight: 600,
      letterSpacing: '0.07em',
      textTransform: 'uppercase',
      fontFamily: 'var(--font-ui)',
      whiteSpace: 'nowrap',
    }}>
      {state}
    </span>
  )
}

interface Props {
  dealId: bigint
  deal: DealData
  milestones: MilestoneData[]
  milestoneLabels: string[]   // user-defined labels passed from parent (may be empty)
  connectedAddress: `0x${string}` | undefined
  arbitrationWindow: bigint
  feeBps: number
  payees?: PayeeInput[]
  payoutRows: PayoutRow[]
  chainId: number | undefined
  onSuccess: () => void
}

export function MilestoneTimeline({
  dealId, deal, milestones, milestoneLabels,
  connectedAddress, arbitrationWindow, feeBps, payees,
  payoutRows, chainId, onSuccess,
}: Props) {
  return (
    <section>
      <h2 style={{
        fontFamily: 'var(--font-ui)',
        fontSize: '13px',
        fontWeight: 600,
        color: 'var(--muted-foreground)',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        margin: '0 0 12px',
      }}>
        Milestones
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {milestones.map((ms) => {
          const label = milestoneLabels[ms.index] ?? ''
          const msPayouts = payoutRows.filter(r => r.milestoneIndex === ms.index)
          const terminal = ['Released', 'Resolved', 'Refunded'].includes(ms.state)

          return (
            <div key={ms.index} style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              overflow: 'hidden',
            }}>
              {/* Card header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '14px 16px',
                borderBottom: '1px solid var(--border)',
                background: 'var(--elevated)',
                flexWrap: 'wrap',
              }}>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  color: 'var(--muted-foreground)',
                  minWidth: '28px',
                }}>
                  #{ms.index + 1}
                </span>
                {label && (
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)', flexGrow: 1 }}>
                    {label}
                  </span>
                )}
                <span style={{
                  marginLeft: label ? 0 : 'auto',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '14px',
                  fontWeight: 700,
                  color: 'var(--foreground)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {fmtUsdc(ms.amount)} USDC
                </span>
                <MsStateBadge state={ms.state} />
              </div>

              {/* Body: actions or payout table */}
              <div style={{ padding: '14px 16px' }}>
                {!terminal && (
                  <MilestoneActions
                    dealId={dealId}
                    ms={ms}
                    deal={deal}
                    connectedAddress={connectedAddress}
                    arbitrationWindow={arbitrationWindow}
                    feeBps={feeBps}
                    payees={payees}
                    chainId={chainId}
                    onSuccess={onSuccess}
                  />
                )}

                {/* Payout / where-the-money-went table */}
                {msPayouts.length > 0 && (
                  <PayoutTable rows={msPayouts} chainId={chainId} />
                )}

                {terminal && msPayouts.length === 0 && (
                  <p style={{ fontSize: '12px', color: 'var(--muted-foreground)', margin: 0 }}>
                    No payout events found for this milestone (the events may be before the indexer lookback window).
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
