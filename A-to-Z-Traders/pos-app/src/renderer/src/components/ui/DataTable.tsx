import clsx from 'clsx'
import type { JSX, ReactNode } from 'react'
import { EmptyState } from './Feedback'

/**
 * Cell styling lives on the cells rather than on descendant selectors from the
 * table, so a caller who renders their own `<tr>` into `footer` gets the same
 * treatment by reaching for the same constant.
 */
const HEAD_CELL =
  'sticky top-0 z-1 border-b border-line bg-surface-sunken text-left text-caption font-semibold whitespace-nowrap text-ink-muted'

const BODY_CELL = 'border-b border-line align-middle text-ink'

/** Totals row pinned to the bottom of a table. */
export const FOOTER_ROW =
  '[&_td]:sticky [&_td]:bottom-0 [&_td]:h-[var(--row-height)] [&_td]:border-t [&_td]:border-line-strong [&_td]:bg-surface-sunken [&_td]:px-4 [&_td]:font-semibold'

export interface Column<Row> {
  key: string
  header: ReactNode
  /** Right-aligns and applies tabular figures. Use for every money column. */
  numeric?: boolean
  center?: boolean
  width?: string
  render: (row: Row, index: number) => ReactNode
}

interface DataTableProps<Row> {
  columns: Column<Row>[]
  rows: Row[]
  rowKey: (row: Row, index: number) => string | number
  isLoading?: boolean
  onRowClick?: (row: Row) => void
  isRowSelected?: (row: Row) => boolean
  /** Rendered in place of the table body when there are no rows. */
  empty?: { title: string; description?: string; action?: ReactNode }
  footer?: ReactNode
  compact?: boolean
  className?: string
}

/**
 * The table used everywhere a list of records appears.
 *
 * One component means column alignment, header treatment, row height and the
 * empty state are decided once. Screens declare columns; they never lay out a
 * `<table>` by hand.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  isLoading = false,
  onRowClick,
  isRowSelected,
  empty,
  footer,
  compact = false,
  className
}: DataTableProps<Row>): JSX.Element {
  if (!isLoading && rows.length === 0 && empty) {
    return (
      <div className="px-6 py-12">
        <EmptyState title={empty.title} description={empty.description} action={empty.action} />
      </div>
    )
  }

  // Numeric columns are right-aligned and share one digit width so the decimal
  // points form a straight edge down the column.
  const align = (column: Column<Row>): string =>
    clsx(column.numeric && 'text-right tabular-nums', column.center && 'text-center')

  const density = compact ? 'h-8 px-3' : 'px-4'

  return (
    <div className={clsx('w-full overflow-auto', className)}>
      <table className="w-full text-sm">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                style={column.width ? { width: column.width } : undefined}
                className={clsx(HEAD_CELL, density, !compact && 'h-[34px]', align(column))}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading && rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="h-24 text-center text-ink-subtle">
                Loading…
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr
                key={rowKey(row, index)}
                className={clsx(
                  'last:[&>td]:border-b-0',
                  onRowClick && 'cursor-pointer hover:[&>td]:bg-surface-hover',
                  isRowSelected?.(row) && '[&>td]:bg-accent-weak'
                )}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={clsx(
                      BODY_CELL,
                      density,
                      !compact && 'h-[var(--row-height)]',
                      align(column)
                    )}
                  >
                    {column.render(row, index)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {footer && <tfoot className={FOOTER_ROW}>{footer}</tfoot>}
      </table>
    </div>
  )
}

/** A name with a quieter second line — the standard first column. */
export function PrimaryCell({
  title,
  subtitle
}: {
  title: ReactNode
  subtitle?: ReactNode
}): JSX.Element {
  return (
    <span className="flex flex-col gap-px py-1 leading-[1.35]">
      <strong className="font-medium">{title}</strong>
      {subtitle && <span className="text-caption text-ink-subtle">{subtitle}</span>}
    </span>
  )
}

export function RowActions({ children }: { children: ReactNode }): JSX.Element {
  return <div className="flex justify-end gap-1">{children}</div>
}

/** Secondary information inside a cell: a SKU under a product name, and so on. */
export function MutedCell({ children }: { children: ReactNode }): JSX.Element {
  return <span className="text-ink-muted">{children}</span>
}
