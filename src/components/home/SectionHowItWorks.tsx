/** Section 1 — How it works */
import { Reveal } from '../Reveal'

const STEPS = [
  {
    n: '1',
    title: 'Terms are fixed first',
    body: 'Payees and their shares, milestone amounts, who attests, the arbiter and the deadline are all set before any money moves. The contract checks every rule when the deal is created.',
  },
  {
    n: '2',
    title: 'Fund once, attest per milestone',
    body: 'The buyer funds the whole deal in one USDC payment. An inspector attests each milestone as it is completed, with a hash of the supporting documents.',
  },
  {
    n: '3',
    title: 'Release, dispute or refund',
    body: 'After a short challenge window anyone can release the milestone, and it pays everyone at once. The buyer can dispute inside the window. Milestones never attested refund the buyer after the deadline.',
  },
]

const SPLIT_ROWS = [
  { role: 'Seller',            bps: '8,000', usdc: '3,200.00' },
  { role: 'Freight forwarder', bps: '1,200', usdc: '480.00'   },
  { role: 'Inspector',         bps: '600',   usdc: '240.00'   },
  { role: 'Platform fee',      bps: '200',   usdc: '80.00'    },
]

export function SectionHowItWorks() {
  return (
    <section className="lp-section" aria-labelledby="how-heading">
      <div className="lp-inner">
        <Reveal>
          <p className="lp-eyebrow">How it works</p>
          <h2 id="how-heading" className="lp-heading">Terms first. Then money moves.</h2>
        </Reveal>

        {/* Three steps */}
        <div className="how-steps-grid">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={`${i * 80}ms`}>
              <div className="how-step-card">
                <span className="how-step-num" aria-hidden="true">{s.n}</span>
                <div>
                  <p className="how-step-title">{s.title}</p>
                  <p className="how-step-body">{s.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Worked example */}
        <Reveal delay="120ms">
          <div className="example-panel">
            <p className="example-heading">
              Example: a $10,000 order, released in two milestones
            </p>
            <p className="example-sub">First milestone — 4,000 USDC</p>

            <div className="example-table" role="table" aria-label="Milestone split example">
              {/* Header */}
              <div className="example-row example-row--head" role="row">
                <span role="columnheader">Role</span>
                <span role="columnheader" style={{ textAlign: 'right' }}>Basis points</span>
                <span role="columnheader" style={{ textAlign: 'right' }}>USDC</span>
              </div>
              {SPLIT_ROWS.map(r => (
                <div key={r.role} className="example-row" role="row">
                  <span role="cell">{r.role}</span>
                  <span role="cell" className="mono" style={{ textAlign: 'right', color: 'var(--muted-foreground)' }}>{r.bps}</span>
                  <span role="cell" className="mono" style={{ textAlign: 'right', color: 'var(--foreground)' }}>{r.usdc}</span>
                </div>
              ))}
              {/* Total */}
              <div className="example-row example-row--total" role="row">
                <span role="cell" style={{ fontWeight: 600 }}>Total</span>
                <span role="cell" />
                <span role="cell" className="mono" style={{ textAlign: 'right', color: 'var(--primary)', fontWeight: 600 }}>4,000.00</span>
              </div>
            </div>

            <p className="example-note">
              One transaction. The seller takes the remainder, so rounding never goes
              missing and the rows always sum to the milestone exactly.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
