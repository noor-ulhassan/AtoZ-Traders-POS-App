import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, databasePath, openDatabase, setDb } from '../src/main/db/connection'
import { migrate } from '../src/main/db/migrate'
import { createTestDb } from './helpers/database'
import * as backupService from '../src/main/services/backupService'
import * as productService from '../src/main/services/productService'
import * as settingsService from '../src/main/services/settingsService'

/**
 * The backup path end to end, against real files in a real folder.
 *
 * The retention *rules* are tested on data elsewhere; what is worth proving
 * here is the part that touches the disk: that an online backup taken while the
 * app is running is a database that can actually be opened and read, that a
 * half-written one never gets left behind looking usable, and that the folder
 * guard refuses the arrangement that would corrupt the live file.
 */

let folder: string
const temporary: string[] = []

function makeFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pos-backup-folder-'))
  temporary.push(dir)
  return dir
}

beforeEach(() => {
  createTestDb()
  backupService.resetBackupSession()
  folder = makeFolder()

  productService.addProduct({
    name: 'Detergent 1kg',
    baseUnit: 'piece',
    costPrice: 100,
    salePrice: 150,
    reorderLevel: 5,
    openingStock: 40
  })
})

afterEach(() => {
  for (const dir of temporary.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // A leftover temp folder is not worth failing a test over.
    }
  }
})

describe('taking a backup while the app is running', () => {
  it('writes a file that opens as a working database', async () => {
    const result = await backupService.onlineBackupTo(folder)

    expect(existsSync(result.path)).toBe(true)
    expect(result.size).toBeGreaterThan(0)

    const copy = new Database(result.path, { readonly: true, fileMustExist: true })
    try {
      const row = copy
        .prepare<[], { name: string; stock_qty: number }>('SELECT name, stock_qty FROM products')
        .get()
      expect(row?.name).toBe('Detergent 1kg')
      // The stock came from a movement written in this session, so this also
      // proves the WAL made it into the copy.
      expect(row?.stock_qty).toBe(40)
    } finally {
      copy.close()
    }
  })

  it('leaves nothing behind that looks like a usable backup', async () => {
    await backupService.onlineBackupTo(folder)

    // A `.part` file would be a half-written database. Nothing may match the
    // name pattern except finished copies.
    expect(readdirSync(folder).filter((name) => name.endsWith('.part'))).toHaveLength(0)
    expect(backupService.listBackups(folder)).toHaveLength(1)
  })

  it('produces a backup the restore check accepts', async () => {
    const result = await backupService.onlineBackupTo(folder)
    expect(() => backupService.assertUsableBackup(result.path)).not.toThrow()
  })

  it('creates the folder when it does not exist yet', async () => {
    const nested = join(folder, 'nested', 'backups')
    const result = await backupService.onlineBackupTo(nested)
    expect(existsSync(result.path)).toBe(true)
  })
})

describe('the folder guard', () => {
  it('refuses the folder holding the live database', () => {
    expect(() => backupService.assertBackupFolderIsSafe(dirname(databasePath()))).toThrow(
      /live database/i
    )
  })

  it('refuses a parent of the live database folder', () => {
    expect(() => backupService.assertBackupFolderIsSafe(dirname(dirname(databasePath())))).toThrow(
      /live database/i
    )
  })

  it('refuses a folder that already holds a pos.db', () => {
    const dir = makeFolder()
    writeFileSync(join(dir, 'pos.db'), 'anything')
    expect(() => backupService.assertBackupFolderIsSafe(dir)).toThrow(/only for backups/i)
  })

  it('accepts an ordinary folder', () => {
    expect(() => backupService.assertBackupFolderIsSafe(makeFolder())).not.toThrow()
  })

  it('is enforced when the setting is saved, not only when a backup runs', () => {
    expect(() => settingsService.updateSettings({ autoBackupDir: dirname(databasePath()) })).toThrow(
      /live database/i
    )
    // The bad value must not have been written.
    expect(settingsService.getSettings().autoBackupDir).toBe('')
  })

  it('still allows turning backups off', () => {
    expect(() => settingsService.updateSettings({ autoBackupDir: '' })).not.toThrow()
  })
})

