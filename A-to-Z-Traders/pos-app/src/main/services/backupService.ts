import { app, dialog } from 'electron'
import Database from 'better-sqlite3'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync
} from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type {
  BackupFile,
  BackupHealth,
  BackupResult,
  BackupStatus,
  DatabaseInfo,
  RestoreResult
} from '@shared/types'
import { checkpoint, closeDatabase, databasePath, openDatabase, setDb } from '../db/connection'
import { currentVersion, migrate } from '../db/migrate'
import { getSettings } from '../repositories/settingsRepository'
import { getDb } from '../db/connection'
import { AppError, businessRule } from '../utils/errors'
import { underMaintenance } from '../ipc/maintenance'
import { logger } from '../utils/logger'
import { planRetention } from './backupRetention'

const log = logger.child('backup')

/** `pos-backup-20260828-141503.db`. Parsed back out, so it must never vary. */
const FILE_PREFIX = 'pos-backup-'
const FILE_SUFFIX = '.db'
const NAME_PATTERN = /^pos-backup-(\d{8})-(\d{6})\.db$/
/** A backup still being written. Renamed into place only once it is complete. */
const PART_SUFFIX = '.part'

function stamp(now: Date = new Date()): string {
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

export function backupFileName(now: Date = new Date()): string {
  return `${FILE_PREFIX}${stamp(now)}${FILE_SUFFIX}`
}

/** The timestamp a backup's filename encodes, as `YYYY-MM-DD HH:MM:SS`. */
export function timestampFromFileName(fileName: string): string | null {
  const match = NAME_PATTERN.exec(fileName)
  if (!match) return null

  const [, date, time] = match as unknown as [string, string, string]
  return (
    `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)} ` +
    `${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`
  )
}

// --------------------------------------------------------------- the folder

/**
 * Refuses a folder that would put the live database inside a synced directory.
 *
 * The database runs in WAL mode: `pos.db` plus two sidecar files that only make
 * sense as a set. A cloud client copying those three at slightly different
 * moments produces a corrupt database — and the owner would not find out until
 * the day they restored it. Only finished backup *copies* belong in a synced
 * folder, never the file the app is writing to.
 */
export function assertBackupFolderIsSafe(folder: string): void {
  const target = resolve(folder)
  const liveDir = resolve(dirname(databasePath()))

  const contains = (parent: string, child: string): boolean =>
    child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep)

  if (contains(target, liveDir)) {
    throw businessRule(
      'That folder holds the live database, so a sync client there could corrupt it. Choose a different folder for backups.'
    )
  }
  if (existsSync(join(target, basename(databasePath())))) {
    throw businessRule(
      'That folder already contains a live pos.db. Choose a folder used only for backups.'
    )
  }
}

function ensureFolder(folder: string): string {
  const target = resolve(folder)
  assertBackupFolderIsSafe(target)
  if (!existsSync(target)) mkdirSync(target, { recursive: true })
  return target
}

/**
 * The backups in a folder, described from their names and sizes alone.
 *
 * Deliberately does not open them. A folder synced by OneDrive or Drive may
 * hold files that are online-only placeholders, and opening one to read a row
 * count would silently pull hundreds of megabytes down a shop's connection
 * just to draw a list.
 */
