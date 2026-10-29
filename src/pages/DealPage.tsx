/**
 * DealPage — full deal detail view.
 *
 * Loads deal state via useDeal, recovers payee list from the DealCreated event,
 * and composes DealHeader, PartiesSplit, FundPanel, WithdrawPanel, and
 * MilestoneTimeline.
 */
import { useEffect, useState } from 'react'
import { useAccount, useChainId } from 'wagmi'
import { usePublicClient } from 'wagmi'
import { parseAbiItem, decodeEventLog, type Log } from 'viem'
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react'

import { useDeal } from '../hooks/useDeal'
import { DealHeader } from '../components/deal/DealHeader'
import { PartiesSplit } from '../components/deal/PartiesSplit'
import { MilestoneTimeline } from '../components/deal/MilestoneTimeline'
import { FundPanel } from '../components/deal/FundPanel'
import { WithdrawPanel } from '../components/deal/WithdrawPanel'
import { getContractAddress } from '../lib/wasit-config'
import type { PayeeInput } from '../lib/split'

interface Props {
  dealId: string
  onBack: () => void
}

// ── Recover payee list from the DealCreated event ─────────────────────────────
interface DealCreatedArgs {
  payees: readonly { addr: `0x${string}`; bps: number }[]
  milestoneAmounts: readonly bigint[]
  challengeWindow: bigint
}

function useDealCreatedEvent(
  dealId: string,
  chainId: number | undefined,
): { payees: PayeeInput[]; milestoneAmounts: bigint[]; loaded: boolean } {
  const publicClient = usePublicClient({ chainId })
  const contractAddress = chainId ? getContractAddress(chainId) : null
  const [result, setResult] = useState<{ payees: PayeeInput[]; milestoneAmounts: bigint[]; loaded: boolean }>(
    { payees: [], milestoneAmounts: [], loaded: false }
  )

  useEffect(() => {
    if (!publicClient || !contractAddress) return
    let cancelled = false

    async function fetch() {
      if (!publicClient || !contractAddress) return
      try {
        const currentBlock = await publicClient.getBlockNumber()
        const fromBlock = currentBlock > 500_000n ? currentBlock - 500_000n : 0n

        // DealCreated(uint256 indexed dealId, address indexed buyer, address inspector,
        //             address arbiter, uint128 total, uint64 deadline)
        // NOTE: The full event including payees is not in the DealCreated ABI fragment —
        // we use the full ABI item from the contract which includes payees[] as a tuple array.
        // Since parseAbiItem doesn't support tuple arrays easily, we use getLogs with
        // the contract ABI and the DealCreated signature, then decode.
        const logs = await publicClient.getLogs({
          address: contractAddress,
          event: parseAbiItem(
            'event DealCreated(uint256 indexed dealId, address indexed buyer, address inspector, address arbiter, uint128 total, uint64 deadline)',
          ),
          args: { dealId: BigInt(dealId) },
          fromBlock,
          toBlock: 'latest',
        })

        if (cancelled || logs.length === 0) {
          if (!cancelled) setResult({ payees: [], milestoneAmounts: [], loaded: true })
          return
        }

        // The DealCreated event in the contract also carries payees[] and milestoneAmounts[]
        // but those aren't in the simplified signature above. We'll fetch the full tx receipt
        // and re-decode from the raw log data using the full ABI.
        const log = logs[0] as Log
        // Try to get payees from the full DealCreated log using the extended ABI item
        // that includes the tuple array. Fall back to empty if it fails.
        let payees: PayeeInput[] = []
        let milestoneAmounts: bigint[] = []

        try {
          // Extended DealCreated signature with payees tuple array and milestoneAmounts
          const fullEvent = parseAbiItem(
            'event DealCreated(uint256 indexed dealId, address indexed buyer, ' +
            '(address addr, uint16 bps)[] payees, address inspector, address arbiter, ' +
            'uint256[] milestoneAmounts, uint64 challengeWindow, uint64 deadline, uint128 total)'
          )
          const decoded = decodeEventLog({
            abi: [fullEvent],
            data: log.data,
            topics: log.topics,
          }) as unknown as { args: DealCreatedArgs }
          if (decoded.args.payees) {
            payees = decoded.args.payees.map((p, i) => ({
              addr: p.addr,
              bps: Number(p.bps),
              role: i === 0 ? 'Seller' : `Payee ${i + 1}`,
            }))
          }
          if (decoded.args.milestoneAmounts) {
            milestoneAmounts = [...decoded.args.milestoneAmounts]
          }
        } catch {
          // If the extended decode fails (e.g. simplified event was emitted), continue with empty payees
        }

        if (!cancelled) setResult({ payees, milestoneAmounts, loaded: true })
      } catch {
        if (!cancelled) setResult({ payees: [], milestoneAmounts: [], loaded: true })
      }
    }

    void fetch()
    return () => { cancelled = true }
  }, [publicClient, contractAddress, dealId, chainId])

  return result
}

