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
