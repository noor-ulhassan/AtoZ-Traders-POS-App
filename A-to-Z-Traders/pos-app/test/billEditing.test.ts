import { beforeEach, describe, expect, it } from 'vitest'
import type { Customer, Product } from '@shared/types'
import type { Db } from '../src/main/db/connection'
import { createTestDb } from './helpers/database'
import { findStockDrift, sumMovements } from '../src/main/repositories/stockRepository'
import { computeBalance, getStatement } from '../src/main/services/ledgerService'
import * as dashboardService from '../src/main/services/dashboardService'
import * as otherStockService from '../src/main/services/otherStockService'
import * as partyService from '../src/main/services/partyService'
import * as productService from '../src/main/services/productService'
import * as purchaseService from '../src/main/services/purchaseService'
import * as reportService from '../src/main/services/reportService'
import * as returnService from '../src/main/services/returnService'
import * as salesService from '../src/main/services/salesService'
import { today } from '../src/shared/date'

/**
 * Phase 4 — changing a bill after it has been issued.
 *
 * The client's fourth request, and the one with the most ways to go quietly
 * wrong: a bill that is rewritten has to take back exactly what it took, from
 * the shelf and from the khata, before it puts anything new there. Most of
 * what follows checks that the reversal is exact rather than approximately
 * right — the two reconcilers in `bootstrapDatabase()` are asserted at the end
 * of the heavier cases, because a Phase 4 bug is precisely the kind that would
 * show up as "drift repaired" in a log nobody reads.
 */

let db: Db
let customer: Customer
let product: Product

/** A shop with one customer and 100 units bought at 100 each. */
function seed(): void {
  customer = partyService.addParty('customer', { name: 'Karim General Store' })
  product = productService.addProduct({
    name: 'Detergent 1kg',
    baseUnit: 'piece',
    costPrice: 0,
    salePrice: 150,
    reorderLevel: 10,
    units: [{ unitName: 'carton', factor: 12, salePrice: 1700 }]
  })

  purchaseService.createPurchase({
    items: [{ productId: product.id, unitName: 'piece', qty: 100, unitCost: 100 }],
    paidAmount: 10000
  })

  product = productService.getProduct(product.id)
}

/** A credit bill: 10 pieces at 150, nothing paid. */
function creditBill(): number {
  return salesService.createSale({
    customerId: customer.id,
    items: [{ productId: product.id, unitName: 'piece', qty: 10, rate: 150 }],
    paymentType: 'credit',
    paidAmount: 0
  }).sale.id
}

/** What the launch-time reconcilers would find. Both must always be empty. */
function drift(): { stock: number; balance: number } {
  return {
    stock: findStockDrift(db).length,
    balance: Math.abs(
      computeBalance(db, 'customer', customer.id) -
        partyService.getParty('customer', customer.id).currentBalance
    )
  }
}

beforeEach(() => {
  db = createTestDb()
  seed()
})

// ===========================================================================
// 4a — settling a delivered bill
// ===========================================================================

