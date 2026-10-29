/** Section 5 — Closing CTA */
import { useChainId } from 'wagmi'
import { Reveal } from '../Reveal'
import { ARC_TESTNET_CHAIN_ID, ARC_MAINNET_CHAIN_ID } from '../../lib/wasit-config'

interface Props {
  onNavigate: (page: 'create' | 'deals') => void
}

function NetworkPill() {
  const chainId = useChainId()
  const isTestnet = chainId === ARC_TESTNET_CHAIN_ID
  const isMainnet = chainId === ARC_MAINNET_CHAIN_ID
  const onArc = isTestnet || isMainnet
  const label = isMainnet ? 'Live on Arc' : isTestnet ? 'Live on Arc Testnet' : 'Live on Arc'

  return (
    <div className="cta-network-pill">
      <span
        className="cta-dot"
        style={{ background: onArc ? 'var(--success)' : 'var(--muted-foreground)' }}
        aria-hidden="true"
      />
      <span>{label}</span>
    </div>
  )
}

export function SectionCta({ onNavigate }: Props) {
  return (
    <section className="lp-section cta-section" aria-label="Get started">
      <div className="lp-inner cta-inner">
        <Reveal>
          <h2 className="cta-heading">
            Set the terms. Fund once. Pay everyone at once.
          </h2>
        </Reveal>

        <Reveal delay="80ms">
          <div className="cta-actions">
            <button className="btn-primary" onClick={() => onNavigate('create')}>
              Create a deal
            </button>
            <button className="btn-secondary" onClick={() => onNavigate('deals')}>
              My deals
            </button>
            <NetworkPill />
          </div>
        </Reveal>
      </div>
    </section>
  )
}
