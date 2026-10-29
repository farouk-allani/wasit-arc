/**
 * Home — full landing page.
 * Hero is preserved exactly. Five content sections follow.
 */
import { Globe } from '../components/Globe'
import { SectionHowItWorks } from '../components/home/SectionHowItWorks'
import { SectionProblem }    from '../components/home/SectionProblem'
import { SectionSplit }      from '../components/home/SectionSplit'
import { SectionLimits }     from '../components/home/SectionLimits'
import { SectionCta }        from '../components/home/SectionCta'

interface Props {
  onNavigate: (page: 'create' | 'deals') => void
}

// ── Inline style helpers ──────────────────────────────────────────────────────
const S = {
  hero: {
    position: 'relative' as const,
    minHeight: '86svh',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
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
      {/* ── HERO — unchanged ────────────────────────────────────────────── */}
      <section style={S.hero} aria-label="Hero">
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

        <div className="hero-scrim-mobile" style={S.scrimBase} />
        <div className="hero-scrim-desktop" style={S.scrimBase} />
        <div className="hero-scrim-bottom" style={S.scrimBase} />

        <div className="hero-content" style={{ position: 'relative', zIndex: 2, flex: 1 }}>
          <div className="hero-left">
            <p className="hero-eyebrow">
              Milestone escrow for cross-border trade&nbsp;&mdash; Built on Arc
            </p>
            <h1 className="hero-headline">
              Milestone escrow for cross-border trade deals.
            </h1>
            <p className="hero-subhead">
              The buyer funds once. Each milestone pays everyone at once, in USDC —
              seller, forwarder, inspector and fee, in a single transaction. Disputes
              go to an arbiter chosen at the start.
            </p>
            <div className="hero-actions">
              <button className="btn-primary" onClick={() => onNavigate('create')}>
                Create a deal
              </button>
              <button className="btn-secondary" onClick={() => onNavigate('deals')}>
                My deals
              </button>
            </div>
            <div className="hero-powered">
              <PoweredByItem label="USDC" />
              <span className="hero-powered-sep" aria-hidden="true">·</span>
              <PoweredByItem label="Arc" />
            </div>
          </div>

          <div className="hero-right" aria-hidden="true">
            <Globe
              fallbackSrc="/hero/port-dusk-globe.webp"
              fallbackSrcSet="/hero/port-dusk-globe-1280.webp 1280w, /hero/port-dusk-globe.webp 2400w"
              className="hero-globe"
            />
          </div>
        </div>
      </section>

      {/* ── CONTENT SECTIONS ────────────────────────────────────────────── */}
      <SectionHowItWorks />
      <SectionProblem />
      <SectionSplit />
      <SectionLimits />
      <SectionCta onNavigate={onNavigate} />
    </div>
  )
}

function PoweredByItem({ label }: { label: string }) {
  return <span className="hero-powered-item">{label}</span>
}
