/** WithdrawPanel — shown when the connected wallet has an owed balance. */
import { useEffect } from 'react'
import { CheckCircle, ExternalLink, AlertCircle } from 'lucide-react'
import { useWithdraw } from '../../hooks/useDealActions'
import { fmtUsdc } from '../../lib/split'
import { buildTxExplorerUrl } from '../../onchain-facts'

interface Props {
  owedBalance: bigint
  chainId: number | undefined
  onSuccess: () => void
}

export function WithdrawPanel({ owedBalance, chainId, onSuccess }: Props) {
  const { withdraw, txHash, isPending, isConfirming, isSuccess, error } = useWithdraw(chainId)

  useEffect(() => {
    if (isSuccess) onSuccess()
  }, [isSuccess, onSuccess])

  if (owedBalance === 0n) return null

  return (
    <div style={{
      padding: '16px 20px',
      background: 'rgb(221 184 134 / 0.06)',
      border: '1px solid rgb(221 184 134 / 0.25)',
      borderRadius: 'var(--radius)',
      marginBottom: '24px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '14px',
      flexWrap: 'wrap',
    }}>
      <AlertCircle size={16} style={{ color: 'var(--primary)', marginTop: '2px', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: '200px' }}>
        <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--primary)', margin: '0 0 2px' }}>
          You have a pending withdrawal
        </p>
        <p style={{ fontSize: '12px', color: 'var(--secondary-foreground)', margin: '0 0 10px' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
            {fmtUsdc(owedBalance)} USDC
          </span>
          {' '}is held for you — a previous payout transfer failed (e.g. you were blocklisted at the time).
          Withdraw it to your wallet now.
        </p>
        {!isSuccess && (
          <button
            onClick={withdraw}
            disabled={isPending || isConfirming}
            style={{
              padding: '7px 16px',
              borderRadius: 'var(--radius)',
              border: 'none',
              cursor: isPending || isConfirming ? 'default' : 'pointer',
              fontSize: '12px',
              fontWeight: 600,
              fontFamily: 'var(--font-ui)',
              background: 'var(--primary)',
              color: 'var(--primary-foreground)',
              opacity: isPending || isConfirming ? 0.7 : 1,
            }}
          >
            {isPending ? 'Confirm in wallet…' : isConfirming ? 'Withdrawing…' : `Withdraw ${fmtUsdc(owedBalance)} USDC`}
          </button>
        )}
        {isSuccess && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <CheckCircle size={13} style={{ color: 'var(--success)' }} />
            <span style={{ fontSize: '12px', color: 'var(--success)' }}>Withdrawn</span>
            {txHash && chainId && (
              <a
                href={buildTxExplorerUrl(chainId, txHash)}
                target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}
              >
                {txHash.slice(0, 10)}…<ExternalLink size={9} />
              </a>
            )}
          </div>
        )}
        {error && (
          <p style={{ fontSize: '12px', color: 'var(--destructive)', margin: '6px 0 0' }}>
            {(error as { shortMessage?: string }).shortMessage ?? error.message}
          </p>
        )}
      </div>
    </div>
  )
}
