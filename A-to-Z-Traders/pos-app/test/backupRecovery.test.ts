import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { dialog, shell } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from './helpers/database'
import { closeDatabase, getDb } from '../src/main/db/connection'
import * as backup from '../src/main/services/backupService'
import { historyPath, recordVerifiedBackup } from '../src/main/services/backupHistory'
import { updateSettings } from '../src/main/services/settingsService'
import { addProduct } from '../src/main/services/productService'
import { isBusy } from '../src/main/ipc/maintenance'

let folder: string
beforeEach(() => {
  createTestDb()
  backup.resetBackupSession()
  rmSync(backup.localBackupFolder(), { recursive: true, force: true })
  rmSync(historyPath(), { force: true })
  folder = mkdtempSync(join(tmpdir(), 'pos-recovery-test-'))
  addProduct({
    name: 'Soap',
    baseUnit: 'piece',
    costPrice: 10,
    salePrice: 15,
    reorderLevel: 0,
    openingStock: 20
  })
})
afterEach(() => {
  vi.useRealTimers()
  closeDatabase()
  rmSync(folder, { recursive: true, force: true })
})

describe('automatic local recovery', () => {
  it('creates and verifies a local copy, then skips a quiet period', async () => {
    const writes = backup.changeCount()
    const result = await backup.runScheduledBackup()
    expect(dirname(result!.path)).toBe(backup.localBackupFolder())
    expect(backup.changeCount()).toBe(writes)
    expect(backup.backupStatus().local).toMatchObject({
      health: 'ok',
      pendingChanges: false,
      count: 1,
      intervalMinutes: 15
    })
    expect(backup.listConfiguredBackups()[0]?.verifiedAt).toBeTruthy()
    expect(await backup.runScheduledBackup()).toBeNull()
  })

  it('captures a fresh copy after restart instead of trusting the old connection change counter', async () => {
    await backup.runScheduledBackup()
    backup.resetBackupSession()
    expect(backup.backupStatus().local.pendingChanges).toBe(true)
    await backup.runScheduledBackup()
    expect(backup.backupStatus().local.count).toBe(2)
  })

  it('recreates a deleted latest backup even when there are no new writes', async () => {
    const first = await backup.runScheduledBackup()
    rmSync(first!.path)
    await backup.runScheduledBackup()
    expect(backup.backupStatus().local.count).toBe(1)
  })

  it('does not call a quiet shop overdue, but flags changed records against the 15-minute schedule', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = new Date('2026-09-15T12:00:00')
    vi.setSystemTime(start)
    await backup.runScheduledBackup()
    vi.setSystemTime(new Date(start.getTime() + 31 * 60_000))
    expect(backup.backupStatus().local.health).toBe('ok')
    getDb().prepare('UPDATE products SET sale_price = 16').run()
    expect(backup.backupStatus().local.health).toBe('stale')
    await backup.runScheduledBackup()
    expect(backup.backupStatus().local.health).toBe('ok')
  })

  it('keeps writes made during a snapshot pending for the next backup', async () => {
    const original = getDb().backup.bind(getDb())
    vi.spyOn(getDb(), 'backup').mockImplementationOnce(async (path) => {
      const result = await original(path)
      getDb().prepare('UPDATE products SET sale_price = 16').run()
      return result
    })
    await backup.runScheduledBackup()
    expect(backup.backupStatus().local.pendingChanges).toBe(true)
  })

  it('keeps local backups running when additional copies are set to close-only', async () => {
    updateSettings({ autoBackupDir: folder, backupIntervalMinutes: 0 })
    await backup.runScheduledBackup()
    expect(backup.backupStatus().local.count).toBe(1)
    expect(backup.listBackups(folder)).toHaveLength(0)
  })

  it('retries a repaired additional destination without duplicating the unchanged local backup', async () => {
    const blocked = join(folder, 'blocked')
    writeFileSync(blocked, 'not a directory')
    updateSettings({ autoBackupDir: join(blocked, 'copies') })
    await backup.runScheduledBackup()
    expect(backup.backupStatus().additional?.health).toBe('failing')
    rmSync(blocked)
    await backup.runScheduledBackup()
    expect(backup.backupStatus().additional?.health).toBe('ok')
    expect(backup.backupStatus().local.count).toBe(1)
  })

  it('persists a failed attempt across session reset and still lists local copies', async () => {
    const blocked = join(folder, 'blocked')
    writeFileSync(blocked, 'not a directory')
    updateSettings({ autoBackupDir: join(blocked, 'copies') })
    await expect(backup.backupToConfiguredFolder()).rejects.toThrow(
      /saved.*another destination failed/i
    )
    backup.resetBackupSession()
    expect(backup.backupStatus().additional?.lastError).toBeTruthy()
    expect(backup.listConfiguredBackups().some((file) => file.location === 'local')).toBe(true)
  })
})