export function listBackups(folder: string): BackupFile[] {
  const target = resolve(folder)
  if (folder.trim() === '' || !existsSync(target)) return []

  const files: BackupFile[] = []
  for (const fileName of readdirSync(target)) {
    const createdAt = timestampFromFileName(fileName)
    if (!createdAt) continue

    const path = join(target, fileName)
    try {
      files.push({ path, fileName, size: statSync(path).size, createdAt })
    } catch {
      // A file that vanished between the listing and the stat — a sync client
      // moving things around. It is simply not in the list.
    }
  }

  return files.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Deletes what the retention policy no longer wants. Never throws. */
export function pruneBackups(folder: string): number {
  const { remove } = planRetention(listBackups(folder))

  let deleted = 0
  for (const file of remove) {
    try {
      rmSync(file.path)
      deleted += 1
    } catch (error) {
      // A file held open by a sync client is skipped; the next prune retries.
      log.warn(`could not remove old backup ${file.fileName}`, error)
    }
  }

  if (deleted > 0) log.info(`pruned ${deleted} old backup(s) from ${folder}`)
  return deleted
}

// -------------------------------------------------------------- taking one

function describe(path: string): BackupResult {
  const { size } = statSync(path)
  return {
    path,
    size,
    createdAt: new Date().toISOString().slice(0, 19).replace('T', ' ')
  }
}

/**
 * Copies the database file while nothing is writing to it.
 *
 * Used at quit and after a crash, where the process is about to end and an
 * awaited promise would never settle. The WAL is folded in first: without that
 * the copy can be missing every transaction since the last automatic
 * checkpoint, and a backup that silently loses today's sales is worse than no
 * backup at all.
 */
export function copyDatabaseTo(targetDir: string): BackupResult {
  const folder = ensureFolder(targetDir)
  checkpoint()

  const target = join(folder, backupFileName())
  copyFileSync(databasePath(), target)
  log.info(`backup copied to ${target}`)
  return describe(target)
}

/**
 * Takes a backup using SQLite's online backup, page by page.
 *
 * This is what makes an unattended schedule possible: it is safe to run while
 * the shop is billing, so backups no longer have to wait for a quiet moment
 * that a busy counter never has. The file is written under a `.part` name and
 * renamed only once complete, so an interrupted run can never leave something
 * that looks like a usable backup but is half a database.
 */
export async function onlineBackupTo(targetDir: string): Promise<BackupResult> {
  const folder = ensureFolder(targetDir)
  const target = join(folder, backupFileName())
  const partial = `${target}${PART_SUFFIX}`

  try {
    await getDb().backup(partial)
    renameSync(partial, target)
  } catch (error) {
    try {
      if (existsSync(partial)) rmSync(partial)
    } catch {
      // Leaving a stray .part behind is untidy, never harmful: it does not
      // match the backup name pattern, so nothing will ever offer to restore it.
    }
    throw error
  }

  log.info(`backup written to ${target}`)
  return describe(target)
}

/** Asks where to save, then writes one copy there. Unrelated to the schedule. */
export async function backupNow(): Promise<BackupResult> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Choose a folder for the backup',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Save backup here'
  })

  if (canceled || filePaths.length === 0) {
    throw new AppError('CANCELLED', 'Backup cancelled.')
  }

  return onlineBackupTo(filePaths[0] as string)
}

// ------------------------------------------------------- the running record

/** What this session knows about how the schedule is going. */
interface SessionState {
  lastBackupAt: number | null
  changeCountAtLastBackup: number | null
  lastError: string | null
  running: boolean
}

const session: SessionState = {
  lastBackupAt: null,
  changeCountAtLastBackup: null,
  lastError: null,
  running: false
}

/**
 * Rows written on this connection since it opened.
 *
 * The cheapest honest answer to "has anything happened since the last backup?"
 * — it is a counter SQLite already maintains, so asking costs nothing. It
 * resets when the app restarts, which is why a fresh session always takes one
 * backup before it starts skipping.
 */
export function changeCount(): number {
  try {
    const row = getDb().prepare<[], { n: number }>('SELECT total_changes() AS n').get()
    return row?.n ?? 0
  } catch {
    return 0
  }
}

/** Test seam: forgets what this session did. */
export function resetBackupSession(): void {
  session.lastBackupAt = null
  session.changeCountAtLastBackup = null
  session.lastError = null
  session.running = false
}

/**
 * Takes a scheduled backup into the configured folder and prunes what has aged
 * out.
 *
 * Failures are recorded rather than thrown: the caller is a timer, and there is
 * nobody to show an error to at the moment it happens. The record surfaces on
 * the Settings screen instead, which is the fix for the older behaviour where a
 * backup could stop working and leave no trace anywhere.
 */
export async function runScheduledBackup(): Promise<BackupResult | null> {
  if (session.running) return null

  const { autoBackupDir } = getSettings(getDb())
  if (!autoBackupDir.trim()) return null

  session.running = true
  try {
    const result = await onlineBackupTo(autoBackupDir)
    session.lastBackupAt = Date.now()
    session.changeCountAtLastBackup = changeCount()
    session.lastError = null
    pruneBackups(autoBackupDir)
    return result
  } catch (error) {
    session.lastError = error instanceof Error ? error.message : String(error)
    log.error('scheduled backup failed', error)
    return null
  } finally {
    session.running = false
  }
}

