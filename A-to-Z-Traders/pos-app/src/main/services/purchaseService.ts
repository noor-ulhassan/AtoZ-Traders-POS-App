import type {
  Id,
  PageWithTotals,
  Purchase,
  PurchaseFilters,
  PurchaseInput,
  PurchasePageTotals,
  PurchaseWithItems
} from '@shared/types'
import { today } from '@shared/date'
import { money, qty, sumMoney } from '@shared/money'
import { getDb } from '../db/connection'
import * as parties from '../repositories/partyRepository'
import * as products from '../repositories/productRepository'
import * as purchases from '../repositories/purchaseRepository'
import { businessRule, notFound } from '../utils/errors'
import { recordMovement, weightedAverageCost } from './inventoryService'
import { requireParty } from './partyService'
import { requireProduct, resolveUnit } from './productService'

export function listPurchases(
  filters: PurchaseFilters = {}
): PageWithTotals<Purchase, PurchasePageTotals> {
  return purchases.listPurchases(getDb(), filters)
}

export function getPurchase(id: Id): PurchaseWithItems {
  const db = getDb()
  const purchase = purchases.findPurchase(db, id)
  if (!purchase) throw notFound('Purchase')
  return { ...purchase, items: purchases.listItems(db, id) }
}

/**
 * Records a purchase: stock in, weighted-average cost recomputed per line, and
 * the unpaid portion added to the supplier's balance — all in one transaction
 * (Guide §1.5). Nothing here is valid on its own: if the ledger write fails,
 * the cost must not have moved either.
 */
export function createPurchase(input: PurchaseInput): PurchaseWithItems {
  const db = getDb()

  if (input.items.length === 0) {
    throw businessRule('Add at least one item to the purchase.')
  }

  const date = input.date ?? today()
  const supplierId = input.supplierId ?? null
  if (supplierId != null) requireParty(db, 'supplier', supplierId)

  // Resolve products and units before opening the transaction so a typo fails
  // fast with a clear message rather than mid-write.
  const lines = input.items.map((item) => {
    const product = requireProduct(db, item.productId)
    const unit = resolveUnit(db, product, item.unitName)
    const baseQty = qty(item.qty * unit.factor)

    if (baseQty <= 0) {
      throw businessRule(`Quantity for "${product.name}" must be more than zero.`)
    }

    // Cost is entered per chosen unit; the database stores it per base unit.
    const costPerBase = money(item.unitCost / unit.factor)
    return {
      product,
      unitName: unit.unitName,
      factor: unit.factor,
      qty: qty(item.qty),
      baseQty,
      costPerBase,
      amount: money(item.qty * item.unitCost)
    }
  })

  const subtotal = sumMoney(lines.map((line) => line.amount))
  const discount = money(input.discount ?? 0)
  if (discount > subtotal) {
    throw businessRule('The discount cannot be more than the purchase subtotal.')
  }

  const total = money(subtotal - discount)
  const paidAmount = money(input.paidAmount)
  if (paidAmount > total && supplierId == null) {
    throw businessRule('Paying more than the total requires a supplier to hold the advance.')
  }

  // Whatever is not paid now is owed to the supplier; with no supplier to
  // carry it, an unpaid amount would vanish instead of tracking as a debt.
  const unpaid = money(total - paidAmount)
  if (unpaid > 0 && supplierId == null) {
    throw businessRule('Select a supplier before leaving an amount unpaid.')
  }

  const create = db.transaction(() => {
    const purchaseId = purchases.insertPurchase(db, {
      supplierId,
      invoiceNo: input.invoiceNo ?? null,
      date,
      subtotal,
      discount,
      total,
      paidAmount,
      notes: input.notes ?? null
    })

    for (const line of lines) {
      purchases.insertPurchaseItem(db, {
        purchaseId,
        productId: line.product.id,
        unitName: line.unitName,
        factor: line.factor,
        qty: line.qty,
        baseQty: line.baseQty,
        costPrice: line.costPerBase,
        amount: line.amount
      })

      // Re-read inside the transaction: two lines of the same product must
      // each average against the running total, not the pre-purchase one.
      const current = requireProduct(db, line.product.id)
      const newAverage = weightedAverageCost(
        current.stockQty,
        current.costPrice,
        line.baseQty,
        line.costPerBase
      )
      products.setCostPrice(db, current.id, newAverage)

      recordMovement(db, {
        productId: current.id,
        changeQty: line.baseQty,
        reason: 'purchase',
        refTable: 'purchases',
        refId: purchaseId,
        costPrice: line.costPerBase,
        date,
        notes: null
      })
    }

    if (supplierId != null && unpaid !== 0) {
      parties.applyBalanceDelta(db, 'supplier', supplierId, unpaid)
    }

    return purchaseId
  })

  return getPurchase(create())
}
