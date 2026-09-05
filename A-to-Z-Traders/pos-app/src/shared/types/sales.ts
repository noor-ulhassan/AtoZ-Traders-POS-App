import type { Id, IsoDate, IsoTimestamp } from './common'

export type PaymentType = 'cash' | 'credit' | 'partial'

export interface SaleItem {
  id: Id
  saleId: Id
  productId: Id
  productName: string
  unitName: string
  factor: number
  qty: number
  baseQty: number
  /** Actual sale price per chosen unit. */
  rate: number
  lineDiscount: number
  /** Weighted-average cost per base unit, captured at sale time. Zero for
   *  consignment lines, which cost the shop nothing. */
  costPrice: number
  /**
   * Whether this line was consignment stock, frozen at sale time.
   *
   * Every profit and cost figure filters on this. It lives on the line rather
   * than being joined from `products` so reclassifying a product later cannot
   * restate what an old bill earned.
   */
  isOther: boolean
  /** qty * rate - lineDiscount */
  amount: number
}

export interface Sale {
  id: Id
  invoiceNo: string
  customerId: Id | null
  customerName: string | null
  date: IsoDate
  subtotal: number
  /** The part of `subtotal` that came from consignment lines. */
  otherSubtotal: number
  discount: number
  tax: number
  total: number
  paidAmount: number
  paymentType: PaymentType
  notes: string | null
  createdAt: IsoTimestamp
  /**
   * When the bill was cancelled, or null while it is live.
   *
   * A void bill keeps its invoice number — it was printed and handed over, so
   * the number must never be reused — but every figure on it is zeroed and its
   * lines and stock movements are gone. That is what keeps the reports right
   * without teaching fifteen aggregates a new filter: they sum zeroes. Only
   * the two that COUNT bills read this column.
   */
  voidedAt: IsoTimestamp | null
}

export interface SaleWithItems extends Sale {
  items: SaleItem[]
}

export interface SaleItemInput {
  productId: Id
  unitName: string
  qty: number
  rate: number
  lineDiscount?: number
}

export interface SaleInput {
  customerId?: Id | null
  date?: IsoDate
  items: SaleItemInput[]
  /** Bill-level discount, applied after the sum of line amounts. */
  discount?: number
  paymentType: PaymentType
  paidAmount: number
  notes?: string | null
}

/**
 * Re-issuing a bill that already exists (Phase 4b).
 *
 * The same shape as `SaleInput` plus the bill it replaces. It is deliberately
 * not `Partial` — an edit re-states the whole bill, because the save reverses
 * the old one entirely and writes the new one in the same transaction. A patch
 * would leave the caller guessing which half of a bill it was changing.
 */
export interface SaleUpdateInput extends SaleInput {
  id: Id
  /** Recorded on the revision, so the history says why. */
  reason?: string | null
}

/**
 * Recording what was actually paid on a delivered bill (Phase 4a).
 *
 * This is the common case the client described: the bill is right, and he now
 * knows how much came back with the delivery. It moves `paid_amount` only —
 * never the goods.
 */
export interface SaleSettleInput {
  id: Id
  /** The new total received against this bill, not the extra amount. */
  paidAmount: number
  reason?: string | null
}

export interface SaleVoidInput {
  id: Id
  reason?: string | null
}

export type SaleRevisionAction = 'settle' | 'edit' | 'void'

/** A bill exactly as it stood before one change, kept so an edit is never
 *  destructive and the owner can see what a bill used to say. */
export interface SaleRevisionSnapshot {
  invoiceNo: string
  customerId: Id | null
  customerName: string | null
  date: IsoDate
  subtotal: number
  otherSubtotal: number
  discount: number
  tax: number
  total: number
  paidAmount: number
  paymentType: PaymentType
  notes: string | null
  voidedAt: IsoTimestamp | null
  items: {
    productId: Id
    productName: string
    unitName: string
    factor: number
    qty: number
    baseQty: number
    rate: number
    lineDiscount: number
    costPrice: number
    isOther: boolean
    amount: number
  }[]
}

export interface SaleRevision {
  id: Id
  saleId: Id
  /** 1 for the first change to this bill, counting up. */
  revision: number
  action: SaleRevisionAction
  changedBy: string
  reason: string | null
  snapshot: SaleRevisionSnapshot
  createdAt: IsoTimestamp
}

export interface SaleFilters {
  from?: IsoDate
  to?: IsoDate
  customerId?: Id | null
  paymentType?: PaymentType | 'all'
  search?: string
  limit?: number
  offset?: number
}

export interface PriceSuggestion {
  rate: number
  source: 'customer_history' | 'unit_default' | 'product_default'
}

/** Aggregates over every bill the filters match, not just the page shown. */
export interface SalePageTotals {
  total: number
  paid: number
  /** SUM(MAX(0, total - paid)) — what these bills left on the khata. */
  onKhata: number
}
