/** Section 4 — Limits and principles */
import { Reveal } from '../Reveal'

const ENFORCED = [
  {
    title: 'No owner access to money',
    body: 'There is no admin path that can move escrowed funds. The fee recipient and the fee rate are fixed at deployment and cannot be changed.',
  },
  {
    title: 'Terms are frozen',
    body: 'Payees, shares, amounts, the arbiter and the deadline are set when the deal is created. There is no upgradeable proxy.',
  },
  {
    title: 'Exits always work',
    body: 'No single payee can block a release, and no silent arbiter can freeze a milestone permanently.',
  },
  {
    title: 'Everything is traceable',
    body: 'Every state change emits an event, so anyone can follow a deal on the Arc explorer.',
  },
]

const CANNOT = [
  {
    title: 'Signatures, not truth',
    body: 'An attestation is a statement by a named inspector. The challenge window and the arbiter are what catch a false one.',
  },
  {
    title: 'Fingerprints, not shipments',
    body: 'A document hash proves a file was not altered. It does not prove the goods were made or shipped.',
  },
  {
    title: 'The arbiter is your choice',
    body: "Wasit enforces the arbiter's ruling. Choosing someone trustworthy is still a decision the parties make off-chain.",
  },
  {
    title: 'Unaudited',
    body: 'The contracts were written and reviewed in Arc Studio, with 143 tests and four invariants. That is not a third-party audit. Use small amounts.',
  },
]

function LimitItem({ title, body }: { title: string; body: string }) {
  return (
    <div className="limit-item">
      <p className="limit-title">{title}</p>
      <p className="limit-body">{body}</p>
    </div>
  )
}

export function SectionLimits() {
  return (
    <section className="lp-section lp-section--alt" aria-labelledby="limits-heading">
      <div className="lp-inner lp-two-col">

        {/* Left — enforced */}
        <Reveal className="lp-col-text">
          <h2 id="limits-heading" className="lp-heading lp-heading--sm">
            Enforced by the contracts
          </h2>
          <p className="lp-sub-heading">No person can override these, including us.</p>
          <div className="limit-list">
            {ENFORCED.map(item => (
              <LimitItem key={item.title} {...item} />
            ))}
          </div>
        </Reveal>

        {/* Right — cannot */}
        <Reveal delay="80ms" className="lp-col-text">
          <h2 className="lp-heading lp-heading--sm">What the code cannot do for you</h2>
          <p className="lp-sub-heading">&nbsp;</p>
          <div className="limit-list">
            {CANNOT.map(item => (
              <LimitItem key={item.title} {...item} />
            ))}
          </div>
        </Reveal>

      </div>
    </section>
  )
}
