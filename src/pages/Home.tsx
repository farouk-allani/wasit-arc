import { useAccount } from 'wagmi'
import { ArrowRight, FileText, Briefcase } from 'lucide-react'

interface Props {
  onNavigate: (page: 'create' | 'deals') => void
}

export function Home({ onNavigate }: Props) {
  const { address } = useAccount()

  return (
    <main
      style={{
        maxWidth: '640px',
        margin: '0 auto',
        padding: '64px 20px 48px',
      }}
    >
      {/* Logo mark — large */}
      <div style={{ marginBottom: '32px' }}>
        <svg
          width="52"
          height="52"
          viewBox="0 0 64 64"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="hm-steel" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#eef2f6" />
              <stop offset="1" stopColor="#8d98a8" />
            </linearGradient>
            <linearGradient id="hm-gold" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#f3dcb4" />
              <stop offset="1" stopColor="#b8895a" />
            </linearGradient>
          </defs>
          <rect width="64" height="64" rx="14" fill="var(--card)" />
          <g transform="translate(32 32) scale(0.82) translate(-32 -32)">
            <g fill="none" strokeWidth="7" strokeLinejoin="miter">
              <path d="M24 11 L9 32 L24 53" stroke="url(#hm-steel)" />
              <path d="M40 11 L55 32 L40 53" stroke="url(#hm-gold)" />
            </g>
            <path d="M32 21 L43 32 L32 43 L21 32Z" fill="#f6efe2" />
          </g>
        </svg>
      </div>

      {/* Pitch */}
      <h1
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'clamp(26px, 5vw, 36px)',
          fontWeight: 700,
          letterSpacing: '-0.03em',
          lineHeight: 1.2,
          color: 'var(--foreground)',
          margin: '0 0 16px',
          textWrap: 'balance',
        }}
      >
        Milestone escrow for cross-border trade deals.
      </h1>

      <p
        style={{
          fontSize: '16px',
          lineHeight: 1.7,
          color: 'var(--muted-foreground)',
          margin: '0 0 48px',
          maxWidth: '52ch',
          textWrap: 'pretty',
        }}
      >
        The buyer funds once; each milestone pays everyone at once, in USDC. No
        intermediary. No withheld funds. Disputes go to an arbiter you chose at the
        start.
      </p>

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '320px' }}>
        <ActionCard
          icon={<FileText size={18} strokeWidth={1.5} />}
          title="Create a deal"
          description="Set payees, milestones, inspector and arbiter."
          primary
          onClick={() => onNavigate('create')}
        />
        <ActionCard
          icon={<Briefcase size={18} strokeWidth={1.5} />}
          title="My deals"
          description={
            address ? 'Deals you are part of as buyer, payee, inspector or arbiter.' : 'Connect your wallet to see your deals.'
          }
          onClick={() => onNavigate('deals')}
        />
      </div>

      {/* How it works — quiet secondary section */}
      <section style={{ marginTop: '72px', borderTop: '1px solid var(--border)', paddingTop: '40px' }}>
        <h2
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.09em',
            textTransform: 'uppercase',
            color: 'var(--muted-foreground)',
            margin: '0 0 24px',
          }}
        >
          How it works
        </h2>

        <ol
          style={{
            margin: 0,
            padding: 0,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
          }}
        >
          {STEPS.map((step, i) => (
            <li
              key={i}
              style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: 'var(--muted-foreground)',
                  fontFamily: 'var(--font-mono)',
                  marginTop: '1px',
                }}
              >
                {i + 1}
              </span>
              <div>
                <p
                  style={{
                    margin: '0 0 3px',
                    fontWeight: 600,
                    fontSize: '14px',
                    color: 'var(--foreground)',
                  }}
                >
                  {step.title}
                </p>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted-foreground)' }}>
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}

function ActionCard({
  icon,
  title,
  description,
  primary,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  description: string
  primary?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        padding: '16px 18px',
        borderRadius: 'var(--radius)',
        background: primary ? 'var(--card)' : 'transparent',
        border: primary ? '1px solid var(--border)' : '1px solid var(--border)',
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
        fontFamily: 'var(--font-ui)',
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--elevated)'
        e.currentTarget.style.borderColor = 'rgb(180 191 207 / 0.30)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = primary ? 'var(--card)' : 'transparent'
        e.currentTarget.style.borderColor = 'var(--border)'
      }}
    >
      <span
        style={{
          color: primary ? 'var(--primary)' : 'var(--muted-foreground)',
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1 }}>
        <span
          style={{
            display: 'block',
            fontSize: '14px',
            fontWeight: 600,
            color: 'var(--foreground)',
            marginBottom: '2px',
          }}
        >
          {title}
        </span>
        <span style={{ fontSize: '12px', color: 'var(--muted-foreground)' }}>
          {description}
        </span>
      </span>
      <ArrowRight size={15} style={{ color: 'var(--muted-foreground)', flexShrink: 0 }} />
    </button>
  )
}

const STEPS = [
  {
    title: 'Buyer creates and funds a deal',
    body: 'Set the payee split, milestones, inspector and arbiter. Fund the escrow in one USDC transfer.',
  },
  {
    title: 'Inspector attests each milestone',
    body: 'The inspector signs off when work is done. A challenge window lets the buyer dispute.',
  },
  {
    title: 'Payment releases to all parties at once',
    body: 'One transaction splits the milestone amount among payees, net of the platform fee.',
  },
  {
    title: 'Disputes resolved by the arbiter',
    body: 'The arbiter splits any disputed milestone. After 14 days without a ruling, anyone can settle it to the attested outcome.',
  },
]
