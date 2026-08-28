import { beforeEach, describe, expect, it } from 'vitest'
import type { Customer, Product } from '@shared/types'
import { today } from '@shared/date'
import type { Db } from '../src/main/db/connection'
import { createTestDb } from './helpers/database'
import { sumMovements } from '../src/main/repositories/stockRepository'
import * as dashboardService from '../src/main/services/dashboardService'
import * as inventoryService from '../src/main/services/inventoryService'
import * as otherStockService from '../src/main/services/otherStockService'
import * as partyService from '../src/main/services/partyService'
import * as productService from '../src/main/services/productService'
import * as purchaseService from '../src/main/services/purchaseService'
import * as reportService from '../src/main/services/reportService'
import * as returnService from '../src/main/services/returnService'
import * as salesService from '../src/main/services/salesService'

/**
 * Consignment goods: sold by the shop, owned by somebody else.
 *
 * The whole feature rests on one property — that money earned on stock the shop
 * does not own never reaches a profit, cost or stock-value figure. A single
 * missed filter would overstate the business by exactly the amount belonging to
 * someone else, and would do it silently. So the isolation is asserted here
 * against every aggregate in the app rather than trusted to code review.
 */

let db: Db
let customer: Customer
/** The shop's own stock: bought at 100, sold at 150. */
let own: Product
/** Consignment: costs the shop nothing, sold at 200 on the owner's behalf. */
let other: Product

const RANGE = { from: today(), to: today() }

beforeEach(() => {
  db = createTestDb()

  customer = partyService.addParty('customer', { name: 'Karim General Store' })

  own = productService.addProduct({
    name: 'Detergent 1kg',
    baseUnit: 'piece',
    costPrice: 0,
    salePrice: 150,
    reorderLevel: 10
  })
  purchaseService.createPurchase({
    items: [{ productId: own.id, unitName: 'piece', qty: 100, unitCost: 100 }],
    paidAmount: 10_000
  })
  own = productService.getProduct(own.id)

  other = productService.addProduct({
    name: 'Imported Blender',
    baseUnit: 'piece',
    costPrice: 0,
    salePrice: 200,
    reorderLevel: 0,
    ownership: 'other',
    ownerName: 'Bilal Electronics'
  })
  otherStockService.receiveOtherStock({ productId: other.id, qty: 50 })
  other = productService.getProduct(other.id)
})

describe('setting a product up as consignment stock', () => {
  it('records who the goods belong to', () => {
    expect(other.ownership).toBe('other')
    expect(other.ownerName).toBe('Bilal Electronics')
  })

  it('refuses other stock with nobody named against it', () => {
    expect(() =>
      productService.addProduct({
        name: 'Anonymous goods',
        baseUnit: 'piece',
        costPrice: 0,
        salePrice: 10,
        reorderLevel: 0,
        ownership: 'other'
      })
    ).toThrow(/name of whoever the goods belong to/i)
  })

  it('holds no cost, whatever the form sends', () => {
    const created = productService.addProduct({
      name: 'Someone else goods',
      baseUnit: 'piece',
      // A cost typed here would find its way into a valuation sooner or later.
      costPrice: 500,
      salePrice: 900,
      reorderLevel: 0,
      ownership: 'other',
      ownerName: 'Bilal Electronics'
    })
    expect(created.costPrice).toBe(0)
  })

  it('will not change hands while stock is on the shelf', () => {
    expect(() =>
      productService.updateProduct(other.id, {
        name: other.name,
        baseUnit: other.baseUnit,
        costPrice: 0,
        salePrice: other.salePrice,
        reorderLevel: 0,
        ownership: 'own'
      })
    ).toThrow(/Clear the stock before changing who the goods belong to/i)
  })

  it('can be reclassified once the shelf is empty', () => {
    otherStockService.returnOtherStock({ productId: other.id, qty: 50 })

    const updated = productService.updateProduct(other.id, {
      name: other.name,
      baseUnit: other.baseUnit,
      costPrice: 0,
      salePrice: other.salePrice,
      reorderLevel: 0,
      ownership: 'own'
    })
    expect(updated.ownership).toBe('own')
    expect(updated.ownerName).toBe('')
  })
})

