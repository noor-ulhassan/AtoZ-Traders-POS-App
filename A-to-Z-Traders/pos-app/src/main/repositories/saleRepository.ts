import type {
  Id,
  PageWithTotals,
  PaymentType,
  Sale,
  SaleFilters,
  SaleItem,
  SalePageTotals
} from '@shared/types'
import { money, qty } from '@shared/money'
import { DEFAULT_PAGE_SIZE } from '@shared/pagination'
import type { Db } from '../db/connection'
import { fromBool, toBool, toText } from '../db/rows'

/** Invoice numbers look like `INV-000042`. The prefix is fixed on purpose: it
 *  is parsed back out to find the next number, so it must never vary. */
export const INVOICE_PREFIX = 'INV-'
const INVOICE_DIGITS = 6

interface SaleRow {
  id: number
  invoice_no: string
  customer_id: number | null
  customer_name: string | null
  date: string
  subtotal: number
  other_subtotal: number
  discount: number
  tax: number
  total: number
  paid_amount: number
  payment_type: PaymentType
  notes: string | null
  created_at: string
}

interface SaleItemRow {
  id: number
  sale_id: number
  product_id: number
  product_name: string
  unit_name: string
  factor: number
  qty: number
  base_qty: number
  rate: number
  line_discount: number
  cost_price: number
  is_other: number
  amount: number
}

const toSale = (row: SaleRow): Sale => ({
  id: row.id,
  invoiceNo: row.invoice_no,
  customerId: row.customer_id,
  customerName: row.customer_name,
  date: row.date,
  subtotal: row.subtotal,
  otherSubtotal: row.other_subtotal,
  discount: row.discount,
  tax: row.tax,
  total: row.total,
  paidAmount: row.paid_amount,
  paymentType: row.payment_type,
  notes: toText(row.notes),
  createdAt: row.created_at
})

const toItem = (row: SaleItemRow): SaleItem => ({
  id: row.id,
  saleId: row.sale_id,
  productId: row.product_id,
  productName: row.product_name,
  unitName: row.unit_name,
  factor: row.factor,
  qty: row.qty,
  baseQty: row.base_qty,
  rate: row.rate,
  lineDiscount: row.line_discount,
  costPrice: row.cost_price,
  isOther: toBool(row.is_other),
  amount: row.amount
})

const SELECT = `
  SELECT s.*, c.name AS customer_name
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
`

