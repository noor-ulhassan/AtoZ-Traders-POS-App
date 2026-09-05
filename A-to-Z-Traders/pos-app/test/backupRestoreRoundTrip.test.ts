import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dialog } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, databasePath, openDatabase, setDb } from '../src/main/db/connection'
import { migrate } from '../src/main/db/migrate'
import { LATEST_VERSION, MIGRATIONS } from '../src/main/db/migrations'
import { isBusy } from '../src/main/ipc/maintenance'
import * as backupService from '../src/main/services/backupService'
import * as partyService from '../src/main/services/partyService'
import * as productService from '../src/main/services/productService'
import * as salesService from '../src/main/services/salesService'
import * as settingsService from '../src/main/services/settingsService'

/**
 * Restoring a backup, all the way through.
 *
 * Everything up to the swap is covered elsewhere — the folder guard, the
 * "is this really a POS backup" probe, the half-written file. What was not
 * covered is the swap itself, which is the most destructive thing the program
 * does: it closes the live connection, renames `pos.db` aside and copies a
 * different file into its place. If that goes wrong on a shop counter the
 * owner loses the day, so it is worth proving on real files that the data
 * afterwards is the backup's data, that the pre-restore database is still
 * there to go back to, and that the app keeps working without a relaunch.
 *
 * This suite therefore uses a real file at `databasePath()` rather than
 * `:memory:`, and stands in for the one thing a test cannot click: the native
 * "Restore and replace" confirmation.
 */

let folder: string
const temporary: string[] = []

function makeFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pos-restore-'))
  temporary.push(dir)
  return dir
}

/** Opens a real database file the way the app does at launch. */
function launch(): void {
  const db = openDatabase(databasePath())
  setDb(db)
  migrate(db)
}

function wipeDatabaseFile(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(`${databasePath()}${suffix}`, { force: true })
    } catch {
      // A leftover test database is not worth failing a test over.
    }
  }
}

/** The owner presses "Restore and replace". */
function confirmTheDialog(): void {
  vi.spyOn(dialog, 'showMessageBox').mockResolvedValue({
    response: 0,
    checkboxChecked: false
  } as Awaited<ReturnType<typeof dialog.showMessageBox>>)
}

/** The owner presses "Cancel". */
function cancelTheDialog(): void {
  vi.spyOn(dialog, 'showMessageBox').mockResolvedValue({
    response: 1,
    checkboxChecked: false
  } as Awaited<ReturnType<typeof dialog.showMessageBox>>)
}

/** A shop with one product, one customer and one bill on the khata. */
function trade(): { productId: number; customerId: number } {
  const customer = partyService.addParty('customer', { name: 'Bilal Kiryana Store' })
  const product = productService.addProduct({
    name: 'Cooking oil 5L',
    baseUnit: 'bottle',
    costPrice: 1300,
    salePrice: 1450,
    reorderLevel: 5,
    openingStock: 40
  })

  salesService.createSale({
    customerId: customer.id,
    items: [{ productId: product.id, unitName: 'bottle', qty: 10, rate: 1450 }],
    paymentType: 'credit',
    paidAmount: 0
  })

  return { productId: product.id, customerId: customer.id }
}

beforeEach(() => {
  wipeDatabaseFile()
  launch()
  backupService.resetBackupSession()
  folder = makeFolder()
  settingsService.updateSettings({ autoBackupDir: folder })
})

afterEach(() => {
  closeDatabase()
  wipeDatabaseFile()
  for (const dir of temporary.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Same: a leftover temp folder is not a test failure.
    }
  }
})

