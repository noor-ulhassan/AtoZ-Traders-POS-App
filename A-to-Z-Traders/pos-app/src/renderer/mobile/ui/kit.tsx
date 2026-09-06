import clsx from 'clsx'
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react'

/**
 * The phone's component set.
 *
 * Small on purpose. The desktop's own components assume a mouse, a wide
 * viewport and a keyboard flow that does not exist here, so reusing them would
 * mean bending each one at every call site — but the tokens underneath are the
 * same file, so the two halves of the app still read as one product.
 *
 * Two rules run through everything here: nothing tappable is under 48px, and
 * no figure appears without saying what it is. A number on a phone screen has
 * no column header above it to explain itself.
 */

/* --------------------------------------------------------------- surfaces */

export function Screen({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="min-h-full pb-[calc(var(--tabbar-height)+var(--safe-bottom)+16px)]">
      {children}
    </div>
  )
}

interface TopBarProps {
  title: string
  subtitle?: string
  /** A back arrow, when this screen was pushed onto another. */
  onBack?: () => void
  action?: ReactNode
}

export function TopBar({ title, subtitle, onBack, action }: TopBarProps): JSX.Element {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/95 pt-[var(--safe-top)] backdrop-blur">
      <div className="flex items-center gap-1 px-2 py-2">
        {onBack && (
          <button
            type="button"
            aria-label="Back"
            onClick={onBack}
            className="flex size-12 shrink-0 items-center justify-center rounded-full text-ink-muted active:bg-surface-active"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <div className={clsx('min-w-0 flex-1', !onBack && 'pl-2')}>
          <h1 className="truncate text-md font-semibold">{title}</h1>
          {subtitle && <p className="truncate text-caption text-ink-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
    </header>
  )
}

export function Section({
  title,
  action,
  children
}: {
  title?: string
  action?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <section className="px-4 pt-5">
      {(title || action) && (
        <div className="mb-2 flex items-baseline justify-between gap-3">
          {title && (
            <h2 className="text-caption font-semibold tracking-wide text-ink-subtle uppercase">
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Card({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return (
    <div
      className={clsx(
        'overflow-hidden rounded-xl border border-line bg-surface-raised shadow-card',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

/* ---------------------------------------------------------------- buttons */

type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger'

interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: ButtonVariant
  /** Fills the row it sits in — the default shape for a phone. */
  block?: boolean
  loading?: boolean
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white active:bg-accent-strong disabled:bg-accent/50',
  default: 'border border-line-strong bg-surface-raised text-ink active:bg-surface-active',
  ghost: 'text-accent active:bg-accent-weak',
  danger: 'bg-bad text-white active:opacity-90'
}

export function Button({
  variant = 'default',
  block,
  loading,
  disabled,
  className,
  children,
  ...props
}: ButtonProps): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 text-base font-medium',
        'transition-colors disabled:opacity-60',
        block && 'w-full',
        VARIANTS[variant],
        className
      )}
      {...props}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  )
}

export function Spinner({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className={clsx('animate-spin', className ?? 'size-6')}
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/* ----------------------------------------------------------------- fields */

const CONTROL =
  'w-full rounded-xl border border-line-strong bg-paper px-3 py-3 text-base text-ink ' +
  'placeholder:text-ink-subtle focus:border-accent focus:outline-none disabled:opacity-60'

export function Field({
  label,
  hint,
  error,
  children
}: {
  label?: string
  hint?: string
  error?: string
  children: ReactNode
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1.5">
      {label && <span className="text-sm font-medium text-ink-muted">{label}</span>}
      {children}
      {error ? (
        <span className="text-caption text-bad">{error}</span>
      ) : (
        hint && <span className="text-caption text-ink-subtle">{hint}</span>
      )}
    </label>
  )
}

export function Input({ className, ...props }: ComponentPropsWithoutRef<'input'>): JSX.Element {
  return <input className={clsx(CONTROL, className)} autoComplete="off" {...props} />
}

/**
 * A money or quantity entry.
 *
 * `inputMode="decimal"` rather than `type="number"`: it raises the numeric
 * keypad on both phones without the scroll-wheel and validation quirks that
 * make a real number input painful to type a price into. The value is held as
 * a string so a half-typed "12." survives the next render — the same reason
 * the desktop's own `NumberInput` keeps a draft.
 */
export function AmountInput({
  className,
  ...props
}: ComponentPropsWithoutRef<'input'>): JSX.Element {
  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={clsx(CONTROL, 'text-right tabular-nums', className)}
      {...props}
    />
  )
}

export function Select({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<'select'>): JSX.Element {
  return (
    <select className={clsx(CONTROL, 'appearance-none pr-8', className)} {...props}>
      {children}
    </select>
  )
}

export function SearchInput({
  className,
  ...props
}: ComponentPropsWithoutRef<'input'>): JSX.Element {
  return (
    <div className="relative">
      <svg
        viewBox="0 0 24 24"
        className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-ink-subtle"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        className={clsx(CONTROL, 'pl-10', className)}
        {...props}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ lists */

export function Rows({ children }: { children: ReactNode }): JSX.Element {
  return <div className="divide-y divide-line">{children}</div>
}

interface RowProps {
  title: ReactNode
  subtitle?: ReactNode
  /** The figure on the right — always with a word beneath saying what it is. */
  value?: ReactNode
  valueNote?: ReactNode
  onClick?: () => void
}

export function Row({ title, subtitle, value, valueNote, onClick }: RowProps): JSX.Element {
  const content = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="truncate text-base font-medium text-ink">{title}</span>
        {subtitle && <span className="truncate text-caption text-ink-muted">{subtitle}</span>}
      </span>
      {(value !== undefined || valueNote !== undefined) && (
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
          {value !== undefined && <span className="text-base tabular-nums">{value}</span>}
          {valueNote !== undefined && (
            <span className="text-caption text-ink-muted">{valueNote}</span>
          )}
        </span>
      )}
    </>
  )

  if (!onClick) {
    return <div className="flex items-center gap-3 px-4 py-3">{content}</div>
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-active"
    >
      {content}
    </button>
  )
}

/* ------------------------------------------------------------------ tiles */

export function Tile({
  label,
  value,
  tone = 'neutral'
}: {
  label: string
  value: string
  tone?: 'neutral' | 'good' | 'bad' | 'accent'
}): JSX.Element {
  const colour =
    tone === 'good'
      ? 'text-good'
      : tone === 'bad'
        ? 'text-bad'
        : tone === 'accent'
          ? 'text-accent'
          : 'text-ink'

  return (
    <div className="rounded-xl border border-line bg-surface-raised p-3 shadow-card">
      <div className="text-caption text-ink-muted">{label}</div>
      {/* Long figures shrink rather than being clipped — the same problem the
          desktop's StatTile solves, in the form a narrow phone column needs. */}
      <div
        className={clsx(
          'mt-1 font-semibold tabular-nums',
          colour,
          value.length > 13 ? 'text-base' : value.length > 10 ? 'text-md' : 'text-lg'
        )}
      >
        {value}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- feedback */

export function Note({
  tone = 'info',
  title,
  children
}: {
  tone?: 'info' | 'good' | 'warn' | 'bad'
  title?: string
  children: ReactNode
}): JSX.Element {
  const tones = {
    info: 'border-accent-border bg-accent-weak text-accent-ink',
    good: 'border-good-border bg-good-weak text-good',
    warn: 'border-warn-border bg-warn-weak text-warn',
    bad: 'border-bad-border bg-bad-weak text-bad'
  } as const

  return (
    <div className={clsx('rounded-xl border px-4 py-3 text-sm', tones[tone])}>
      {title && <div className="font-semibold">{title}</div>}
      <div className={clsx(title && 'mt-1')}>{children}</div>
    </div>
  )
}

export function Badge({
  tone = 'neutral',
  children
}: {
  tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'accent'
  children: ReactNode
}): JSX.Element {
  const tones = {
    neutral: 'border-line bg-surface-sunken text-ink-muted',
    good: 'border-good-border bg-good-weak text-good',
    bad: 'border-bad-border bg-bad-weak text-bad',
    warn: 'border-warn-border bg-warn-weak text-warn',
    accent: 'border-accent-border bg-accent-weak text-accent-ink'
  } as const

  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-micro font-medium',
        tones[tone]
      )}
    >
      {children}
    </span>
  )
}

export function Empty({ title, hint }: { title: string; hint?: string }): JSX.Element {
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-base font-medium text-ink">{title}</p>
      {hint && <p className="mt-1 text-sm text-ink-muted">{hint}</p>}
    </div>
  )
}

export function Loading(): JSX.Element {
  return (
    <div className="flex justify-center py-12 text-ink-subtle">
      <Spinner />
    </div>
  )
}

/**
 * The banner that says a figure is not current.
 *
 * It is deliberately unmissable rather than tasteful. The single worst thing
 * this app could do is show yesterday's balance as though it were today's.
 */
export function StaleBanner({ label }: { label: string | null }): JSX.Element {
  return (
    <div className="border-b border-warn-border bg-warn-weak px-4 py-2 text-caption text-warn">
      Showing what this phone last saw{label ? `, read ${label}` : ''}. Not live — the shop computer
      cannot be reached.
    </div>
  )
}

/* ------------------------------------------------------------------ sheet */

/**
 * A form that slides up from the bottom.
 *
 * Everything the phone writes happens in one of these rather than on a pushed
 * screen: it keeps the list underneath visible, and it puts the fields and the
 * save button in the bottom half of the screen, where a thumb already is.
 */
export function Sheet({
  open,
  title,
  onClose,
  children
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}): JSX.Element | null {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 min-h-0 bg-black/40"
      />
      <div className="relative max-h-[88vh] overflow-y-auto rounded-t-2xl border-t border-line bg-paper pb-[var(--safe-bottom)] shadow-popover">
        <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-line bg-paper px-4 py-3">
          <h2 className="truncate text-md font-semibold">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-muted active:bg-surface-active"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
      </div>
    </div>
  )
}
