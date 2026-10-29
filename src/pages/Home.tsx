/**
 * Home — hero landing page for Wasit.
 * Full-bleed port-dusk photograph, navy scrims, two-column layout with
 * a lazy-loaded WebGL globe, and a compact how-it-works strip below.
 */
import { Globe } from '../components/Globe'

interface Props {
  onNavigate: (page: 'create' | 'deals') => void
}

// ── Inline style helpers ──────────────────────────────────────────────────────
const S = {
  // Hero wrapper — full-bleed, min 86svh
  hero: {
    position: 'relative' as const,
    minHeight: '86svh',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },

  // Photo layer — absolutely fills the hero
  photo: {
    position: 'absolute' as const,
    inset: 0,
    zIndex: 0,
  },

  photoImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    objectPosition: 'center 60%',
    display: 'block',
  },

  // Scrim layers — stacked via z-index
  scrimBase: {
    position: 'absolute' as const,
    inset: 0,
    zIndex: 1,
    pointerEvents: 'none' as const,
  },
} as const

export function Home({ onNavigate }: Props) {
  return (
    <div>
      {/* ── HERO ────────────────────────────────────────────────────────── */}
      <section style={S.hero} aria-label="Hero">
        {/* Background photo */}
        <div style={S.photo}>
          <img
            src="/hero/port-dusk.webp"
            srcSet="/hero/port-dusk-1280.webp 1280w, /hero/port-dusk.webp 2400w"
            sizes="100vw"
            alt=""
            aria-hidden="true"
            style={S.photoImg}
            fetchPriority="high"
          />
        </div>

        {/* Scrim — mobile: bottom-up; desktop: left-to-right (via CSS class) */}
        <div className="hero-scrim-mobile" style={S.scrimBase} />
        <div className="hero-scrim-desktop" style={S.scrimBase} />
        {/* Bottom page-blend fade */}
        <div className="hero-scrim-bottom" style={S.scrimBase} />

        {/* Content grid */}
        <div className="hero-content" style={{ position: 'relative', zIndex: 2, flex: 1 }}>
          {/* ── Left column ──────────────────────────────────────────────── */}
          <div className="hero-left">
            {/* Eyebrow */}
            <p className="hero-eyebrow">
              Milestone escrow for cross-border trade&nbsp;&mdash; Built on Arc
            </p>

            {/* Headline */}
            <h1 className="hero-headline">
              Milestone escrow for cross-border trade deals.
            </h1>

            {/* Subhead */}
            <p className="hero-subhead">
              The buyer funds once. Each milestone pays everyone at once, in USDC —
              seller, forwarder, inspector and fee, in a single transaction. Disputes
              go to an arbiter chosen at the start.
            </p>

            {/* Actions */}
            <div className="hero-actions">
              <button
                className="btn-primary"
                onClick={() => onNavigate('create')}
              >
                Create a deal
              </button>
              <button
                className="btn-secondary"
                onClick={() => onNavigate('deals')}
              >
                My deals
              </button>
            </div>

            {/* Powered-by strip */}
            <div className="hero-powered">
              <PoweredByItem label="USDC" />
              <span className="hero-powered-sep" aria-hidden="true">·</span>
              <PoweredByItem label="Arc" />
            </div>
          </div>

          {/* ── Right column — globe ─────────────────────────────────────── */}
          <div className="hero-right" aria-hidden="true">
            <Globe
              fallbackSrc="/hero/port-dusk-globe.webp"
              fallbackSrcSet="/hero/port-dusk-globe-1280.webp 1280w, /hero/port-dusk-globe.webp 2400w"
              className="hero-globe"
            />
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ────────────────────────────────────────────────── */}
      <section className="how-section" aria-label="How it works">
        <div className="how-inner">
          {HOW_STEPS.map((step, i) => (
            <HowStep key={i} index={i + 1} title={step.title} body={step.body} />
          ))}
        </div>
      </section>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PoweredByItem({ label }: { label: string }) {
  return (
    <span className="hero-powered-item">
      {label}
    </span>
  )
}

function HowStep({ index, title, body }: { index: number; title: string; body: string }) {
  return (
    <div className="how-step">
      <span className="how-step-num" aria-hidden="true">{index}</span>
      <div>
        <p className="how-step-title">{title}</p>
        <p className="how-step-body">{body}</p>
      </div>
    </div>
  )
}

// ── Data ──────────────────────────────────────────────────────────────────────

const HOW_STEPS = [
  {
    title: 'Fund once',
    body: 'The buyer approves and transfers the full deal amount into escrow. Funds are locked until milestones complete.',
  },
  {
    title: 'Attest and release',
    body: 'The inspector attests each milestone. After the challenge window, anyone can release — paying all parties in one transaction.',
  },
  {
    title: 'Dispute or refund',
    body: 'The buyer may dispute within the window; an arbiter resolves. Milestones never attested by the deadline refund to the buyer automatically.',
  },
]
