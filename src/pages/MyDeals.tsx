import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { Construction } from 'lucide-react'

interface Props {
  onOpenDeal: (dealId: string) => void
}

/** Placeholder for My Deals — implemented in a later turn. */
export function MyDeals({ onOpenDeal: _onOpenDeal }: Props) {
  const { address } = useAccount()

  return (
    <main
      style={{
        maxWidth: '800px',
        margin: '0 auto',
        padding: '64px 20px',
      }}
    >
      <h1
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: '28px',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          color: 'var(--foreground)',
          margin: '0 0 8px',
        }}
      >
        My deals
      </h1>
      <p
        style={{
          color: 'var(--muted-foreground)',
          fontSize: '14px',
          margin: '0 0 40px',
        }}
      >
        Deals where you are buyer, payee, inspector or arbiter.
      </p>

      {!address ? (
        <div
          style={{
            padding: '32px',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
            background: 'var(--card)',
            textAlign: 'center',
          }}
        >
          <p style={{ color: 'var(--muted-foreground)', fontSize: '14px', margin: '0 0 20px' }}>
            Connect your wallet to see your deals.
          </p>
          <ConnectKitButton />
        </div>
      ) : (
        <Placeholder />
      )}
    </main>
  )
}

function Placeholder() {
  return (
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
        Deal indexing coming in the next turn. This is the navigation placeholder.
      </p>
    </div>
  )
}
