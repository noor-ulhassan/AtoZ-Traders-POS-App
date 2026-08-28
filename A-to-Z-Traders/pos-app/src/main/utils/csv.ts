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
  /**
   * When set, the report grows a TOTAL row and this column is summed across all
   * rows. The getter returns the raw number to add; the sum is formatted with
   * `sumFormat` (money by default).
   */
  sum?: (row: Row) => number
  /** Formats this column's total. Defaults to money (2 dp). */
  sumFormat?: (value: number) => string
}

/** A labelled fact printed in a report's heading block (Period, Currency, …). */
export interface ReportField {
  label: string
  value: string | number | null | undefined
}

export interface ReportHeading {
  /** The shop's own name — the masthead of the report. */
  businessName: string
  /** What this report is, e.g. "Sales Report". */
  title: string
  /** The labelled facts under the title (period, currency, generated at, …). */
  fields: ReportField[]
}

const BOM = '﻿'
const NEWLINE = '\r\n'
const FORMULA_START = /^[=+\-@\t\r]/
// A plain (optionally negative) decimal number is never a formula-injection
// vector, so it must not be quote-prefixed — otherwise "-1234.00" lands in
// Excel as left-aligned text that won't sum. Anything with a non-numeric
// character (=, +, @, a cell reference, a function call) still gets escaped.
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/

function escapeCell(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return ''

  let value = String(raw)
  if (FORMULA_START.test(value) && !PLAIN_NUMBER.test(value)) value = `'${value}`

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

/** One CSV record from an array of already-final cell strings/numbers. */
function record(cells: (string | number | null | undefined)[]): string {
  return cells.map(escapeCell).join(',')
}

/**
 * Writes a report, not just a table.
 *
 * The file opens in Excel as something a shopkeeper can hand to an accountant:
 * the business name on top, then what the report is and the period it covers,
 * then the data, then a TOTAL row that foots the money columns. Everything is
 * still valid RFC-4180 CSV — the heading rows are simply short records Excel
 * lays out down column A — so it also imports cleanly anywhere else.
 */
export function toReportCsv<Row>(
  heading: ReportHeading,
  columns: CsvColumn<Row>[],
  rows: Row[]
): string {
  const lines: string[] = []

  // --- masthead ---------------------------------------------------------
  lines.push(record([heading.businessName]))
  lines.push(record([heading.title]))
  for (const field of heading.fields) {
    if (field.value === null || field.value === undefined || field.value === '') continue
    lines.push(record([field.label, field.value]))
  }
  lines.push(record(['Records', rows.length]))
  lines.push('') // a blank row separates the heading from the table

  // --- table ------------------------------------------------------------
  lines.push(record(columns.map((column) => column.header)))
  for (const row of rows) {
    lines.push(record(columns.map((column) => column.value(row))))
  }

  // --- totals -----------------------------------------------------------
  const totalled = columns.some((column) => column.sum)
  if (totalled && rows.length > 0) {
    lines.push('')
    lines.push(
      record(
        columns.map((column, index) => {
          if (!column.sum) return index === 0 ? 'TOTAL' : ''
          const total = rows.reduce((sum, row) => sum + (column.sum!(row) || 0), 0)
          return (column.sumFormat ?? csvMoney)(total)
        })
      )
    )
  }

  return BOM + lines.join(NEWLINE) + NEWLINE
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

// ---------------------------------------------------------------- reading

/**
 * Parses CSV into rows of raw cell strings.
 *
 * Written by hand rather than pulled from a dependency because the shape it
 * has to survive is narrow and well known: whatever Excel produces when a
 * wholesaler saves their product list. That means honouring RFC 4180 quoting
 * (including `""` for a literal quote inside a quoted field), tolerating both
 * CRLF and LF, and stripping the UTF-8 BOM Excel writes and then chokes on.
 *
 * Blank lines are dropped — a trailing newline is normal, and a row of nothing
 * is never data.
 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let index = 0

  const endField = (): void => {
    row.push(field)
    field = ''
  }

  const endRow = (): void => {
    endField()
    // A line that held nothing but separators is not a record.
    if (row.some((cell) => cell.trim() !== '')) rows.push(row)
    row = []
  }

  while (index < input.length) {
    const char = input[index] as string

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (input[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }
        quoted = false
        index += 1
        continue
      }
      field += char
      index += 1
      continue
    }

    if (char === '"' && field === '') {
      quoted = true
      index += 1
      continue
    }

    if (char === ',') {
      endField()
      index += 1
      continue
    }

    if (char === '\r' || char === '\n') {
      endRow()
      // Consume CRLF as a single terminator.
      index += char === '\r' && input[index + 1] === '\n' ? 2 : 1
      continue
    }

    field += char
    index += 1
  }

  // Whatever is still buffered is the last record, unterminated by a newline.
  if (field !== '' || row.length > 0) endRow()

  return rows
}
