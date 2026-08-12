import type { Id, IsoDate, IsoTimestamp } from './common'

export interface PurchaseItem {
  id: Id
  purchaseId: Id
  productId: Id
  productName: string
  unitName: string
  factor: number
  qty: number
  baseQty: number
  /** Cost per BASE unit. */
  costPrice: number
  /** baseQty * costPrice */
  amount: number
}

export interface Purchase {
  id: Id
  supplierId: Id | null
  supplierName: string | null
  invoiceNo: string | null
  date: IsoDate
  subtotal: number
  discount: number
  total: number
  paidAmount: number
  notes: string | null
  createdAt: IsoTimestamp
}

export interface PurchaseWithItems extends Purchase {
  items: PurchaseItem[]
}

export interface PurchaseItemInput {
  productId: Id
  unitName: string
  qty: number
  /** Cost for ONE of the chosen unit; divided by factor to get base cost. */
  unitCost: number
}

export interface PurchaseInput {
  supplierId?: Id | null
  invoiceNo?: string | null
  date?: IsoDate
  items: PurchaseItemInput[]
  discount?: number
  paidAmount: number
  notes?: string | null
}

export interface PurchaseFilters {
  from?: IsoDate
  to?: IsoDate
  supplierId?: Id | null
  search?: string
  limit?: number
  offset?: number
}
