import type { Id, IsoDate, IsoTimestamp } from './common'

export type RefundType = 'cash' | 'credit'

export interface SaleReturnItem {
  id: Id
  saleReturnId: Id
  productId: Id
  productName: string
  unitName: string
  factor: number
  qty: number
  baseQty: number
  rate: number
  /** Captured for correct profit reversal. */
  costPrice: number
  /** Frozen at return time, mirroring the sale line it reverses. */
  isOther: boolean
  amount: number
}

export interface SaleReturn {
  id: Id
  saleId: Id | null
  saleInvoiceNo: string | null
  customerId: Id | null
  customerName: string | null
  date: IsoDate
  total: number
  /** The part of `total` that was consignment stock. */
  otherTotal: number
  refundType: RefundType
  notes: string | null
  createdAt: IsoTimestamp
}

export interface SaleReturnWithItems extends SaleReturn {
  items: SaleReturnItem[]
}

export interface SaleReturnItemInput {
  productId: Id
  unitName: string
  qty: number
  rate: number
}

export interface SaleReturnInput {
  saleId?: Id | null
  customerId?: Id | null
  date?: IsoDate
  items: SaleReturnItemInput[]
  refundType: RefundType
  notes?: string | null
}

export interface PurchaseReturnItem {
  id: Id
  purchaseReturnId: Id
  productId: Id
  productName: string
  unitName: string
  factor: number
  qty: number
  baseQty: number
  costPrice: number
  amount: number
}

export interface PurchaseReturn {
  id: Id
  purchaseId: Id | null
  purchaseInvoiceNo: string | null
  supplierId: Id | null
  supplierName: string | null
  date: IsoDate
  total: number
  notes: string | null
  createdAt: IsoTimestamp
}

export interface PurchaseReturnWithItems extends PurchaseReturn {
  items: PurchaseReturnItem[]
}

export interface PurchaseReturnItemInput {
  productId: Id
  unitName: string
  qty: number
  /** Cost for ONE of the chosen unit. Defaults to current average cost. */
  unitCost?: number
}

export interface PurchaseReturnInput {
  purchaseId?: Id | null
  supplierId?: Id | null
  date?: IsoDate
  items: PurchaseReturnItemInput[]
  notes?: string | null
}

export interface ReturnFilters {
  from?: IsoDate
  to?: IsoDate
  partyId?: Id | null
  limit?: number
  offset?: number
}

/** Aggregates over every return the filters match, not just the page shown. */
export interface ReturnPageTotals {
  total: number
  /** Sale returns only; always 0 for purchase returns, which have no refund type. */
  cashRefunds: number
}