describe('settling a bill', () => {
  it('records the money that came back with the delivery and clears the khata', () => {
    const saleId = creditBill()
    expect(partyService.getParty('customer', customer.id).currentBalance).toBe(1500)

    const settled = salesService.settleSale({ id: saleId, paidAmount: 1500 })

    expect(settled.paidAmount).toBe(1500)
    expect(settled.paymentType).toBe('cash')
    expect(partyService.getParty('customer', customer.id).currentBalance).toBe(0)
    expect(drift()).toEqual({ stock: 0, balance: 0 })
  })

  it('moves cash in hand by what was actually received', () => {
    const before = dashboardService.getSummary({ from: today(), to: today() }).cashInHand
    const saleId = creditBill()

    salesService.settleSale({ id: saleId, paidAmount: 900 })

    const after = dashboardService.getSummary({ from: today(), to: today() }).cashInHand
    expect(after - before).toBe(900)
  })

  it('leaves the remainder on the khata for a part payment', () => {
    const saleId = creditBill()

    const settled = salesService.settleSale({ id: saleId, paidAmount: 600 })

    expect(settled.paymentType).toBe('partial')
    expect(partyService.getParty('customer', customer.id).currentBalance).toBe(900)
    expect(drift()).toEqual({ stock: 0, balance: 0 })
  })

  it('corrects the khata when a payment is revised downwards', () => {
    const saleId = creditBill()
    salesService.settleSale({ id: saleId, paidAmount: 1500 })

    salesService.settleSale({ id: saleId, paidAmount: 400 })

    expect(partyService.getParty('customer', customer.id).currentBalance).toBe(1100)
    expect(drift()).toEqual({ stock: 0, balance: 0 })
  })

  it('never touches the goods', () => {
    const saleId = creditBill()

    salesService.settleSale({ id: saleId, paidAmount: 1500 })

    expect(productService.getProduct(product.id).stockQty).toBe(90)
    expect(salesService.getSale(saleId).items).toHaveLength(1)
  })

  it('refuses more than the bill is for', () => {
    const saleId = creditBill()
    expect(() => salesService.settleSale({ id: saleId, paidAmount: 1600 })).toThrow(
      /more than the bill total/i
    )
  })

  it('refuses a negative amount', () => {
    const saleId = creditBill()
    expect(() => salesService.settleSale({ id: saleId, paidAmount: -5 })).toThrow(/negative/i)
  })

  it('refuses to leave a balance on a walk-in bill, which has no khata', () => {
    const walkIn = salesService.createSale({
      items: [{ productId: product.id, unitName: 'piece', qty: 2, rate: 150 }],
      paymentType: 'cash',
      paidAmount: 300
    }).sale.id

    expect(() => salesService.settleSale({ id: walkIn, paidAmount: 100 })).toThrow(/walk-in/i)
  })

  it('files the bill as it was, and files nothing when nothing changed', () => {
    const saleId = creditBill()

    salesService.settleSale({ id: saleId, paidAmount: 1500, reason: 'Paid on delivery' })
    const history = salesService.listSaleRevisions(saleId)

    expect(history).toHaveLength(1)
    expect(history[0].action).toBe('settle')
    expect(history[0].reason).toBe('Paid on delivery')
    expect(history[0].snapshot.paidAmount).toBe(0)
    expect(history[0].snapshot.paymentType).toBe('credit')

    salesService.settleSale({ id: saleId, paidAmount: 1500 })
    expect(salesService.listSaleRevisions(saleId)).toHaveLength(1)
  })
})

// ===========================================================================
// 4b — editing a bill
// ===========================================================================