/**
 * Backs up to the configured folder on demand.
 *
 * The same work the schedule does, minus the "is it due?" question — this is
 * the owner pressing the button, and a backup they asked for is always due.
 * Errors reach them as an error, rather than being recorded quietly the way a
 * timer's failure has to be.
 */
export async function backupToConfiguredFolder(): Promise<BackupResult> {
  const { autoBackupDir } = getSettings(getDb())
  if (!autoBackupDir.trim()) {
    throw businessRule('Set a backup folder first, then this button will fill it automatically.')
  }

  try {
    const result = await onlineBackupTo(autoBackupDir)
    session.lastBackupAt = Date.now()
    session.changeCountAtLastBackup = changeCount()
    session.lastError = null
    pruneBackups(autoBackupDir)
    return result
  } catch (error) {
    session.lastError = error instanceof Error ? error.message : String(error)
    throw error
  }
}

/** The backups in the configured folder, newest first. */
export function listConfiguredBackups(): BackupFile[] {
  return listBackups(getSettings(getDb()).autoBackupDir)
}

/** What the scheduler needs to decide whether to act. Read fresh each tick. */
export function scheduleInputs(): {
  folder: string
  intervalMinutes: number
  lastBackupAt: number | null
  changeCount: number
  changeCountAtLastBackup: number | null
} {
  const settings = getSettings(getDb())
  return {
    folder: settings.autoBackupDir,
    intervalMinutes: settings.backupIntervalMinutes,
    lastBackupAt: session.lastBackupAt,
    changeCount: changeCount(),
    changeCountAtLastBackup: session.changeCountAtLastBackup
  }
}

/** Bytes free on the volume holding `folder`; null when it cannot be read. */
function freeSpaceFor(folder: string): number | null {
  try {
    const stats = statfsSync(resolve(folder))
    return Number(stats.bavail) * Number(stats.bsize)
  } catch {
    return null
  }
}

const A_DAY = 24 * 60 * 60 * 1000

function healthOf(folder: string, newest: BackupFile | undefined, error: string | null): BackupHealth {
  if (folder.trim() === '') return 'off'
  if (error) return 'failing'
  if (!newest) return 'never'

  const age = Date.now() - Date.parse(newest.createdAt.replace(' ', 'T'))
  return Number.isNaN(age) || age > A_DAY ? 'stale' : 'ok'
}

export function backupStatus(): BackupStatus {
  const settings = getSettings(getDb())
  const folder = settings.autoBackupDir
  const files = listBackups(folder)
  const newest = files[0]
  const oldest = files[files.length - 1]

  return {
    folder,
    health: healthOf(folder, newest, session.lastError),
    intervalMinutes: settings.backupIntervalMinutes,
    lastBackupAt: newest?.createdAt ?? null,
    lastBackupSize: newest?.size ?? 0,
    count: files.length,
    oldestBackupAt: oldest?.createdAt ?? null,
    totalSize: files.reduce((sum, file) => sum + file.size, 0),
    lastError: session.lastError,
    freeSpace: folder.trim() === '' ? null : freeSpaceFor(folder)
  }
}

// ----------------------------------------------------------------- restore

/**
 * Confirms the chosen file is a usable POS backup before anything destructive
 * happens.
 *
 * Opened read-only and never touched. better-sqlite3 validates lazily — a
 * file that isn't SQLite at all opens without error and only fails on the
 * first real query — so "not a database" and "a database, but not ours" are
 * both handled as query-time failures. Without this, either case would only
 * surface after the live database was already overwritten: the first as a
 * broken app with no automatic way back, the second as a silent,
 * error-free wipe down to zero data.
 */
