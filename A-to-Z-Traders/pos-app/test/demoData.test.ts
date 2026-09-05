import { beforeEach, describe, expect, it } from 'vitest'
import { addDays, today } from '@shared/date'
import type { Db } from '../src/main/db/connection'
import { createTestDb } from './helpers/database'
import { computeBalance } from '../src/main/services/ledgerService'
import * as demoDataService from '../src/main/services/demoDataService'
import * as partyService from '../src/main/services/partyService'
import * as productService from '../src/main/services/productService'
import * as purchaseService from '../src/main/services/purchaseService'
import * as reportService from '../src/main/services/reportService'
import * as salesService from '../src/main/services/salesService'
import * as expenseService from '../src/main/services/expenseService'
import * as categoryService from '../src/main/services/categoryService'

/**
 * Sample data has to be trustworthy in two directions.
 *
 * Going in: it must be indistinguishable in *quality* from real trade, because
 * it is used to judge whether the app works. Data that skipped the services
 * would look right on screen and be wrong underneath — stock that does not add
 * up, a khata that disagrees with its own entries.
 *
 * Coming out: removal must take the samples and nothing else. This app holds a
 * real shop's records, and a remover that overreaches is worse than one that
 * refuses.
 */

let db: Db

beforeEach(() => {
  db = createTestDb()
})

/** Counts every product whose cached stock disagrees with its ledger. */
function stockDrift(): number {
  return (
    db
      .prepare<[], { drifted: number }>(
        `SELECT COUNT(*) AS drifted
           FROM products p
          WHERE ROUND(p.stock_qty, 3) <> ROUND(
                  COALESCE((SELECT SUM(m.change_qty) FROM stock_movements m
                             WHERE m.product_id = p.id), 0), 3)`
      )
      .get()?.drifted ?? 0
  )
}

/** Counts every party whose cached balance disagrees with its events. */
function balanceDrift(): number {
  let drifted = 0
  for (const type of ['customer', 'supplier'] as const) {
    const table = type === 'customer' ? 'customers' : 'suppliers'
    for (const party of db
      .prepare<[], { id: number; current_balance: number }>(
        `SELECT id, current_balance FROM ${table}`
      )
      .all()) {
      if (Math.abs(computeBalance(db, type, party.id) - party.current_balance) > 0.005) {
        drifted += 1
      }
    }
  }
  return drifted
}

describe('seeding', () => {
  it('fills an empty shop with a working set of records', () => {
    const result = demoDataService.seedDemoData()

    expect(result.total).toBeGreaterThan(250)
    const labels = result.counts.map((entry) => entry.label)
    for (const expected of [
      'Categories',
      'Products',
      'Customers',
      'Suppliers',
      'Purchases',
      'Bills',
      'Payments',
      'Expenses'
    ]) {
      expect(labels).toContain(expected)
    }
  })

  it('leaves the stock ledger and the khata in perfect agreement', () => {
    demoDataService.seedDemoData()

    // The seeder writes through the real services, so this must hold exactly —
    // the same invariant the app repairs at every startup.
    expect(stockDrift()).toBe(0)
    expect(balanceDrift()).toBe(0)
  })

  it('produces enough products and bills to page through', () => {
    demoDataService.seedDemoData()

    // Paging is 50 a page; both lists need to be past that to be worth testing.
    expect(productService.listProducts({ status: 'all', limit: 1 }).total).toBeGreaterThan(50)
    expect(salesService.listSales({ limit: 1 }).total).toBeGreaterThan(50)
  })

  it('covers every payment type a bill can have', () => {
    demoDataService.seedDemoData()

    const types = new Set(
      salesService.listSales({ limit: 1000 }).rows.map((sale) => sale.paymentType)
    )
    expect(types).toContain('cash')
    expect(types).toContain('credit')
    expect(types).toContain('partial')
  })

  it('leaves customers on both sides of the khata', () => {
    demoDataService.seedDemoData()

    const balances = partyService
      .listParties('customer', { limit: 500 })
      .rows.map((row) => row.currentBalance)

    expect(balances.some((balance) => balance > 0)).toBe(true)
    expect(balances.some((balance) => balance < 0)).toBe(true)
  })

  it('includes consignment stock, kept out of the profit figures', () => {
    demoDataService.seedDemoData()

    const consignment = productService
      .listProducts({ status: 'all', limit: 500 })
      .rows.filter((row) => row.ownership === 'other')

    expect(consignment.length).toBeGreaterThan(0)
    expect(consignment.every((row) => row.costPrice === 0)).toBe(true)
    expect(new Set(consignment.map((row) => row.ownerName)).size).toBeGreaterThan(1)

    // And at least one bill actually carries a consignment line.
    const withOther = salesService
      .listSales({ limit: 1000 })
      .rows.filter((sale) => sale.otherSubtotal > 0)
    expect(withOther.length).toBeGreaterThan(0)
  })

  it('gives every report something to show', () => {
    demoDataService.seedDemoData()
    // A year back covers the whole seeded history. Not wider: `salesSummary`
    // builds a point per day and `eachDay` stops after 3660 of them, so an
    // absurd range would quietly come back empty.
    const range = { from: addDays(today(), -365), to: today() }

    const profit = reportService.profitAndLoss(range)
    expect(profit.grossSales).toBeGreaterThan(0)
    expect(profit.cogs).toBeGreaterThan(0)
    expect(profit.expenses).toBeGreaterThan(0)
    expect(profit.expenseBreakdown.length).toBeGreaterThan(0)
    expect(profit.categoryBreakdown.length).toBeGreaterThan(0)

    expect(reportService.stockValuation().totalStockValue).toBeGreaterThan(0)
    expect(reportService.productProfit(range).length).toBeGreaterThan(0)
    expect(reportService.salesSummary(range).billCount).toBeGreaterThan(0)
  })

  it('reports correct totals even when the chart cannot draw every day', () => {
    demoDataService.seedDemoData()

    const year = reportService.salesSummary({ from: addDays(today(), -365), to: today() })
    // Past `eachDay`'s ten-year stop, so the chart is clipped. The headline
    // figures must still describe the whole period rather than reading zero.
    const wide = reportService.salesSummary({ from: '1990-01-01', to: today() })

    expect(wide.billCount).toBe(year.billCount)
    expect(wide.totalSales).toBe(year.totalSales)
    expect(wide.totalProfit).toBe(year.totalProfit)
  })

  it('is deterministic — two shops seeded the same way match', () => {
    const range = { from: addDays(today(), -365), to: today() }

    demoDataService.seedDemoData()
    const first = reportService.profitAndLoss(range)

    createTestDb()
    demoDataService.seedDemoData()
    const second = reportService.profitAndLoss(range)

    expect(second.grossSales).toBe(first.grossSales)
    expect(second.billCount).toBe(first.billCount)
  })

  it('refuses to seed twice over itself', () => {
    demoDataService.seedDemoData()
    expect(() => demoDataService.seedDemoData()).toThrow(/already loaded/i)
  })
})