describe('editing a bill', () => {
  it('keeps the invoice number it was issued under', () => {
    const saleId = creditBill()
    const invoiceNo = salesService.getSale(saleId).invoiceNo

    const { sale } = salesService.updateSale({
      id: saleId,
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 8, rate: 150 }],
      paymentType: 'credit',
      paidAmount: 0
    })

    expect(sale.invoiceNo).toBe(invoiceNo)
    expect(salesService.peekNextInvoiceNo()).toBe('INV-000002')
  })

  it('moves stock by the difference, not by the whole bill', () => {
    const saleId = creditBill()
    expect(productService.getProduct(product.id).stockQty).toBe(90)

    salesService.updateSale({
      id: saleId,
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 8, rate: 150 }],
      paymentType: 'credit',
      paidAmount: 0
    })

    expect(productService.getProduct(product.id).stockQty).toBe(92)
    expect(sumMovements(db, product.id)).toBe(92)
    expect(drift()).toEqual({ stock: 0, balance: 0 })
  })

  it('re-bills the whole shelf, because the reversal happens first', () => {
    // 100 in stock; a bill for all 100 can be re-saved for all 100 without
    // the stock check seeing the original bill's own deduction.
    const saleId = salesService.createSale({
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 100, rate: 150 }],
      paymentType: 'credit',
      paidAmount: 0
    }).sale.id

    const { sale } = salesService.updateSale({
      id: saleId,
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 100, rate: 160 }],
      paymentType: 'credit',
      paidAmount: 0
    })

    expect(sale.total).toBe(16000)
    expect(productService.getProduct(product.id).stockQty).toBe(0)
    expect(drift()).toEqual({ stock: 0, balance: 0 })
  })

  it('moves the khata to the new unpaid amount', () => {
    const saleId = creditBill()
    expect(partyService.getParty('customer', customer.id).currentBalance).toBe(1500)

    salesService.updateSale({
      id: saleId,
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 10, rate: 150 }],
      paymentType: 'partial',
      paidAmount: 500
    })

    expect(partyService.getParty('customer', customer.id).currentBalance).toBe(1000)
    expect(drift()).toEqual({ stock: 0, balance: 0 })
  })

  it('moves both khatas when the bill is put on a different customer', () => {
    const other = partyService.addParty('customer', { name: 'Bilal Kirana' })
    const saleId = creditBill()

    salesService.updateSale({
      id: saleId,
      customerId: other.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 10, rate: 150 }],
      paymentType: 'credit',
      paidAmount: 0
    })

    expect(partyService.getParty('customer', customer.id).currentBalance).toBe(0)
    expect(partyService.getParty('customer', other.id).currentBalance).toBe(1500)
    expect(computeBalance(db, 'customer', other.id)).toBe(1500)
  })

  it('keeps the cost frozen on a line whose product was already on the bill', () => {
    const saleId = creditBill()

    // Cost moves after the sale: 90 pieces left at 100, plus 100 more at 200,
    // takes the weighted average to 152.63. An edit must not restate what the
    // old bill earned.
    purchaseService.createPurchase({
      items: [{ productId: product.id, unitName: 'piece', qty: 100, unitCost: 200 }],
      paidAmount: 20000
    })
    expect(productService.getProduct(product.id).costPrice).toBe(152.63)

    const { sale } = salesService.updateSale({
      id: saleId,
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 12, rate: 150 }],
      paymentType: 'credit',
      paidAmount: 0
    })

    expect(sale.items[0].costPrice).toBe(100)
  })

  it('takes today’s cost for a line that is genuinely new', () => {
    const second = productService.addProduct({
      name: 'Soap bar',
      baseUnit: 'piece',
      costPrice: 0,
      salePrice: 60,
      reorderLevel: 5
    })
    purchaseService.createPurchase({
      items: [{ productId: second.id, unitName: 'piece', qty: 50, unitCost: 40 }],
      paidAmount: 2000
    })

    const saleId = creditBill()

    const { sale } = salesService.updateSale({
      id: saleId,
      customerId: customer.id,
      items: [
        { productId: product.id, unitName: 'piece', qty: 10, rate: 150 },
        { productId: second.id, unitName: 'piece', qty: 5, rate: 60 }
      ],
      paymentType: 'credit',
      paidAmount: 0
    })

    const added = sale.items.find((item) => item.productId === second.id)!
    expect(added.costPrice).toBe(40)
  })

  it('re-prices, re-taxes and re-derives the payment type', () => {
    const saleId = creditBill()

    const { sale } = salesService.updateSale({
      id: saleId,
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'carton', qty: 1, rate: 1700 }],
      discount: 200,
      paymentType: 'credit',
      paidAmount: 1500
    })

    expect(sale.subtotal).toBe(1700)
    expect(sale.discount).toBe(200)
    expect(sale.total).toBe(1500)
    // Paid in full, whatever the form said.
    expect(sale.paymentType).toBe('cash')
    expect(productService.getProduct(product.id).stockQty).toBe(88)
  })

  it('files the bill as it was before the edit', () => {
    const saleId = creditBill()

    salesService.updateSale({
      id: saleId,
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 8, rate: 150 }],
      paymentType: 'credit',
      paidAmount: 0,
      reason: 'Two came back at the door'
    })

    const [latest] = salesService.listSaleRevisions(saleId)
    expect(latest.action).toBe('edit')
    expect(latest.revision).toBe(1)
    expect(latest.reason).toBe('Two came back at the door')
    expect(latest.snapshot.total).toBe(1500)
    expect(latest.snapshot.items[0].qty).toBe(10)
  })

  it('numbers revisions in order across several changes', () => {
    const saleId = creditBill()
    salesService.settleSale({ id: saleId, paidAmount: 500 })
    salesService.updateSale({
      id: saleId,
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 9, rate: 150 }],
      paymentType: 'partial',
      paidAmount: 500
    })

    expect(salesService.listSaleRevisions(saleId).map((entry) => entry.revision)).toEqual([2, 1])
  })

  it('leaves the bill exactly as it was when the edit is refused', () => {
    const saleId = creditBill()

    expect(() =>
      salesService.updateSale({
        id: saleId,
        customerId: customer.id,
        items: [{ productId: product.id, unitName: 'piece', qty: 500, rate: 150 }],
        paymentType: 'credit',
        paidAmount: 0
      })
    ).toThrow(/in stock/i)

    const sale = salesService.getSale(saleId)
    expect(sale.items).toHaveLength(1)
    expect(sale.items[0].qty).toBe(10)
    expect(sale.total).toBe(1500)
    expect(productService.getProduct(product.id).stockQty).toBe(90)
    expect(partyService.getParty('customer', customer.id).currentBalance).toBe(1500)
    // The refused attempt must not leave a revision behind either.
    expect(salesService.listSaleRevisions(saleId)).toHaveLength(0)
    expect(drift()).toEqual({ stock: 0, balance: 0 })
  })

  it('refuses to edit a bill that has goods returned against it', () => {
    const saleId = creditBill()
    returnService.createSaleReturn({
      saleId,
      items: [{ productId: product.id, unitName: 'piece', qty: 2, rate: 150 }],
      refundType: 'credit'
    })

    expect(() =>
      salesService.updateSale({
        id: saleId,
        customerId: customer.id,
        items: [{ productId: product.id, unitName: 'piece', qty: 8, rate: 150 }],
        paymentType: 'credit',
        paidAmount: 0
      })
    ).toThrow(/returned against/i)
  })

  it('leaves the profit reported for the period consistent with the edited bill', () => {
    const range = { from: today(), to: today() }
    const saleId = creditBill()

    salesService.updateSale({
      id: saleId,
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 20, rate: 150 }],
      paymentType: 'credit',
      paidAmount: 0
    })

    const pl = reportService.profitAndLoss(range)
    expect(pl.grossSales).toBe(3000)
    expect(pl.cogs).toBe(2000)
    expect(pl.grossProfit).toBe(1000)
    expect(pl.billCount).toBe(1)
  })
})