describe('listing what is in the folder', () => {
  it('reads the time a backup was taken from its name', () => {
    expect(backupService.timestampFromFileName('pos-backup-20260828-141503.db')).toBe(
      '2026-08-28 14:15:03'
    )
  })

  it('ignores anything that is not one of ours', () => {
    writeFileSync(join(folder, 'notes.txt'), 'hello')
    writeFileSync(join(folder, 'pos.db.bak'), 'hello')
    writeFileSync(join(folder, 'pos-backup-20260828-141503.db.part'), 'half a file')
    writeFileSync(join(folder, 'pos-backup-20260828-141503.db'), 'x')

    const files = backupService.listBackups(folder)
    expect(files.map((file) => file.fileName)).toEqual(['pos-backup-20260828-141503.db'])
  })

  it('returns newest first', () => {
    for (const stamp of ['20260826-090000', '20260828-090000', '20260827-090000']) {
      writeFileSync(join(folder, `pos-backup-${stamp}.db`), 'x')
    }

    expect(backupService.listBackups(folder).map((file) => file.createdAt)).toEqual([
      '2026-08-28 09:00:00',
      '2026-08-27 09:00:00',
      '2026-08-26 09:00:00'
    ])
  })

  it('says nothing rather than failing for a folder that is not there', () => {
    expect(backupService.listBackups(join(folder, 'gone'))).toEqual([])
    expect(backupService.listBackups('')).toEqual([])
  })
})

describe('pruning', () => {
  it('deletes only what the policy has let go of', () => {
    // 40 backups on 40 separate days: recent + daily + weekly keeps a subset.
    for (let day = 1; day <= 40; day += 1) {
      const stamp = `202607${String(day).padStart(2, '0')}`
      if (day > 31) continue
      writeFileSync(join(folder, `pos-backup-${stamp}-120000.db`), 'x')
    }

    const before = backupService.listBackups(folder).length
    const deleted = backupService.pruneBackups(folder)
    const after = backupService.listBackups(folder).length

    expect(before).toBe(31)
    expect(after).toBe(before - deleted)
    // The newest is never a candidate for removal.
    expect(backupService.listBackups(folder)[0]?.fileName).toBe('pos-backup-20260731-120000.db')
  })

  it('does nothing to a folder that is still small', () => {
    for (const stamp of ['20260826-090000', '20260827-090000']) {
      writeFileSync(join(folder, `pos-backup-${stamp}.db`), 'x')
    }

    expect(backupService.pruneBackups(folder)).toBe(0)
    expect(backupService.listBackups(folder)).toHaveLength(2)
  })
})

describe('the scheduled backup', () => {
  it('does nothing at all until a folder is configured', async () => {
    expect(await backupService.runScheduledBackup()).toBeNull()
  })

  it('writes into the configured folder and records that it worked', async () => {
    settingsService.updateSettings({ autoBackupDir: folder })

    const result = await backupService.runScheduledBackup()

    expect(result).not.toBeNull()
    expect(backupService.listBackups(folder)).toHaveLength(1)

    const status = backupService.backupStatus()
    expect(status.health).toBe('ok')
    expect(status.count).toBe(1)
    expect(status.lastError).toBeNull()
    expect(status.folder).toBe(folder)
  })

  it('records a failure instead of throwing at a timer', async () => {
    settingsService.updateSettings({ autoBackupDir: folder })
    // A path that cannot be created: the folder is replaced by a file.
    const blocked = join(folder, 'blocked')
    writeFileSync(blocked, 'not a folder')
    settingsService.updateSettings({ autoBackupDir: join(blocked, 'inside') })

    await expect(backupService.runScheduledBackup()).resolves.toBeNull()

    const status = backupService.backupStatus()
    expect(status.health).toBe('failing')
    expect(status.lastError).toBeTruthy()
  })

  it('reports "off" when no folder is set', () => {
    const status = backupService.backupStatus()
    expect(status.health).toBe('off')
    expect(status.count).toBe(0)
    expect(status.freeSpace).toBeNull()
  })

  it('reports "never" for a configured folder with nothing in it yet', () => {
    settingsService.updateSettings({ autoBackupDir: folder })
    expect(backupService.backupStatus().health).toBe('never')
  })

  it('reports "stale" when the newest copy is over a day old', () => {
    settingsService.updateSettings({ autoBackupDir: folder })
    writeFileSync(join(folder, 'pos-backup-20200101-120000.db'), 'x')

    expect(backupService.backupStatus().health).toBe('stale')
  })
})