export function assertUsableBackup(path: string): void {
  let probe: Database.Database
  try {
    probe = new Database(path, { readonly: true, fileMustExist: true })
  } catch {
    throw businessRule('That file could not be opened as a database. Choose a different backup.')
  }

  try {
    const row = probe
      .prepare<[], { n: number }>(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('products', 'sales', 'schema_migrations')"
      )
      .get()
    if (!row || row.n < 3) {
      throw businessRule('That file does not look like a POS backup.')
    }
  } catch (error) {
    if (error instanceof AppError) throw error
    throw businessRule('That file could not be opened as a database. Choose a different backup.')
  } finally {
    probe.close()
  }
}

/** What a backup holds, read only once the owner has chosen to restore it. */
function summarise(path: string): string {
  try {
    const probe = new Database(path, { readonly: true, fileMustExist: true })
    try {
      const row = probe
        .prepare<[], { sales: number; products: number; customers: number }>(
          `SELECT (SELECT COUNT(*) FROM sales)     AS sales,
                  (SELECT COUNT(*) FROM products)  AS products,
                  (SELECT COUNT(*) FROM customers) AS customers`
        )
        .get()
      if (!row) return ''
      return `\n\nThis backup holds ${row.sales} bills, ${row.products} products and ${row.customers} customers.`
    } finally {
      probe.close()
    }
  } catch {
    // The confirmation is still shown without the summary; failing to count is
    // not a reason to block a restore the owner has asked for.
    return ''
  }
}

/**
 * Replaces the live database with a backup file.
 *
 * The current database is never deleted — it is renamed aside first, so a
 * restore from the wrong file is always recoverable. The connection is closed,
 * swapped and reopened, and migrations run again in case the backup predates
 * the current schema.
 */
async function performRestore(source: string): Promise<RestoreResult> {
  if (!existsSync(source)) throw businessRule('That backup file no longer exists.')
  assertUsableBackup(source)

  // Confirm destructively, in the main process, where it cannot be bypassed.
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Restore and replace', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Restore backup',
    message: `Replace all current data with "${basename(source)}"?`,
    detail:
      'Everything currently in the app will be replaced. A copy of the current data is kept alongside it, and the app will reload when the restore finishes.' +
      summarise(source)
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

    // The restored file describes a different shop than the one this session
    // has been counting changes against.
    resetBackupSession()

    log.info(`restored from ${source}; previous database kept at ${safetyCopy}`)
    return { restoredFrom: source, safetyCopyPath: safetyCopy }
  })
}

/** Restore from a file the owner picks anywhere — a USB stick, say. */
export async function restoreFromFile(): Promise<RestoreResult> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Choose a backup file to restore',
    properties: ['openFile'],
    filters: [{ name: 'POS backup', extensions: ['db'] }]
  })

  if (canceled || filePaths.length === 0) {
    throw new AppError('CANCELLED', 'Restore cancelled.')
  }

  return performRestore(filePaths[0] as string)
}

/**
 * Restore one of the backups listed from the configured folder.
 *
 * The path comes from the renderer, so it is checked against the folder's own
 * listing rather than trusted — the only restorable files are ones this
 * process just enumerated.
 */
export async function restoreFromPath(path: string): Promise<RestoreResult> {
  const { autoBackupDir } = getSettings(getDb())
  const known = listBackups(autoBackupDir).some((file) => resolve(file.path) === resolve(path))

  if (!known) {
    throw businessRule('That backup is not in the backup folder any more. Refresh the list.')
  }

  return performRestore(resolve(path))
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
 * Runs on quit and after a crash, when the owner has configured a folder.
 *
 * Synchronous by necessity: `before-quit` does not wait for a promise, so the
 * online backup used everywhere else would never finish. Nothing is writing at
 * this point, which is exactly when a plain file copy is the right tool.
 * Failures are logged, never surfaced — nothing should be able to stop the app
 * from closing.
 */
export function runAutoBackup(): void {
  try {
    const { autoBackupDir } = getSettings(getDb())
    if (!autoBackupDir.trim()) return
    copyDatabaseTo(autoBackupDir)
    pruneBackups(autoBackupDir)
    session.lastBackupAt = Date.now()
    session.lastError = null
  } catch (error) {
    // Recorded as well as logged. The app is closing, so there is nobody to
    // show an error to now — but the next launch must be able to say that the
    // last backup did not happen, rather than looking healthy.
    session.lastError = error instanceof Error ? error.message : String(error)
    log.error('auto-backup failed', error)
  }
}
