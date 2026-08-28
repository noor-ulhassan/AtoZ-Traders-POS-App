/**
 * Primitives shared by every layer of the application.
 *
 * Dates are always ISO calendar dates (`YYYY-MM-DD`). Timestamps are
 * `YYYY-MM-DD HH:MM:SS` as produced by SQLite's `datetime('now')`.
 * Money is always a number rounded to 2 decimal places (PKR).
 */

export type Id = number

/** `YYYY-MM-DD` */
export type IsoDate = string

/** `YYYY-MM-DD HH:MM:SS` */
export type IsoTimestamp = string

export interface DateRange {
  /** inclusive */
  from: IsoDate
  /** inclusive */
  to: IsoDate
}

export type ErrorCode =
  'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'BUSINESS_RULE' | 'INTERNAL' | 'CANCELLED' | 'AUTH'

export interface IpcError {
  code: ErrorCode
  message: string
  /** Field-level issues, keyed by dotted path. Present for VALIDATION errors. */
  fields?: Record<string, string>
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError }

export interface Page<T> {
  rows: T[]
  total: number
}

/**
 * A page of rows plus aggregates computed over the WHOLE filtered set.
 *
 * List screens show summary tiles above their table. Those tiles must describe
 * everything the filters match, not the slice currently on screen — so the
 * numbers are computed in SQL beside the row query, sharing its WHERE clause,
 * and never by reducing over `rows`.
 */
export interface PageWithTotals<T, Totals> extends Page<T> {
  totals: Totals
}
