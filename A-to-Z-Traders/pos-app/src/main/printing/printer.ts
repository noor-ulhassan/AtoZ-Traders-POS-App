import type { Receipt } from '@shared/types'
import { logger } from '../utils/logger'

const log = logger.child('printer')

/**
 * Printer driver — STUB (Guide §6.10).
 *
 * Real ESC/POS wiring waits on the confirmed printer model, paper width and
 * connection. Until then this renders the receipt to the log in the same
 * column layout a 80mm roll would use, which is enough to verify totals and
 * wrapping. Swapping this file for a real driver must not require touching
 * `receiptBuilder`, any service, or the renderer — the IPC channel and the
 * `Receipt` shape are the contract.
 */
export interface PrinterDriver {
  print(receipt: Receipt): Promise<void>
}

const WIDTH = 42

const line = (char = '-'): string => char.repeat(WIDTH)

function twoColumns(left: string, right: string): string {
  const gap = Math.max(1, WIDTH - left.length - right.length)
  return `${left}${' '.repeat(gap)}${right}`
}

function centre(text: string): string {
  const padding = Math.max(0, Math.floor((WIDTH - text.length) / 2))
  return `${' '.repeat(padding)}${text}`
}

export function renderPlainText(receipt: Receipt): string {
  const amount = (value: number): string => value.toFixed(2)
  const rows: string[] = []

  if (receipt.business.name) rows.push(centre(receipt.business.name))
  if (receipt.business.address) rows.push(centre(receipt.business.address))
  if (receipt.business.phone) rows.push(centre(receipt.business.phone))
  if (receipt.business.taxNumber) rows.push(centre(`NTN: ${receipt.business.taxNumber}`))
  rows.push(line('='))

  rows.push(twoColumns(`Invoice: ${receipt.invoiceNo}`, receipt.date))
  if (receipt.customer) {
    rows.push(`Customer: ${receipt.customer.name}`)
    if (receipt.customer.phone) rows.push(`Phone: ${receipt.customer.phone}`)
  } else {
    rows.push('Customer: Walk-in')
  }
  rows.push(line())

  for (const item of receipt.lines) {
    // Marked on the printed copy too, so a bill can be reconciled against the
    // goods' owner from the paper alone.
    rows.push(item.isOther ? `${item.name} *` : item.name)
    rows.push(
      twoColumns(`  ${item.qty} ${item.unitName} x ${amount(item.rate)}`, amount(item.amount))
    )
    if (item.discount > 0) rows.push(twoColumns('  Less discount', `-${amount(item.discount)}`))
  }

  rows.push(line())
  rows.push(twoColumns('Subtotal', amount(receipt.totals.subtotal)))
  if (receipt.totals.otherSubtotal > 0) {
    rows.push(twoColumns('  * of which other stock', amount(receipt.totals.otherSubtotal)))
  }
  if (receipt.totals.discount > 0) {
    rows.push(twoColumns('Discount', `-${amount(receipt.totals.discount)}`))
  }
  if (receipt.totals.tax > 0) {
    rows.push(twoColumns(receipt.totals.taxLabel, amount(receipt.totals.tax)))
  }
  rows.push(twoColumns('TOTAL', `${receipt.currency} ${amount(receipt.totals.total)}`))
  rows.push(twoColumns('Paid', amount(receipt.totals.paid)))
  if (receipt.totals.balance > 0) {
    rows.push(twoColumns('Balance due', amount(receipt.totals.balance)))
  }
  if (receipt.customer?.balanceAfter) {
    rows.push(twoColumns('Total outstanding', amount(receipt.customer.balanceAfter)))
  }

  rows.push(line())
  rows.push(receipt.amountInWords)
  if (receipt.footer) {
    rows.push(line())
    rows.push(centre(receipt.footer))
  }

  return rows.join('\n')
}

export const consolePrinter: PrinterDriver = {
  async print(receipt) {
    log.info(`receipt ${receipt.invoiceNo}\n${renderPlainText(receipt)}`)
  }
}

let driver: PrinterDriver = consolePrinter

/** Swap in the real driver here once the printer is confirmed. */
export function setPrinterDriver(next: PrinterDriver): void {
  driver = next
}

export async function printReceipt(receipt: Receipt): Promise<void> {
  await driver.print(receipt)
}
