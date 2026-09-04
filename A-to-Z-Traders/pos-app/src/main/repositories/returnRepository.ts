import type {
  Id,
  PageWithTotals,
  PurchaseReturn,
  PurchaseReturnItem,
  RefundType,
  ReturnFilters,
  ReturnPageTotals,
  SaleReturn,
  SaleReturnItem
} from '@shared/types'
import { money, qty } from '@shared/money'
import { DEFAULT_PAGE_SIZE } from '@shared/pagination'
import type { Db } from '../db/connection'
import { fromBool, toBool, toText } from '../db/rows'

// ------------------------------------------------------------ sale returns

interface SaleReturnRow {
  id: number
  sale_id: number | null
  sale_invoice_no: string | null
  customer_id: number | null
  customer_name: string | null
  date: string
  total: number
  other_total: number
  refund_type: RefundType
  notes: string | null
  created_at: string
}

interface SaleReturnItemRow {
  id: number
  sale_return_id: number
  product_id: number
  product_name: string
  unit_name: string
  factor: number
  qty: number
  base_qty: number
  rate: number
  cost_price: number
  is_other: number
  amount: number
}

const toSaleReturn = (row: SaleReturnRow): SaleReturn => ({
  id: row.id,
  saleId: row.sale_id,
  saleInvoiceNo: row.sale_invoice_no,
  customerId: row.customer_id,
  customerName: row.customer_name,
  date: row.date,
  total: row.total,
  otherTotal: row.other_total,
  refundType: row.refund_type,
  notes: toText(row.notes),
  createdAt: row.created_at
})

const SELECT_SALE_RETURN = `
  SELECT sr.*, s.invoice_no AS sale_invoice_no, c.name AS customer_name
    FROM sale_returns sr
    LEFT JOIN sales s ON s.id = sr.sale_id
    LEFT JOIN customers c ON c.id = sr.customer_id
`

