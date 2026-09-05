import { describe, expect, it } from 'vitest'
import { openDatabase, setDb } from '../src/main/db/connection'
import type { Db } from '../src/main/db/connection'
import { migrate } from '../src/main/db/migrate'
import { LATEST_VERSION, MIGRATIONS } from '../src/main/db/migrations'
import * as salesService from '../src/main/services/salesService'

/**
 * The upgrade path to 0009, not the fresh install.
 *
 * Every other Phase 4 test starts from a fully migrated database. The case
 * that matters is the shop's own file: bills already in it, written before
 * `voided_at` and `sale_revisions` existed. A migration that throws there does
 * not produce a warning — it aborts startup and the owner cannot open the app.
 *
 * The specific risk here is small but real: `voided_at` is added to a table
 * that already has rows, and every existing bill has to come out of it as
 * *live*. A default of anything but NULL would cancel a shop's entire history
 * in one launch.
 */

/** A database at schema version 8 — what a live install is upgrading from. */
function databaseAtVersion(version: number): Db {
  const db = openDatabase(':memory:')

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `)

  const record = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
  for (const migration of MIGRATIONS.filter((entry) => entry.version <= version)) {
    db.exec(migration.sql)
    record.run(migration.version, migration.name)
  }
  return db
}

/** A shop with one customer, one product in stock and one bill against it. */
function seedVersion8(db: Db): { saleId: number; customerId: number; productId: number } {
  const customerId = db
    .prepare("INSERT INTO customers (name, current_balance) VALUES ('Karim General Store', 1500)")
    .run().lastInsertRowid as number

  const productId = db
    .prepare(
      `INSERT INTO products (name, base_unit, cost_price, sale_price, stock_qty)
       VALUES ('Detergent 1kg', 'piece', 100, 150, 90)`
    )
    .run().lastInsertRowid as number

  const saleId = db
    .prepare(
      `INSERT INTO sales (invoice_no, customer_id, date, subtotal, total, paid_amount, payment_type)
       VALUES ('INV-000001', ?, '2026-01-15', 1500, 1500, 0, 'credit')`
    )
    .run(customerId).lastInsertRowid as number

  db.prepare(
    `INSERT INTO sale_items (sale_id, product_id, unit_name, factor, qty, base_qty, rate, cost_price, amount)
     VALUES (?, ?, 'piece', 1, 10, 10, 150, 100, 1500)`
  ).run(saleId, productId)

  db.prepare(
    `INSERT INTO stock_movements (product_id, change_qty, reason, ref_table, ref_id, cost_price, date)
     VALUES (?, -10, 'sale', 'sales', ?, 100, '2026-01-15')`
  ).run(productId, saleId)

  return { saleId, customerId, productId }
}

describe('upgrading a live database to 0009', () => {
  it('applies cleanly and reaches the latest schema version', () => {
    const db = databaseAtVersion(8)
    seedVersion8(db)

    expect(() => migrate(db)).not.toThrow()
    expect(migrate(db)).toBe(LATEST_VERSION)
  })

  it('leaves every bill that already existed live, not cancelled', () => {
    const db = databaseAtVersion(8)
    seedVersion8(db)

    migrate(db)

    const rows = db
      .prepare<[], { invoice_no: string; voided_at: string | null; total: number }>(
        'SELECT invoice_no, voided_at, total FROM sales'
      )
      .all()
    expect(rows).toEqual([{ invoice_no: 'INV-000001', voided_at: null, total: 1500 }])
  })

  it('starts the history empty, and every old bill therefore reads as unedited', () => {
    const db = databaseAtVersion(8)
    const { saleId } = seedVersion8(db)

    migrate(db)
    setDb(db)

    expect(salesService.listSaleRevisions(saleId)).toEqual([])
  })

  it('lets an upgraded bill be settled, edited and cancelled like any other', () => {
    const db = databaseAtVersion(8)
    const { saleId, productId } = seedVersion8(db)

    migrate(db)
    setDb(db)

    // Settle: money only.
    expect(salesService.settleSale({ id: saleId, paidAmount: 500 }).paymentType).toBe('partial')

    // Edit: the pre-upgrade line's frozen cost of 100 is carried forward, and
    // the stock movement written before the upgrade is reversed with the rest.
    const { sale } = salesService.updateSale({
      id: saleId,
      customerId: 1,
      items: [{ productId, unitName: 'piece', qty: 6, rate: 150 }],
      paymentType: 'partial',
      paidAmount: 500
    })
    expect(sale.invoiceNo).toBe('INV-000001')
    expect(sale.items[0].costPrice).toBe(100)
    expect(
      db.prepare<[], { qty: number }>('SELECT stock_qty AS qty FROM products').get()?.qty
    ).toBe(94)

    // Cancel: everything goes back.
    salesService.voidSale({ id: saleId })
    expect(
      db.prepare<[], { qty: number }>('SELECT stock_qty AS qty FROM products').get()?.qty
    ).toBe(100)
    expect(salesService.listSaleRevisions(saleId)).toHaveLength(3)
  })

  it('removes a bill’s history with the bill, and never before', () => {
    const db = databaseAtVersion(8)
    const { saleId } = seedVersion8(db)

    migrate(db)
    setDb(db)
    salesService.settleSale({ id: saleId, paidAmount: 1500 })

    expect(
      db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM sale_revisions').get()?.count
    ).toBe(1)

    // ON DELETE CASCADE — the sample-data remover deletes sales directly, and
    // must not leave revisions of bills that no longer exist behind it.
    db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(saleId)
    db.prepare('DELETE FROM sales WHERE id = ?').run(saleId)

    expect(
      db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM sale_revisions').get()?.count
    ).toBe(0)
  })
})