describe('status', () => {
  it('reports nothing on a clean database', () => {
    const status = demoDataService.demoStatus()

    expect(status.present).toBe(false)
    expect(status.total).toBe(0)
    expect(status.counts).toEqual([])
    expect(status.createdAt).toBeNull()
  })

  it('reports what is there once seeded', () => {
    demoDataService.seedDemoData()
    const status = demoDataService.demoStatus()

    expect(status.present).toBe(true)
    expect(status.total).toBeGreaterThan(250)
    expect(status.createdAt).not.toBeNull()
    expect(status.blockers).toEqual([])
  })
})

describe('removal', () => {
  it('takes the database back to empty', () => {
    demoDataService.seedDemoData()
    const removed = demoDataService.clearDemoData()

    expect(removed.removed).toBeGreaterThan(250)
    expect(demoDataService.demoStatus().present).toBe(false)

    expect(productService.listProducts({ status: 'all', limit: 1 }).total).toBe(0)
    expect(salesService.listSales({ limit: 1 }).total).toBe(0)
    expect(partyService.listParties('customer', { limit: 1 }).total).toBe(0)
    expect(expenseService.listExpenses({ limit: 1 }).total).toBe(0)
  })

  it('leaves no orphaned child rows behind', () => {
    demoDataService.seedDemoData()
    demoDataService.clearDemoData()

    for (const table of [
      'sale_items',
      'purchase_items',
      'sale_return_items',
      'purchase_return_items',
      'stock_movements',
      'customer_item_prices',
      'product_units'
    ]) {
      const n = db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n
      expect({ table, n }).toEqual({ table, n: 0 })
    }
  })

  it('refuses when there is nothing to remove', () => {
    expect(() => demoDataService.clearDemoData()).toThrow(/no sample data/i)
  })

  it('can be seeded and removed repeatedly', () => {
    for (let round = 0; round < 3; round += 1) {
      demoDataService.seedDemoData()
      expect(demoDataService.demoStatus().present).toBe(true)
      demoDataService.clearDemoData()
      expect(demoDataService.demoStatus().present).toBe(false)
    }

    expect(stockDrift()).toBe(0)
    expect(balanceDrift()).toBe(0)
  })
})