function buildFilter(
  filters: ReturnFilters,
  partyColumn: string,
  alias: string
): {
  where: string
  params: unknown[]
} {
  const clauses: string[] = []
  const params: unknown[] = []

  if (filters.from) {
    clauses.push(`${alias}.date >= ?`)
    params.push(filters.from)
  }
  if (filters.to) {
    clauses.push(`${alias}.date <= ?`)
    params.push(filters.to)
  }
  if (filters.partyId != null) {
    clauses.push(`${alias}.${partyColumn} = ?`)
    params.push(filters.partyId)
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export function listSaleReturns(
  db: Db,
  filters: ReturnFilters = {}
): PageWithTotals<SaleReturn, ReturnPageTotals> {
  const { where, params } = buildFilter(filters, 'customer_id', 'sr')
  const limit = filters.limit ?? DEFAULT_PAGE_SIZE
  const offset = filters.offset ?? 0

  const rows = db
    .prepare<unknown[], SaleReturnRow>(
      `${SELECT_SALE_RETURN} ${where} ORDER BY sr.date DESC, sr.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)

  const summary = db
    .prepare<unknown[], { total: number; sum_total: number | null; cash: number | null }>(
      `SELECT COUNT(*)     AS total,
              SUM(sr.total) AS sum_total,
              SUM(CASE WHEN sr.refund_type = 'cash' THEN sr.total END) AS cash
         FROM sale_returns sr ${where}`
    )
    .get(...params)

  return {
    rows: rows.map(toSaleReturn),
    total: summary?.total ?? 0,
    totals: {
      total: money(summary?.sum_total ?? 0),
      cashRefunds: money(summary?.cash ?? 0)
    }
  }
}

export function findSaleReturn(db: Db, id: Id): SaleReturn | null {
  const row = db.prepare<[Id], SaleReturnRow>(`${SELECT_SALE_RETURN} WHERE sr.id = ?`).get(id)
  return row ? toSaleReturn(row) : null
}

export function listSaleReturnItems(db: Db, saleReturnId: Id): SaleReturnItem[] {
  return db
    .prepare<[Id], SaleReturnItemRow>(
      `SELECT i.*, p.name AS product_name
         FROM sale_return_items i
         JOIN products p ON p.id = i.product_id
        WHERE i.sale_return_id = ?
        ORDER BY i.id`
    )
    .all(saleReturnId)
    .map((row) => ({
      id: row.id,
      saleReturnId: row.sale_return_id,
      productId: row.product_id,
      productName: row.product_name,
      unitName: row.unit_name,
      factor: row.factor,
      qty: row.qty,
      baseQty: row.base_qty,
      rate: row.rate,
      costPrice: row.cost_price,
      isOther: toBool(row.is_other),
      amount: row.amount
    }))
}

export function insertSaleReturn(
  db: Db,
  fields: {
    saleId: Id | null
    customerId: Id | null
    date: string
    total: number
    /** The part of `total` that was consignment stock. */
    otherTotal: number
    refundType: RefundType
    notes: string | null
  }
): Id {
  const info = db
    .prepare(
      `INSERT INTO sale_returns
         (sale_id, customer_id, date, total, other_total, refund_type, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      fields.saleId,
      fields.customerId,
      fields.date,
      money(fields.total),
      money(fields.otherTotal),
      fields.refundType,
      fields.notes
    )
  return Number(info.lastInsertRowid)
}

export function insertSaleReturnItem(
  db: Db,
  fields: {
    saleReturnId: Id
    productId: Id
    unitName: string
    factor: number
    qty: number
    baseQty: number
    rate: number
    costPrice: number
    isOther: boolean
    amount: number
  }
): void {
  db.prepare(
    `INSERT INTO sale_return_items
       (sale_return_id, product_id, unit_name, factor, qty, base_qty, rate,
        cost_price, is_other, amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    fields.saleReturnId,
    fields.productId,
    fields.unitName,
    fields.factor,
    qty(fields.qty),
    qty(fields.baseQty),
    money(fields.rate),
    money(fields.costPrice),
    fromBool(fields.isOther),
    money(fields.amount)
  )
}

/** The cost frozen onto the original sale line, so profit reverses exactly. */
export function findOriginalSaleCost(
  db: Db,
  saleId: Id,
  productId: Id,
  unitName: string
): number | null {
  const row = db
    .prepare<[Id, Id, string], { cost_price: number }>(
      `SELECT cost_price FROM sale_items
        WHERE sale_id = ? AND product_id = ? AND unit_name = ?
        ORDER BY id LIMIT 1`
    )
    .get(saleId, productId, unitName)
  return row?.cost_price ?? null
}

/** Base quantity already returned against a sale line, to cap over-returns. */
export function returnedBaseQty(db: Db, saleId: Id, productId: Id): number {
  const row = db
    .prepare<[Id, Id], { total: number | null }>(
      `SELECT SUM(i.base_qty) AS total
         FROM sale_return_items i
         JOIN sale_returns r ON r.id = i.sale_return_id
        WHERE r.sale_id = ? AND i.product_id = ?`
    )
    .get(saleId, productId)
  return qty(row?.total ?? 0)
}

export function soldBaseQty(db: Db, saleId: Id, productId: Id): number {
  const row = db
    .prepare<[Id, Id], { total: number | null }>(
      'SELECT SUM(base_qty) AS total FROM sale_items WHERE sale_id = ? AND product_id = ?'
    )
    .get(saleId, productId)
  return qty(row?.total ?? 0)
}

/**
 * True once anything has been returned against a bill.
 *
 * Editing or voiding underneath a return would corrupt both: a return captures
 * the cost from the original line and caps itself against what that bill sold,
 * so rewriting the bill leaves the return quoting a line that no longer
 * exists. Both operations refuse while one is on file.
 */
export function hasReturnsForSale(db: Db, saleId: Id): boolean {
  const row = db
    .prepare<[Id], { present: number }>(
      'SELECT EXISTS(SELECT 1 FROM sale_returns WHERE sale_id = ?) AS present'
    )
    .get(saleId)
  return row?.present === 1
}

// -------------------------------------------------------- purchase returns

/** Base quantity a purchase brought in for a product, to cap over-returns. */
export function purchasedBaseQty(db: Db, purchaseId: Id, productId: Id): number {
  const row = db
    .prepare<[Id, Id], { total: number | null }>(
      'SELECT SUM(base_qty) AS total FROM purchase_items WHERE purchase_id = ? AND product_id = ?'
    )
    .get(purchaseId, productId)
  return qty(row?.total ?? 0)
}

/** Base quantity already returned against a purchase line. */
export function returnedPurchaseBaseQty(db: Db, purchaseId: Id, productId: Id): number {
  const row = db
    .prepare<[Id, Id], { total: number | null }>(
      `SELECT SUM(i.base_qty) AS total
         FROM purchase_return_items i
         JOIN purchase_returns r ON r.id = i.purchase_return_id
        WHERE r.purchase_id = ? AND i.product_id = ?`
    )
    .get(purchaseId, productId)
  return qty(row?.total ?? 0)
}

interface PurchaseReturnRow {
  id: number
  purchase_id: number | null
  purchase_invoice_no: string | null
  supplier_id: number | null
  supplier_name: string | null
  date: string
  total: number
  notes: string | null
  created_at: string
}

interface PurchaseReturnItemRow {
  id: number
  purchase_return_id: number
  product_id: number
  product_name: string
  unit_name: string
  factor: number
  qty: number
  base_qty: number
  cost_price: number
  amount: number
}

const toPurchaseReturn = (row: PurchaseReturnRow): PurchaseReturn => ({
  id: row.id,
  purchaseId: row.purchase_id,
  purchaseInvoiceNo: row.purchase_invoice_no,
  supplierId: row.supplier_id,
  supplierName: row.supplier_name,
  date: row.date,
  total: row.total,
  notes: toText(row.notes),
  createdAt: row.created_at
})

const SELECT_PURCHASE_RETURN = `
  SELECT pr.*, pu.invoice_no AS purchase_invoice_no, s.name AS supplier_name
    FROM purchase_returns pr
    LEFT JOIN purchases pu ON pu.id = pr.purchase_id
    LEFT JOIN suppliers s ON s.id = pr.supplier_id
`

export function listPurchaseReturns(
  db: Db,
  filters: ReturnFilters = {}
): PageWithTotals<PurchaseReturn, ReturnPageTotals> {
  const { where, params } = buildFilter(filters, 'supplier_id', 'pr')
  const limit = filters.limit ?? DEFAULT_PAGE_SIZE
  const offset = filters.offset ?? 0

  const rows = db
    .prepare<unknown[], PurchaseReturnRow>(
      `${SELECT_PURCHASE_RETURN} ${where} ORDER BY pr.date DESC, pr.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)

  const summary = db
    .prepare<unknown[], { total: number; sum_total: number | null }>(
      `SELECT COUNT(*) AS total, SUM(pr.total) AS sum_total FROM purchase_returns pr ${where}`
    )
    .get(...params)

  return {
    rows: rows.map(toPurchaseReturn),
    total: summary?.total ?? 0,
    // Goods returned to a supplier reduce a payable; there is no cash refund
    // to report, so the field stays 0 rather than pretending to a number.
    totals: { total: money(summary?.sum_total ?? 0), cashRefunds: 0 }
  }
}

export function findPurchaseReturn(db: Db, id: Id): PurchaseReturn | null {
  const row = db
    .prepare<[Id], PurchaseReturnRow>(`${SELECT_PURCHASE_RETURN} WHERE pr.id = ?`)
    .get(id)
  return row ? toPurchaseReturn(row) : null
}

export function listPurchaseReturnItems(db: Db, purchaseReturnId: Id): PurchaseReturnItem[] {
  return db
    .prepare<[Id], PurchaseReturnItemRow>(
      `SELECT i.*, p.name AS product_name
         FROM purchase_return_items i
         JOIN products p ON p.id = i.product_id
        WHERE i.purchase_return_id = ?
        ORDER BY i.id`
    )
    .all(purchaseReturnId)
    .map((row) => ({
      id: row.id,
      purchaseReturnId: row.purchase_return_id,
      productId: row.product_id,
      productName: row.product_name,
      unitName: row.unit_name,
      factor: row.factor,
      qty: row.qty,
      baseQty: row.base_qty,
      costPrice: row.cost_price,
      amount: row.amount
    }))
}

export function insertPurchaseReturn(
  db: Db,
  fields: {
    purchaseId: Id | null
    supplierId: Id | null
    date: string
    total: number
    notes: string | null
  }
): Id {
  const info = db
    .prepare(
      `INSERT INTO purchase_returns (purchase_id, supplier_id, date, total, notes)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(fields.purchaseId, fields.supplierId, fields.date, money(fields.total), fields.notes)
  return Number(info.lastInsertRowid)
}

export function insertPurchaseReturnItem(
  db: Db,
  fields: {
    purchaseReturnId: Id
    productId: Id
    unitName: string
    factor: number
    qty: number
    baseQty: number
    costPrice: number
    amount: number
  }
): void {
  db.prepare(
    `INSERT INTO purchase_return_items
       (purchase_return_id, product_id, unit_name, factor, qty, base_qty, cost_price, amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    fields.purchaseReturnId,
    fields.productId,
    fields.unitName,
    fields.factor,
    qty(fields.qty),
    qty(fields.baseQty),
    money(fields.costPrice),
    money(fields.amount)
  )
}
