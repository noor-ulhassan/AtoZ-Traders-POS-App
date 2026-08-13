import clsx from 'clsx'
import type { JSX, ReactNode } from 'react'

const TONES = {
  good: 'text-good',
  bad: 'text-bad'
} as const

export interface SummaryRow {
  label: ReactNode
  value: ReactNode
  /** Marks the line the eye should land on, e.g. the bill total. */
  emphasis?: boolean
  tone?: keyof typeof TONES
}

/**
 * A label/amount stack — the totals block on a bill, purchase or report.
 *
 * One component so the subtotal / discount / tax / total sequence looks
 * identical everywhere the owner sees it.
 */
export function SummaryList({ rows }: { rows: SummaryRow[] }): JSX.Element {
  return (
    <div className="mt-4 flex flex-col">
      {rows.map((row, index) => (
        <div
          key={index}
          className={clsx(
            'flex items-baseline justify-between gap-4 text-sm',
            // A rule between lines, but never above the first one.
            'not-first:border-t not-first:border-line',
            row.emphasis ? 'border-t border-line-strong py-3' : 'py-2'
          )}
        >
          <span className={row.emphasis ? 'font-semibold text-ink' : 'text-ink-muted'}>
            {row.label}
          </span>
          <span
            className={clsx(
              'tabular-nums',
              row.emphasis ? 'text-md font-semibold' : 'font-medium',
              row.tone && TONES[row.tone]
            )}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  )
}
