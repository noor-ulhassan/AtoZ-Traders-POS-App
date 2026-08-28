import type { IsoTimestamp } from './common'

export interface BackupResult {
  path: string
  /** Bytes. */
  size: number
  createdAt: IsoTimestamp
}

export interface RestoreResult {
  restoredFrom: string
  /** Where the pre-restore database was moved, so nothing is ever lost. */
  safetyCopyPath: string
}

export interface DatabaseInfo {
  path: string
  size: number
  schemaVersion: number
  /** Row counts for the tables the owner cares about. */
  counts: {
    products: number
    customers: number
    suppliers: number
    sales: number
    purchases: number
  }
}

/** One backup sitting in the folder, described without opening it. */
export interface BackupFile {
  path: string
  fileName: string
  /** Bytes. */
  size: number
  /** Read from the filename stamp, which is why the format never varies. */
  createdAt: IsoTimestamp
}

/**
 * What the owner needs to know at a glance.
 *
 * - `off`      no folder configured; nothing is being copied anywhere.
 * - `never`    a folder is set but no backup has landed in it yet.
 * - `ok`       the most recent backup is recent enough to be worth having.
 * - `stale`    backups are configured but the newest is over a day old.
 * - `failing`  an attempt failed in this session; `lastError` says why.
 *
 * `stale` and `failing` exist because a backup that quietly stopped working is
 * indistinguishable from one that works, right up until it is needed.
 */
export type BackupHealth = 'off' | 'never' | 'ok' | 'stale' | 'failing'

export interface BackupStatus {
  /** The configured folder; '' when automatic backup is off. */
  folder: string
  health: BackupHealth
  /** Minutes between automatic backups; 0 means only when the app closes. */
  intervalMinutes: number
  lastBackupAt: IsoTimestamp | null
  /** Bytes in the most recent backup. */
  lastBackupSize: number
  /** How many backups the folder is holding. */
  count: number
  oldestBackupAt: IsoTimestamp | null
  /** Total bytes the backups occupy. */
  totalSize: number
  /** Why the last attempt in this session failed, if it did. */
  lastError: string | null
  /** Bytes free on the volume holding the folder; null when it cannot be read. */
  freeSpace: number | null
}
