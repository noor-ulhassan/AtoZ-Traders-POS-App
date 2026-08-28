import type {
  Id,
  OtherStockFilters,
  OtherStockMovementInput,
  OtherStockOwner,
  OtherStockReport,
  OtherStockRow
} from '@shared/types'
import { today } from '@shared/date'
import { money, qty } from '@shared/money'
import { getDb } from '../db/connection'
import { businessRule } from '../utils/errors'
import { recordMovement } from './inventoryService'
import { requireProduct, resolveUnit } from './productService'

/**
 * The consignment register.
 *
 * Goods the shop sells but does not own. The brief was "no calculations" —
 * meaning no cost, no profit, no stock value, none of which apply to somebody
 * else's property. What is left is the record: what arrived, what sold, what is
 * left, and what it was billed for. That is not a calculation, it is the sheet
 * the owner needs in hand the day the goods' owner comes to settle up.
 *
 * Intake deliberately does not go through purchases. A purchase would create a
 * supplier payable and a weighted-average cost, and neither exists here: no
 * money changed hands and the shop owes nothing until the goods actually sell.
 */

/** Throws unless the product is consignment stock. */
function requireOtherStock(productId: Id): ReturnType<typeof requireProduct> {
  const product = requireProduct(getDb(), productId)
  if (product.ownership !== 'other') {
    throw businessRule(
      `"${product.name}" is your own stock. Use a purchase or a stock adjustment for it.`
    )
  }
  return product
}

/** Goods arriving from their owner. No money moves and no balance is touched. */
export function receiveOtherStock(input: OtherStockMovementInput): {
  productId: Id
  stockQty: number
} {
  const db = getDb()
  const product = requireOtherStock(input.productId)
  const unit = resolveUnit(db, product, input.unitName ?? product.baseUnit)
  const baseQty = qty(input.qty * unit.factor)

  if (baseQty <= 0) {
    throw businessRule('Enter how many units came in.')
  }

  db.transaction(() => {
    recordMovement(db, {
      productId: product.id,
      changeQty: baseQty,
      reason: 'other_in',
      refTable: 'products',
      refId: product.id,
      // No cost: the shop did not buy these, and a number here would find its
      // way into a valuation sooner or later.
      costPrice: 0,
      date: input.date ?? today(),
      notes: input.notes ?? `Received from ${product.ownerName}`
    })
  })()

  return { productId: product.id, stockQty: qty(product.stockQty + baseQty) }
}

/** Unsold goods going back to their owner. */
export function returnOtherStock(input: OtherStockMovementInput): {
  productId: Id
  stockQty: number
} {
  const db = getDb()
  const product = requireOtherStock(input.productId)
  const unit = resolveUnit(db, product, input.unitName ?? product.baseUnit)
  const baseQty = qty(input.qty * unit.factor)

  if (baseQty <= 0) {
    throw businessRule('Enter how many units are going back.')
  }

  const remaining = qty(product.stockQty - baseQty)
  if (remaining < 0) {
    throw businessRule(
      `Only ${product.stockQty} ${product.baseUnit} of "${product.name}" are on the shelf; you cannot return ${baseQty}.`
    )
  }

  db.transaction(() => {
    recordMovement(db, {
      productId: product.id,
      changeQty: -baseQty,
      reason: 'other_out',
      refTable: 'products',
      refId: product.id,
      costPrice: 0,
      date: input.date ?? today(),
      notes: input.notes ?? `Returned to ${product.ownerName}`
    })
  })()

  return { productId: product.id, stockQty: remaining }
}

interface RegisterRow {
  product_id: number
  product_name: string
  sku: string | null
  owner_name: string
  base_unit: string
  sale_price: number
  stock_qty: number
  received: number | null
  sold: number | null
  returned_to_owner: number | null
  returned_by_customer: number | null
  billed: number | null
  refunded: number | null
}

/**
 * What has happened to every consignment product.
 *
 * Quantities come from the stock ledger, which is the source of truth, so the
 * register cannot disagree with the stock screen. Amounts come from the frozen
 * `is_other` lines rather than from today's product prices, so a price change
 * tomorrow does not restate what was billed yesterday.
 *
 * A date range narrows the movement and billing figures but never `onHand`,
 * which is a fact about the shelf right now and belongs to no period.
 */
