import { app, dialog, shell } from 'electron'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
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
  BackupCheck,
  BackupDestinationStatus,
  BackupHealth,
  BackupResult,
  BackupStatus,
  DatabaseInfo,
  RestoreResult
} from '@shared/types'
import { checkpoint, closeDatabase, databasePath, openDatabase, setDb } from '../db/connection'
import { currentVersion, migrate } from '../db/migrate'
import { LATEST_VERSION } from '../db/migrations'
import { getSettings } from '../repositories/settingsRepository'
import { getDb } from '../db/connection'
import { AppError, businessRule } from '../utils/errors'
import { isBusy, underMaintenance } from '../ipc/maintenance'
import { logger } from '../utils/logger'
import { isBackupDue, planRetention } from './backupRetention'
import {
  pathKey,
  readBackupHistory,
  recordBackupAttempt,
  recordVerifiedBackup,
  verifiedRecord
} from './backupHistory'

const log = logger.child('backup')

/** `pos-backup-20260828-141503.db`. Parsed back out, so it must never vary. */
const FILE_PREFIX = 'pos-backup-'
const FILE_SUFFIX = '.db'
const NAME_PATTERN = /^pos-backup-(\d{8})-(\d{6})(?:-\d+)?\.db$/
/** A backup still being written. Renamed into place only once it is complete. */
const PART_SUFFIX = '.part'
const pendingBackupPaths = new Set<string>()
const LOCAL_INTERVAL = 15

export function localBackupFolder(): string {
  return join(app.getPath('userData'), 'backups')
}

function destinations(): { folder: string; intervalMinutes: number }[] {
  const settings = getSettings(getDb())
  const local = { folder: localBackupFolder(), intervalMinutes: LOCAL_INTERVAL }
  return settings.autoBackupDir.trim() && pathKey(settings.autoBackupDir) !== pathKey(local.folder)
    ? [local, { folder: settings.autoBackupDir, intervalMinutes: settings.backupIntervalMinutes }]
    : [local]
}

/** Reserve before the first await; manual and scheduled copies may overlap. */
function reserveBackupPath(folder: string): string {
  const name = backupFileName().slice(0, -FILE_SUFFIX.length)
  let sequence = 0
  let target: string
  do {
    target = join(folder, `${name}${sequence === 0 ? '' : `-${sequence}`}${FILE_SUFFIX}`)
    sequence += 1
  } while (
    pendingBackupPaths.has(target) ||
    existsSync(target) ||
    existsSync(`${target}${PART_SUFFIX}`)
  )
  pendingBackupPaths.add(target)
  return target
}

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
  const target = pathKey(folder)
  const liveDir = pathKey(dirname(databasePath()))

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
  if (!statSync(target).isDirectory())
    throw businessRule('Choose a folder, not a file, for backups.')
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
      const stat = statSync(path)
      if (stat.isFile()) files.push({ path, fileName, size: stat.size, createdAt })
    } catch {
      // A file that vanished between the listing and the stat — a sync client
      // moving things around. It is simply not in the list.
    }
  }

  return files.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Deletes what the retention policy no longer wants. Never throws. */
