import React from 'react'
import { addMonthKey, formatMonthKey } from '@shared/dates'

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }): React.JSX.Element {
  const styles: Record<ButtonVariant, string> = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:hover:bg-indigo-600',
    secondary:
      'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    ghost: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'
  }
  return (
    <button
      className={`inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
      {...props}
    />
  )
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({
  title,
  onClose,
  children,
  wide
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}): React.JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 py-10"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
      role="dialog"
      aria-modal
    >
      <div className={`card w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} p-6`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function Card({
  title,
  children,
  className = '',
  actions
}: {
  title?: string
  children: React.ReactNode
  className?: string
  actions?: React.ReactNode
}): React.JSX.Element {
  return (
    <section className={`card p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export function ProgressBar({
  value,
  max,
  color,
  over
}: {
  value: number
  max: number
  color?: string
  over?: boolean
}): React.JSX.Element {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : value > 0 ? 100 : 0
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, backgroundColor: over ? '#d03b3b' : (color ?? '#6366f1') }}
      />
    </div>
  )
}

export function Badge({
  children,
  tone = 'neutral'
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'good' | 'bad' | 'warn'
}): React.JSX.Element {
  const tones = {
    neutral: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
    good: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
    bad: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    warn: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function PersonDot({ color, name }: { color: string; name: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {name}
    </span>
  )
}

export function EmptyState({
  icon,
  title,
  message,
  action
}: {
  icon: string
  title: string
  message: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      <div className="text-4xl">{icon}</div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">{message}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function MonthNav({
  month,
  onChange
}: {
  month: string
  onChange: (m: string) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" aria-label="Previous month" onClick={() => onChange(addMonthKey(month, -1))}>
        ‹
      </Button>
      <span className="w-28 text-center text-sm font-semibold tabular-nums">{formatMonthKey(month)}</span>
      <Button variant="ghost" aria-label="Next month" onClick={() => onChange(addMonthKey(month, 1))}>
        ›
      </Button>
    </div>
  )
}

export function Spinner(): React.JSX.Element {
  return (
    <div className="flex justify-center py-16">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
    </div>
  )
}

/** Money-colored text: red for negative, green for positive (when colored). */
export function Money({
  cents,
  fmt,
  colored,
  sign,
  className = ''
}: {
  cents: number
  fmt: (c: number, o?: { sign?: boolean }) => string
  colored?: boolean
  sign?: boolean
  className?: string
}): React.JSX.Element {
  const color = !colored
    ? ''
    : cents < 0
      ? 'text-red-600 dark:text-red-400'
      : cents > 0
        ? 'text-emerald-700 dark:text-emerald-400'
        : 'text-slate-500'
  return <span className={`tabular-nums ${color} ${className}`}>{fmt(cents, { sign })}</span>
}
