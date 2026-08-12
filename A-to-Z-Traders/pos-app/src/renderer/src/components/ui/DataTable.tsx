import clsx from 'clsx'
import type { JSX, ReactNode } from 'react'
import { EmptyState } from './Feedback'
import styles from './DataTable.module.css'

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
      <div className={styles.empty}>
        <EmptyState title={empty.title} description={empty.description} action={empty.action} />
      </div>
    )
  }

  return (
    <div className={clsx(styles.scroller, className)}>
      <table className={clsx(styles.table, compact && styles.compact)}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                style={column.width ? { width: column.width } : undefined}
                className={clsx(column.numeric && styles.numeric, column.center && styles.center)}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading && rows.length === 0 ? (
            <tr className={styles.loadingRow}>
              <td colSpan={columns.length}>Loading…</td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr
                key={rowKey(row, index)}
                className={clsx(
                  onRowClick && styles.clickable,
                  isRowSelected?.(row) && styles.selected
                )}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={clsx(
                      column.numeric && styles.numeric,
                      column.center && styles.center
                    )}
                  >
                    {column.render(row, index)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
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
    <span className={styles.primaryCell}>
      <strong>{title}</strong>
      {subtitle && <span>{subtitle}</span>}
    </span>
  )
}

export function RowActions({ children }: { children: ReactNode }): JSX.Element {
  return <div className={styles.actionsCell}>{children}</div>
}

export function MutedCell({ children }: { children: ReactNode }): JSX.Element {
  return <span className={styles.muted}>{children}</span>
}
