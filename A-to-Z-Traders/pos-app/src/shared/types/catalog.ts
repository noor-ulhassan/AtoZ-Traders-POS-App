import type { Id, IsoTimestamp } from './common'

export interface Category {
  id: Id
  name: string
  /** Number of products referencing this category. */
  productCount?: number
}

/**
 * An alternate selling unit. The product's `baseUnit` is implicit and always
 * has a factor of 1; it is never stored in this table.
 */
export interface ProductUnit {
  id: Id
  productId: Id
  unitName: string
  /** Base units contained in ONE of this unit, e.g. box = 24. */
  factor: number
  /** Default price for this unit; null falls back to `salePrice * factor`. */
  salePrice: number | null
}

/**
 * Whose goods these are.
 *
 * 'other' is consignment: the shop sells them but does not own them, so they
 * are deliberately kept out of every cost, profit and stock-value figure.
 */
export type Ownership = 'own' | 'other'

export interface Product {
  id: Id
  name: string
  sku: string | null
  barcode: string | null
  categoryId: Id | null
  categoryName: string | null
  baseUnit: string
  /** Weighted-average cost per base unit. */
  costPrice: number
  /** Default sale price per base unit. */
  salePrice: number
  /** Cached running total of stock_movements.change_qty. */
  stockQty: number
  reorderLevel: number
  isActive: boolean
  ownership: Ownership
  /** Who the goods belong to. '' for the shop's own stock. */
  ownerName: string
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
}

/** A product plus its alternate units — what the sale/purchase screens need. */
export interface ProductWithUnits extends Product {
  units: ProductUnit[]
  /** True once any stock movement exists — the base unit can no longer change. */
  hasStockHistory: boolean
}

export interface ProductFilters {
  /** Matches name, sku or barcode. */
  search?: string
  categoryId?: Id | null
  /** Defaults to 'active'. */
  status?: 'active' | 'inactive' | 'all'
  /** Only products at or below their reorder level. */
  lowStockOnly?: boolean
  /** Defaults to every product, whoever owns it. */
  ownership?: Ownership | 'all'
  limit?: number
  offset?: number
}

/** Payload for creating a product. Opening stock writes an 'opening' movement. */
export interface ProductInput {
  name: string
  sku?: string | null
  barcode?: string | null
  categoryId?: Id | null
  baseUnit: string
  costPrice: number
  salePrice: number
  reorderLevel: number
  isActive?: boolean
  /** Defaults to 'own'. Changeable only while the product holds no stock. */
  ownership?: Ownership
  /** Required when ownership is 'other'; ignored otherwise. */
  ownerName?: string | null
  /** Create-only. Ignored on update — use a stock adjustment instead. */
  openingStock?: number
  units?: ProductUnitInput[]
}

export interface ProductUnitInput {
  unitName: string
  factor: number
  salePrice?: number | null
}

/**
 * A selectable unit for a product, flattened for pickers. The base unit is
 * always present as the first entry with factor 1.
 */
export interface SellableUnit {
  unitName: string
  factor: number
  salePrice: number
  isBase: boolean
}

/** Aggregates over every product the filters match, not just the page shown. */
export interface ProductPageTotals {
  /** SUM(stock_qty * cost_price) — what the matching stock is worth at cost. */
  stockValue: number
}
