import clsx from 'clsx'
import type { JSX, ReactNode } from 'react'
import styles from './SummaryList.module.css'

export interface SummaryRow {
  label: ReactNode
  value: ReactNode
  /** Marks the line the eye should land on, e.g. the bill total. */
  emphasis?: boolean
  tone?: 'good' | 'bad'
}

/**
 * A label/amount stack — the totals block on a bill, purchase or report.
 *
 * One component so the subtotal / discount / tax / total sequence looks
 * identical everywhere the owner sees it.
 */
export function SummaryList({ rows }: { rows: SummaryRow[] }): JSX.Element {
  return (
    <div className={styles.list}>
      {rows.map((row, index) => (
        <div key={index} className={clsx(styles.row, row.emphasis && styles.emphasis)}>
          <span className={styles.label}>{row.label}</span>
          <span className={clsx(styles.value, row.tone && styles[row.tone])}>{row.value}</span>
        </div>
      ))}
    </div>
  )
}
