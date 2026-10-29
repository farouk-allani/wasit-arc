/** Section 3 — One release, everyone paid */
import { Reveal } from '../Reveal'

/* ── Payout flow diagram — inline SVG / styled divs ─────────────────────────
   One labelled "USDC amount" input arrow → four labelled output arrows.
   Built as pure CSS/SVG, no chart library. Steel and gold tokens only.
──────────────────────────────────────────────────────────────────────────── */
function PayoutDiagram() {
  return (
    <div className="payout-diagram" aria-hidden="true">
      {/* Source */}
      <div className="pd-source">
        <div className="pd-box pd-box--source">
          <span className="mono pd-amount">4,000 USDC</span>
          <span className="pd-label">Milestone release</span>
        </div>
      </div>

      {/* Connector line */}
      <div className="pd-connector">
        <svg viewBox="0 0 40 120" preserveAspectRatio="none" aria-hidden="true">
          <line x1="20" y1="0" x2="20" y2="120" stroke="var(--primary)" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.35" />
        </svg>
      </div>

      {/* Recipients */}
      <div className="pd-recipients">
        {[
          { label: 'Seller',            pct: '80%',  color: 'gold'  },
          { label: 'Freight forwarder', pct: '12%',  color: 'steel' },
          { label: 'Inspector',         pct: '6%',   color: 'steel' },
          { label: 'Platform fee',      pct: '2%',   color: 'steel' },
        ].map((r, i) => (
          <div key={r.label} className="pd-recipient" style={{ animationDelay: `${i * 60}ms` }}>
            <svg viewBox="0 0 40 32" preserveAspectRatio="none" className="pd-branch" aria-hidden="true">
              <line x1="0" y1="16" x2="40" y2="16" stroke={r.color === 'gold' ? 'var(--primary)' : 'var(--secondary-foreground)'} strokeWidth="1.5" opacity="0.35" />
            </svg>
            <div className={`pd-box pd-box--recipient ${r.color === 'gold' ? 'pd-box--gold' : ''}`}>
              <span className="pd-label">{r.label}</span>
              <span className="mono pd-pct">{r.pct}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const NOTES = [
  {
    title: 'If a payee cannot receive',
    body: "Arc reverts transfers to blocklisted addresses. If one payee's transfer fails, their share is credited to them to withdraw later and everyone else is still paid. One address cannot block a release.",
  },
  {
    title: 'If the arbiter goes quiet',
    body: 'A disputed milestone is not frozen forever. After fourteen days anyone can settle it to what the inspector attested.',
  },
]

export function SectionSplit() {
  return (
    <section className="lp-section" aria-labelledby="split-heading">
      <div className="lp-inner lp-two-col lp-two-col--flip">

        {/* Left — text */}
        <Reveal className="lp-col-text">
          <p className="lp-eyebrow">The split</p>
          <h2 id="split-heading" className="lp-heading">One release. Everyone paid.</h2>
          <p className="lp-body">
            A milestone release is a single transaction. The seller, the freight forwarder,
            the inspector and the platform fee are all paid from it, in the shares fixed when
            the deal was created. Nobody waits on anybody else to forward their cut.
          </p>

          <div className="split-notes">
            {NOTES.map(n => (
              <div key={n.title} className="split-note">
                <p className="split-note-title">{n.title}</p>
                <p className="split-note-body">{n.body}</p>
              </div>
            ))}
          </div>
        </Reveal>

        {/* Right — diagram */}
        <Reveal delay="100ms" className="lp-col-diagram">
          <PayoutDiagram />
        </Reveal>

      </div>
    </section>
  )
}
