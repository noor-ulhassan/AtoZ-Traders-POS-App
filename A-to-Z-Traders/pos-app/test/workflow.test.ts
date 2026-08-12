import { beforeEach, describe, expect, it } from 'vitest'
import { today } from '@shared/date'
import type { Db } from '../src/main/db/connection'
import { createTestDb } from './helpers/database'
import { findStockDrift, sumMovements } from '../src/main/repositories/stockRepository'
import * as categoryService from '../src/main/services/categoryService'
import * as dashboardService from '../src/main/services/dashboardService'
import * as expenseService from '../src/main/services/expenseService'
import * as ledgerService from '../src/main/services/ledgerService'
import * as partyService from '../src/main/services/partyService'
import * as paymentService from '../src/main/services/paymentService'
import * as productService from '../src/main/services/productService'
import * as purchaseService from '../src/main/services/purchaseService'
import * as reportService from '../src/main/services/reportService'
import * as returnService from '../src/main/services/returnService'
import * as salesService from '../src/main/services/salesService'
import * as settingsService from '../src/main/services/settingsService'

let db: Db

beforeEach(() => {
  db = createTestDb()
})

/**
 * One realistic trading day, end to end.
 *
 * Individual rules are covered by the other suites; this one exists to catch
 * the failures that only appear when the modules run together — a balance that
 * drifts once returns and payments touch the same customer, or a dashboard
 * that disagrees with the P&L it is summarising.
 */