// ===========================================================================
// Editing a bill that carries consignment lines
// ===========================================================================

describe('editing a bill with other stock on it', () => {
  let consigned: Product

  beforeEach(() => {
    consigned = productService.addProduct({
      name: 'Imported olive oil',
      baseUnit: 'bottle',
      costPrice: 0,
      salePrice: 900,
      reorderLevel: 0,
      ownership: 'other',
      ownerName: 'Hamid Traders'
    })
    otherStockService.receiveOtherStock({ productId: consigned.id, qty: 20 })
  })

  it('recomputes the consignment split when a line is changed', () => {
    const saleId = salesService.createSale({
      customerId: customer.id,
      items: [
        { productId: product.id, unitName: 'piece', qty: 10, rate: 150 },
        { productId: consigned.id, unitName: 'bottle', qty: 2, rate: 900 }
      ],
      paymentType: 'credit',
      paidAmount: 0
    }).sale.id

    const { sale } = salesService.updateSale({
      id: saleId,
      customerId: customer.id,
      items: [
        { productId: product.id, unitName: 'piece', qty: 10, rate: 150 },
        { productId: consigned.id, unitName: 'bottle', qty: 5, rate: 900 }
      ],
      paymentType: 'credit',
      paidAmount: 0
    })

    expect(sale.subtotal).toBe(6000)
    expect(sale.otherSubtotal).toBe(4500)
    expect(sale.items.find((item) => item.productId === consigned.id)!.isOther).toBe(true)
    expect(sale.items.find((item) => item.productId === consigned.id)!.costPrice).toBe(0)
    expect(productService.getProduct(consigned.id).stockQty).toBe(15)
  })

  it('still refuses a discount larger than the shop’s own goods on the bill', () => {
    const saleId = salesService.createSale({
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 10, rate: 150 }],
      paymentType: 'credit',
      paidAmount: 0
    }).sale.id

    expect(() =>
      salesService.updateSale({
        id: saleId,
        customerId: customer.id,
        items: [
          { productId: product.id, unitName: 'piece', qty: 1, rate: 150 },
          { productId: consigned.id, unitName: 'bottle', qty: 2, rate: 900 }
        ],
        discount: 400,
        paymentType: 'credit',
        paidAmount: 0
      })
    ).toThrow(/your own goods/i)
  })

  it('keeps the consignment portion out of profit after the edit', () => {
    const range = { from: today(), to: today() }
    const saleId = salesService.createSale({
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 10, rate: 150 }],
      paymentType: 'credit',
      paidAmount: 0
    }).sale.id

    salesService.updateSale({
      id: saleId,
      customerId: customer.id,
      items: [
        { productId: product.id, unitName: 'piece', qty: 10, rate: 150 },
        { productId: consigned.id, unitName: 'bottle', qty: 4, rate: 900 }
      ],
      paymentType: 'credit',
      paidAmount: 0
    })

    const pl = reportService.profitAndLoss(range)
    // 3600 of consignment revenue is on the bill and none of it is the shop's.
    expect(pl.grossSales).toBe(1500)
    expect(pl.cogs).toBe(1000)
    expect(pl.grossProfit).toBe(500)
  })
})

