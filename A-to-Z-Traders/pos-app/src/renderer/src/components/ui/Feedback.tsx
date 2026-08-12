import clsx from 'clsx'
import type { JSX, ReactNode } from 'react'
import { Icon } from '../icons/Icon'
import styles from './Feedback.module.css'

export type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'accent'

export function Badge({
  tone = 'neutral',
  children
}: {
  tone?: Tone
  children: ReactNode
}): JSX.Element {
  return <span className={clsx(styles.badge, styles[tone])}>{children}</span>
}

interface CalloutProps {
  tone?: 'info' | 'warn' | 'bad'
  title?: string
  children: ReactNode
}

/** An explanation attached to the thing it explains, not a floating toast. */
export function Callout({ tone = 'info', title, children }: CalloutProps): JSX.Element {
  const toneClass = {
    info: styles.calloutInfo,
    warn: styles.calloutWarn,
    bad: styles.calloutBad
  }[tone]

  const iconName = tone === 'info' ? 'info' : 'warning'
  const iconColor = { info: 'var(--accent)', warn: 'var(--warn)', bad: 'var(--bad)' }[tone]

  return (
    <div className={clsx(styles.callout, toneClass)} role={tone === 'bad' ? 'alert' : undefined}>
      <Icon name={iconName} size={16} className={styles.calloutIcon} style={{ color: iconColor }} />
      <div className={styles.calloutBody}>
        {title && <span className={styles.calloutTitle}>{title}</span>}
        <span>{children}</span>
      </div>
    </div>
  )
}

interface EmptyStateProps {
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps): JSX.Element {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyTitle}>{title}</span>
      {description && <span className={styles.emptyDescription}>{description}</span>}
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  )
}

/** A money figure coloured by what it means, used inside table cells. */
export function ToneValue({
  tone,
  children
}: {
  tone: 'good' | 'bad' | 'neutral'
  children: ReactNode
}): JSX.Element {
  const toneClass = {
    good: styles.toneGood,
    bad: styles.toneBad,
    neutral: styles.toneNeutral
  }[tone]

  return <span className={toneClass}>{children}</span>
}
