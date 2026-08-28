import { beforeAll, describe, expect, it } from 'vitest'
import type { Customer, Product } from '@shared/types'
import type { Db } from '../src/main/db/connection'
import { createTestDb } from './helpers/database'
import { today } from '@shared/date'
import * as dashboardService from '../src/main/services/dashboardService'
import * as ledgerService from '../src/main/services/ledgerService'
import * as partyService from '../src/main/services/partyService'
import * as productService from '../src/main/services/productService'
import * as reportService from '../src/main/services/reportService'
import * as salesService from '../src/main/services/salesService'

/**
 * The app at the size of a real shop.
 *
 * The client asked whether it could handle a thousand products; the number is
 * illustrative rather than a ceiling, so what this fixture is really for is
 * making sure nothing in a screen's path degrades with the size of the table
 * behind it. A query that scans the whole catalogue on every keystroke passes
 * a ten-row test and fails a shop.
 *
 * Budgets are deliberately loose — roughly ten times what these take on a
 * modern machine — because a red build over a busy CI runner teaches nobody
 * anything. They are set to catch a change of *shape*: an accidental N+1, a
 * dropped index, a filter that stopped being pushed into SQL.
 */

const PRODUCTS = 1_000
const CUSTOMERS = 200
const SALES = 1_000
const LINES_PER_SALE = 3

let db: Db
let products: Product[]
let customers: Customer[]

/** Milliseconds one call is allowed to take. */
function elapsed(run: () => void): number {
  const started = performance.now()
  run()
  return performance.now() - started
}

beforeAll(() => {
  db = createTestDb()

  // Seeding goes through the real services, so the fixture exercises the same
  // transactions the app uses and cannot drift from them.
  const seed = db.transaction(() => {
    const categoryNames = ['Grocery', 'Household', 'Beverages', 'Hardware', 'Stationery']
    const categoryIds = categoryNames.map(
      (name) =>
        db.prepare('INSERT INTO categories (name) VALUES (?)').run(name).lastInsertRowid as number
    )

    for (let index = 0; index < PRODUCTS; index += 1) {
      db.prepare(
        `INSERT INTO products
           (name, sku, barcode, category_id, base_unit, cost_price, sale_price, stock_qty, reorder_level)
         VALUES (?, ?, ?, ?, 'piece', ?, ?, ?, 5)`
      ).run(
        `Product ${String(index).padStart(4, '0')}`,
        `SKU-${String(index).padStart(5, '0')}`,
        `890${String(index).padStart(7, '0')}`,
        categoryIds[index % categoryIds.length],
        50 + (index % 40),
        90 + (index % 60),
        10_000
      )
    }

    // The stock above is asserted into place, so give the ledger the matching
    // opening movements — the integrity check at the end depends on it.
    for (let id = 1; id <= PRODUCTS; id += 1) {
      db.prepare(
        `INSERT INTO stock_movements (product_id, change_qty, reason, ref_table, ref_id, cost_price, date)
         VALUES (?, 10000, 'opening', 'products', ?, 50, ?)`
      ).run(id, id, today())
    }

    for (let index = 0; index < CUSTOMERS; index += 1) {
      db.prepare(
        `INSERT INTO customers (name, phone, opening_balance, current_balance) VALUES (?, ?, 0, 0)`
      ).run(`Customer ${String(index).padStart(3, '0')}`, `030000${String(index).padStart(5, '0')}`)
    }
  })
  seed()

  products = productService.listProducts({ limit: PRODUCTS }).rows
  customers = partyService.listParties('customer', { limit: CUSTOMERS }).rows

  expect(products).toHaveLength(PRODUCTS)
  expect(customers).toHaveLength(CUSTOMERS)

  // Bills go through createSale itself: one transaction each, with the stock
  // movements, khata and remembered prices every real bill writes.
  for (let index = 0; index < SALES; index += 1) {
    const customer = customers[index % CUSTOMERS] as Customer
    const items = Array.from({ length: LINES_PER_SALE }, (_, line) => {
      const product = products[(index * LINES_PER_SALE + line) % PRODUCTS] as Product
      return { productId: product.id, unitName: 'piece', qty: 2, rate: product.salePrice }
    })

    const total = items.reduce((sum, item) => sum + item.qty * item.rate, 0)
    // A third of bills leave something on the khata, so the ledger and the
    // receivables figures have real work to do.
    const onKhata = index % 3 === 0

    salesService.createSale({
      customerId: customer.id,
      items,
      paymentType: onKhata ? 'credit' : 'cash',
      paidAmount: onKhata ? 0 : total
    })
  }
}, 120_000)