describe('receiving and returning consignment goods', () => {
  it('puts stock on the shelf through the ledger, with no money involved', () => {
    expect(other.stockQty).toBe(50)
    expect(sumMovements(db, other.id)).toBe(50)

    const movements = inventoryService.listMovements({ productId: other.id })
    expect(movements.rows[0]?.reason).toBe('other_in')

    // No supplier balance moved, because nothing was bought.
    expect(partyService.listParties('supplier').totals.outstanding).toBe(0)
  })

  it('sends unsold goods back', () => {
    otherStockService.returnOtherStock({ productId: other.id, qty: 20 })

    expect(productService.getProduct(other.id).stockQty).toBe(30)
    expect(sumMovements(db, other.id)).toBe(30)
  })

  it('will not send back more than is on the shelf', () => {
    expect(() => otherStockService.returnOtherStock({ productId: other.id, qty: 80 })).toThrow(
      /cannot return/i
    )
  })

  it('refuses to take the shop’s own stock into the register', () => {
    expect(() => otherStockService.receiveOtherStock({ productId: own.id, qty: 5 })).toThrow(
      /your own stock/i
    )
  })

  it('refuses to buy consignment goods on a purchase', () => {
    expect(() =>
      purchaseService.createPurchase({
        items: [{ productId: other.id, unitName: 'piece', qty: 10, unitCost: 120 }],
        paidAmount: 0
      })
    ).toThrow(/Record it under Other stock/i)
  })
})

describe('billing consignment goods', () => {
  it('sells them like anything else, marked and at zero cost', () => {
    const { sale } = salesService.createSale({
      customerId: customer.id,
      items: [{ productId: other.id, unitName: 'piece', qty: 2, rate: 200 }],
      paymentType: 'cash',
      paidAmount: 400
    })

    expect(sale.total).toBe(400)
    expect(sale.otherSubtotal).toBe(400)
    expect(sale.items[0]?.isOther).toBe(true)
    expect(sale.items[0]?.costPrice).toBe(0)
    expect(productService.getProduct(other.id).stockQty).toBe(48)
  })

  it('puts both kinds on one bill and splits the subtotal', () => {
    const { sale } = salesService.createSale({
      customerId: customer.id,
      items: [
        { productId: own.id, unitName: 'piece', qty: 2, rate: 150 },
        { productId: other.id, unitName: 'piece', qty: 1, rate: 200 }
      ],
      paymentType: 'cash',
      paidAmount: 500
    })

    expect(sale.subtotal).toBe(500)
    expect(sale.otherSubtotal).toBe(200)
    expect(sale.items.filter((item) => item.isOther)).toHaveLength(1)
  })

  it('will not let a bill discount eat into somebody else’s goods', () => {
    // Own goods are worth 300 on this bill; a 400 discount would take 100 out
    // of the consignment line, which is money the shop does not own.
    expect(() =>
      salesService.createSale({
        customerId: customer.id,
        items: [
          { productId: own.id, unitName: 'piece', qty: 2, rate: 150 },
          { productId: other.id, unitName: 'piece', qty: 1, rate: 200 }
        ],
        discount: 400,
        paymentType: 'cash',
        paidAmount: 100
      })
    ).toThrow(/only be given on your own goods/i)
  })

  it('allows a discount up to the value of the shop’s own goods', () => {
    const { sale } = salesService.createSale({
      customerId: customer.id,
      items: [
        { productId: own.id, unitName: 'piece', qty: 2, rate: 150 },
        { productId: other.id, unitName: 'piece', qty: 1, rate: 200 }
      ],
      discount: 300,
      paymentType: 'cash',
      paidAmount: 200
    })

    expect(sale.discount).toBe(300)
    expect(sale.total).toBe(200)
  })

  it('reverses a consignment line on a return without inventing a profit', () => {
    const { sale } = salesService.createSale({
      customerId: customer.id,
      items: [{ productId: other.id, unitName: 'piece', qty: 5, rate: 200 }],
      paymentType: 'cash',
      paidAmount: 1000
    })

    const saleReturn = returnService.createSaleReturn({
      saleId: sale.id,
      items: [{ productId: other.id, unitName: 'piece', qty: 2, rate: 200 }],
      refundType: 'cash'
    })

    expect(saleReturn.total).toBe(400)
    expect(saleReturn.otherTotal).toBe(400)
    expect(saleReturn.items[0]?.isOther).toBe(true)
    expect(saleReturn.items[0]?.costPrice).toBe(0)
    expect(productService.getProduct(other.id).stockQty).toBe(47)
  })
})

