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
  /** Weighted-average cost per base unit, captured at sale time. */
  costPrice: number
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
  discount: number
  tax: number
  total: number
  paidAmount: number
  paymentType: PaymentType
  notes: string | null
  createdAt: IsoTimestamp
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