describe('restoring a backup over the live database', () => {
  it('puts the shop back exactly as the backup left it', async () => {
    const { productId, customerId } = trade()
    const backup = await backupService.backupToConfiguredFolder()

    // The day carries on after the backup: more goods sold, more owed.
    salesService.createSale({
      customerId,
      items: [{ productId, unitName: 'bottle', qty: 5, rate: 1450 }],
      paymentType: 'credit',
      paidAmount: 0
    })
    expect(productService.getProduct(productId).stockQty).toBe(25)
    expect(partyService.getParty('customer', customerId).currentBalance).toBe(21750)
    expect(salesService.listSales().total).toBe(2)

    confirmTheDialog()
    const result = await backupService.restoreFromPath(backup.path)

    // Everything after the backup is gone, and everything in it is back —
    // read through the services, on the reopened connection, with no relaunch.
    expect(salesService.listSales().total).toBe(1)
    expect(productService.getProduct(productId).stockQty).toBe(30)
    expect(partyService.getParty('customer', customerId).currentBalance).toBe(14500)
    expect(result.restoredFrom).toBe(backup.path)
  })

  it('keeps the pre-restore database so a wrong restore is recoverable', async () => {
    trade()
    const backup = await backupService.backupToConfiguredFolder()

    confirmTheDialog()
    const result = await backupService.restoreFromPath(backup.path)

    expect(existsSync(result.safetyCopyPath)).toBe(true)
    // And it is a real database, not a stub — the owner can restore it back.
    expect(() => backupService.assertUsableBackup(result.safetyCopyPath)).not.toThrow()
  })

  it('leaves the app usable straight away — the next sale still writes', async () => {
    const { productId, customerId } = trade()
    const backup = await backupService.backupToConfiguredFolder()

    confirmTheDialog()
    await backupService.restoreFromPath(backup.path)

    // The connection was closed and reopened underneath us; a write must land.
    const { sale } = salesService.createSale({
      customerId,
      items: [{ productId, unitName: 'bottle', qty: 2, rate: 1450 }],
      paymentType: 'cash',
      paidAmount: 2900
    })

    expect(sale.total).toBe(2900)
    expect(productService.getProduct(productId).stockQty).toBe(28)
    expect(salesService.listSales().total).toBe(2)
  })

  it('clears maintenance mode once the swap is done', async () => {
    trade()
    const backup = await backupService.backupToConfiguredFolder()

    confirmTheDialog()
    await backupService.restoreFromPath(backup.path)

    // The IPC guard turns business channels away while this is set; a restore
    // that left it on would lock the till until the app was restarted.
    expect(isBusy()).toBe(false)
  })

  it('changes nothing when the owner cancels the confirmation', async () => {
    const { productId, customerId } = trade()
    const backup = await backupService.backupToConfiguredFolder()

    salesService.createSale({
      customerId,
      items: [{ productId, unitName: 'bottle', qty: 5, rate: 1450 }],
      paymentType: 'credit',
      paidAmount: 0
    })

    cancelTheDialog()
    await expect(backupService.restoreFromPath(backup.path)).rejects.toThrow(/cancelled/i)

    // The second bill is still there; nothing was swapped.
    expect(salesService.listSales().total).toBe(2)
    expect(productService.getProduct(productId).stockQty).toBe(25)
    expect(isBusy()).toBe(false)
  })

  it('refuses a corrupt file before anything is swapped', async () => {
    trade()
    const stockBefore = productService.listProducts().rows[0]?.stockQty

    const junk = join(folder, 'pos-backup-20260828-120000.db')
    writeFileSync(junk, 'this is not a database')

    confirmTheDialog()
    await expect(backupService.restoreFromPath(junk)).rejects.toThrow()

    // The live database is untouched and still answering.
    expect(productService.listProducts().rows[0]?.stockQty).toBe(stockBefore)
    expect(salesService.listSales().total).toBe(1)
    expect(isBusy()).toBe(false)
  })

  it('brings a backup from an older version up to the current schema', async () => {
    trade()

    // A backup taken before the app was updated: the same data, but only the
    // migrations that existed then. Built by hand rather than by rewinding a
    // current file, so the restore really has to run 0009 against a schema
    // that has never seen it.
    const old = join(folder, 'pos-backup-20250101-090000.db')
    const older = openDatabase(old)
    older.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
    `)
    const record = older.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
    for (const migration of MIGRATIONS.filter((m) => m.version < LATEST_VERSION)) {
      older.exec(migration.sql)
      record.run(migration.version, migration.name)
    }
    older
      .prepare(
        `INSERT INTO sales (invoice_no, customer_id, date, subtotal, discount, tax, total,
                            paid_amount, payment_type)
         VALUES ('INV-000001', NULL, date('now','localtime'), 100, 0, 0, 100, 100, 'cash')`
      )
      .run()
    older.close()

    confirmTheDialog()
    await backupService.restoreFromPath(old)

    // The schema is current again, and the older file's data came with it.
    expect(backupService.databaseInfo().schemaVersion).toBe(LATEST_VERSION)
    expect(salesService.listSales().total).toBe(1)
    expect(salesService.listSales().rows[0]?.invoiceNo).toBe('INV-000001')
  })
})