describe('living beside the shop’s own records', () => {
  /** A real product, customer and bill, entered by the owner. */
  function realTrade(): { productId: number; customerId: number; saleId: number } {
    const customer = partyService.addParty('customer', { name: 'A Real Customer' })
    const product = productService.addProduct({
      name: 'A Real Product',
      baseUnit: 'piece',
      costPrice: 0,
      salePrice: 500,
      reorderLevel: 0
    })
    purchaseService.createPurchase({
      items: [{ productId: product.id, unitName: 'piece', qty: 20, unitCost: 300 }],
      paidAmount: 6000
    })
    const { sale } = salesService.createSale({
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 2, rate: 500 }],
      paymentType: 'credit',
      paidAmount: 0
    })
    return { productId: product.id, customerId: customer.id, saleId: sale.id }
  }

  it('seeds alongside real data without disturbing it', () => {
    const real = realTrade()
    const before = productService.getProduct(real.productId).stockQty
    const balanceBefore = partyService.getParty('customer', real.customerId).currentBalance

    demoDataService.seedDemoData()

    expect(productService.getProduct(real.productId).stockQty).toBe(before)
    expect(partyService.getParty('customer', real.customerId).currentBalance).toBe(balanceBefore)
  })

  it('removes only the samples, leaving the shop’s own records untouched', () => {
    const real = realTrade()
    const stockBefore = productService.getProduct(real.productId).stockQty
    const balanceBefore = partyService.getParty('customer', real.customerId).currentBalance

    demoDataService.seedDemoData()
    demoDataService.clearDemoData()

    // Everything the owner entered survives, with its numbers intact.
    expect(productService.listProducts({ status: 'all', limit: 500 }).total).toBe(1)
    expect(productService.getProduct(real.productId).stockQty).toBe(stockBefore)
    expect(partyService.getParty('customer', real.customerId).currentBalance).toBe(balanceBefore)
    expect(salesService.listSales({ limit: 10 }).total).toBe(1)
    expect(salesService.getSale(real.saleId).id).toBe(real.saleId)

    expect(stockDrift()).toBe(0)
    expect(balanceDrift()).toBe(0)
  })

  /**
   * A shop that has been trading for a week already has a "Grocery" category
   * and a "Rent" expense — both names the seeder wants, and both columns are
   * UNIQUE. Inserting blindly refused the whole seed on exactly the shops most
   * likely to press the button.
   */
  it('seeds into a shop that already uses the category names it wants', () => {
    const own = categoryService.addCategory('Grocery')
    const ownExpense = expenseService.addExpenseCategory('Rent')

    expect(() => demoDataService.seedDemoData()).not.toThrow()
    expect(demoDataService.demoStatus().present).toBe(true)

    // One category, not two — the shop's own, reused.
    const grocery = categoryService
      .listCategories()
      .filter((category) => category.name.toLowerCase() === 'grocery')
    expect(grocery).toHaveLength(1)
    expect(grocery[0]?.id).toBe(own.id)

    const rent = expenseService
      .listExpenseCategories()
      .filter((category) => category.name.toLowerCase() === 'rent')
    expect(rent).toHaveLength(1)
    expect(rent[0]?.id).toBe(ownExpense.id)
  })

  it('matches a category name the way a person reads it, not the index', () => {
    const own = categoryService.addCategory('grocery')

    demoDataService.seedDemoData()

    // "grocery" and "Grocery" would both satisfy the UNIQUE index, and the
    // shop would end up looking at two of what it thinks is one category.
    expect(
      categoryService.listCategories().filter((c) => c.name.toLowerCase() === 'grocery')
    ).toHaveLength(1)
    expect(categoryService.listCategories().find((c) => c.id === own.id)?.name).toBe('grocery')
  })

  it('leaves a reused category behind when the samples are removed', () => {
    const own = categoryService.addCategory('Grocery')
    const ownExpense = expenseService.addExpenseCategory('Rent')

    demoDataService.seedDemoData()
    demoDataService.clearDemoData()

    // The categories are the shop's, so removing the samples must not take
    // them — nor anything the shop has since filed under them.
    expect(categoryService.listCategories().map((c) => c.id)).toEqual([own.id])
    expect(expenseService.listExpenseCategories().map((c) => c.id)).toEqual([ownExpense.id])
  })

  it('refuses to remove samples the shop’s own records now depend on', () => {
    demoDataService.seedDemoData()

    // The owner bills a sample customer for real — easily done while trying
    // the app out, and exactly the case that must not silently cascade.
    const demoCustomer = partyService.listParties('customer', { limit: 1 }).rows[0]!
    const demoProduct = productService
      .listProducts({ limit: 200 })
      .rows.find((row) => row.ownership === 'own' && row.stockQty > 5)!

    const { sale } = salesService.createSale({
      customerId: demoCustomer.id,
      items: [{ productId: demoProduct.id, unitName: demoProduct.baseUnit, qty: 1, rate: 100 }],
      paymentType: 'credit',
      paidAmount: 0
    })
    // The bill is the owner's, so it is deliberately not in the manifest.
    db.prepare('DELETE FROM demo_records WHERE table_name = ? AND row_id = ?').run('sales', sale.id)

    const status = demoDataService.demoStatus()
    expect(status.blockers.length).toBeGreaterThan(0)
    expect(() => demoDataService.clearDemoData()).toThrow(/cannot be removed yet/i)

    // And nothing was removed on the way to refusing.
    expect(demoDataService.demoStatus().present).toBe(true)
  })
})
