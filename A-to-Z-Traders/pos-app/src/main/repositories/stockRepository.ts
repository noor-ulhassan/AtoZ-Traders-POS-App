import type {
  Id,
  Page,
  StockMovement,
  StockMovementFilters,
  StockMovementReason
} from '@shared/types'
import { money, qty } from '@shared/money'
import type { Db } from '../db/connection'

interface StockMovementRow {
  id: number
  product_id: number
  product_name: string
  change_qty: number
  reason: StockMovementReason
  ref_table: string | null
  ref_id: number | null
  cost_price: number | null
  date: string
  notes: string | null
  created_at: string
}

const toMovement = (row: StockMovementRow): StockMovement => ({
  id: row.id,
  productId: row.product_id,
  productName: row.product_name,
  changeQty: row.change_qty,
  reason: row.reason,
  refTable: row.ref_table,
  refId: row.ref_id,
  costPrice: row.cost_price,
  date: row.date,
  notes: row.notes,
  createdAt: row.created_at
})

export interface MovementInput {
  productId: Id
  /** Signed, in BASE units. */
  changeQty: number
  reason: StockMovementReason
  refTable?: string | null
  refId?: Id | null
  costPrice?: number | null
  date: string
  notes?: string | null
}

export function insertMovement(db: Db, input: MovementInput): Id {
  const info = db
    .prepare(
      `INSERT INTO stock_movements
         (product_id, change_qty, reason, ref_table, ref_id, cost_price, date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.productId,
      qty(input.changeQty),
      input.reason,
      input.refTable ?? null,
      input.refId ?? null,
      input.costPrice == null ? null : money(input.costPrice),
      input.date,
      input.notes ?? null
    )
  return Number(info.lastInsertRowid)
}

const SELECT = `
  SELECT m.*, p.name AS product_name
    FROM stock_movements m
    JOIN products p ON p.id = m.product_id
`

function buildFilter(filters: StockMovementFilters): { where: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []

  if (filters.productId != null) {
    clauses.push('m.product_id = ?')
    params.push(filters.productId)
  }
  if (filters.from) {
    clauses.push('m.date >= ?')
    params.push(filters.from)
  }
  if (filters.to) {
    clauses.push('m.date <= ?')
    params.push(filters.to)
  }
  if (filters.reason && filters.reason !== 'all') {
    clauses.push('m.reason = ?')
    params.push(filters.reason)
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export function listMovements(db: Db, filters: StockMovementFilters = {}): Page<StockMovement> {
  const { where, params } = buildFilter(filters)
  const limit = filters.limit ?? 200
  const offset = filters.offset ?? 0

  const rows = db
    .prepare<unknown[], StockMovementRow>(
      `${SELECT} ${where} ORDER BY m.date DESC, m.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)

  const total = db
    .prepare<unknown[], { total: number }>(
      `SELECT COUNT(*) AS total FROM stock_movements m ${where}`
    )
    .get(...params)

  return { rows: rows.map(toMovement), total: total?.total ?? 0 }
}

/** The authoritative on-hand quantity — the sum of the ledger (Guide §1.6). */
export function sumMovements(db: Db, productId: Id): number {
  const row = db
    .prepare<[Id], { total: number | null }>(
      'SELECT SUM(change_qty) AS total FROM stock_movements WHERE product_id = ?'
    )
    .get(productId)
  return qty(row?.total ?? 0)
}

/** Products whose cached `stock_qty` has drifted from the movement ledger. */
/** True once any stock movement exists for a product — even if it later sold to
 *  zero. The base unit must stay fixed past this point (Guide §1.6). */
export function hasMovements(db: Db, productId: Id): boolean {
  const row = db
    .prepare<[Id], { present: number }>(
      'SELECT EXISTS(SELECT 1 FROM stock_movements WHERE product_id = ?) AS present'
    )
    .get(productId)
  return row?.present === 1
}

export function findStockDrift(db: Db): { productId: Id; cached: number; actual: number }[] {
  return db
    .prepare<[], { product_id: number; cached: number; actual: number }>(
      `SELECT p.id AS product_id,
              p.stock_qty AS cached,
              COALESCE((SELECT SUM(m.change_qty) FROM stock_movements m WHERE m.product_id = p.id), 0) AS actual
         FROM products p
        WHERE ABS(p.stock_qty - COALESCE(
                (SELECT SUM(m.change_qty) FROM stock_movements m WHERE m.product_id = p.id), 0)) > 0.0005`
    )
    .all()
    .map((row) => ({ productId: row.product_id, cached: row.cached, actual: row.actual }))
}

export function setCachedStock(db: Db, productId: Id, value: number): void {
  db.prepare('UPDATE products SET stock_qty = ? WHERE id = ?').run(qty(value), productId)
}
