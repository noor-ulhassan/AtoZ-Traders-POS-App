import type { Id, IsoDate } from './common'

/**
 * The consignment register.
 *
 * Goods the shop sells but does not own. The client's instruction was "no
 * calculations" — meaning no cost, no profit, no stock value. What remains is
 * the record: what arrived, what sold, what is left, and what it was billed
 * for. That is not a calculation, it is the sheet he needs in his hand the day
 * the goods' owner comes to settle up.
 */

export interface OtherStockMovementInput {
  productId: Id
  /** Always positive; the direction comes from which function is called. */
  qty: number
  /** The unit the quantity was counted in. Defaults to the base unit. */
  unitName?: string
  date?: IsoDate
  notes?: string | null
}

/** One consignment product, with what has happened to it. */
export interface OtherStockRow {
  productId: Id
  productName: string
  sku: string | null
  ownerName: string
  baseUnit: string
  /** Units received from the owner, all time. */
  received: number
  /** Units sold on, all time. */
  sold: number
  /** Units handed back to the owner unsold. */
  returnedToOwner: number
  /** Units customers brought back. */
  returnedByCustomer: number
  /** On the shelf now — the cached stock, which the ledger above explains. */
  onHand: number
  /** What the sold units were billed for, net of customer returns. */
  billedAmount: number
  salePrice: number
}

/** The same figures totalled for one owner. */
export interface OtherStockOwner {
  ownerName: string
  productCount: number
  received: number
  sold: number
  returnedToOwner: number
  onHand: number
  billedAmount: number
}

export interface OtherStockReport {
  /** Null when the report covers everything ever recorded. */
  from: IsoDate | null
  to: IsoDate | null
  rows: OtherStockRow[]
  owners: OtherStockOwner[]
  totals: {
    productCount: number
    ownerCount: number
    onHand: number
    billedAmount: number
  }
}

export interface OtherStockFilters {
  from?: IsoDate
  to?: IsoDate
  ownerName?: string
  search?: string
}
