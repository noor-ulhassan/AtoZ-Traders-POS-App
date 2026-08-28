import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import type { Db } from '../src/main/db/connection'
import { migrate } from '../src/main/db/migrate'
import { LATEST_VERSION, MIGRATIONS } from '../src/main/db/migrations'

/**
 * The riskiest migration in the app so far.
 *
 * SQLite cannot widen a CHECK constraint in place, so adding the two new stock
 * movement reasons means rebuilding `stock_movements` — copy every row into a
 * new table, drop the old one, rename. That table is the source of truth for
 * every quantity in the shop. Losing a row, an id, or an index during the
 * rebuild would not announce itself; it would show up weeks later as stock that
 * does not add up.
 *
 * So this walks a populated version-6 database through the upgrade and checks
 * the ledger came out the other side intact, down to the row ids.
 */

/** A database at `version`, the state a live install is upgrading from. */
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

/** A shop mid-life: products, a bill, and a ledger explaining the shelf. */
function seedShop(db: Db): void {
  db.prepare(
    `INSERT INTO products (id, name, base_unit, cost_price, sale_price, stock_qty, reorder_level)
     VALUES (1, 'Detergent 1kg', 'piece', 100, 150, 90, 10),
            (2, 'Rice 5kg', 'piece', 800, 950, 40, 5)`
  ).run()

  db.prepare(
    `INSERT INTO customers (id, name, opening_balance, current_balance)
     VALUES (1, 'Karim General Store', 0, 0)`
  ).run()

  db.prepare(
    `INSERT INTO sales (id, invoice_no, customer_id, date, subtotal, discount, tax, total,
                        paid_amount, payment_type)
     VALUES (1, 'INV-000001', 1, '2026-08-01', 1500, 0, 0, 1500, 1500, 'cash')`
  ).run()

  db.prepare(
    `INSERT INTO sale_items (id, sale_id, product_id, unit_name, factor, qty, base_qty,
                             rate, line_discount, cost_price, amount)
     VALUES (1, 1, 1, 'piece', 1, 10, 10, 150, 0, 100, 1500)`
  ).run()

  db.prepare(
    `INSERT INTO stock_movements (id, product_id, change_qty, reason, ref_table, ref_id,
                                  cost_price, date, notes)
     VALUES (1, 1, 100, 'opening',  'products',  1, 100, '2026-07-01', 'Opening stock'),
            (2, 1, -10, 'sale',     'sales',     1, 100, '2026-08-01', NULL),
            (3, 2,  40, 'purchase', 'purchases', 1, 800, '2026-07-15', 'First delivery'),
            (4, 1,   0, 'adjustment','products', 1, 100, '2026-08-02', 'Recount, no change')`
  ).run()
}

describe('upgrading a populated database to 0007', () => {
  it('applies without aborting startup', () => {
    const db = databaseAtVersion(6)
    seedShop(db)

    expect(() => migrate(db)).not.toThrow()
    expect(migrate(db)).toBe(LATEST_VERSION)
  })

  it('carries every stock movement across the rebuild, ids and all', () => {
    const db = databaseAtVersion(6)
    seedShop(db)

    const before = db
      .prepare<[], Record<string, unknown>>('SELECT * FROM stock_movements ORDER BY id')
      .all()

    migrate(db)

    const after = db
      .prepare<[], Record<string, unknown>>('SELECT * FROM stock_movements ORDER BY id')
      .all()

    // Same rows, same ids, same values. `ref_id` in particular has to survive:
    // it is how a sale's movements are found again.
    expect(after).toEqual(before)
    expect(after).toHaveLength(4)
  })

  it('keeps the ledger agreeing with the cached stock', () => {
    const db = databaseAtVersion(6)
    seedShop(db)
    migrate(db)

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

  it('rebuilds the indexes the rebuilt table lost', () => {
    const db = databaseAtVersion(6)
    seedShop(db)
    migrate(db)

    const indexes = db
      .prepare<[], { name: string }>(
        `SELECT name FROM sqlite_master
          WHERE type = 'index' AND tbl_name = 'stock_movements' AND name LIKE 'idx_%'
          ORDER BY name`
      )
      .all()
      .map((row) => row.name)

    // Without these the stock ledger goes back to a full scan per lookup.
    expect(indexes).toEqual(['idx_movements_date', 'idx_movements_product', 'idx_movements_ref'])
  })

  it('keeps new ids climbing from where the old table left off', () => {
    const db = databaseAtVersion(6)
    seedShop(db)
    migrate(db)

    const id = db
      .prepare(
        `INSERT INTO stock_movements (product_id, change_qty, reason, date)
         VALUES (1, 5, 'other_in', '2026-08-28')`
      )
      .run().lastInsertRowid

    expect(Number(id)).toBeGreaterThan(4)
  })

  it('accepts the two new reasons and still refuses nonsense', () => {
    const db = databaseAtVersion(6)
    seedShop(db)
    migrate(db)

    const insert = (reason: string): unknown =>
      db
        .prepare(
          `INSERT INTO stock_movements (product_id, change_qty, reason, date)
           VALUES (1, 1, ?, '2026-08-28')`
        )
        .run(reason)

    expect(() => insert('other_in')).not.toThrow()
    expect(() => insert('other_out')).not.toThrow()
    // The CHECK still has to be a real constraint afterwards, not a casualty.
    expect(() => insert('nonsense')).toThrow(/CHECK/i)
  })

  it('defaults every existing product to the shop’s own stock', () => {
    const db = databaseAtVersion(6)
    seedShop(db)
    migrate(db)

    const rows = db
      .prepare<[], { ownership: string; owner_name: string }>(
        'SELECT ownership, owner_name FROM products'
      )
      .all()

    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.ownership).toBe('own')
      expect(row.owner_name).toBe('')
    }
  })

  it('leaves existing bills reading exactly as they did', () => {
    const db = databaseAtVersion(6)
    seedShop(db)
    migrate(db)

    const sale = db
      .prepare<[], { subtotal: number; other_subtotal: number; total: number }>(
        'SELECT subtotal, other_subtotal, total FROM sales WHERE id = 1'
      )
      .get()

    expect(sale?.subtotal).toBe(1500)
    expect(sale?.total).toBe(1500)
    // Nothing on an old bill was consignment, so none of it is carved out.
    expect(sale?.other_subtotal).toBe(0)

    const item = db
      .prepare<[], { is_other: number; cost_price: number }>(
        'SELECT is_other, cost_price FROM sale_items WHERE id = 1'
      )
      .get()

    expect(item?.is_other).toBe(0)
    expect(item?.cost_price).toBe(100)
  })
})
