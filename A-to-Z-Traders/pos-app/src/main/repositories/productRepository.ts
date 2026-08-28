import type {
  Id,
  PageWithTotals,
  Product,
  ProductFilters,
  ProductPageTotals,
  ProductUnit,
  ProductUnitInput,
  Ownership,
  SellableUnit
} from '@shared/types'
import { money, qty } from '@shared/money'
import { DEFAULT_PAGE_SIZE } from '@shared/pagination'
import type { Db } from '../db/connection'
import { toBool, toText } from '../db/rows'

interface ProductRow {
  id: number
  name: string
  sku: string | null
  barcode: string | null
  category_id: number | null
  category_name: string | null
  base_unit: string
  cost_price: number
  sale_price: number
  stock_qty: number
  reorder_level: number
  is_active: number
  ownership: 'own' | 'other'
  owner_name: string
  created_at: string
  updated_at: string
}

interface ProductUnitRow {
  id: number
  product_id: number
  unit_name: string
  factor: number
  sale_price: number | null
}

const toProduct = (row: ProductRow): Product => ({
  id: row.id,
  name: row.name,
  sku: toText(row.sku),
  barcode: toText(row.barcode),
  categoryId: row.category_id,
  categoryName: row.category_name,
  baseUnit: row.base_unit,
  costPrice: row.cost_price,
  salePrice: row.sale_price,
  stockQty: row.stock_qty,
  reorderLevel: row.reorder_level,
  isActive: toBool(row.is_active),
  ownership: row.ownership,
  ownerName: row.owner_name,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

const toProductUnit = (row: ProductUnitRow): ProductUnit => ({
  id: row.id,
  productId: row.product_id,
  unitName: row.unit_name,
  factor: row.factor,
  salePrice: row.sale_price
})

const SELECT_PRODUCT = `
  SELECT p.*, c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
`

/** Builds the shared WHERE clause so list and count can never disagree. */
function buildFilter(filters: ProductFilters): { where: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []

  const status = filters.status ?? 'active'
  if (status === 'active') clauses.push('p.is_active = 1')
  if (status === 'inactive') clauses.push('p.is_active = 0')

  if (filters.search) {
    const term = `%${filters.search.trim()}%`
    clauses.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)')
    params.push(term, term, term)
  }

  if (filters.categoryId != null) {
    clauses.push('p.category_id = ?')
    params.push(filters.categoryId)
  }

  if (filters.lowStockOnly) {
    clauses.push('p.reorder_level > 0 AND p.stock_qty <= p.reorder_level')
  }

  const ownership = filters.ownership ?? 'all'
  if (ownership !== 'all') {
    clauses.push('p.ownership = ?')
    params.push(ownership)
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export function listProducts(
  db: Db,
  filters: ProductFilters = {}
): PageWithTotals<Product, ProductPageTotals> {
  const { where, params } = buildFilter(filters)
  const limit = filters.limit ?? DEFAULT_PAGE_SIZE
  const offset = filters.offset ?? 0

  const rows = db
    .prepare<unknown[], ProductRow>(
      `${SELECT_PRODUCT} ${where} ORDER BY p.name COLLATE NOCASE LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)

  // One pass for the count and the money, over the same WHERE the rows used —
  // so the tiles above the table describe every match, not the page on screen.
  const summary = db
    .prepare<unknown[], { total: number; stock_value: number | null }>(
      `SELECT COUNT(*) AS total, SUM(p.stock_qty * p.cost_price) AS stock_value
         FROM products p ${where}`
    )
    .get(...params)

  return {
    rows: rows.map(toProduct),
    total: summary?.total ?? 0,
    totals: { stockValue: money(summary?.stock_value ?? 0) }
  }
}

export function findProduct(db: Db, id: Id): Product | null {
  const row = db.prepare<[Id], ProductRow>(`${SELECT_PRODUCT} WHERE p.id = ?`).get(id)
  return row ? toProduct(row) : null
}

export function findProductByBarcode(db: Db, barcode: string): Product | null {
  const row = db
    .prepare<[string], ProductRow>(`${SELECT_PRODUCT} WHERE p.barcode = ? AND p.is_active = 1`)
    .get(barcode)
  return row ? toProduct(row) : null
}

export interface ProductWriteFields {
  name: string
  sku: string | null
  barcode: string | null
  categoryId: Id | null
  baseUnit: string
  costPrice: number
  salePrice: number
  reorderLevel: number
  isActive: boolean
  ownership: Ownership
  ownerName: string
}

export function insertProduct(db: Db, fields: ProductWriteFields): Id {
  const info = db
    .prepare(
      `INSERT INTO products
         (name, sku, barcode, category_id, base_unit, cost_price, sale_price,
          reorder_level, is_active, ownership, owner_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      fields.name,
      fields.sku,
      fields.barcode,
      fields.categoryId,
      fields.baseUnit,
      money(fields.costPrice),
      money(fields.salePrice),
      qty(fields.reorderLevel),
      fields.isActive ? 1 : 0,
      fields.ownership,
      fields.ownerName
    )
  return Number(info.lastInsertRowid)
}

export function updateProduct(db: Db, id: Id, fields: ProductWriteFields): void {
  db.prepare(
    `UPDATE products
        SET name = ?, sku = ?, barcode = ?, category_id = ?, base_unit = ?,
            cost_price = ?, sale_price = ?, reorder_level = ?, is_active = ?,
            ownership = ?, owner_name = ?,
            updated_at = datetime('now','localtime')
      WHERE id = ?`
  ).run(
    fields.name,
    fields.sku,
    fields.barcode,
    fields.categoryId,
    fields.baseUnit,
    money(fields.costPrice),
    money(fields.salePrice),
    qty(fields.reorderLevel),
    fields.isActive ? 1 : 0,
    fields.ownership,
    fields.ownerName,
    id
  )
}

export function setProductActive(db: Db, id: Id, isActive: boolean): void {
  db.prepare(
    `UPDATE products SET is_active = ?, updated_at = datetime('now','localtime') WHERE id = ?`
  ).run(isActive ? 1 : 0, id)
}

/**
 * Applies a signed change to the cached stock total.
 *
 * Callers must be inside the same transaction that wrote the matching
 * `stock_movements` row — the cache and the ledger move together or not at all
 * (Guide §1.6).
 */
export function applyStockDelta(db: Db, id: Id, delta: number): void {
  db.prepare(
    `UPDATE products
        SET stock_qty = ROUND(stock_qty + ?, 3),
            updated_at = datetime('now','localtime')
      WHERE id = ?`
  ).run(delta, id)
}

/** Sets the weighted-average cost after a purchase recalculation. */
export function setCostPrice(db: Db, id: Id, costPrice: number): void {
  db.prepare(
    `UPDATE products SET cost_price = ?, updated_at = datetime('now','localtime') WHERE id = ?`
  ).run(money(costPrice), id)
}

// ---------------------------------------------------------------- units

export function listUnits(db: Db, productId: Id): ProductUnit[] {
  return db
    .prepare<[Id], ProductUnitRow>(
      'SELECT * FROM product_units WHERE product_id = ? ORDER BY factor ASC'
    )
    .all(productId)
    .map(toProductUnit)
}

export function replaceUnits(db: Db, productId: Id, units: ProductUnitInput[]): void {
  db.prepare('DELETE FROM product_units WHERE product_id = ?').run(productId)
  const insert = db.prepare(
    'INSERT INTO product_units (product_id, unit_name, factor, sale_price) VALUES (?, ?, ?, ?)'
  )
  for (const unit of units) {
    insert.run(
      productId,
      unit.unitName,
      unit.factor,
      unit.salePrice == null ? null : money(unit.salePrice)
    )
  }
}

/**
 * Every unit the product can be sold in, base unit first.
 *
 * An alternate unit without an explicit price falls back to the base price
 * multiplied by the factor, so a box of 24 is never accidentally priced as one
 * piece.
 */
export function sellableUnits(db: Db, product: Product): SellableUnit[] {
  const base: SellableUnit = {
    unitName: product.baseUnit,
    factor: 1,
    salePrice: product.salePrice,
    isBase: true
  }

  const alternates = listUnits(db, product.id).map<SellableUnit>((unit) => ({
    unitName: unit.unitName,
    factor: unit.factor,
    salePrice: unit.salePrice ?? money(product.salePrice * unit.factor),
    isBase: false
  }))

  return [base, ...alternates]
}
