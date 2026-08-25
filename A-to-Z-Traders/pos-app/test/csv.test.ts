import { describe, expect, it } from 'vitest'
import type { ReportHeading } from '../src/main/utils/csv'
import { csvMoney, toCsv, toReportCsv } from '../src/main/utils/csv'

interface Row {
  label: string
  amount: number
}

const columns = [
  { header: 'Line', value: (r: Row) => r.label },
  { header: 'Amount', value: (r: Row) => csvMoney(r.amount) }
]

// Assertions use `toContain` on body rows, so the leading UTF-8 BOM that `toCsv`
// prepends (before the header) does not need stripping.

describe('csv export', () => {
  it('keeps negative money as a real number, not quote-prefixed text', () => {
    // A negative amount begins with "-", which is a formula-injection trigger.
    // It must still export as a plain number so Excel can sum the column.
    const csv = toCsv(columns, [{ label: 'Net profit', amount: -1234.5 }])
    expect(csv).toContain('Net profit,-1234.50')
    expect(csv).not.toContain("'-1234.50")
  })

  it('still neutralises genuine formula injection in text cells', () => {
    const csv = toCsv(columns, [{ label: '=cmd|calc', amount: 10 }])
    expect(csv).toContain("'=cmd|calc")
  })

  it('quotes and escapes values containing commas or quotes', () => {
    const csv = toCsv(columns, [{ label: 'Ali, "AB" Traders', amount: 0 }])
    expect(csv).toContain('"Ali, ""AB"" Traders"')
  })

  it('renders money with two decimal places', () => {
    expect(csvMoney(5)).toBe('5.00')
    expect(csvMoney(-5)).toBe('-5.00')
    expect(csvMoney(null)).toBe('')
  })
})

interface Bill {
  invoice: string
  total: number
}

const heading: ReportHeading = {
  businessName: 'A to Z Traders',
  title: 'Sales Report',
  fields: [
    { label: 'Period', value: '2026-01-01 to 2026-01-31' },
    { label: 'Currency', value: 'PKR' },
    { label: 'Generated', value: '2026-01-31 18:00:00' }
  ]
}

const billColumns = [
  { header: 'Invoice', value: (r: Bill) => r.invoice },
  { header: 'Total (PKR)', value: (r: Bill) => csvMoney(r.total), sum: (r: Bill) => r.total }
]

const bills: Bill[] = [
  { invoice: 'INV-1', total: 100 },
  { invoice: 'INV-2', total: 250.5 }
]

describe('report csv', () => {
  it('prints a masthead, the period, a record count and the table', () => {
    const csv = toReportCsv(heading, billColumns, bills)
    expect(csv).toContain('A to Z Traders')
    expect(csv).toContain('Sales Report')
    expect(csv).toContain('Period,2026-01-01 to 2026-01-31')
    expect(csv).toContain('Currency,PKR')
    expect(csv).toContain('Records,2')
    expect(csv).toContain('Invoice,Total (PKR)')
    expect(csv).toContain('INV-1,100.00')
    // Heading comes before the table, which comes before the totals.
    expect(csv.indexOf('A to Z Traders')).toBeLessThan(csv.indexOf('Sales Report'))
    expect(csv.indexOf('Sales Report')).toBeLessThan(csv.indexOf('Invoice,Total (PKR)'))
  })

  it('foots the summed columns in a TOTAL row', () => {
    const csv = toReportCsv(heading, billColumns, bills)
    // 100.00 + 250.50 = 350.50, under the Total column, with the TOTAL label in
    // the first (unsummed) column.
    expect(csv).toContain('TOTAL,350.50')
  })

  it('omits the TOTAL row when no column is summed', () => {
    const csv = toReportCsv(heading, [{ header: 'Invoice', value: (r: Bill) => r.invoice }], bills)
    expect(csv).not.toContain('TOTAL')
  })

  it('still guards CSV injection inside a report', () => {
    const csv = toReportCsv(heading, billColumns, [{ invoice: '=cmd', total: 5 }])
    expect(csv).toContain("'=cmd")
  })
})
