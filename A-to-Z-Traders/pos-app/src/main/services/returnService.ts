import type {
  Id,
  PageWithTotals,
  PurchaseReturn,
  PurchaseReturnInput,
  PurchaseReturnWithItems,
  ReturnFilters,
  ReturnPageTotals,
  SaleReturn,
  SaleReturnInput,
  SaleReturnWithItems
} from '@shared/types'
import { today } from '@shared/date'
import { money, qty, sumMoney } from '@shared/money'
import { getDb } from '../db/connection'
import * as parties from '../repositories/partyRepository'
import * as returns from '../repositories/returnRepository'
import * as sales from '../repositories/saleRepository'
import { businessRule, notFound } from '../utils/errors'
import { recordMovement } from './inventoryService'
import { requireParty } from './partyService'
import { requireProduct, resolveUnit } from './productService'

// --------------------------------------------------------------- helpers

/** Total base quantity requested per product across a return's lines. */
function aggregateBaseQty(lines: { product: { id: Id }; baseQty: number }[]): Map<Id, number> {
  const totals = new Map<Id, number>()
  for (const line of lines) {
    totals.set(line.product.id, qty((totals.get(line.product.id) ?? 0) + line.baseQty))
  }
  return totals
}

/** The product behind an aggregated total, for a human-readable error. */
function productOf<P extends { id: Id }>(lines: { product: P }[], productId: Id): P {
  return lines.find((line) => line.product.id === productId)!.product
}

// ------------------------------------------------------------ sale returns

export function listSaleReturns(
  filters: ReturnFilters = {}
): PageWithTotals<SaleReturn, ReturnPageTotals> {
  return returns.listSaleReturns(getDb(), filters)
}

export function getSaleReturn(id: Id): SaleReturnWithItems {
  const db = getDb()
  const header = returns.findSaleReturn(db, id)
  if (!header) throw notFound('Sale return')
  return { ...header, items: returns.listSaleReturnItems(db, id) }
}

/**
 * Goods come back: stock in, profit reversed at the cost captured on the
 * original sale, and either cash refunded or the customer's khata reduced.
 *
 * When the return is linked to a sale we reuse that sale's frozen cost. That
 * is what makes the profit reversal exact — using today's average cost would
 * leave a phantom gain or loss behind whenever cost has moved since.
 */
export function createSaleReturn(input: SaleReturnInput): SaleReturnWithItems {
  const db = getDb()

  if (input.items.length === 0) {
    throw businessRule('Add at least one item to the return.')
  }

  const date = input.date ?? today()
  const saleId = input.saleId ?? null
  let customerId = input.customerId ?? null

  if (saleId != null) {
    const sale = sales.findSale(db, saleId)
    if (!sale) throw notFound('Sale')
    // The return follows the original bill's customer; a mismatch would put
    // the credit on the wrong khata.
    customerId = sale.customerId
  }

  if (customerId != null) requireParty(db, 'customer', customerId)

  if (input.refundType === 'credit' && customerId == null) {
    throw businessRule('Adjusting the khata needs a customer. Refund in cash instead.')
  }

  const lines = input.items.map((item) => {
    const product = requireProduct(db, item.productId)
    const unit = resolveUnit(db, product, item.unitName)
    const lineQty = qty(item.qty)
    const baseQty = qty(lineQty * unit.factor)

    // Consignment goods never had a cost to the shop, so there is no profit to
    // reverse — the same zero the sale line carried.
    const isOther = product.ownership === 'other'
    const costPrice = isOther
      ? 0
      : ((saleId != null
          ? returns.findOriginalSaleCost(db, saleId, product.id, unit.unitName)
          : null) ?? product.costPrice)

    return {
      product,
      unitName: unit.unitName,
      factor: unit.factor,
      qty: lineQty,
      baseQty,
      rate: money(item.rate),
      costPrice,
      isOther,
      amount: money(lineQty * item.rate)
    }
  })

  // Cap the return against what the bill still has left — aggregated per
  // product, so two lines of the same item (a carton and loose pieces, say)
  // cannot each look small enough to pass while their sum exceeds what was
  // sold. Checking line-by-line was the bug this replaces.
  if (saleId != null) {
    for (const [productId, need] of aggregateBaseQty(lines)) {
      const sold = returns.soldBaseQty(db, saleId, productId)
      const already = returns.returnedBaseQty(db, saleId, productId)
      if (qty(already + need) > sold) {
        const { name, baseUnit } = productOf(lines, productId)
        throw businessRule(
          `Only ${qty(sold - already)} ${baseUnit} of "${name}" are left to return on this bill.`
        )
      }
    }
  }

  const total = sumMoney(lines.map((line) => line.amount))
  const otherTotal = sumMoney(lines.filter((line) => line.isOther).map((line) => line.amount))

  const create = db.transaction(() => {
    const returnId = returns.insertSaleReturn(db, {
      saleId,
      customerId,
      date,
      total,
      otherTotal,
      refundType: input.refundType,
      notes: input.notes ?? null
    })

    for (const line of lines) {
      returns.insertSaleReturnItem(db, {
        saleReturnId: returnId,
        productId: line.product.id,
        unitName: line.unitName,
        factor: line.factor,
        qty: line.qty,
        baseQty: line.baseQty,
        rate: line.rate,
        costPrice: line.costPrice,
        isOther: line.isOther,
        amount: line.amount
      })

      recordMovement(db, {
        productId: line.product.id,
        changeQty: line.baseQty,
        reason: 'sale_return',
        refTable: 'sale_returns',
        refId: returnId,
        costPrice: line.costPrice,
        date,
        notes: null
      })
    }

    // A cash refund leaves the khata alone — the money went out of the drawer.
    if (input.refundType === 'credit' && customerId != null) {
      parties.applyBalanceDelta(db, 'customer', customerId, -total)
    }

    return returnId
  })

  return getSaleReturn(create())
}