describe('a day at the shop', () => {
  it('leaves stock, khata, cash and profit all agreeing with each other', () => {
    const range = { from: today(), to: today() }

    // --- setting up
    settingsService.updateSettings({
      businessName: 'A to Z Traders',
      address: 'Shahalam Market, Lahore',
      phone: '0300-1234567'
    })

    const grocery = categoryService.addCategory('Grocery')
    const supplier = partyService.addParty('supplier', {
      name: 'Metro Distributors',
      openingBalance: 0
    })
    const shop = partyService.addParty('customer', {
      name: 'Bilal Kiryana Store',
      openingBalance: 2000
    })

    const oil = productService.addProduct({
      name: 'Cooking oil 5L',
      sku: 'OIL-5L',
      categoryId: grocery.id,
      baseUnit: 'bottle',
      costPrice: 0,
      salePrice: 1450,
      reorderLevel: 12,
      units: [{ unitName: 'carton', factor: 4, salePrice: 5700 }]
    })

    // --- stock comes in: 40 bottles at 1,300, half paid
    purchaseService.createPurchase({
      supplierId: supplier.id,
      invoiceNo: 'MD-8891',
      items: [{ productId: oil.id, unitName: 'carton', qty: 10, unitCost: 5200 }],
      paidAmount: 26000
    })

    expect(productService.getProduct(oil.id).stockQty).toBe(40)
    expect(productService.getProduct(oil.id).costPrice).toBe(1300)
    expect(partyService.getParty('supplier', supplier.id).currentBalance).toBe(26000)

    // --- a walk-in cash sale of 3 bottles
    salesService.createSale({
      items: [{ productId: oil.id, unitName: 'bottle', qty: 3, rate: 1450 }],
      paymentType: 'cash',
      paidAmount: 4350
    })

    // --- a credit sale to the kiryana store: 5 cartons at a negotiated rate
    const credit = salesService.createSale({
      customerId: shop.id,
      items: [{ productId: oil.id, unitName: 'carton', qty: 5, rate: 5600 }],
      paymentType: 'credit',
      paidAmount: 0
    })

    expect(productService.getProduct(oil.id).stockQty).toBe(17)
    // 2,000 opening + 28,000 on this bill
    expect(partyService.getParty('customer', shop.id).currentBalance).toBe(30000)

    // --- one carton comes back damaged, credited to the khata
    returnService.createSaleReturn({
      saleId: credit.sale.id,
      items: [{ productId: oil.id, unitName: 'carton', qty: 1, rate: 5600 }],
      refundType: 'credit'
    })

    expect(productService.getProduct(oil.id).stockQty).toBe(21)
    expect(partyService.getParty('customer', shop.id).currentBalance).toBe(24400)

    // --- the shop pays 20,000 on account, and the day's expenses go in
    paymentService.createPayment({
      partyType: 'customer',
      partyId: shop.id,
      amount: 20000,
      method: 'cash'
    })
    expenseService.addExpense({ title: 'Shop rent', amount: 3000 })
    expenseService.addExpense({ title: 'Loader wages', amount: 700 })

    expect(partyService.getParty('customer', shop.id).currentBalance).toBe(4400)

    // --- the ledger must tell the same story as the cached balance
    const statement = ledgerService.getStatement('customer', shop.id, range)
    expect(statement.closingBalance).toBe(4400)
    expect(statement.openingBalance).toBe(2000)
    expect(statement.totalDebit).toBe(28000)
    expect(statement.totalCredit).toBe(25600)

    // --- the stock cache must equal the movement ledger, product by product
    expect(sumMovements(db, oil.id)).toBe(21)
    expect(findStockDrift(db)).toHaveLength(0)

    // --- profit and loss
    const pnl = reportService.profitAndLoss(range)
    //   cash sale        3 bottles  @ 1450 =  4,350
    //   credit sale     20 bottles  @ 1400 = 28,000   (5 cartons at 5,600)
    expect(pnl.grossSales).toBe(32350)
    expect(pnl.salesReturns).toBe(5600)
    expect(pnl.netSales).toBe(26750)
    //   23 bottles sold at 1,300 cost, 4 returned
    expect(pnl.cogs).toBe(29900)
    expect(pnl.returnedCogs).toBe(5200)
    expect(pnl.netCogs).toBe(24700)
    expect(pnl.grossProfit).toBe(2050)
    expect(pnl.expenses).toBe(3700)
    expect(pnl.netProfit).toBe(-1650)

    // --- the dashboard must not invent different numbers
    const dashboard = dashboardService.getSummary(range)
    expect(dashboard.billCount).toBe(2)
    expect(dashboard.expenses).toBe(pnl.expenses)
    expect(dashboard.receivables).toBe(4400)
    expect(dashboard.payables).toBe(26000)
    //   in : 4,350 sale + 20,000 payment
    //   out: 26,000 purchase + 3,700 expenses + 0 cash refunds
    expect(dashboard.cashInHand).toBe(-5350)

    // --- and the reorder list must be shouting about the oil
    const lowStock = reportService.lowStock()
    expect(lowStock).toHaveLength(0)

    salesService.createSale({
      items: [{ productId: oil.id, unitName: 'bottle', qty: 10, rate: 1450 }],
      paymentType: 'cash',
      paidAmount: 14500
    })

    const afterBigSale = reportService.lowStock()
    expect(afterBigSale).toHaveLength(1)
    expect(afterBigSale[0]?.stockQty).toBe(11)
    expect(afterBigSale[0]?.shortfall).toBe(1)
  })

  it('keeps two customers apart when they trade on the same day', () => {
    const first = partyService.addParty('customer', { name: 'Shop One' })
    const second = partyService.addParty('customer', { name: 'Shop Two' })
    const item = productService.addProduct({
      name: 'Soap bar',
      baseUnit: 'piece',
      costPrice: 40,
      salePrice: 55,
      reorderLevel: 0,
      openingStock: 500
    })

    salesService.createSale({
      customerId: first.id,
      items: [{ productId: item.id, unitName: 'piece', qty: 100, rate: 52 }],
      paymentType: 'credit',
      paidAmount: 0
    })
    salesService.createSale({
      customerId: second.id,
      items: [{ productId: item.id, unitName: 'piece', qty: 50, rate: 54 }],
      paymentType: 'partial',
      paidAmount: 700
    })
    paymentService.createPayment({ partyType: 'customer', partyId: first.id, amount: 5200 })

    expect(partyService.getParty('customer', first.id).currentBalance).toBe(0)
    expect(partyService.getParty('customer', second.id).currentBalance).toBe(2000)

    // Each shop is offered back the price it was actually given.
    expect(salesService.suggestPrice(first.id, item.id, 'piece').rate).toBe(52)
    expect(salesService.suggestPrice(second.id, item.id, 'piece').rate).toBe(54)
    expect(productService.getProduct(item.id).stockQty).toBe(350)
  })
})
