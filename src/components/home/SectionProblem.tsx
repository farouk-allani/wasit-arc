/** Section 2 — The problem */
import { Reveal } from '../Reveal'

const STATS = [
  { figure: '30 / 70', label: 'Common sourcing terms: deposit, then balance' },
  { figure: '$2.5T',   label: 'Global trade finance gap in 2025' },
  { figure: '41%',     label: 'Of SME trade finance requests rejected' },
]

export function SectionProblem() {
  return (
    <section className="lp-section lp-section--alt" aria-labelledby="problem-heading">
      <div className="lp-inner lp-two-col">

        {/* Left */}
        <Reveal className="lp-col-text">
          <p className="lp-eyebrow">The problem</p>
          <h2 id="problem-heading" className="lp-heading">
            The deposit leaves before the goods exist.
          </h2>
          <p className="lp-body">
            More importers pay foreign suppliers in stablecoins: fast and final, but with
            no buyer protection, and the production deposit is sent before anything is made.
            A bank letter of credit is slow, costly and often out of reach for small firms.
          </p>
        </Reveal>

        {/* Right — stats panel */}
        <Reveal delay="80ms" className="lp-col-panel">
          <div className="stats-panel">
            <div className="stats-row">
              {STATS.map(s => (
                <div key={s.figure} className="stat-item">
                  <span className="stat-figure mono">{s.figure}</span>
                  <span className="stat-label">{s.label}</span>
                </div>
              ))}
            </div>

            {/* Tinted strip */}
            <div className="stats-strip">
              <strong>Wasit does not lend.</strong>
              {' '}It protects the advance a buyer already pays.
            </div>
          </div>

          <p className="stats-source">
            Gap and rejection rate: Asian Development Bank, Global Trade Finance Gap
            Survey (2026). Shown as context only.
          </p>
        </Reveal>

      </div>
    </section>
  )
}