// -------------------------------------------------------- purchase returns

export function listPurchaseReturns(
  filters: ReturnFilters = {}
): PageWithTotals<PurchaseReturn, ReturnPageTotals> {
  return returns.listPurchaseReturns(getDb(), filters)
}

export function getPurchaseReturn(id: Id): PurchaseReturnWithItems {
  const db = getDb()
  const header = returns.findPurchaseReturn(db, id)
  if (!header) throw notFound('Purchase return')
  return { ...header, items: returns.listPurchaseReturnItems(db, id) }
}

/**
 * Goods go back to the supplier: stock out and the payable reduced.
 *
 * Stock leaves at the current weighted-average cost by default, which keeps
 * the average unchanged — the correct behaviour when returning goods that
 * were bought at that average. An explicitly different cost is recorded on
 * the line but still does not re-derive the average; rebuilding an average
 * backwards from a partial return is guesswork, and a stock adjustment is the
 * honest tool for correcting a cost that is genuinely wrong.
 */
export function createPurchaseReturn(input: PurchaseReturnInput): PurchaseReturnWithItems {
  const db = getDb()

  if (input.items.length === 0) {
    throw businessRule('Add at least one item to the return.')
  }

  const date = input.date ?? today()
  const purchaseId = input.purchaseId ?? null
  const supplierId = input.supplierId ?? null
  if (supplierId != null) requireParty(db, 'supplier', supplierId)

  const lines = input.items.map((item) => {
    const product = requireProduct(db, item.productId)
    const unit = resolveUnit(db, product, item.unitName)
    const lineQty = qty(item.qty)
    const baseQty = qty(lineQty * unit.factor)

    const costPerBase =
      item.unitCost != null ? money(item.unitCost / unit.factor) : product.costPrice

    return {
      product,
      unitName: unit.unitName,
      factor: unit.factor,
      qty: lineQty,
      baseQty,
      costPerBase,
      amount: money(baseQty * costPerBase)
    }
  })

  // Aggregate per product before checking: duplicate lines of the same item
  // must not each pass a check their sum would fail. Stock may never be driven
  // below zero, and a return linked to a purchase cannot exceed what that bill
  // brought in (net of earlier returns against it).
  for (const [productId, need] of aggregateBaseQty(lines)) {
    const { name, baseUnit, stockQty } = productOf(lines, productId)
    if (need > qty(stockQty)) {
      throw businessRule(
        `Only ${stockQty} ${baseUnit} of "${name}" are in stock; the return needs ${need}.`
      )
    }
    if (purchaseId != null) {
      const purchased = returns.purchasedBaseQty(db, purchaseId, productId)
      const already = returns.returnedPurchaseBaseQty(db, purchaseId, productId)
      if (qty(already + need) > purchased) {
        throw businessRule(
          `Only ${qty(purchased - already)} ${baseUnit} of "${name}" are left to return on this purchase.`
        )
      }
    }
  }

  const total = sumMoney(lines.map((line) => line.amount))

  const create = db.transaction(() => {
    const returnId = returns.insertPurchaseReturn(db, {
      purchaseId,
      supplierId,
      date,
      total,
      notes: input.notes ?? null
    })

    for (const line of lines) {
      returns.insertPurchaseReturnItem(db, {
        purchaseReturnId: returnId,
        productId: line.product.id,
        unitName: line.unitName,
        factor: line.factor,
        qty: line.qty,
        baseQty: line.baseQty,
        costPrice: line.costPerBase,
        amount: line.amount
      })

      recordMovement(db, {
        productId: line.product.id,
        changeQty: -line.baseQty,
        reason: 'purchase_return',
        refTable: 'purchase_returns',
        refId: returnId,
        costPrice: line.costPerBase,
        date,
        notes: null
      })
    }

    if (supplierId != null) {
      parties.applyBalanceDelta(db, 'supplier', supplierId, -total)
    }

    return returnId
  })

  return getPurchaseReturn(create())
}
