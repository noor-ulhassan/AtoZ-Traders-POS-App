import type { Id, IsoDate, IsoTimestamp } from './common'

export type StockMovementReason =
  | 'opening'
  | 'purchase'
  | 'sale'
  | 'sale_return'
  | 'purchase_return'
  | 'adjustment'
  /** Consignment goods arriving from their owner. No money moves. */
  | 'other_in'
  /** Unsold consignment goods going back to their owner. */
  | 'other_out'

export interface StockMovement {
  id: Id
  productId: Id
  productName: string
  /** +in / -out, in BASE units. */
  changeQty: number
  reason: StockMovementReason
  refTable: string | null
  refId: Id | null
  costPrice: number | null
  date: IsoDate
  notes: string | null
  createdAt: IsoTimestamp
  /** Running total after this movement, when the query asks for it. */
  balance?: number
}

export interface StockAdjustmentInput {
  productId: Id
  /** Signed change in BASE units. */
  changeQty: number
  date?: IsoDate
  notes?: string | null
}

export interface StockMovementFilters {
  productId?: Id
  from?: IsoDate
  to?: IsoDate
  reason?: StockMovementReason | 'all'
  limit?: number
  offset?: number
}
