import type { IsoDate, IsoTimestamp } from './common'

/**
 * A print-ready, transport-agnostic description of a bill.
 *
 * Nothing here knows about ESC/POS, paper width or the OS print dialog — the
 * printer driver consumes this shape. Swapping the console stub for a real
 * thermal printer must not require changing this object.
 */
export interface Receipt {
  business: {
    name: string
    address: string
    phone: string
    taxNumber: string
    logoPath: string
  }
  invoiceNo: string
  date: IsoDate
  printedAt: IsoTimestamp
  customer: {
    name: string
    phone: string
    /** Balance after this bill. Null for walk-in cash customers. */
    balanceAfter: number | null
  } | null
  lines: ReceiptLine[]
  totals: {
    subtotal: number
    discount: number
    taxLabel: string
    tax: number
    total: number
    paid: number
    /** total - paid; 0 for fully paid bills. */
    balance: number
  }
  amountInWords: string
  currency: string
  footer: string
}

export interface ReceiptLine {
  name: string
  unitName: string
  qty: number
  rate: number
  discount: number
  amount: number
}