export function pruneBackups(folder: string): number {
  let remove: BackupFile[]
  try {
    const history = readBackupHistory()
    // Only automatic copies recorded by this installation are eligible.
    // Manual exports and older unrecorded backups stay under the owner's control.
    const automatic = listBackups(folder).filter(
      (file) => verifiedRecord(history, file.path)?.automatic
    )
    remove = planRetention(automatic).remove
  } catch (error) {
    log.warn('retention skipped because backup history could not be read', error)
    return 0
  }

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
    createdAt: timestampFromFileName(basename(path))!
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
export function copyDatabaseTo(targetDir: string, automatic = false): BackupResult {
  const folder = ensureFolder(targetDir)
  checkpoint()

  const target = reserveBackupPath(folder)
  const partial = `${target}${PART_SUFFIX}`
  try {
    copyFileSync(databasePath(), partial)
    assertUsableBackup(partial)
    renameSync(partial, target)
  } finally {
    pendingBackupPaths.delete(target)
    try {
      rmSync(partial, { force: true })
    } catch {
      /* left as an unlisted partial */
    }
  }
  log.info(`backup copied to ${target}`)
  rememberVerified(target, automatic)
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
export async function onlineBackupTo(targetDir: string, automatic = false): Promise<BackupResult> {
  if (isBusy())
    throw businessRule('A restore is in progress. Try the backup again when it finishes.')
  const folder = ensureFolder(targetDir)
  const target = reserveBackupPath(folder)
  const partial = `${target}${PART_SUFFIX}`

  try {
    await getDb().backup(partial)
    assertUsableBackup(partial)
    renameSync(partial, target)
  } catch (error) {
    try {
      if (existsSync(partial)) rmSync(partial)
    } catch {
      // Leaving a stray .part behind is untidy, never harmful: it does not
      // match the backup name pattern, so nothing will ever offer to restore it.
    }
    throw error
  } finally {
    pendingBackupPaths.delete(target)
  }

  log.info(`backup written to ${target}`)
  rememberVerified(target, automatic)
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

interface DestinationSession {
  db: ReturnType<typeof getDb>
  lastBackupAt: number
  changeCountAtLastBackup: number
  path: string
}
const sessions = new Map<string, DestinationSession>()
let running = false
let historyWriteError: string | null = null

function historyFailure(error: unknown): void {
  historyWriteError = 'Backup history could not be saved. Check free space and folder permissions.'
  log.warn(historyWriteError, error)
}

function rememberVerified(path: string, automatic: boolean): void {
  try {
    recordVerifiedBackup(path, automatic)
    historyWriteError = null
  } catch (error) {
    historyFailure(error)
  }
}

function rememberAttempt(folder: string, error: string | null): void {
  try {
    recordBackupAttempt(folder, error)
  } catch (caught) {
    historyFailure(caught)
  }
}

/** Counts business writes only; backup history lives outside this database. */
export function changeCount(): number {
  const row = getDb().prepare<[], { n: number }>('SELECT total_changes() AS n').get()
  return row?.n ?? 0
}

/** Reset after a restore or a new connection. Persistent history stays intact. */
export function resetBackupSession(): void {
  sessions.clear()
  running = false
  historyWriteError = null
}

function currentSession(folder: string): DestinationSession | undefined {
  const entry = sessions.get(pathKey(folder))
  return entry?.db === getDb() ? entry : undefined
}

function isDue(folder: string, intervalMinutes: number): boolean {
  const entry = currentSession(folder)
  if (intervalMinutes > 0 && entry && !existsSync(entry.path)) return true
  return isBackupDue({
    folder,
    intervalMinutes,
    now: Date.now(),
    lastBackupAt: entry?.lastBackupAt ?? null,
    changeCount: changeCount(),
    changeCountAtLastBackup: entry?.changeCountAtLastBackup ?? null
  })
}

async function takeDestination(folder: string, automatic: boolean): Promise<BackupResult> {
  const db = getDb()
  // Capture BEFORE the asynchronous snapshot. Writes during it remain pending,
  // even if SQLite happened to include them; we must never claim missing writes are protected.
  const changes = changeCount()
  try {
    const result = await onlineBackupTo(folder, automatic)
    sessions.set(pathKey(folder), {
      db,
      lastBackupAt: Date.now(),
      changeCountAtLastBackup: changes,
      path: result.path
    })
    rememberAttempt(folder, null)
    if (automatic) pruneBackups(folder)
    return result
  } catch (error) {
    rememberAttempt(folder, error instanceof Error ? error.message : String(error))
    throw error
  }
}

/** Each destination is independent: an unavailable external folder cannot stop local recovery. */
export async function runScheduledBackup(): Promise<BackupResult | null> {
  if (running || isBusy()) return null
  running = true
  let result: BackupResult | null = null
  try {
    for (const target of destinations()) {
      if (!isDue(target.folder, target.intervalMinutes)) continue
      try {
        result = await takeDestination(target.folder, true)
      } catch (error) {
        log.error('scheduled backup failed', error)
      }
    }
    return result
  } finally {
    running = false
  }
}

/** Manual copies are retained until the owner removes them. */
export async function backupToConfiguredFolder(): Promise<BackupResult> {
  if (running || isBusy())
    throw businessRule('A backup or restore is already in progress. Try again when it finishes.')
  running = true
  let result: BackupResult | null = null
  const failures: string[] = []
  try {
    for (const target of destinations()) {
      try {
        result = await takeDestination(target.folder, false)
      } catch (error) {
        failures.push(`${target.folder}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (failures.length)
      throw businessRule(
        `${result ? 'A backup was saved, but another destination failed.' : 'Backup failed.'} ${failures.join(' ')}`
      )
    return result as BackupResult
  } finally {
    running = false
  }
}

/** Includes local recovery and the configured additional folder. */
export function listConfiguredBackups(): BackupFile[] {
  let history: ReturnType<typeof readBackupHistory> | null = null
  try {
    history = readBackupHistory()
  } catch {
    /* Status surfaces the history error. */
  }
  const files: BackupFile[] = []
  for (const [index, target] of destinations().entries()) {
    try {
      for (const file of listBackups(target.folder)) {
        let verifiedAt: string | null = null
        try {
          verifiedAt = history ? (verifiedRecord(history, file.path)?.verifiedAt ?? null) : null
        } catch {
          /* disappeared */
        }
        files.push({ ...file, verifiedAt, location: index === 0 ? 'local' : 'additional' })
      }
    } catch {
      /* An unavailable additional destination must not hide local copies. */
    }
  }
  return files.sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) ||
      b.fileName.localeCompare(a.fileName, undefined, { numeric: true })
  )
}

function freeSpaceFor(folder: string): number | null {
  try {
    const stats = statfsSync(resolve(folder))
    return Number(stats.bavail) * Number(stats.bsize)
  } catch {
    return null
  }
}

export function backupStatus(): BackupStatus {
  let history: ReturnType<typeof readBackupHistory> = { destinations: {}, files: {} }
  let historyError = historyWriteError
  try {
    history = readBackupHistory()
  } catch {
    historyError =
      'Backup history cannot be read. Existing backup files are still available; use Check backup to inspect a copy.'
  }
  const targets = destinations()
  const allFiles = listConfiguredBackups()
  const statuses = targets.map((target): BackupDestinationStatus => {
    const entry = currentSession(target.folder)
    const attempt = history.destinations[pathKey(target.folder)]
    const files = allFiles.filter((file) => pathKey(dirname(file.path)) === pathKey(target.folder))
    let lastError = attempt?.error ?? null
    try {
      if (existsSync(target.folder)) readdirSync(target.folder)
    } catch {
      lastError = 'The backup folder cannot be read. Check the drive and folder permissions.'
    }
    const pendingChanges = !entry || changeCount() !== entry.changeCountAtLastBackup
    const verified = files.find((file) => file.verifiedAt)
    const lastBackupAt = files[0]?.createdAt ?? null
    const elapsed = lastBackupAt
      ? Date.now() - Date.parse(lastBackupAt.replace(' ', 'T'))
      : Infinity
    const threshold = (target.intervalMinutes || 24 * 60) * 60_000 + 60_000
    const health: BackupHealth = lastError
      ? 'failing'
      : !files.length
        ? 'never'
        : pendingChanges && elapsed > threshold
          ? 'stale'
          : 'ok'
    return {
      folder: target.folder,
      intervalMinutes: target.intervalMinutes,
      health,
      lastBackupAt,
      lastVerifiedAt: verified?.verifiedAt ?? null,
      lastAttemptAt: attempt?.attemptedAt ?? null,
      lastError,
      count: files.length,
      pendingChanges
    }
  })
  const local = statuses[0]!
  const additional = statuses[1] ?? null
  // Preserve legacy summary fields for callers, with additional details below.
  const primary = additional ?? local
  const primaryFiles = allFiles.filter(
    (file) => pathKey(dirname(file.path)) === pathKey(primary.folder)
  )
  return {
    ...primary,
    local,
    additional,
    historyError,
    lastBackupSize: primaryFiles[0]?.size ?? 0,
    oldestBackupAt: primaryFiles.at(-1)?.createdAt ?? null,
    totalSize: primaryFiles.reduce((sum, file) => sum + file.size, 0),
    freeSpace: freeSpaceFor(primary.folder)
  }
}

export async function chooseBackupFolder(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Choose an additional backup folder',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Use this folder'
  })
  if (result.canceled || !result.filePaths.length) return null
  const folder = result.filePaths[0]!
  assertBackupFolderIsSafe(folder)
  return folder
}

export async function openBackupFolder(kind: 'data' | 'local' | 'additional'): Promise<void> {
  const folder =
    kind === 'data'
      ? dirname(databasePath())
      : kind === 'local'
        ? localBackupFolder()
        : getSettings(getDb()).autoBackupDir
  if (!folder.trim()) throw businessRule('Choose and save an additional backup folder first.')
  if (kind === 'local') ensureFolder(folder)
  if (!existsSync(folder))
    throw businessRule('That folder is unavailable. Connect the drive and try again.')
  if (!statSync(folder).isDirectory())
    throw businessRule('That location is not a folder. Choose a backup folder in Settings.')
  const error = await shell.openPath(resolve(folder))
  if (error) throw businessRule(`The folder could not be opened: ${error}`)
}

/** Inspect a temporary migrated copy, never the live shop or the selected original. */
export async function checkBackup(path?: string): Promise<BackupCheck> {
  if (path && !listConfiguredBackups().some((file) => pathKey(file.path) === pathKey(path!))) {
    throw businessRule('That backup is not in the backup folder any more. Refresh the list.')
  }
  if (!path) {
    const picked = await dialog.showOpenDialog({
      title: 'Choose a backup to check',
      properties: ['openFile'],
      filters: [{ name: 'POS backup', extensions: ['db'] }]
    })
    if (picked.canceled || !picked.filePaths.length)
      throw new AppError('CANCELLED', 'Check cancelled.')
    path = picked.filePaths[0]!
  }
  assertUsableBackup(path)
  const originalStat = statSync(path)
  const staged = join(app.getPath('userData'), `pos-check-${randomUUID()}.db`)
  const source = new Database(path, { readonly: true, fileMustExist: true })
  try {
    await source.backup(staged)
    const candidate = openDatabase(staged)
    try {
      migrate(candidate)
    } finally {
      candidate.close()
    }
    assertUsableBackup(staged)
    const probe = new Database(staged, { readonly: true, fileMustExist: true })
    try {
      const counts = probe
        .prepare<[], DatabaseInfo['counts']>(
          `SELECT
        (SELECT COUNT(*) FROM products) AS products, (SELECT COUNT(*) FROM customers) AS customers,
        (SELECT COUNT(*) FROM suppliers) AS suppliers, (SELECT COUNT(*) FROM sales) AS sales,
        (SELECT COUNT(*) FROM purchases) AS purchases`
        )
        .get()!
      const businessName = getSettings(probe).businessName
      const now = statSync(path)
      if (now.size === originalStat.size && now.mtimeMs === originalStat.mtimeMs)
        rememberVerified(path, false)
      return {
        path,
        size: originalStat.size,
        schemaVersion: currentVersion(probe),
        counts,
        businessName,
        checkedAt: new Date().toISOString()
      }
    } finally {
      probe.close()
    }
  } finally {
    source.close()
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        rmSync(`${staged}${suffix}`, { force: true })
      } catch {
        log.warn('could not remove temporary check file')
      }
    }
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
    if (currentVersion(probe) > LATEST_VERSION) {
      throw businessRule(
        'That backup was made by a newer version of the app. Update the app before restoring it.'
      )
    }
    const foreignKeyErrors = probe.pragma('foreign_key_check') as unknown[]
    if (probe.pragma('quick_check', { simple: true }) !== 'ok' || foreignKeyErrors.length !== 0) {
      throw businessRule('That backup has damaged or inconsistent data. Choose a different backup.')
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
  const restoreId = randomUUID()
  const safetyCopy = join(app.getPath('userData'), `pos-before-restore-${stamp()}-${restoreId}.db`)
  const staged = join(app.getPath('userData'), `pos-restore-${restoreId}.db`)

  // Turn business IPC away while the connection is closed and the file swapped,
  // so a sale firing from the renderer mid-restore cannot touch a database that
  // is about to be replaced.
  return underMaintenance(async () => {
    if (pendingBackupPaths.size > 0) {
      throw businessRule('A backup is in progress. Try restoring again when it finishes.')
    }
    let movedLive = false
    let installed = false
    try {
      // Prepare and migrate a separate snapshot first. A failed migration,
      // unreadable source, or full disk must leave the current connection usable.
      // SQLite's backup API also includes any committed WAL pages in the source.
      const sourceDb = new Database(source, { readonly: true, fileMustExist: true })
      try {
        await sourceDb.backup(staged)
      } finally {
        sourceDb.close()
      }
      assertUsableBackup(staged)
      const candidate = openDatabase(staged)
      try {
        migrate(candidate)
        candidate.pragma('wal_checkpoint(TRUNCATE)')
      } finally {
        candidate.close()
      }
      assertUsableBackup(staged)

      checkpoint()
      closeDatabase()
      renameSync(live, safetyCopy)
      movedLive = true
      renameSync(staged, live)
      installed = true
      setDb(openDatabase())
    } catch (error) {
      // The old file stays recoverable even if opening the replacement fails.
      if (movedLive) {
        closeDatabase()
        if (installed) renameSync(live, staged)
        renameSync(safetyCopy, live)
        setDb(openDatabase())
      } else {
        // A failure between closeDatabase and the first rename also needs a
        // connection again; preparation failures leave the original one open.
        try {
          getDb()
        } catch {
          setDb(openDatabase())
        }
      }
      log.error('restore failed', error)
      throw businessRule('The backup could not be restored. Your existing data is unchanged.')
    } finally {
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          rmSync(`${staged}${suffix}`, { force: true })
        } catch {
          log.warn('could not remove temporary restore file')
        }
      }
    }

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
 * Restore one of the backups listed from either recovery destination.
 *
 * The path comes from the renderer, so it is checked against the folder's own
 * listing rather than trusted — the only restorable files are ones this
 * process just enumerated.
 */
export async function restoreFromPath(path: string): Promise<RestoreResult> {
  const known = listConfiguredBackups().some((file) => pathKey(file.path) === pathKey(path))

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
 * Runs during shutdown, including handled crashes, for both recovery destinations.
 *
 * Synchronous by necessity: `before-quit` does not wait for a promise, so the
 * online backup used everywhere else would never finish. Nothing is writing at
 * this point, which is exactly when a plain file copy is the right tool.
 * Failures are recorded for the next launch and logged; they do not stop closing.
 */
export function runAutoBackup(): void {
  if (isBusy()) return
  let targets: ReturnType<typeof destinations>
  try {
    targets = destinations()
  } catch (error) {
    log.warn('could not read backup settings during shutdown', error)
    return
  }
  // Local always runs first. A disconnected additional destination cannot prevent it.
  for (const target of targets) {
    try {
      const entry = currentSession(target.folder)
      if (entry && existsSync(entry.path) && entry.changeCountAtLastBackup === changeCount())
        continue
      copyDatabaseTo(target.folder, true)
      rememberAttempt(target.folder, null)
      pruneBackups(target.folder)
    } catch (error) {
      rememberAttempt(target.folder, error instanceof Error ? error.message : String(error))
      log.error('auto-backup failed', error)
    }
  }
}
