import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDatabase, databasePath, openDatabase, setDb } from '../src/main/db/connection'
import type { Db } from '../src/main/db/connection'
import { migrate } from '../src/main/db/migrate'
import { LATEST_VERSION, MIGRATIONS } from '../src/main/db/migrations'
import { computeBalance } from '../src/main/services/ledgerService'
import { reconcileStockCache } from '../src/main/services/inventoryService'
import * as partyService from '../src/main/services/partyService'
import * as productService from '../src/main/services/productService'
import * as purchaseService from '../src/main/services/purchaseService'
import * as salesService from '../src/main/services/salesService'

/**
 * What happens in the first second of a real launch.
 *
 * `bootstrapDatabase()` opens the file, migrates it and then verifies the two
 * derived caches before a window is shown. If any of that throws, the app does
 * not start at all — which makes it the single most important path in the
 * program and, until now, the only one with no test behind it.
 *
 * Every other suite runs against `:memory:`. This one uses a real file at the
 * real `databasePath()`, because the WAL sidecars and the on-disk migration are
 * part of what is being checked.
 */

let db: Db | null = null

afterEach(() => {
  if (db) {
    closeDatabase()
    db = null
  }
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(`${databasePath()}${suffix}`, { force: true })
    } catch {
      // A leftover test database is not worth failing a test over.
    }
  }
})

/** Opens a real database file the way the app does at launch. */
function launch(): Db {
  const opened = openDatabase(databasePath())
  setDb(opened)
  migrate(opened)
  db = opened
  return opened
}

/** The reconcile pass `bootstrapDatabase` runs, minus its Electron dependency. */
function reconcile(database: Db): { stockDrift: number; balanceDrift: number } {
  const stockDrift = reconcileStockCache(database)

  let balanceDrift = 0
  for (const type of ['customer', 'supplier'] as const) {
    const parties = database
      .prepare<[], { id: number; current_balance: number }>(
        `SELECT id, current_balance FROM ${type === 'customer' ? 'customers' : 'suppliers'}`
      )
      .all()

    for (const party of parties) {
      const actual = computeBalance(database, type, party.id)
      if (Math.abs(actual - party.current_balance) > 0.005) balanceDrift += 1
    }
  }

  return { stockDrift, balanceDrift }
}

describe('starting up on a fresh machine', () => {
  it('migrates an empty file all the way to the current schema', () => {
    const fresh = launch()
    expect(migrate(fresh)).toBe(LATEST_VERSION)
  })

  it('applies every migration exactly once and records each one', () => {
    const fresh = launch()

    const applied = fresh
      .prepare<[], { version: number; name: string }>(
        'SELECT version, name FROM schema_migrations ORDER BY version'
      )
      .all()

    expect(applied.map((row) => row.version)).toEqual(MIGRATIONS.map((m) => m.version))
    expect(applied.map((row) => row.name)).toEqual(MIGRATIONS.map((m) => m.name))
  })

  it('is idempotent — a second launch changes nothing', () => {
    const fresh = launch()
    const first = fresh
      .prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM schema_migrations')
      .get()

    migrate(fresh)
    migrate(fresh)

    const second = fresh
      .prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM schema_migrations')
      .get()

    expect(second?.n).toBe(first?.n)
  })

  it('finds no drift to repair in a database it just created', () => {
    const fresh = launch()
    expect(reconcile(fresh)).toEqual({ stockDrift: 0, balanceDrift: 0 })
  })

  it('seeds the single settings row the whole app reads', () => {
    const fresh = launch()
    const row = fresh.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM settings').get()
    expect(row?.n).toBe(1)
  })
})

describe('starting up on a shop that has been trading', () => {
  /** A day's worth of real activity, written through the real services. */
  function trade(): void {
    const customer = partyService.addParty('customer', { name: 'Karim General Store' })
    const product = productService.addProduct({
      name: 'Detergent 1kg',
      baseUnit: 'piece',
      costPrice: 0,
      salePrice: 150,
      reorderLevel: 10
    })
    purchaseService.createPurchase({
      items: [{ productId: product.id, unitName: 'piece', qty: 100, unitCost: 100 }],
      // Paid in full: a purchase that leaves money owed needs a supplier to
      // owe it to, and this fixture deliberately has none.
      paidAmount: 10_000
    })

    const consignment = productService.addProduct({
      name: 'Imported Blender',
      baseUnit: 'piece',
      costPrice: 0,
      salePrice: 200,
      reorderLevel: 0,
      ownership: 'other',
      ownerName: 'Bilal Electronics',
      openingStock: 20
    })

    salesService.createSale({
      customerId: customer.id,
      items: [
        { productId: product.id, unitName: 'piece', qty: 10, rate: 150 },
        { productId: consignment.id, unitName: 'piece', qty: 2, rate: 200 }
      ],
      paymentType: 'credit',
      paidAmount: 0
    })
  }

  it('reopens a populated database with both caches intact', () => {
    const first = launch()
    trade()

    // Close and reopen, exactly as quitting and relaunching would.
    closeDatabase()
    db = null
    const second = launch()

    expect(reconcile(second)).toEqual({ stockDrift: 0, balanceDrift: 0 })
    expect(first).not.toBe(second)
  })

  it('still reads back the trade it recorded before the restart', () => {
    launch()
    trade()

    closeDatabase()
    db = null
    launch()

    const sales = salesService.listSales()
    expect(sales.total).toBe(1)
    expect(sales.rows[0]?.total).toBe(1900)
    // The consignment split survives a round trip through the file.
    expect(sales.rows[0]?.otherSubtotal).toBe(400)

    const products = productService.listProducts()
    expect(products.total).toBe(2)
    expect(products.rows.find((row) => row.name === 'Detergent 1kg')?.stockQty).toBe(90)
    expect(products.rows.find((row) => row.name === 'Imported Blender')?.stockQty).toBe(18)

    const customers = partyService.listParties('customer')
    expect(customers.rows[0]?.currentBalance).toBe(1900)
  })

  it('repairs a cache that has been corrupted behind the app’s back', () => {
    const database = launch()
    trade()

    // Simulate the failure the reconcilers exist for: the cached total no
    // longer matches the ledger. This is exactly what a half-written
    // transaction or a hand-edited file would leave behind.
    database.prepare("UPDATE products SET stock_qty = 999 WHERE name = 'Detergent 1kg'").run()

    const repaired = reconcileStockCache(database)
    expect(repaired).toBe(1)

    expect(
      productService.listProducts().rows.find((row) => row.name === 'Detergent 1kg')?.stockQty
    ).toBe(90)
  })
})