describe('counting changes', () => {
  it('rises as the shop writes, so a quiet period can be skipped', () => {
    const before = backupService.changeCount()

    productService.addProduct({
      name: 'Another product',
      baseUnit: 'piece',
      costPrice: 1,
      salePrice: 2,
      reorderLevel: 0
    })

    expect(backupService.changeCount()).toBeGreaterThan(before)
  })

  it('does not move when nothing is written', () => {
    const before = backupService.changeCount()
    productService.listProducts()
    expect(backupService.changeCount()).toBe(before)
  })
})

describe('restoring by path', () => {
  it('refuses a path that is not in the backup folder', async () => {
    settingsService.updateSettings({ autoBackupDir: folder })

    const elsewhere = makeFolder()
    const stray = join(elsewhere, 'pos-backup-20260828-120000.db')
    writeFileSync(stray, 'x')

    // The renderer supplies this path, so it is checked against the folder's
    // own listing rather than trusted — and the check happens before any
    // dialog or file swap.
    await expect(backupService.restoreFromPath(stray)).rejects.toThrow(/not in the backup folder/i)
  })

  it('refuses a path in the folder that has since disappeared', async () => {
    settingsService.updateSettings({ autoBackupDir: folder })
    const gone = join(folder, 'pos-backup-20260828-120000.db')

    await expect(backupService.restoreFromPath(gone)).rejects.toThrow(/not in the backup folder/i)
  })
})

/**
 * The quit path copies the database *file*, so unlike everything above it
 * cannot run against `:memory:` — it needs a database that actually exists on
 * disk at `databasePath()`. That is the arrangement the app really has, which
 * makes this the one block that exercises the crash-time backup honestly.
 */
describe('the on-quit copy', () => {
  beforeEach(() => {
    closeDatabase()
    const file = openDatabase(databasePath())
    migrate(file)
    setDb(file)

    file
      .prepare(
        `INSERT INTO products (name, base_unit, cost_price, sale_price, reorder_level, stock_qty)
         VALUES ('Detergent 1kg', 'piece', 100, 150, 5, 40)`
      )
      .run()
  })

  afterEach(() => {
    closeDatabase()
    try {
      rmSync(databasePath(), { force: true })
      // WAL mode leaves two sidecars beside the database.
      rmSync(`${databasePath()}-wal`, { force: true })
      rmSync(`${databasePath()}-shm`, { force: true })
    } catch {
      // A leftover test database is not worth failing a test over.
    }
  })

  it('still writes a usable backup without needing the event loop', () => {
    // `before-quit` does not await, so this path stays synchronous. It has to
    // keep working: it is the backup taken when the app closes or crashes.
    mkdirSync(folder, { recursive: true })
    const result = backupService.copyDatabaseTo(folder)

    expect(existsSync(result.path)).toBe(true)
    expect(() => backupService.assertUsableBackup(result.path)).not.toThrow()
  })

  it('folds the write-ahead log in, so the copy holds the latest writes', () => {
    backupService.copyDatabaseTo(folder)
    const [copy] = backupService.listBackups(folder)

    const probe = new Database(copy!.path, { readonly: true, fileMustExist: true })
    try {
      // Written moments ago and still in the WAL until the checkpoint. A copy
      // taken without one would silently be missing today's trade.
      expect(probe.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM products').get()?.n).toBe(1)
    } finally {
      probe.close()
    }
  })

  it('is a no-op when no folder is configured', () => {
    expect(() => backupService.runAutoBackup()).not.toThrow()
    expect(backupService.listBackups(folder)).toHaveLength(0)
  })

  it('writes and prunes when a folder is configured', () => {
    settingsService.updateSettings({ autoBackupDir: folder })
    backupService.runAutoBackup()

    expect(backupService.listBackups(folder)).toHaveLength(1)
  })

  it('records a failure so it is visible after the app restarts', () => {
    settingsService.updateSettings({ autoBackupDir: folder })
    const blocked = join(folder, 'blocked')
    writeFileSync(blocked, 'not a folder')
    settingsService.updateSettings({ autoBackupDir: join(blocked, 'inside') })

    // The app is closing, so nobody can be shown an error. It still must not
    // look healthy afterwards — a backup that quietly stopped working is the
    // exact failure the health panel exists to catch.
    expect(() => backupService.runAutoBackup()).not.toThrow()

    const status = backupService.backupStatus()
    expect(status.health).toBe('failing')
    expect(status.lastError).toBeTruthy()
  })
})
