import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate } from '../src/main/db/migrate'
import { assertUsableBackup } from '../src/main/services/backupService'
import * as productService from '../src/main/services/productService'
import { createTestDb } from './helpers/database'

/**
 * A restore that swaps the live database for a broken file, with no automatic
 * way back, is worse than not restoring at all — so the file is validated
 * before anything destructive happens. These pin the three shapes of "not a
 * usable backup" that would otherwise only surface after the swap.
 */
describe('assertUsableBackup', () => {
  it('accepts a real, migrated database', () => {
    createTestDb()
    productService.addProduct({
      name: 'Test product',
      baseUnit: 'piece',
      costPrice: 10,
      salePrice: 15,
      reorderLevel: 0
    })

    const dir = mkdtempSync(join(tmpdir(), 'pos-backup-test-'))
    const path = join(dir, 'valid.db')
    const file = new Database(path)
    migrate(file)
    file
      .prepare(
        'INSERT INTO products (name, base_unit, cost_price, sale_price, reorder_level, stock_qty) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run('Test product', 'piece', 10, 15, 0, 0)
    file.close()

    expect(() => assertUsableBackup(path)).not.toThrow()
  })

  it('rejects a file that is not a database at all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-backup-test-'))
    const path = join(dir, 'not-a-db.db')
    writeFileSync(path, 'this is a text file, not sqlite')

    expect(() => assertUsableBackup(path)).toThrow(/could not be opened/i)
  })

  it('rejects a valid but empty or unrelated sqlite file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-backup-test-'))
    const path = join(dir, 'empty.db')
    const file = new Database(path)
    file.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY)')
    file.close()

    expect(() => assertUsableBackup(path)).toThrow(/does not look like a POS backup/i)
  })
})