describe('verification and readable inspection', () => {
  it('refuses an invalid snapshot before publishing it and keeps earlier backups', async () => {
    const old = await backup.onlineBackupTo(folder)
    const original = getDb().backup.bind(getDb())
    vi.spyOn(getDb(), 'backup').mockImplementationOnce(async (path) => {
      const result = await original(path)
      writeFileSync(path, 'simulated damaged snapshot')
      return result
    })
    await expect(backup.onlineBackupTo(folder)).rejects.toThrow()
    expect(backup.listBackups(folder).map((file) => file.path)).toEqual([old.path])
    expect(readdirSync(folder).some((name) => name.endsWith('.part'))).toBe(false)
  })

  it('checks a copy and reports its records without changing that file or the live shop', async () => {
    const saved = await backup.backupToConfiguredFolder()
    const bytes = readFileSync(saved.path)
    getDb().prepare('UPDATE products SET sale_price = 17').run()
    const writes = backup.changeCount()
    const result = await backup.checkBackup(saved.path)
    expect(result.counts).toMatchObject({ products: 1, sales: 0, customers: 0 })
    expect(result.checkedAt).toBeTruthy()
    expect(readFileSync(saved.path)).toEqual(bytes)
    expect(backup.changeCount()).toBe(writes)
    expect(getDb().prepare('SELECT sale_price FROM products').get()).toEqual({ sale_price: 17 })
    expect(isBusy()).toBe(false)
  })

  it('refuses a renderer-supplied check path outside the listed destinations', async () => {
    const saved = await backup.onlineBackupTo(folder)
    await expect(backup.checkBackup(saved.path)).rejects.toThrow(/not in the backup folder/i)
  })

  it('keeps local recovery working and surfaces damaged history without deleting backups', async () => {
    const saved = await backup.runScheduledBackup()
    writeFileSync(historyPath(), '{damaged history')
    backup.resetBackupSession()
    await expect(backup.runScheduledBackup()).resolves.toHaveProperty('path')
    expect(backup.backupStatus().historyError).toBeTruthy()
    expect(backup.listConfiguredBackups().map((file) => file.path)).toContain(saved!.path)
    expect(backup.pruneBackups(backup.localBackupFolder())).toBe(0)
  })

  it('invalidates recorded verification when the file changes', async () => {
    const saved = await backup.backupToConfiguredFolder()
    writeFileSync(saved.path, 'changed')
    expect(backup.listConfiguredBackups()[0]?.verifiedAt).toBeNull()
    await expect(backup.checkBackup(saved.path)).rejects.toThrow()
  })
})

describe('retention and folder access', () => {
  it('prunes only recorded automatic copies, preserving manual and legacy files', () => {
    for (let day = 1; day <= 31; day++) {
      const path = join(folder, `pos-backup-202601${String(day).padStart(2, '0')}-120000.db`)
      writeFileSync(path, 'test fixture')
      recordVerifiedBackup(path, true)
    }
    const manual = join(folder, 'pos-backup-20200101-120000.db')
    const legacy = join(folder, 'pos-backup-20200102-120000.db')
    writeFileSync(manual, 'manual')
    writeFileSync(legacy, 'legacy')
    recordVerifiedBackup(manual, false)
    expect(backup.pruneBackups(folder)).toBeGreaterThan(0)
    expect(readFileSync(manual, 'utf8')).toBe('manual')
    expect(readFileSync(legacy, 'utf8')).toBe('legacy')
  })

  it('does not mark a manually requested backup as eligible for automatic cleanup', async () => {
    await backup.backupToConfiguredFolder()
    expect(backup.pruneBackups(backup.localBackupFolder())).toBe(0)
  })

  it('opens the known local folder and never launches a file supplied as a folder', async () => {
    const open = vi.spyOn(shell, 'openPath')
    await backup.openBackupFolder('local')
    expect(open).toHaveBeenCalledWith(backup.localBackupFolder())
    const file = join(folder, 'file.exe')
    writeFileSync(file, 'not a folder')
    updateSettings({ autoBackupDir: file })
    open.mockClear()
    await expect(backup.openBackupFolder('additional')).rejects.toThrow(/not a folder/i)
    expect(open).not.toHaveBeenCalled()
  })

  it('reports an Explorer failure as a readable error', async () => {
    vi.spyOn(shell, 'openPath').mockResolvedValue('Access denied')
    await expect(backup.openBackupFolder('local')).rejects.toThrow(/Access denied/)
  })

  it('cancelling Browse keeps the configured folder unchanged', async () => {
    vi.spyOn(dialog, 'showOpenDialog').mockResolvedValue({ canceled: true, filePaths: [] } as never)
    expect(await backup.chooseBackupFolder()).toBeNull()
    expect(backup.backupStatus().additional).toBeNull()
  })
})
