import { app, dialog } from 'electron'
import { copyFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { BackupResult, DatabaseInfo, RestoreResult } from '@shared/types'
import { checkpoint, closeDatabase, databasePath, openDatabase, setDb } from '../db/connection'
import { currentVersion, migrate } from '../db/migrate'
import { getSettings } from '../repositories/settingsRepository'
import { getDb } from '../db/connection'
import { AppError, businessRule } from '../utils/errors'
import { underMaintenance } from '../ipc/maintenance'
import { logger } from '../utils/logger'

const log = logger.child('backup')

function stamp(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('')
}

export function backupFileName(): string {
  return `pos-backup-${stamp()}.db`
}

/**
 * Copies the database to `targetDir`.
 *
 * The WAL is checkpointed first: without that, the copied `pos.db` can be
 * missing every transaction since the last automatic checkpoint — a backup
 * that silently loses today's sales is worse than no backup at all.
 */
export function backupTo(targetDir: string): BackupResult {
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })

  checkpoint()
  const target = join(targetDir, backupFileName())
  copyFileSync(databasePath(), target)

  const { size } = statSync(target)
  log.info(`backup written to ${target} (${size} bytes)`)

  return { path: target, size, createdAt: new Date().toISOString().slice(0, 19).replace('T', ' ') }
}

/** Asks where to save, then writes the backup there. */
export async function backupNow(): Promise<BackupResult> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Choose a folder for the backup',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Save backup here'
  })

  if (canceled || filePaths.length === 0) {
    throw new AppError('CANCELLED', 'Backup cancelled.')
  }

  return backupTo(filePaths[0] as string)
}

/**
 * Replaces the live database with a backup file.
 *
 * The current database is never deleted — it is renamed aside first, so a
 * restore from the wrong file is always recoverable. The connection is closed,
 * swapped and reopened, and migrations run again in case the backup predates
 * the current schema.
 */
export async function restoreFromFile(): Promise<RestoreResult> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Choose a backup file to restore',
    properties: ['openFile'],
    filters: [{ name: 'POS backup', extensions: ['db'] }]
  })

  if (canceled || filePaths.length === 0) {
    throw new AppError('CANCELLED', 'Restore cancelled.')
  }

  const source = filePaths[0] as string
  if (!existsSync(source)) throw businessRule('That backup file no longer exists.')

  // Confirm destructively, in the main process, where it cannot be bypassed.
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Restore and replace', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Restore backup',
    message: `Replace all current data with "${basename(source)}"?`,
    detail:
      'Everything currently in the app will be replaced. A copy of the current data is kept alongside it, and the app will reload when the restore finishes.'
  })

  if (response !== 0) throw new AppError('CANCELLED', 'Restore cancelled.')

  const live = databasePath()
  const safetyCopy = join(app.getPath('userData'), `pos-before-restore-${stamp()}.db`)

  // Turn business IPC away while the connection is closed and the file swapped,
  // so a sale firing from the renderer mid-restore cannot touch a database that
  // is about to be replaced.
  return underMaintenance(async () => {
    checkpoint()
    closeDatabase()

    try {
      renameSync(live, safetyCopy)
      copyFileSync(source, live)
    } catch (error) {
      // Put things back exactly as they were before re-opening.
      if (!existsSync(live) && existsSync(safetyCopy)) renameSync(safetyCopy, live)
      setDb(openDatabase())
      log.error('restore failed', error)
      throw businessRule('The backup could not be restored. Your existing data is unchanged.')
    }

    const db = openDatabase()
    setDb(db)
    migrate(db)

    log.info(`restored from ${source}; previous database kept at ${safetyCopy}`)
    return { restoredFrom: source, safetyCopyPath: safetyCopy }
  })
}

export function databaseInfo(): DatabaseInfo {
  const db = getDb()
  const path = databasePath()
  const counts = db
    .prepare<
      [],
      {
        products: number
        customers: number
        suppliers: number
        sales: number
        purchases: number
      }
    >(
      `SELECT (SELECT COUNT(*) FROM products)  AS products,
              (SELECT COUNT(*) FROM customers) AS customers,
              (SELECT COUNT(*) FROM suppliers) AS suppliers,
              (SELECT COUNT(*) FROM sales)     AS sales,
              (SELECT COUNT(*) FROM purchases) AS purchases`
    )
    .get()

  return {
    path,
    size: existsSync(path) ? statSync(path).size : 0,
    schemaVersion: currentVersion(db),
    counts: counts ?? { products: 0, customers: 0, suppliers: 0, sales: 0, purchases: 0 }
  }
}

/**
 * Runs on quit when the owner has configured a folder. Failures are logged,
 * never surfaced — nothing should be able to stop the app from closing.
 */
export function runAutoBackup(): void {
  try {
    const { autoBackupDir } = getSettings(getDb())
    if (!autoBackupDir) return
    backupTo(autoBackupDir)
  } catch (error) {
    log.error('auto-backup failed', error)
  }
}
