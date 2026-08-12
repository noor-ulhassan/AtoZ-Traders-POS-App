/**
 * CSV writing tuned for the one program these files actually get opened in:
 * Excel.
 *
 * - A UTF-8 BOM is prepended so Excel stops mangling non-ASCII names.
 * - CRLF line endings, per RFC 4180 and Excel's expectations.
 * - Values that begin with `=`, `+`, `-` or `@` are prefixed with a single
 *   quote. Without that, a product named "-Special" is interpreted as a
 *   formula — the CSV injection problem, and also just a broken-looking file.
 */

export interface CsvColumn<Row> {
  header: string
  value: (row: Row) => string | number | null | undefined
}

const BOM = '﻿'
const NEWLINE = '\r\n'
const FORMULA_START = /^[=+\-@\t\r]/

function escapeCell(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return ''

  let value = String(raw)
  if (FORMULA_START.test(value)) value = `'${value}`

  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function toCsv<Row>(columns: CsvColumn<Row>[], rows: Row[]): string {
  const header = columns.map((column) => escapeCell(column.header)).join(',')
  const body = rows.map((row) => columns.map((column) => escapeCell(column.value(row))).join(','))
  return BOM + [header, ...body].join(NEWLINE) + NEWLINE
}

/** Formats money for a spreadsheet: a plain number, never a currency string. */
export const csvMoney = (value: number | null | undefined): string =>
  value === null || value === undefined ? '' : value.toFixed(2)

export const csvQty = (value: number | null | undefined): string =>
  value === null || value === undefined ? '' : String(Number(value.toFixed(3)))

/** `sales_2026-01-01_2026-01-31.csv` — sortable and self-describing. */
export function suggestFileName(report: string, from?: string, to?: string): string {
  const parts = [report.replace(/[^a-z0-9-]/gi, '-')]
  if (from) parts.push(from)
  if (to && to !== from) parts.push(to)
  return `${parts.join('_')}.csv`
}