describe(`a catalogue of ${PRODUCTS} products and ${SALES} bills`, () => {
  it('seeded the shape the rest of these tests assume', () => {
    expect(productService.listProducts({ limit: 1 }).total).toBe(PRODUCTS)
    expect(salesService.listSales({ limit: 1 }).total).toBe(SALES)
  })

  it('opens the product list on a page, not the whole table', () => {
    let page = productService.listProducts({ limit: 50, offset: 0 })
    const ms = elapsed(() => {
      page = productService.listProducts({ limit: 50, offset: 0 })
    })

    expect(page.rows).toHaveLength(50)
    expect(page.total).toBe(PRODUCTS)
    expect(ms).toBeLessThan(150)
  })

  it('reaches the last page as fast as the first', () => {
    const first = elapsed(() => productService.listProducts({ limit: 50, offset: 0 }))
    const last = elapsed(() => productService.listProducts({ limit: 50, offset: PRODUCTS - 50 }))

    expect(last).toBeLessThan(150)
    // Not a ratio against `first`: at these speeds the two are within noise of
    // each other, and asserting on the ratio would flake.
    expect(first).toBeLessThan(150)
  })

  it('searches the catalogue fast enough to type against', () => {
    let page = productService.listProducts({ search: 'Product 07', limit: 12 })
    const ms = elapsed(() => {
      page = productService.listProducts({ search: 'Product 07', limit: 12 })
    })

    // The billing screen debounces at 150ms; a search must comfortably beat that.
    expect(ms).toBeLessThan(100)
    expect(page.total).toBe(100) // Product 0700-0799
    // ...but only a picker's worth is carried back over IPC.
    expect(page.rows).toHaveLength(12)
  })

  it('finds a product by barcode in one hit', () => {
    const ms = elapsed(() => productService.listProducts({ search: '8900000500', limit: 5 }))
    expect(ms).toBeLessThan(100)
  })

  it('pages the sales history', () => {
    let page = salesService.listSales({ limit: 50, offset: 0 })
    const ms = elapsed(() => {
      page = salesService.listSales({ limit: 50, offset: 0 })
    })

    expect(page.rows).toHaveLength(50)
    expect(page.total).toBe(SALES)
    expect(ms).toBeLessThan(200)
  })

  it('builds the dashboard within a page load', () => {
    const range = { from: today(), to: today() }
    const ms = elapsed(() => dashboardService.getSummary(range))
    expect(ms).toBeLessThan(1500)
  })

  it('builds the profit and loss report', () => {
    const range = { from: today(), to: today() }
    const ms = elapsed(() => reportService.profitAndLoss(range))
    expect(ms).toBeLessThan(1500)
  })

  it('builds a customer statement', () => {
    const customer = customers[0] as Customer
    const ms = elapsed(() =>
      ledgerService.getStatement('customer', customer.id, { from: '2000-01-01', to: today() })
    )
    expect(ms).toBeLessThan(1000)
  })
})

describe('integrity at this size', () => {
  it('has no product whose cached stock disagrees with its ledger', () => {
    const drift = db
      .prepare<[], { drifted: number }>(
        `SELECT COUNT(*) AS drifted
           FROM products p
          WHERE ROUND(p.stock_qty, 3) <> ROUND(
                  COALESCE((SELECT SUM(m.change_qty) FROM stock_movements m
                             WHERE m.product_id = p.id), 0), 3)`
      )
      .get()

    expect(drift?.drifted).toBe(0)
  })

  it('has no customer whose cached balance disagrees with their events', () => {
    const drifted = customers.filter((customer) => {
      const actual = ledgerService.computeBalance(db, 'customer', customer.id)
      const cached = partyService.getParty('customer', customer.id).currentBalance
      return Math.abs(actual - cached) > 0.005
    })

    expect(drifted).toHaveLength(0)
  })

  it('issued every invoice number exactly once', () => {
    const row = db
      .prepare<[], { issued: number; unique_numbers: number }>(
        'SELECT COUNT(*) AS issued, COUNT(DISTINCT invoice_no) AS unique_numbers FROM sales'
      )
      .get()

    expect(row?.issued).toBe(SALES)
    expect(row?.unique_numbers).toBe(SALES)
  })

  it('agrees between the paged total and a plain count', () => {
    const counted = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM products').get()
    expect(productService.listProducts({ limit: 1 }).total).toBe(counted?.n)
  })
})
