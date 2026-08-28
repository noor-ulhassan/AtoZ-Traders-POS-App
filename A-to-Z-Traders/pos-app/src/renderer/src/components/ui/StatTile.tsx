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
 * Sizes the number to the space a tile actually has.
 *
 * A shop's headline figures are not all the same length: takings for a quiet
 * Tuesday and an all-time cash position can differ by four digits. At one fixed
 * size the long ones were truncated — "PKR -8,342,689..." — which turns the most
 * important number on the screen into a number the owner cannot read. Stepping
 * the size down keeps the whole figure visible, and a tile that steps down is
 * itself a signal that the number got big.
 */
function sizeFor(value: ReactNode): string {
  const length = typeof value === 'string' || typeof value === 'number' ? String(value).length : 0

  /*
   * The thresholds are measured, not guessed. A tile in the narrowest grid
   * leaves about 154px for the figure once the currency code and the gap are
   * taken out, and this scale's tabular digits run near 0.475em wide:
   *
   *   text-xl  29px -> ~13.8px a character -> ~11 fit
   *   text-lg  21px -> ~10.0px a character -> ~15 fit
   *   text-md  17px ->  ~8.1px a character -> ~19 fit
   *
   * Deliberately conservative: they assume the narrowest tile with a currency
   * code beside it, so a figure never truncates on the small screen the shop
   * actually runs.
   */
  if (length > 15) return 'text-md'
  if (length > 11) return 'text-lg'
  return 'text-xl'
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
        {unit && <span className="shrink-0 text-caption font-medium text-ink-subtle">{unit}</span>}
        <span
          // `title` is the last resort: if a figure is somehow still too wide
          // for its tile, it stays readable on hover rather than being lost.
          title={typeof value === 'string' || typeof value === 'number' ? String(value) : undefined}
          className={clsx(
            'truncate font-display font-semibold tracking-[-0.01em] tabular-nums',
            // Not tighter than this: `truncate` clips overflow, and at 1.1 the
            // line box was shorter than the glyphs, shaving the tails off the
            // commas in every figure on the dashboard.
            'leading-[1.25]',
            sizeFor(value),
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
