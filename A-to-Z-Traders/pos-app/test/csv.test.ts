import { describe, expect, it } from 'vitest'
import { csvMoney, toCsv } from '../src/main/utils/csv'

interface Row {
  label: string
  amount: number
}

const columns = [
  { header: 'Line', value: (r: Row) => r.label },
  { header: 'Amount', value: (r: Row) => csvMoney(r.amount) }
]

/** Strip the leading UTF-8 BOM so assertions read cleanly. */
function body(csv: string): string {
  return csv.replace(/^﻿/, '')
}

describe('csv export', () => {
  it('keeps negative money as a real number, not quote-prefixed text', () => {
    // A negative amount begins with "-", which is a formula-injection trigger.
    // It must still export as a plain number so Excel can sum the column.
    const csv = body(toCsv(columns, [{ label: 'Net profit', amount: -1234.5 }]))
    expect(csv).toContain('Net profit,-1234.50')
    expect(csv).not.toContain("'-1234.50")
  })

  it('still neutralises genuine formula injection in text cells', () => {
    const csv = body(toCsv(columns, [{ label: '=cmd|calc', amount: 10 }]))
    expect(csv).toContain("'=cmd|calc")
  })

  it('quotes and escapes values containing commas or quotes', () => {
    const csv = body(toCsv(columns, [{ label: 'Ali, "AB" Traders', amount: 0 }]))
    expect(csv).toContain('"Ali, ""AB"" Traders"')
  })

  it('renders money with two decimal places', () => {
    expect(csvMoney(5)).toBe('5.00')
    expect(csvMoney(-5)).toBe('-5.00')
    expect(csvMoney(null)).toBe('')
  })
})
