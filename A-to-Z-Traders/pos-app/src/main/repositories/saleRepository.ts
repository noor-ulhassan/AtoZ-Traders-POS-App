import type {
  Id,
  PageWithTotals,
  PaymentType,
  Sale,
  SaleFilters,
  SaleItem,
  SalePageTotals,
  SaleRevision,
  SaleRevisionAction,
  SaleRevisionSnapshot
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
  voided_at: string | null
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
  createdAt: row.created_at,
  voidedAt: row.voided_at
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

// ------------------------------------------------------- editing a bill

/**
 * Re-states a saved bill's header. The invoice number is deliberately absent:
 * an edited bill keeps the number that was printed and handed to the customer,
 * so there is exactly one piece of paper per number, always.
 */
export function updateSaleHeader(
  db: Db,
  id: Id,
  fields: Omit<SaleHeaderFields, 'invoiceNo'>
): void {
  db.prepare(
    `UPDATE sales
        SET customer_id = ?, date = ?, subtotal = ?, other_subtotal = ?, discount = ?,
            tax = ?, total = ?, paid_amount = ?, payment_type = ?, notes = ?
      WHERE id = ?`
  ).run(
    fields.customerId,
    fields.date,
    money(fields.subtotal),
    money(fields.otherSubtotal),
    money(fields.discount),
    money(fields.tax),
    money(fields.total),
    money(fields.paidAmount),
    fields.paymentType,
    fields.notes,
    id
  )
}

/** The settle path: money only, nothing about the goods. */
export function updateSalePayment(
  db: Db,
  id: Id,
  paidAmount: number,
  paymentType: PaymentType
): void {
  db.prepare('UPDATE sales SET paid_amount = ?, payment_type = ? WHERE id = ?').run(
    money(paidAmount),
    paymentType,
    id
  )
}

export function deleteSaleItems(db: Db, saleId: Id): void {
  db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(saleId)
}

/** Stamps the cancellation. The caller has already zeroed the figures. */
export function markVoided(db: Db, id: Id): void {
  db.prepare("UPDATE sales SET voided_at = datetime('now','localtime') WHERE id = ?").run(id)
}

/** Bills that have been cancelled, so the two COUNT aggregates can skip them. */
export function isVoided(db: Db, id: Id): boolean {
  const row = db
    .prepare<[Id], { voided: number }>(
      'SELECT (voided_at IS NOT NULL) AS voided FROM sales WHERE id = ?'
    )
    .get(id)
  return row?.voided === 1
}

// ------------------------------------------------------ revision history

interface SaleRevisionRow {
  id: number
  sale_id: number
  revision: number
  action: SaleRevisionAction
  changed_by: string
  reason: string | null
  snapshot: string
  created_at: string
}

export interface SaleRevisionFields {
  saleId: Id
  action: SaleRevisionAction
  changedBy: string
  reason: string | null
  snapshot: SaleRevisionSnapshot
}

/**
 * Files the bill as it stood before a change.
 *
 * The revision number is read inside the caller's transaction, exactly like
 * `nextInvoiceNo` — SQLite's writer lock is what makes that safe.
 */
export function insertRevision(db: Db, fields: SaleRevisionFields): Id {
  const previous = db
    .prepare<[Id], { highest: number | null }>(
      'SELECT MAX(revision) AS highest FROM sale_revisions WHERE sale_id = ?'
    )
    .get(fields.saleId)

  const info = db
    .prepare(
      `INSERT INTO sale_revisions (sale_id, revision, action, changed_by, reason, snapshot)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      fields.saleId,
      (previous?.highest ?? 0) + 1,
      fields.action,
      fields.changedBy,
      fields.reason,
      JSON.stringify(fields.snapshot)
    )
  return Number(info.lastInsertRowid)
}

export function listRevisions(db: Db, saleId: Id): SaleRevision[] {
  return db
    .prepare<[Id], SaleRevisionRow>(
      `SELECT * FROM sale_revisions WHERE sale_id = ? ORDER BY revision DESC`
    )
    .all(saleId)
    .map((row) => ({
      id: row.id,
      saleId: row.sale_id,
      revision: row.revision,
      action: row.action,
      changedBy: row.changed_by,
      reason: toText(row.reason),
      snapshot: JSON.parse(row.snapshot) as SaleRevisionSnapshot,
      createdAt: row.created_at
    }))
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