describe('the isolation that makes this safe', () => {
  /** One bill of each kind: 2 own at 150, 3 other at 200. */
  function sellBoth(): void {
    salesService.createSale({
      customerId: customer.id,
      items: [
        { productId: own.id, unitName: 'piece', qty: 2, rate: 150 },
        { productId: other.id, unitName: 'piece', qty: 3, rate: 200 }
      ],
      paymentType: 'cash',
      paidAmount: 900
    })
  }

  it('keeps consignment revenue out of the profit and loss', () => {
    sellBoth()
    const report = reportService.profitAndLoss(RANGE)

    // Own goods only: 2 x 150 revenue, 2 x 100 cost.
    expect(report.grossSales).toBe(300)
    expect(report.cogs).toBe(200)
    expect(report.grossProfit).toBe(100)
    expect(report.netProfit).toBe(100)
  })

  it('keeps it out of the category breakdown', () => {
    sellBoth()
    const report = reportService.profitAndLoss(RANGE)
    const revenue = report.categoryBreakdown.reduce((sum, row) => sum + row.revenue, 0)

    expect(revenue).toBe(300)
  })

  it('keeps it out of the product profit report', () => {
    sellBoth()
    const rows = reportService.productProfit(RANGE)

    expect(rows.map((row) => row.productName)).toEqual(['Detergent 1kg'])
  })

  it('keeps it out of the sales summary and its chart', () => {
    sellBoth()
    const summary = reportService.salesSummary(RANGE)

    expect(summary.totalSales).toBe(300)
    expect(summary.totalProfit).toBe(100)
    // The bill itself is still one bill; only the money is split.
    expect(summary.billCount).toBe(1)
  })

  it('keeps it out of the stock valuation', () => {
    const valuation = reportService.stockValuation()

    expect(valuation.rows.map((row) => row.productName)).toEqual(['Detergent 1kg'])
    // 100 units at 100 — the blender's 50 units are worth nothing to the shop.
    expect(valuation.totalStockValue).toBe(10_000)
  })

  it('keeps it out of the reorder list', () => {
    productService.updateProduct(other.id, {
      name: other.name,
      baseUnit: other.baseUnit,
      costPrice: 0,
      salePrice: other.salePrice,
      // Deliberately below stock, so it would appear if it were not filtered.
      reorderLevel: 999,
      ownership: 'other',
      ownerName: other.ownerName
    })

    expect(reportService.lowStock().map((row) => row.productName)).not.toContain('Imported Blender')
  })

  it('keeps it out of the dashboard profit', () => {
    sellBoth()
    const summary = dashboardService.getSummary(RANGE)

    expect(summary.sales).toBe(300)
    expect(summary.profit).toBe(100)
    expect(summary.topProducts.map((row) => row.productName)).toEqual(['Detergent 1kg'])
  })

  it('DOES count the money in the drawer, because it really is there', () => {
    sellBoth()
    const summary = dashboardService.getSummary(RANGE)

    // 900 taken at the counter, less the 10,000 paid for the detergent.
    expect(summary.cashInHand).toBe(900 - 10_000)
  })

  it('does not let a returned consignment item claw back profit', () => {
    sellBoth()
    const before = reportService.profitAndLoss(RANGE)

    const sale = salesService.listSales().rows[0]!
    returnService.createSaleReturn({
      saleId: sale.id,
      items: [{ productId: other.id, unitName: 'piece', qty: 3, rate: 200 }],
      refundType: 'cash'
    })

    const after = reportService.profitAndLoss(RANGE)
    expect(after.salesReturns).toBe(0)
    expect(after.netProfit).toBe(before.netProfit)
  })

  it('leaves an old bill alone when the product is reclassified later', () => {
    sellBoth()
    const before = reportService.profitAndLoss(RANGE)

    // Empty the shelf so the classification is allowed to change at all.
    otherStockService.returnOtherStock({ productId: other.id, qty: 47 })
    productService.updateProduct(other.id, {
      name: other.name,
      baseUnit: other.baseUnit,
      costPrice: 0,
      salePrice: other.salePrice,
      reorderLevel: 0,
      ownership: 'own'
    })

    // The sale line froze the answer; reclassifying cannot restate the month.
    expect(reportService.profitAndLoss(RANGE).grossSales).toBe(before.grossSales)
  })
})

