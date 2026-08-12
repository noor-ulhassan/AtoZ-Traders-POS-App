import type {
  Id,
  Page,
  StockAdjustmentInput,
  StockMovement,
  StockMovementFilters
} from '@shared/types'
import { today } from '@shared/date'
import { money, qty } from '@shared/money'
import type { Db } from '../db/connection'
import { getDb } from '../db/connection'
import * as products from '../repositories/productRepository'
import * as stock from '../repositories/stockRepository'
import type { MovementInput } from '../repositories/stockRepository'
import { businessRule } from '../utils/errors'
import { logger } from '../utils/logger'
import { requireProduct } from './productService'

const log = logger.child('inventory')

/**
 * Writes a stock movement and moves the cached total with it.
 *
 * Every module that changes stock goes through here, so the invariant
 * "products.stock_qty == SUM(stock_movements.change_qty)" has exactly one
 * place it can be broken — and it is not broken here. The caller must already
 * be inside a transaction.
 */
export function recordMovement(db: Db, input: MovementInput): Id {
  const id = stock.insertMovement(db, input)
  products.applyStockDelta(db, input.productId, qty(input.changeQty))
  return id
}

/**
 * Recomputes the weighted-average cost after stock comes in (Guide §4).
 *
 *   new_avg = (stock_qty * cost_price + qty_in * cost_in) / (stock_qty + qty_in)
 *
 * Returns the current cost unchanged when the denominator is zero, and falls
 * back to the incoming cost when the product had no stock at all — otherwise
 * a product that went to zero would keep its stale historical cost forever.
 */
export function weightedAverageCost(
  currentQty: number,
  currentCost: number,
  incomingQty: number,
  incomingCost: number
): number {
  const totalQty = currentQty + incomingQty
  if (totalQty <= 0) return money(incomingCost)
  if (currentQty <= 0) return money(incomingCost)
  return money((currentQty * currentCost + incomingQty * incomingCost) / totalQty)
}

export function adjustStock(input: StockAdjustmentInput): { productId: Id; stockQty: number } {
  const db = getDb()
  const product = requireProduct(db, input.productId)
  const change = qty(input.changeQty)

  const resulting = qty(product.stockQty + change)
  if (resulting < 0) {
    throw businessRule(
      `That adjustment would leave ${product.name} at ${resulting} ${product.baseUnit}. Stock cannot go below zero.`
    )
  }

  db.transaction(() => {
    recordMovement(db, {
      productId: product.id,
      changeQty: change,
      reason: 'adjustment',
      refTable: 'products',
      refId: product.id,
      costPrice: product.costPrice,
      date: input.date ?? today(),
      notes: input.notes ?? null
    })
  })()

  return { productId: product.id, stockQty: resulting }
}

export function listMovements(filters: StockMovementFilters = {}): Page<StockMovement> {
  return stock.listMovements(getDb(), filters)
}

/**
 * Repairs any drift between the cached total and the movement ledger.
 *
 * Runs once at startup. The ledger always wins. Drift should be impossible,
 * so anything found here is logged loudly — it means a bug slipped a write
 * past `recordMovement`.
 */
export function reconcileStockCache(db: Db): number {
  const drift = stock.findStockDrift(db)
  if (drift.length === 0) return 0

  log.error(`stock cache drift on ${drift.length} product(s); rebuilding from movements`, drift)
  db.transaction(() => {
    for (const row of drift) stock.setCachedStock(db, row.productId, row.actual)
  })()
  return drift.length
}
