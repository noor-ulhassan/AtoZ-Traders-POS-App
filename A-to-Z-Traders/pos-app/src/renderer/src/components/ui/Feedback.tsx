import clsx from 'clsx'
import type { JSX, ReactNode } from 'react'
import { Icon } from '../icons/Icon'

export type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'accent'

/* ---- Badge: state encoded as shape and colour, not colour alone */

const BADGE_TONES: Record<Tone, string> = {
  neutral: 'bg-surface-sunken border-line text-ink-muted',
  good: 'bg-good-weak border-good-border text-good',
  bad: 'bg-bad-weak border-bad-border text-bad',
  warn: 'bg-warn-weak border-warn-border text-warn',
  accent: 'bg-accent-weak border-accent-border text-accent-ink'
}

export function Badge({
  tone = 'neutral',
  children
}: {
  tone?: Tone
  children: ReactNode
}): JSX.Element {
  return (
    <span
      className={clsx(
        'inline-flex h-5 items-center gap-[5px] rounded-sm border border-transparent px-2 text-micro font-semibold tracking-[0.02em] whitespace-nowrap',
        BADGE_TONES[tone]
      )}
    >
      {children}
    </span>
  )
}

/* ---- Callout: an inline message block inside a form or panel */

type CalloutTone = 'info' | 'warn' | 'bad'

const CALLOUT_TONES: Record<CalloutTone, string> = {
  info: 'bg-info-weak border-accent-border',
  warn: 'bg-warn-weak border-warn-border',
  bad: 'bg-bad-weak border-bad-border'
}

/** The icon carries the tone; the body text stays at full reading contrast. */
const CALLOUT_ICON: Record<CalloutTone, string> = {
  info: 'text-accent',
  warn: 'text-warn',
  bad: 'text-bad'
}

interface CalloutProps {
  tone?: CalloutTone
  title?: string
  children: ReactNode
}

/** An explanation attached to the thing it explains, not a floating toast. */
export function Callout({ tone = 'info', title, children }: CalloutProps): JSX.Element {
  return (
    <div
      className={clsx(
        'flex gap-3 rounded-md border px-4 py-3 text-sm leading-normal text-ink',
        CALLOUT_TONES[tone]
      )}
      role={tone === 'bad' ? 'alert' : undefined}
    >
      <Icon
        name={tone === 'info' ? 'info' : 'warning'}
        size={16}
        className={clsx('mt-0.5 shrink-0', CALLOUT_ICON[tone])}
      />
      <div className="flex min-w-0 flex-col gap-1">
        {title && <span className="font-semibold">{title}</span>}
        <span>{children}</span>
      </div>
    </div>
  )
}

/* ---- EmptyState */

interface EmptyStateProps {
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 text-center text-ink-muted">
      <span className="text-base font-semibold text-ink">{title}</span>
      {description && <span className="max-w-[44ch] text-sm">{description}</span>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

/* ---- inline value tones, for balances in tables */

const VALUE_TONES = {
  good: 'font-medium text-good',
  bad: 'font-medium text-bad',
  neutral: 'text-ink-subtle'
} as const

/** A money figure coloured by what it means, used inside table cells. */
export function ToneValue({
  tone,
  children
}: {
  tone: keyof typeof VALUE_TONES
  children: ReactNode
}): JSX.Element {
  return <span className={VALUE_TONES[tone]}>{children}</span>
}
