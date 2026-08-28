import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import type { Db } from '../src/main/db/connection'
import { migrate } from '../src/main/db/migrate'
import { LATEST_VERSION, MIGRATIONS } from '../src/main/db/migrations'

/**
 * The upgrade path, not the fresh install.
 *
 * Every other test starts from a fully migrated empty database, which is the
 * one case migration 0005 cannot get wrong. The case that matters is the shop's
 * own file: products already in it, some of them sharing a barcode because
 * nothing stopped that until now. A migration that throws there does not
 * produce a warning — it aborts startup, and the owner cannot open the app at
 * all. So this asserts the upgrade survives exactly the mess it was written for.
 */

/** A database at schema version 4 — the state a live install is upgrading from. */
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

function addProduct(db: Db, name: string, barcode: string | null): number {
  return db
    .prepare(
      `INSERT INTO products (name, base_unit, cost_price, sale_price, barcode)
       VALUES (?, 'piece', 10, 20, ?)`
    )
    .run(name, barcode).lastInsertRowid as number
}

describe('upgrading a live database to 0005', () => {
  it('applies cleanly when barcodes are already unique', () => {
    const db = databaseAtVersion(4)
    addProduct(db, 'Soap', '111')
    addProduct(db, 'Rice', '222')

    expect(() => migrate(db)).not.toThrow()

    const rows = db
      .prepare<[], { name: string; barcode: string | null }>(
        'SELECT name, barcode FROM products ORDER BY name'
      )
      .all()
    expect(rows).toEqual([
      { name: 'Rice', barcode: '222' },
      { name: 'Soap', barcode: '111' }
    ])
  })

  it('does not abort startup over duplicates that were already there', () => {
    const db = databaseAtVersion(4)
    const first = addProduct(db, 'Soap Large', '111')
    const second = addProduct(db, 'Soap Small', '111')
    const third = addProduct(db, 'Soap Refill', '111')

    expect(() => migrate(db)).not.toThrow()

    const kept = db
      .prepare<[number], { barcode: string | null }>('SELECT barcode FROM products WHERE id = ?')
      .get(first)
    // The lowest id keeps it; the scan was already returning an arbitrary one
    // of the three, so nothing reliable is lost by clearing the others.
    expect(kept?.barcode).toBe('111')

    for (const id of [second, third]) {
      const row = db
        .prepare<[number], { barcode: string | null; name: string }>(
          'SELECT barcode, name FROM products WHERE id = ?'
        )
        .get(id)
      expect(row?.barcode).toBeNull()
      // The products themselves survive — only the ambiguous barcode goes.
      expect(row?.name).toMatch(/^Soap /)
    }
  })

  it('normalises blank barcodes to NULL so they stop colliding', () => {
    const db = databaseAtVersion(4)
    addProduct(db, 'One', '')
    addProduct(db, 'Two', '   ')
    addProduct(db, 'Three', null)

    expect(() => migrate(db)).not.toThrow()

    const withBarcode = db
      .prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM products WHERE barcode IS NOT NULL')
      .get()
    expect(withBarcode?.n).toBe(0)
    expect(db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM products').get()?.n).toBe(3)
  })

  it('refuses a duplicate barcode from then on', () => {
    const db = databaseAtVersion(4)
    addProduct(db, 'Soap Large', '111')
    addProduct(db, 'Soap Small', '111')
    migrate(db)

    expect(() => addProduct(db, 'Shampoo', '111')).toThrow(/UNIQUE/i)
  })

  it('carries an old install all the way to the current schema', () => {
    const db = databaseAtVersion(4)
    addProduct(db, 'Soap', '111')

    // Read from the registry rather than hardcoded, so adding a migration does
    // not fail a test about the upgrade *path*.
    expect(migrate(db)).toBe(LATEST_VERSION)
  })
})
