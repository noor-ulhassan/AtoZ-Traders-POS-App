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
