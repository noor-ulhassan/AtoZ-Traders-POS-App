import type { Receipt, SaleWithItems } from '@shared/types'
import { getDb } from '../db/connection'
import { findParty } from '../repositories/partyRepository'
import { getSettings } from '../repositories/settingsRepository'
import { amountInWords } from '../utils/amountInWords'

function timestamp(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
    now.getHours()
  )}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

/**
 * Turns a saved sale into a print-ready receipt.
 *
 * This is deliberately transport-agnostic: no ESC/POS, no paper width, no
 * print dialog. When the real thermal printer is wired up (Guide §6.10) it
 * consumes this object and nothing else in the app changes.
 */
export function buildReceipt(sale: SaleWithItems): Receipt {
  const db = getDb()
  const settings = getSettings(db)

  const customer = sale.customerId != null ? findParty(db, 'customer', sale.customerId) : null

  return {
    business: {
      name: settings.businessName,
      address: settings.address,
      phone: settings.phone,
      taxNumber: settings.taxNumber,
      logoPath: settings.logoPath
    },
    invoiceNo: sale.invoiceNo,
    date: sale.date,
    printedAt: timestamp(),
    customer: customer
      ? {
          name: customer.name,
          phone: customer.phone ?? '',
          balanceAfter: customer.currentBalance
        }
      : null,
    lines: sale.items.map((item) => ({
      name: item.productName,
      isOther: item.isOther,
      unitName: item.unitName,
      qty: item.qty,
      rate: item.rate,
      discount: item.lineDiscount,
      amount: item.amount
    })),
    totals: {
      subtotal: sale.subtotal,
      otherSubtotal: sale.otherSubtotal,
      discount: sale.discount,
      taxLabel: settings.taxEnabled ? `Tax (${settings.taxRate}%)` : 'Tax',
      tax: sale.tax,
      total: sale.total,
      paid: sale.paidAmount,
      balance: Math.max(0, Math.round((sale.total - sale.paidAmount) * 100) / 100)
    },
    amountInWords: amountInWords(sale.total, settings.currency),
    currency: settings.currency,
    footer: settings.receiptFooter
  }
}