// ===========================================================================
// Voiding a bill
// ===========================================================================

describe('voiding a bill', () => {
  it('puts the stock back, empties the figures and clears the khata', () => {
    const saleId = creditBill()

    const voided = salesService.voidSale({ id: saleId, reason: 'Order cancelled at the door' })

    expect(voided.voidedAt).not.toBeNull()
    expect(voided.total).toBe(0)
    expect(voided.paidAmount).toBe(0)
    expect(voided.items).toHaveLength(0)
    expect(productService.getProduct(product.id).stockQty).toBe(100)
    expect(sumMovements(db, product.id)).toBe(100)
    expect(partyService.getParty('customer', customer.id).currentBalance).toBe(0)
    expect(drift()).toEqual({ stock: 0, balance: 0 })
  })

  it('returns the cash a paid bill had taken', () => {
    const range = { from: today(), to: today() }
    const before = dashboardService.getSummary(range).cashInHand

    const saleId = salesService.createSale({
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 4, rate: 150 }],
      paymentType: 'cash',
      paidAmount: 600
    }).sale.id
    expect(dashboardService.getSummary(range).cashInHand).toBe(before + 600)

    salesService.voidSale({ id: saleId })

    expect(dashboardService.getSummary(range).cashInHand).toBe(before)
  })

  it('keeps the invoice number, and never issues it again', () => {
    const saleId = creditBill()
    const invoiceNo = salesService.getSale(saleId).invoiceNo

    salesService.voidSale({ id: saleId })

    expect(salesService.getSale(saleId).invoiceNo).toBe(invoiceNo)
    expect(salesService.peekNextInvoiceNo()).toBe('INV-000002')
  })

  it('drops out of the bill count without disturbing any money figure', () => {
    const range = { from: today(), to: today() }
    salesService.createSale({
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 5, rate: 150 }],
      paymentType: 'cash',
      paidAmount: 750
    })
    const cancelled = creditBill()

    salesService.voidSale({ id: cancelled })

    const pl = reportService.profitAndLoss(range)
    expect(pl.billCount).toBe(1)
    expect(pl.grossSales).toBe(750)
    expect(pl.cogs).toBe(500)

    const summary = reportService.salesSummary(range)
    expect(summary.billCount).toBe(1)
    expect(summary.totalSales).toBe(750)
  })

  it('leaves nothing behind on the customer’s statement', () => {
    const saleId = creditBill()

    salesService.voidSale({ id: saleId })

    const statement = getStatement('customer', customer.id, { from: today(), to: today() })
    expect(statement.closingBalance).toBe(0)
    expect(statement.entries.some((entry) => entry.reference.includes('INV-000001'))).toBe(false)
  })

  it('files the bill as it was', () => {
    const saleId = creditBill()

    salesService.voidSale({ id: saleId, reason: 'Duplicate bill' })

    const [latest] = salesService.listSaleRevisions(saleId)
    expect(latest.action).toBe('void')
    expect(latest.reason).toBe('Duplicate bill')
    expect(latest.snapshot.total).toBe(1500)
    expect(latest.snapshot.items).toHaveLength(1)
  })

  it('refuses a bill that has goods returned against it', () => {
    const saleId = creditBill()
    returnService.createSaleReturn({
      saleId,
      items: [{ productId: product.id, unitName: 'piece', qty: 1, rate: 150 }],
      refundType: 'credit'
    })

    expect(() => salesService.voidSale({ id: saleId })).toThrow(/returned against/i)
  })

  it('cannot be voided, edited or settled twice', () => {
    const saleId = creditBill()
    salesService.voidSale({ id: saleId })

    expect(() => salesService.voidSale({ id: saleId })).toThrow(/cancelled/i)
    expect(() => salesService.settleSale({ id: saleId, paidAmount: 0 })).toThrow(/cancelled/i)
    expect(() =>
      salesService.updateSale({
        id: saleId,
        customerId: customer.id,
        items: [{ productId: product.id, unitName: 'piece', qty: 1, rate: 150 }],
        paymentType: 'credit',
        paidAmount: 0
      })
    ).toThrow(/cancelled/i)
  })
})

// ===========================================================================
// The property that matters most
// ===========================================================================

describe('after a run of edits', () => {
  it('leaves nothing for the launch-time reconcilers to repair', () => {
    const second = partyService.addParty('customer', { name: 'Bilal Kirana' })
    const first = creditBill()
    const paid = salesService.createSale({
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'carton', qty: 2, rate: 1700 }],
      paymentType: 'partial',
      paidAmount: 1000
    }).sale.id

    salesService.settleSale({ id: first, paidAmount: 700 })
    salesService.updateSale({
      id: first,
      customerId: second.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 6, rate: 155 }],
      paymentType: 'partial',
      paidAmount: 700
    })
    salesService.updateSale({
      id: paid,
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'carton', qty: 1, rate: 1700 }],
      paymentType: 'partial',
      paidAmount: 1000
    })
    salesService.voidSale({ id: paid })
    salesService.settleSale({ id: first, paidAmount: 930 })

    expect(findStockDrift(db)).toEqual([])
    for (const party of [customer, second]) {
      expect(partyService.getParty('customer', party.id).currentBalance).toBe(
        computeBalance(db, 'customer', party.id)
      )
    }
    expect(sumMovements(db, product.id)).toBe(productService.getProduct(product.id).stockQty)
  })
})
