/**
 * Home — hero only.
 * Two-tone headline, frosted status cards, full-width bottom strip.
 */
import { lazy, Suspense, useState } from 'react'
import { ArrowRight, Wallet, BadgeCheck, Split } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { useChainId } from 'wagmi'
import { supportsWebGL } from '../components/globe/webgl'

// Lazy-load so three.js stays in its own chunk and never blocks first paint
const GlobeCanvas = lazy(() => import('../components/globe/GlobeCanvas'))

interface Props {
  onNavigate: (page: 'create' | 'deals') => void
}

// ── Inline style helpers ──────────────────────────────────────────────────────
const S = {
  hero: {
    position: 'relative' as const,
    minHeight: '92svh',
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

// Checked once at module load — avoids a re-render on mount
const webGLAvailable = typeof window !== 'undefined' && supportsWebGL()

export function Home({ onNavigate }: Props) {
  const chainId = useChainId()
  const networkLabel = chainId === 5042 ? 'Arc Mainnet' : 'Arc Testnet'
  const isMainnet = chainId === 5042
  // Falls back to the static globe photo if WebGL fails at runtime
  const [globeFailed, setGlobeFailed] = useState(false)
  const showCanvas = webGLAvailable && !globeFailed

  return (
    <div>
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
            // @ts-expect-error lowercase fetchpriority is the correct DOM attr in React 18; see vite-env.d.ts
            fetchpriority="high"
          />
        </div>

        {/* Scrims */}
        <div className="hero-scrim-mobile"  style={S.scrimBase} />
        <div className="hero-scrim-desktop" style={S.scrimBase} />
        <div className="hero-scrim-bottom"  style={S.scrimBase} />

        {/* Content grid */}
        <div className="hero-content" style={{ position: 'relative', zIndex: 2, flex: 1 }}>

          {/* ── LEFT ──────────────────────────────────────────────────────────── */}
          <div className="hero-left">
            <p className="hero-eyebrow">
              Milestone escrow for cross-border trade&nbsp;&mdash; Built on Arc
            </p>

            <h1 className="hero-headline">
              Milestone escrow for{' '}
              <span className="hero-headline-gold">cross-border trade deals.</span>
            </h1>

            <p className="hero-subhead">
              The buyer funds once. Each milestone pays everyone at once, in USDC —
              seller, forwarder, inspector and fee, in a single transaction. Disputes
              go to an arbiter chosen at the start.
            </p>

            <div className="hero-actions">
              <button className="btn-primary" onClick={() => onNavigate('create')}>
                Create a deal
                <ArrowRight size={15} strokeWidth={2.2} style={{ marginLeft: 8 }} />
              </button>
              <button className="btn-secondary" onClick={() => onNavigate('deals')}>
                My deals
              </button>
            </div>

            {/* Status cards — shown inline on phones, positioned on desktop */}
            <div className="hero-cards-mobile" aria-hidden="true">
              <StatusCardInline
                icon={<Wallet size={15} />}
                title="Buyer"
                line="Funds the whole deal once, in USDC."
                dotColor="var(--success)"
                label="Funded"
              />
              <StatusCardInline
                icon={<BadgeCheck size={15} />}
                title="Inspector"
                line="Signs that the milestone is done."
                dotColor="var(--success)"
                label="Attested"
              />
              <StatusCardInline
                icon={<Split size={15} />}
                title="One release"
                line="Pays seller, forwarder, inspector and fee."
                dotColor="var(--primary)"
                label="Split in one transaction"
              />
            </div>
          </div>

          {/* ── RIGHT — globe + floating cards ───────────────────────────────── */}
          <div className="hero-right" aria-hidden="true">
            {/* Floating cards — desktop only */}
            <div className="hero-globe-wrap">
              <div className="hero-float-card hero-float-card--ul">
                <FloatCard
                  icon={<Wallet size={14} />}
                  title="Buyer"
                  line="Funds the whole deal once, in USDC."
                  dotColor="var(--success)"
                  label="Funded"
                />
              </div>
              <div className="hero-float-card hero-float-card--ur">
                <FloatCard
                  icon={<BadgeCheck size={14} />}
                  title="Inspector"
                  line="Signs that the milestone is done."
                  dotColor="var(--success)"
                  label="Attested"
                />
              </div>
              <div className="hero-float-card hero-float-card--lr">
                <FloatCard
                  icon={<Split size={14} />}
                  title="One release"
                  line="Pays seller, forwarder, inspector and fee."
                  dotColor="var(--primary)"
                  label="Split in one transaction"
                />
              </div>

              {showCanvas ? (
                <Suspense fallback={null}>
                  <GlobeCanvas
                    className="hero-globe"
                    onFail={() => setGlobeFailed(true)}
                  />
                </Suspense>
              ) : (
                <img
                  src="/hero/port-dusk-globe.webp"
                  srcSet="/hero/port-dusk-globe-1280.webp 1280w, /hero/port-dusk-globe.webp 2400w"
                  sizes="(max-width: 1280px) 100vw, 50vw"
                  alt=""
                  aria-hidden="true"
                  className="hero-globe"
                  style={{ objectFit: 'cover', objectPosition: 'center' }}
                />
              )}
            </div>
          </div>
        </div>

        {/* ── BOTTOM STRIP ─────────────────────────────────────────────────── */}
        <div className="hero-strip" style={{ position: 'relative', zIndex: 2 }}>
          <div className="hero-strip-inner">
            <div className="hero-strip-group">
              <span className="hero-strip-label">Built on</span>
              <span className="hero-strip-value hero-strip-arc">Arc</span>
            </div>
            <div className="hero-strip-divider" aria-hidden="true" />
            <div className="hero-strip-group">
              <span className="hero-strip-label">Settles in</span>
              <span className="hero-strip-value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <TokenUSDC size={18} variant="branded" />
                USDC
              </span>
            </div>
            <div className="hero-strip-divider" aria-hidden="true" />
            <div className="hero-strip-group">
              <span className="hero-strip-label">Built with</span>
              <span className="hero-strip-value">Arc Studio</span>
            </div>
            <div className="hero-strip-divider hero-strip-divider--hide-sm" aria-hidden="true" />
            <div className="hero-strip-group hero-strip-group--network">
              <span
                className="hero-strip-dot"
                style={{ background: isMainnet ? 'var(--primary)' : 'var(--success)' }}
              />
              <span className="hero-strip-value" style={{ fontSize: 12 }}>
                Live on {networkLabel}
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

// ── Floating card (desktop) ───────────────────────────────────────────────────
function FloatCard({
  icon,
  title,
  line,
  dotColor,
  label,
}: {
  icon: React.ReactNode
  title: string
  line: string
  dotColor: string
  label: string
}) {
  return (
    <div className="float-card">
      <div className="float-card-header">
        <span className="float-card-icon">{icon}</span>
        <span className="float-card-title">{title}</span>
      </div>
      <p className="float-card-line">{line}</p>
      <div className="float-card-status">
        <span className="float-card-dot" style={{ background: dotColor }} />
        <span className="float-card-label">{label}</span>
      </div>
    </div>
  )
}

// ── Inline card (phone — stacked below headline) ──────────────────────────────
function StatusCardInline({
  icon,
  title,
  line,
  dotColor,
  label,
}: {
  icon: React.ReactNode
  title: string
  line: string
  dotColor: string
  label: string
}) {
  return (
    <div className="inline-status-card">
      <span className="float-card-icon">{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span className="float-card-title">{title}</span>
        </div>
        <p className="float-card-line" style={{ margin: 0 }}>{line}</p>
      </div>
      <div className="float-card-status" style={{ flexShrink: 0 }}>
        <span className="float-card-dot" style={{ background: dotColor }} />
        <span className="float-card-label">{label}</span>
      </div>
    </div>
  )
}