// ── DealPage component ────────────────────────────────────────────────────────
export function DealPage({ dealId, onBack }: Props) {
  const { address: connectedAddress } = useAccount()
  const walletChainId = useChainId()

  // We display on the current chain; use the wallet chain or fall back to Arc Testnet
  const chainId = walletChainId ?? 5042002

  const {
    deal, milestones, feeBps, arbitrationWindow,
    owedBalance, payoutRows,
    isLoading, isError, refetch,
  } = useDeal(dealId, chainId)

  const { payees, milestoneAmounts, loaded: payeesLoaded } = useDealCreatedEvent(dealId, chainId)

  // Derive milestone labels from milestone amounts (shown as USDC amounts when no label known)
  // Labels would be stored off-chain; here we generate defaults from amounts
  const milestoneLabels: string[] = milestoneAmounts.map((_, i) => `Milestone ${i + 1}`)

  const contractAddress = getContractAddress(chainId)
  const isWrongNetwork = !contractAddress

  // ── Wrong network ─────────────────────────────────────────────────────────
  if (isWrongNetwork) {
    return (
      <PageWrapper dealId={dealId} onBack={onBack}>
        <EmptyState
          icon={<AlertTriangle size={28} strokeWidth={1.5} style={{ color: 'var(--warning)' }} />}
          title="Wrong network"
          body="This deal is on Arc Testnet or Arc Mainnet. Please switch your wallet to the correct network."
        />
      </PageWrapper>
    )
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading || !payeesLoaded) {
    return (
      <PageWrapper dealId={dealId} onBack={onBack}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--muted-foreground)', padding: '64px 0' }}>
          <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
          <span style={{ fontSize: '13px' }}>Loading deal…</span>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </PageWrapper>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (isError || !deal) {
    return (
      <PageWrapper dealId={dealId} onBack={onBack}>
        <EmptyState
          icon={<AlertTriangle size={28} strokeWidth={1.5} style={{ color: 'var(--destructive)' }} />}
          title={isError ? 'Failed to load deal' : `Deal #${dealId} not found`}
          body={isError
            ? 'Could not fetch deal data. Check your network connection and try again.'
            : 'No deal exists at this id. Check the id and the selected network.'
          }
        />
        <button
          onClick={refetch}
          style={{
            marginTop: '16px', padding: '8px 18px', borderRadius: 'var(--radius)',
            border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--foreground)', fontSize: '13px', fontWeight: 500,
            cursor: 'pointer', fontFamily: 'var(--font-ui)',
          }}
        >
          Retry
        </button>
      </PageWrapper>
    )
  }

  const isBuyer = connectedAddress?.toLowerCase() === deal.buyer.toLowerCase()
  const resolvedFeeBps = feeBps ?? 200
  const resolvedArbWindow = arbitrationWindow ?? BigInt(14 * 86400)

  return (
    <PageWrapper dealId={dealId} onBack={onBack}>
      {/* Deal header */}
      <DealHeader dealId={dealId} deal={deal} chainId={chainId} />

      {/* Withdraw panel — shown when connected wallet has owed balance */}
      {owedBalance > 0n && connectedAddress && (
        <WithdrawPanel
          owedBalance={owedBalance}
          chainId={chainId}
          onSuccess={refetch}
        />
      )}

      {/* Fund panel — shown to buyer when deal is Created */}
      {deal.state === 'Created' && isBuyer && (
        <FundPanel
          dealId={BigInt(dealId)}
          total={deal.total}
          buyerAddress={connectedAddress}
          chainId={chainId}
          onSuccess={refetch}
        />
      )}

      {/* Fund panel hint for non-buyer */}
      {deal.state === 'Created' && !isBuyer && connectedAddress && (
        <div style={{
          padding: '14px 18px',
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          marginBottom: '24px',
          fontSize: '13px',
          color: 'var(--muted-foreground)',
        }}>
          Waiting for the buyer (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--foreground)' }}>
            {deal.buyer.slice(0, 6)}…{deal.buyer.slice(-4)}
          </span>
          ) to fund this deal.
        </div>
      )}

      {/* Parties & split */}
      <PartiesSplit
        deal={deal}
        payees={payees.length > 0 ? payees : undefined}
        feeBps={resolvedFeeBps}
      />

      {/* Milestone timeline */}
      <MilestoneTimeline
        dealId={BigInt(dealId)}
        deal={deal}
        milestones={milestones}
        milestoneLabels={milestoneLabels}
        connectedAddress={connectedAddress}
        arbitrationWindow={resolvedArbWindow}
        feeBps={resolvedFeeBps}
        payees={payees.length > 0 ? payees : undefined}
        payoutRows={payoutRows}
        chainId={chainId}
        onSuccess={refetch}
      />
    </PageWrapper>
  )
}

// ── Layout wrappers ───────────────────────────────────────────────────────────
function PageWrapper({ dealId, onBack, children }: { dealId: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <main style={{ maxWidth: '860px', margin: '0 auto', padding: '32px 20px 80px' }}>
      {/* Back link */}
      <button
        onClick={onBack}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--muted-foreground)', fontSize: '13px',
          fontFamily: 'var(--font-ui)', padding: '0 0 24px',
        }}
      >
        <ArrowLeft size={14} /> My deals
      </button>

      {/* Page title */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '28px' }}>
        <span style={{
          fontSize: '11px', fontFamily: 'var(--font-mono)',
          color: 'var(--muted-foreground)', letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>Deal</span>
        <h1 style={{
          fontFamily: 'var(--font-mono)', fontSize: '28px', fontWeight: 700,
          color: 'var(--foreground)', margin: 0, fontVariantNumeric: 'tabular-nums',
        }}>
          #{dealId}
        </h1>
      </div>

      {children}
    </main>
  )
}

function EmptyState({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div style={{
      padding: '48px 32px', borderRadius: 'var(--radius)',
      border: '1px dashed var(--border)', background: 'var(--card)',
      textAlign: 'center', display: 'flex', flexDirection: 'column',
      alignItems: 'center', gap: '12px',
    }}>
      {icon}
      <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>{title}</p>
      <p style={{ fontSize: '13px', color: 'var(--muted-foreground)', margin: 0, maxWidth: '36ch', textAlign: 'center' }}>{body}</p>
    </div>
  )
}
