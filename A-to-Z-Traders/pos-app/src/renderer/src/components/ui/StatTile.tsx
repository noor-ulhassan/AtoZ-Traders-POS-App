import clsx from 'clsx'
import type { JSX, ReactNode } from 'react'

/**
 * The row of tiles that opens most screens. Every one of them was its own
 * near-identical `.tiles` rule in a feature stylesheet; the only thing that
 * ever differed was how narrow a tile may get before the row wraps.
 */
const GRID_MIN = {
  190: 'grid-cols-[repeat(auto-fit,minmax(190px,1fr))]',
  200: 'grid-cols-[repeat(auto-fit,minmax(200px,1fr))]',
  210: 'grid-cols-[repeat(auto-fit,minmax(210px,1fr))]'
} as const

export function StatGrid({
  min = 210,
  children
}: {
  min?: keyof typeof GRID_MIN
  children: ReactNode
}): JSX.Element {
  return <div className={clsx('grid gap-4', GRID_MIN[min])}>{children}</div>
}

const VALUE_TONES = {
  default: '',
  good: 'text-good',
  bad: 'text-bad'
} as const

interface StatTileProps {
  label: string
  value: ReactNode
  /** Small unit shown before the value, e.g. a currency code. */
  unit?: string
  footnote?: ReactNode
  tone?: keyof typeof VALUE_TONES
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
    <div
      className={clsx(
        'flex min-w-0 flex-col gap-2 rounded-lg border px-5 py-4',
        // A tile that carries a severity, e.g. items below reorder level.
        attention ? 'border-warn-border bg-warn-weak' : 'border-line bg-paper'
      )}
    >
      <span
        className={clsx(
          'text-micro font-semibold tracking-[0.07em] uppercase',
          attention ? 'text-warn' : 'text-ink-subtle'
        )}
      >
        {label}
      </span>
      <span className="flex min-w-0 items-baseline gap-2">
        {unit && <span className="text-caption font-medium text-ink-subtle">{unit}</span>}
        <span
          className={clsx(
            'truncate font-display text-xl font-semibold tracking-[-0.01em] tabular-nums',
            'leading-[1.1]',
            VALUE_TONES[tone]
          )}
        >
          {value}
        </span>
      </span>
      {footnote && <span className="text-caption text-ink-muted">{footnote}</span>}
    </div>
  )
}
