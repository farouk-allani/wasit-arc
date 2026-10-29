/**
 * Wasit shared UI primitives.
 *
 * Field, Input, Card, Button, Badge, PageHeader — used across all app pages.
 * Styles live in index.css under the "SHARED FORM + UI PRIMITIVES" section.
 */
import { type ReactNode, useId } from 'react'
import { Loader2 } from 'lucide-react'

// ── Field ──────────────────────────────────────────────────────────────────────

interface FieldProps {
  label: string
  hint?: string
  error?: string
  children: (ids: { inputId: string; hintId?: string; errorId?: string }) => ReactNode
}

export function Field({ label, hint, error, children }: FieldProps) {
  const base = useId()
  const inputId = `${base}-input`
  const hintId  = hint  ? `${base}-hint`  : undefined
  const errorId = error ? `${base}-error` : undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <label
        htmlFor={inputId}
        style={{ fontSize: '12px', fontWeight: 600, color: 'var(--secondary-foreground)', letterSpacing: '0.01em' }}
      >
        {label}
      </label>
      {children({ inputId, hintId, errorId })}
      {hint && !error && (
        <p id={hintId} style={{ margin: 0, fontSize: '12px', color: 'var(--muted-foreground)', lineHeight: 1.5 }}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" style={{ margin: 0, fontSize: '12px', color: 'var(--destructive)', lineHeight: 1.5 }}>
          {error}
        </p>
      )}
    </div>
  )
}

// ── Input ──────────────────────────────────────────────────────────────────────

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id?: string
  mono?: boolean
  hintId?: string
  errorId?: string
  hasError?: boolean
}

export function Input({ mono, hintId, errorId, hasError, className, style, ...rest }: InputProps) {
  const classes = ['ws-input', mono ? 'ws-input--mono' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <input
      {...rest}
      className={classes}
      aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
      aria-invalid={hasError ? 'true' : undefined}
      style={style}
    />
  )
}

// ── Card ───────────────────────────────────────────────────────────────────────

interface CardProps {
  title?: string
  description?: string
  children: ReactNode
  style?: React.CSSProperties
  bodyStyle?: React.CSSProperties
}

export function Card({ title, description, children, style, bodyStyle }: CardProps) {
  return (
    <div className="ws-card" style={style}>
      {(title || description) && (
        <div className="ws-card-header">
          {title && <p className="ws-card-title">{title}</p>}
          {description && <p className="ws-card-desc">{description}</p>}
        </div>
      )}
      <div className="ws-card-body" style={bodyStyle}>
        {children}
      </div>
    </div>
  )
}

// ── Button ─────────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  pending?: boolean
  pendingLabel?: string
}

export function Button({
  variant = 'primary',
  pending = false,
  pendingLabel,
  disabled,
  children,
  className,
  style,
  ...rest
}: ButtonProps) {
  const base = `ws-btn ws-btn--${variant}`
  const cls  = [base, className ?? ''].filter(Boolean).join(' ')
  const isDisabled = disabled || pending
  return (
    <button
      {...rest}
      className={cls}
      disabled={isDisabled}
      aria-disabled={isDisabled}
      style={style}
    >
      {pending ? (
        <>
          <Loader2 size={14} className="spin" aria-hidden />
          {pendingLabel ?? children}
        </>
      ) : children}
    </button>
  )
}

// ── Badge ──────────────────────────────────────────────────────────────────────

type BadgeVariant = 'neutral' | 'success' | 'warning' | 'destructive' | 'primary'

interface BadgeProps {
  variant?: BadgeVariant
  children: ReactNode
  dot?: boolean
}

const BADGE_DOT_COLOR: Record<BadgeVariant, string> = {
  neutral:     'var(--secondary-foreground)',
  success:     'var(--success)',
  warning:     'var(--warning)',
  destructive: 'var(--destructive)',
  primary:     'var(--primary)',
}

export function Badge({ variant = 'neutral', children, dot = true }: BadgeProps) {
  return (
    <span className={`ws-badge ws-badge--${variant}`}>
      {dot && (
        <span
          className="ws-badge-dot"
          style={{ background: BADGE_DOT_COLOR[variant] }}
          aria-hidden
        />
      )}
      {children}
    </span>
  )
}

// ── PageHeader ─────────────────────────────────────────────────────────────────

interface PageHeaderProps {
  eyebrow: string
  title: string
  description?: string
}

export function PageHeader({ eyebrow, title, description }: PageHeaderProps) {
  return (
    <header className="ws-page-header">
      <p className="ws-page-eyebrow">{eyebrow}</p>
      <h1 className="ws-page-title">{title}</h1>
      {description && <p className="ws-page-desc">{description}</p>}
    </header>
  )
}
