import clsx from 'clsx'
import type { JSX, ReactNode } from 'react'
import styles from './StatTile.module.css'

interface StatTileProps {
  label: string
  value: ReactNode
  /** Small unit shown before the value, e.g. a currency code. */
  unit?: string
  footnote?: ReactNode
  tone?: 'default' | 'good' | 'bad'
  /** Marks the tile as something the owner should act on. */
  attention?: boolean
}

/**
 * One number, said once.
 *
 * The label is small and quiet, the number is the loudest thing in the tile,
 * and the currency code sits beside it rather than inside it so the digits
 * stay on the tabular grid with the tile next to them.
 */
export function StatTile({
  label,
  value,
  unit,
  footnote,
  tone = 'default',
  attention = false
}: StatTileProps): JSX.Element {
  return (
    <div className={clsx(styles.tile, attention && styles.attention)}>
      <span className={styles.label}>{label}</span>
      <span className={styles.valueRow}>
        {unit && <span className={styles.currency}>{unit}</span>}
        <span className={clsx(styles.value, tone !== 'default' && styles[tone])}>{value}</span>
      </span>
      {footnote && <span className={styles.footnote}>{footnote}</span>}
    </div>
  )
}