describe('the register', () => {
  it('reports what arrived, what sold and what is left, per product', () => {
    salesService.createSale({
      customerId: customer.id,
      items: [{ productId: other.id, unitName: 'piece', qty: 12, rate: 200 }],
      paymentType: 'cash',
      paidAmount: 2400
    })
    otherStockService.returnOtherStock({ productId: other.id, qty: 8 })

    const report = otherStockService.getReport()
    const row = report.rows[0]!

    expect(row.productName).toBe('Imported Blender')
    expect(row.ownerName).toBe('Bilal Electronics')
    expect(row.received).toBe(50)
    expect(row.sold).toBe(12)
    expect(row.returnedToOwner).toBe(8)
    expect(row.onHand).toBe(30)
    expect(row.billedAmount).toBe(2400)
  })

  it('nets customer returns off what is owed to the goods’ owner', () => {
    const { sale } = salesService.createSale({
      customerId: customer.id,
      items: [{ productId: other.id, unitName: 'piece', qty: 10, rate: 200 }],
      paymentType: 'cash',
      paidAmount: 2000
    })
    returnService.createSaleReturn({
      saleId: sale.id,
      items: [{ productId: other.id, unitName: 'piece', qty: 4, rate: 200 }],
      refundType: 'cash'
    })

    const row = otherStockService.getReport().rows[0]!
    expect(row.billedAmount).toBe(1200)
    expect(row.returnedByCustomer).toBe(4)
  })

  it('totals by owner', () => {
    const second = productService.addProduct({
      name: 'Imported Kettle',
      baseUnit: 'piece',
      costPrice: 0,
      salePrice: 90,
      reorderLevel: 0,
      ownership: 'other',
      ownerName: 'Bilal Electronics'
    })
    otherStockService.receiveOtherStock({ productId: second.id, qty: 10 })

    productService.addProduct({
      name: 'Handmade Rug',
      baseUnit: 'piece',
      costPrice: 0,
      salePrice: 5000,
      reorderLevel: 0,
      ownership: 'other',
      ownerName: 'Zainab Textiles'
    })

    const report = otherStockService.getReport()

    expect(report.owners.map((owner) => owner.ownerName)).toEqual([
      'Bilal Electronics',
      'Zainab Textiles'
    ])
    expect(report.owners[0]?.productCount).toBe(2)
    expect(report.owners[0]?.onHand).toBe(60)
    expect(report.totals.ownerCount).toBe(2)
  })

  it('never mentions the shop’s own products', () => {
    const report = otherStockService.getReport()
    expect(report.rows.map((row) => row.productName)).not.toContain('Detergent 1kg')
  })

  it('lists the owners on record', () => {
    expect(otherStockService.listOwners()).toEqual(['Bilal Electronics'])
  })

  it('narrows to one owner', () => {
    productService.addProduct({
      name: 'Handmade Rug',
      baseUnit: 'piece',
      costPrice: 0,
      salePrice: 5000,
      reorderLevel: 0,
      ownership: 'other',
      ownerName: 'Zainab Textiles'
    })

    const report = otherStockService.getReport({ ownerName: 'Zainab Textiles' })
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]?.productName).toBe('Handmade Rug')
  })
})
