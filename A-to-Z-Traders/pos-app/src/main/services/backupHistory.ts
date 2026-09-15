import { app } from 'electron'
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { z } from 'zod'

const attempt = z.object({
  attemptedAt: z.string(),
  error: z.string().nullable(),
  lastSuccessAt: z.string().nullable()
})
const file = z.object({
  verifiedAt: z.string(),
  size: z.number(),
  modifiedAt: z.number(),
  automatic: z.boolean()
})
const schema = z.object({ destinations: z.record(attempt), files: z.record(file) })
type History = z.infer<typeof schema>

export function historyPath(): string {
  return join(app.getPath('userData'), 'backup-history.json')
}

export function pathKey(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

/** Outside the shop database: recording a backup must not itself change shop data. */
export function readBackupHistory(): History {
  if (!existsSync(historyPath())) return { destinations: {}, files: {} }
  return schema.parse(JSON.parse(readFileSync(historyPath(), 'utf8')))
}

function save(history: History): void {
  // Bound history independently of retention. Unrecorded files are never auto-deleted.
  history.files = Object.fromEntries(
    Object.entries(history.files)
      .sort((a, b) => b[1].verifiedAt.localeCompare(a[1].verifiedAt))
      .slice(0, 512)
  )
  history.destinations = Object.fromEntries(
    Object.entries(history.destinations)
      .sort((a, b) => b[1].attemptedAt.localeCompare(a[1].attemptedAt))
      .slice(0, 32)
  )
  const temporary = `${historyPath()}.part`
  writeFileSync(temporary, JSON.stringify(history, null, 2), 'utf8')
  renameSync(temporary, historyPath())
}

export function recordBackupAttempt(folder: string, error: string | null): void {
  const history = readBackupHistory()
  const previous = history.destinations[pathKey(folder)]
  const now = new Date().toISOString()
  history.destinations[pathKey(folder)] = {
    attemptedAt: now,
    error,
    lastSuccessAt: error ? (previous?.lastSuccessAt ?? null) : now
  }
  save(history)
}

export function recordVerifiedBackup(path: string, automatic: boolean): string {
  const history = readBackupHistory()
  const stat = statSync(path)
  const verifiedAt = new Date().toISOString()
  history.files[pathKey(path)] = {
    verifiedAt,
    size: stat.size,
    modifiedAt: stat.mtimeMs,
    automatic: history.files[pathKey(path)]?.automatic ?? automatic
  }
  save(history)
  return verifiedAt
}

export function verifiedRecord(history: History, path: string): z.infer<typeof file> | null {
  const entry = history.files[pathKey(path)]
  if (!entry) return null
  const stat = statSync(path)
  return stat.isFile() && entry.size === stat.size && entry.modifiedAt === stat.mtimeMs
    ? entry
    : null
}