function buildFilter(filters: SaleFilters): { where: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []

  if (filters.from) {
    clauses.push('s.date >= ?')
    params.push(filters.from)
  }
  if (filters.to) {
    clauses.push('s.date <= ?')
    params.push(filters.to)
  }
  if (filters.customerId != null) {
    clauses.push('s.customer_id = ?')
    params.push(filters.customerId)
  }
  if (filters.paymentType && filters.paymentType !== 'all') {
    clauses.push('s.payment_type = ?')
    params.push(filters.paymentType)
  }
  if (filters.search) {
    const term = `%${filters.search.trim()}%`
    clauses.push('(s.invoice_no LIKE ? OR c.name LIKE ? OR s.notes LIKE ?)')
    params.push(term, term, term)
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export function listSales(db: Db, filters: SaleFilters = {}): PageWithTotals<Sale, SalePageTotals> {
  const { where, params } = buildFilter(filters)
  const limit = filters.limit ?? DEFAULT_PAGE_SIZE
  const offset = filters.offset ?? 0

  const rows = db
    .prepare<unknown[], SaleRow>(
      `${SELECT} ${where} ORDER BY s.date DESC, s.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)

  const summary = db
    .prepare<
      unknown[],
      { total: number; sum_total: number | null; sum_paid: number | null; on_khata: number | null }
    >(
      `SELECT COUNT(*)                                    AS total,
              SUM(s.total)                                AS sum_total,
              SUM(s.paid_amount)                          AS sum_paid,
              SUM(MAX(0, ROUND(s.total - s.paid_amount, 2))) AS on_khata
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id ${where}`
    )
    .get(...params)

  return {
    rows: rows.map(toSale),
    total: summary?.total ?? 0,
    totals: {
      total: money(summary?.sum_total ?? 0),
      paid: money(summary?.sum_paid ?? 0),
      onKhata: money(summary?.on_khata ?? 0)
    }
  }
}

export function findSale(db: Db, id: Id): Sale | null {
  const row = db.prepare<[Id], SaleRow>(`${SELECT} WHERE s.id = ?`).get(id)
  return row ? toSale(row) : null
}

export function listItems(db: Db, saleId: Id): SaleItem[] {
  return db
    .prepare<[Id], SaleItemRow>(
      `SELECT si.*, p.name AS product_name
         FROM sale_items si
         JOIN products p ON p.id = si.product_id
        WHERE si.sale_id = ?
        ORDER BY si.id`
    )
    .all(saleId)
    .map(toItem)
}

/**
 * The next invoice number, derived from the highest one already issued.
 *
 * Must be called inside the same transaction as the insert — SQLite's writer
 * lock then guarantees no other write can claim the same number between the
 * read and the insert. The UNIQUE index on `invoice_no` is the backstop.
 */
export function nextInvoiceNo(db: Db): string {
  const row = db
    .prepare<[number], { highest: number | null }>(
      `SELECT MAX(CAST(SUBSTR(invoice_no, ?) AS INTEGER)) AS highest
         FROM sales
        WHERE invoice_no LIKE '${INVOICE_PREFIX}%'`
    )
    .get(INVOICE_PREFIX.length + 1)

  const next = (row?.highest ?? 0) + 1
  return `${INVOICE_PREFIX}${String(next).padStart(INVOICE_DIGITS, '0')}`
}

export interface SaleHeaderFields {
  invoiceNo: string
  customerId: Id | null
  date: string
  subtotal: number
  otherSubtotal: number
  discount: number
  tax: number
  total: number
  paidAmount: number
  paymentType: PaymentType
  notes: string | null
}

export function insertSale(db: Db, fields: SaleHeaderFields): Id {
  const info = db
    .prepare(
      `INSERT INTO sales
         (invoice_no, customer_id, date, subtotal, other_subtotal, discount, tax,
          total, paid_amount, payment_type, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      fields.invoiceNo,
      fields.customerId,
      fields.date,
      money(fields.subtotal),
      money(fields.otherSubtotal),
      money(fields.discount),
      money(fields.tax),
      money(fields.total),
      money(fields.paidAmount),
      fields.paymentType,
      fields.notes
    )
  return Number(info.lastInsertRowid)
}

export interface SaleItemFields {
  saleId: Id
  productId: Id
  unitName: string
  factor: number
  qty: number
  baseQty: number
  rate: number
  lineDiscount: number
  costPrice: number
  isOther: boolean
  amount: number
}

export function insertSaleItem(db: Db, fields: SaleItemFields): Id {
  const info = db
    .prepare(
      `INSERT INTO sale_items
         (sale_id, product_id, unit_name, factor, qty, base_qty, rate,
          line_discount, cost_price, is_other, amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      fields.saleId,
      fields.productId,
      fields.unitName,
      fields.factor,
      qty(fields.qty),
      qty(fields.baseQty),
      money(fields.rate),
      money(fields.lineDiscount),
      money(fields.costPrice),
      fromBool(fields.isOther),
      money(fields.amount)
    )
  return Number(info.lastInsertRowid)
}

// -------------------------------------------------- remembered pricing

export function rememberCustomerPrice(
  db: Db,
  customerId: Id,
  productId: Id,
  unitName: string,
  rate: number
): void {
  db.prepare(
    `INSERT INTO customer_item_prices (customer_id, product_id, unit_name, last_rate)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (customer_id, product_id, unit_name)
     DO UPDATE SET last_rate = excluded.last_rate, updated_at = datetime('now','localtime')`
  ).run(customerId, productId, unitName, money(rate))
}

export function findCustomerPrice(
  db: Db,
  customerId: Id,
  productId: Id,
  unitName: string
): number | null {
  const row = db
    .prepare<[Id, Id, string], { last_rate: number }>(
      `SELECT last_rate FROM customer_item_prices
        WHERE customer_id = ? AND product_id = ? AND unit_name = ?`
    )
    .get(customerId, productId, unitName)
  return row?.last_rate ?? null
}
