import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, getDb } from '../src/main/db/connection'
import { createTestDb } from './helpers/database'
import * as products from '../src/main/services/productService'
import * as parties from '../src/main/services/partyService'
import * as sales from '../src/main/services/salesService'
import * as returns from '../src/main/services/returnService'
import * as payments from '../src/main/services/paymentService'
import * as inventory from '../src/main/services/inventoryService'
import * as ledger from '../src/main/services/ledgerService'
import * as reports from '../src/main/services/reportService'

describe('repeated trading and rollback', () => {
  afterEach(() => closeDatabase())

  it('keeps independent stock and debt totals after 250 sale/edit/settle/return/void cycles', () => {
    createTestDb()
    const customer = parties.addParty('customer', { name: 'Regular customer' })
    const product = products.addProduct({
      name: 'Soap',
      baseUnit: 'piece',
      costPrice: 10,
      salePrice: 15,
      reorderLevel: 0,
      openingStock: 10000
    })
    let expectedStock = 10000
    let expectedDebt = 0
    for (let index = 0; index < 250; index++) {
      const input = {
        customerId: customer.id,
        items: [{ productId: product.id, unitName: 'piece', qty: 4, rate: 15 }],
        paymentType: 'credit' as const,
        paidAmount: 0
      }
      const { sale } = sales.createSale(input)
      sales.updateSale({ ...input, id: sale.id, items: [{ ...input.items[0]!, qty: 3 }] })
      sales.settleSale({ id: sale.id, paidAmount: 15 })
      if (index % 2 === 0) {
        sales.voidSale({ id: sale.id })
      } else {
        returns.createSaleReturn({
          saleId: sale.id,
          items: [{ productId: product.id, unitName: 'piece', qty: 1, rate: 15 }],
          refundType: 'credit'
        })
        const payment = payments.createPayment({
          partyType: 'customer',
          partyId: customer.id,
          amount: 5
        })
        if (index % 3 === 0) payments.removePayment(payment.id)
        expectedStock -= 2
        expectedDebt += index % 3 === 0 ? 15 : 10
      }
    }
    expect(products.getProduct(product.id).stockQty).toBe(expectedStock)
    expect(parties.getParty('customer', customer.id).currentBalance).toBe(expectedDebt)
    expect(ledger.computeBalance(getDb(), 'customer', customer.id)).toBe(expectedDebt)
    expect(inventory.reconcileStockCache(getDb())).toBe(0)
    expect(getDb().pragma('integrity_check', { simple: true })).toBe('ok')
    expect(getDb().pragma('foreign_key_check')).toEqual([])
  }, 30000)

  it('rolls back the whole bill if storage fails after the header was inserted', () => {
    const db = createTestDb()
    const customer = parties.addParty('customer', { name: 'Customer' })
    const product = products.addProduct({
      name: 'Soap',
      baseUnit: 'piece',
      costPrice: 10,
      salePrice: 15,
      reorderLevel: 0,
      openingStock: 10
    })
    const nextInvoice = sales.peekNextInvoiceNo()
    db.exec(`CREATE TRIGGER fail_sale_movement BEFORE INSERT ON stock_movements
      WHEN NEW.reason = 'sale' BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END;`)
    expect(() =>
      sales.createSale({
        customerId: customer.id,
        items: [{ productId: product.id, unitName: 'piece', qty: 2, rate: 15 }],
        paymentType: 'credit',
        paidAmount: 0
      })
    ).toThrow(/simulated storage failure/)
    expect(sales.listSales().total).toBe(0)
    expect(products.getProduct(product.id).stockQty).toBe(10)
    expect(parties.getParty('customer', customer.id).currentBalance).toBe(0)
    expect(sales.peekNextInvoiceNo()).toBe(nextInvoice)
    expect(db.prepare('SELECT COUNT(*) AS n FROM sale_items').get()).toEqual({ n: 0 })
  })
})

describe('six years of history: 100,000 bills, 1,000 products, 200 customers', () => {
  const range = { from: '2020-01-01', to: '2026-12-31' }
  beforeAll(() => {
    const db = createTestDb()
    // Synthetic history isolates query growth from the service-cycle test above.
    // Totals are known independently: 100,000 x (2 units x 15), with 10 paid.
    db.transaction(() => {
      db.exec(`
        WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000)
        INSERT INTO products (id, name, sku, base_unit, cost_price, sale_price, stock_qty, reorder_level)
          SELECT x, 'Product ' || x, 'SKU-' || x, 'piece', 10, 15, 800, 5 FROM n;
        WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<200)
        INSERT INTO customers (id, name, opening_balance, current_balance)
          SELECT x, 'Customer ' || x, 0, 10000 FROM n;
        WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100000)
        INSERT INTO sales (id, invoice_no, customer_id, date, subtotal, discount, tax, total, paid_amount, payment_type)
          SELECT x, printf('INV-%06d', x), (x-1)%200+1,
            date('2020-01-01', '+' || ((x-1)%2190) || ' days'), 30, 0, 0, 30, 10, 'partial' FROM n;
        INSERT INTO sale_items (sale_id, product_id, unit_name, factor, qty, base_qty, rate, line_discount, cost_price, amount)
          SELECT id, (id-1)%1000+1, 'piece', 1, 2, 2, 15, 0, 10, 30 FROM sales;
        INSERT INTO stock_movements (product_id, change_qty, reason, ref_table, ref_id, cost_price, date)
          SELECT id, 1000, 'opening', 'products', id, 10, '2020-01-01' FROM products;
        INSERT INTO stock_movements (product_id, change_qty, reason, ref_table, ref_id, cost_price, date)
          SELECT (id-1)%1000+1, -2, 'sale', 'sales', id, 10, date FROM sales;
      `)
    })()
  }, 30000)
  afterAll(() => closeDatabase())

  it('returns exact totals and bounded pages at the end of the history', () => {
    const measurements: Record<string, number> = {}
    let started = performance.now()
    const page = sales.listSales({ limit: 50, offset: 99950 })
    measurements.lastSalesPageMs = performance.now() - started
    expect(page.total).toBe(100000)
    expect(page.rows).toHaveLength(50)
    started = performance.now()
    const pnl = reports.profitAndLoss(range)
    measurements.profitLossMs = performance.now() - started
    expect(pnl.grossSales).toBe(3000000)
    expect(pnl.cogs).toBe(2000000)
    expect(pnl.netProfit).toBe(1000000)
    started = performance.now()
    expect(ledger.computeBalance(getDb(), 'customer', 1)).toBe(10000)
    measurements.customerBalanceMs = performance.now() - started
    started = performance.now()
    expect(products.listProducts({ search: 'SKU-999', limit: 12 }).total).toBe(1)
    measurements.productSearchMs = performance.now() - started
    console.info('100k history timings (ms):', measurements)
    for (const ms of Object.values(measurements)) expect(ms).toBeLessThan(2000)
  })

  it('has no stock drift or foreign-key damage after the large load', () => {
    expect(inventory.reconcileStockCache(getDb())).toBe(0)
    expect(getDb().pragma('integrity_check', { simple: true })).toBe('ok')
    expect(getDb().pragma('foreign_key_check')).toEqual([])
  })
})