export function getReport(filters: OtherStockFilters = {}): OtherStockReport {
  const db = getDb()
  const from = filters.from ?? '0000-01-01'
  const to = filters.to ?? '9999-12-31'

  const clauses = ["p.ownership = 'other'"]
  const params: Record<string, unknown> = { from, to }

  if (filters.ownerName) {
    clauses.push('p.owner_name = @ownerName')
    params.ownerName = filters.ownerName
  }
  if (filters.search) {
    clauses.push('(p.name LIKE @search OR p.sku LIKE @search OR p.owner_name LIKE @search)')
    params.search = `%${filters.search.trim()}%`
  }

  const rows = db
    .prepare<Record<string, unknown>, RegisterRow>(
      `SELECT p.id            AS product_id,
              p.name          AS product_name,
              p.sku           AS sku,
              p.owner_name    AS owner_name,
              p.base_unit     AS base_unit,
              p.sale_price    AS sale_price,
              p.stock_qty     AS stock_qty,
              (SELECT SUM(m.change_qty) FROM stock_movements m
                WHERE m.product_id = p.id AND m.reason = 'other_in'
                  AND m.date BETWEEN @from AND @to)          AS received,
              (SELECT -SUM(m.change_qty) FROM stock_movements m
                WHERE m.product_id = p.id AND m.reason = 'sale'
                  AND m.date BETWEEN @from AND @to)          AS sold,
              (SELECT -SUM(m.change_qty) FROM stock_movements m
                WHERE m.product_id = p.id AND m.reason = 'other_out'
                  AND m.date BETWEEN @from AND @to)          AS returned_to_owner,
              (SELECT SUM(m.change_qty) FROM stock_movements m
                WHERE m.product_id = p.id AND m.reason = 'sale_return'
                  AND m.date BETWEEN @from AND @to)          AS returned_by_customer,
              (SELECT SUM(si.amount) FROM sale_items si
                 JOIN sales s ON s.id = si.sale_id
                WHERE si.product_id = p.id AND si.is_other = 1
                  AND s.date BETWEEN @from AND @to)          AS billed,
              (SELECT SUM(i.amount) FROM sale_return_items i
                 JOIN sale_returns r ON r.id = i.sale_return_id
                WHERE i.product_id = p.id AND i.is_other = 1
                  AND r.date BETWEEN @from AND @to)          AS refunded
         FROM products p
        WHERE ${clauses.join(' AND ')}
        ORDER BY p.owner_name COLLATE NOCASE, p.name COLLATE NOCASE`
    )
    .all(params)
    .map<OtherStockRow>((row) => ({
      productId: row.product_id,
      productName: row.product_name,
      sku: row.sku,
      ownerName: row.owner_name,
      baseUnit: row.base_unit,
      received: qty(row.received ?? 0),
      sold: qty(row.sold ?? 0),
      returnedToOwner: qty(row.returned_to_owner ?? 0),
      returnedByCustomer: qty(row.returned_by_customer ?? 0),
      onHand: qty(row.stock_qty),
      // Net of what customers brought back — the figure to settle on.
      billedAmount: money((row.billed ?? 0) - (row.refunded ?? 0)),
      salePrice: money(row.sale_price)
    }))

  const byOwner = new Map<string, OtherStockOwner>()
  for (const row of rows) {
    const existing = byOwner.get(row.ownerName) ?? {
      ownerName: row.ownerName,
      productCount: 0,
      received: 0,
      sold: 0,
      returnedToOwner: 0,
      onHand: 0,
      billedAmount: 0
    }

    byOwner.set(row.ownerName, {
      ownerName: row.ownerName,
      productCount: existing.productCount + 1,
      received: qty(existing.received + row.received),
      sold: qty(existing.sold + row.sold),
      returnedToOwner: qty(existing.returnedToOwner + row.returnedToOwner),
      onHand: qty(existing.onHand + row.onHand),
      billedAmount: money(existing.billedAmount + row.billedAmount)
    })
  }

  const owners = [...byOwner.values()].sort((a, b) => a.ownerName.localeCompare(b.ownerName))

  return {
    from: filters.from ?? null,
    to: filters.to ?? null,
    rows,
    owners,
    totals: {
      productCount: rows.length,
      ownerCount: owners.length,
      onHand: qty(rows.reduce((sum, row) => sum + row.onHand, 0)),
      billedAmount: money(rows.reduce((sum, row) => sum + row.billedAmount, 0))
    }
  }
}

/** The distinct owners on record, for the filter on the register screen. */
export function listOwners(): string[] {
  return getDb()
    .prepare<[], { owner_name: string }>(
      `SELECT DISTINCT owner_name FROM products
        WHERE ownership = 'other' AND owner_name <> ''
        ORDER BY owner_name COLLATE NOCASE`
    )
    .all()
    .map((row) => row.owner_name)
}
