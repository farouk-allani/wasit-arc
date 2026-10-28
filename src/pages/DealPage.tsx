import { Construction } from 'lucide-react'

interface Props {
  dealId: string
}

/** Placeholder for the deal detail page — implemented in a later turn. */
export function DealPage({ dealId }: Props) {
  return (
    <main
      style={{
        maxWidth: '800px',
        margin: '0 auto',
        padding: '64px 20px',
      }}
    >
      <p
        style={{
          fontSize: '12px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--muted-foreground)',
          margin: '0 0 8px',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        Deal
      </p>
      <h1
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: '28px',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          color: 'var(--foreground)',
          margin: '0 0 40px',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        #{dealId}
      </h1>

      <div
        style={{
          padding: '48px 32px',
          borderRadius: 'var(--radius)',
          border: '1px dashed var(--border)',
          background: 'var(--card)',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        <Construction size={28} strokeWidth={1.5} style={{ color: 'var(--muted-foreground)' }} />
        <p style={{ color: 'var(--muted-foreground)', fontSize: '13px', margin: 0, maxWidth: '30ch', textWrap: 'balance' }}>
          Deal detail view coming in the next turn. This is the navigation placeholder.
        </p>
      </div>
    </main>
  )
}
