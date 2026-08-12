import type { Id, Page, Purchase, PurchaseFilters, PurchaseItem } from '@shared/types'
import { money, qty } from '@shared/money'
import type { Db } from '../db/connection'
import { toText } from '../db/rows'

interface PurchaseRow {
  id: number
  supplier_id: number | null
  supplier_name: string | null
  invoice_no: string | null
  date: string
  subtotal: number
  discount: number
  total: number
  paid_amount: number
  notes: string | null
  created_at: string
}

interface PurchaseItemRow {
  id: number
  purchase_id: number
  product_id: number
  product_name: string
  unit_name: string
  factor: number
  qty: number
  base_qty: number
  cost_price: number
  amount: number
}

const toPurchase = (row: PurchaseRow): Purchase => ({
  id: row.id,
  supplierId: row.supplier_id,
  supplierName: row.supplier_name,
  invoiceNo: toText(row.invoice_no),
  date: row.date,
  subtotal: row.subtotal,
  discount: row.discount,
  total: row.total,
  paidAmount: row.paid_amount,
  notes: toText(row.notes),
  createdAt: row.created_at
})

const toItem = (row: PurchaseItemRow): PurchaseItem => ({
  id: row.id,
  purchaseId: row.purchase_id,
  productId: row.product_id,
  productName: row.product_name,
  unitName: row.unit_name,
  factor: row.factor,
  qty: row.qty,
  baseQty: row.base_qty,
  costPrice: row.cost_price,
  amount: row.amount
})

const SELECT = `
  SELECT pu.*, s.name AS supplier_name
    FROM purchases pu
    LEFT JOIN suppliers s ON s.id = pu.supplier_id
`

function buildFilter(filters: PurchaseFilters): { where: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []

  if (filters.from) {
    clauses.push('pu.date >= ?')
    params.push(filters.from)
  }
  if (filters.to) {
    clauses.push('pu.date <= ?')
    params.push(filters.to)
  }
  if (filters.supplierId != null) {
    clauses.push('pu.supplier_id = ?')
    params.push(filters.supplierId)
  }
  if (filters.search) {
    const term = `%${filters.search.trim()}%`
    clauses.push('(pu.invoice_no LIKE ? OR s.name LIKE ? OR pu.notes LIKE ?)')
    params.push(term, term, term)
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export function listPurchases(db: Db, filters: PurchaseFilters = {}): Page<Purchase> {
  const { where, params } = buildFilter(filters)
  const limit = filters.limit ?? 100
  const offset = filters.offset ?? 0

  const rows = db
    .prepare<unknown[], PurchaseRow>(
      `${SELECT} ${where} ORDER BY pu.date DESC, pu.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)

  const total = db
    .prepare<unknown[], { total: number }>(
      `SELECT COUNT(*) AS total FROM purchases pu LEFT JOIN suppliers s ON s.id = pu.supplier_id ${where}`
    )
    .get(...params)

  return { rows: rows.map(toPurchase), total: total?.total ?? 0 }
}

export function findPurchase(db: Db, id: Id): Purchase | null {
  const row = db.prepare<[Id], PurchaseRow>(`${SELECT} WHERE pu.id = ?`).get(id)
  return row ? toPurchase(row) : null
}

export function listItems(db: Db, purchaseId: Id): PurchaseItem[] {
  return db
    .prepare<[Id], PurchaseItemRow>(
      `SELECT pi.*, p.name AS product_name
         FROM purchase_items pi
         JOIN products p ON p.id = pi.product_id
        WHERE pi.purchase_id = ?
        ORDER BY pi.id`
    )
    .all(purchaseId)
    .map(toItem)
}

export interface PurchaseHeaderFields {
  supplierId: Id | null
  invoiceNo: string | null
  date: string
  subtotal: number
  discount: number
  total: number
  paidAmount: number
  notes: string | null
}

export function insertPurchase(db: Db, fields: PurchaseHeaderFields): Id {
  const info = db
    .prepare(
      `INSERT INTO purchases
         (supplier_id, invoice_no, date, subtotal, discount, total, paid_amount, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      fields.supplierId,
      fields.invoiceNo,
      fields.date,
      money(fields.subtotal),
      money(fields.discount),
      money(fields.total),
      money(fields.paidAmount),
      fields.notes
    )
  return Number(info.lastInsertRowid)
}

export interface PurchaseItemFields {
  purchaseId: Id
  productId: Id
  unitName: string
  factor: number
  qty: number
  baseQty: number
  costPrice: number
  amount: number
}

export function insertPurchaseItem(db: Db, fields: PurchaseItemFields): Id {
  const info = db
    .prepare(
      `INSERT INTO purchase_items
         (purchase_id, product_id, unit_name, factor, qty, base_qty, cost_price, amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      fields.purchaseId,
      fields.productId,
      fields.unitName,
      fields.factor,
      qty(fields.qty),
      qty(fields.baseQty),
      money(fields.costPrice),
      money(fields.amount)
    )
  return Number(info.lastInsertRowid)
}
