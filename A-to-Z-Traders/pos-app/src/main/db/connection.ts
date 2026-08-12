import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'

export type Db = Database.Database

let instance: Db | null = null

/** `<userData>/pos.db` — never inside the project or install folder (Guide §1.4). */
export function databasePath(): string {
  return join(app.getPath('userData'), 'pos.db')
}

/**
 * Opens the database and applies the pragmas the app depends on.
 *
 * - WAL keeps reads from blocking the write of a sale in progress.
 * - `foreign_keys` is OFF by default in SQLite; without it the ON DELETE
 *   CASCADE rules in the schema silently do nothing.
 * - `synchronous = NORMAL` is the right trade-off under WAL: a crash can cost
 *   the last transaction but never corrupts the file, and this is a
 *   single-user shop machine that may lose power.
 */
export function openDatabase(path: string = databasePath()): Db {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')
  return db
}

export function getDb(): Db {
  if (!instance) {
    throw new Error('Database has not been initialised. Call initDatabase() first.')
  }
  return instance
}

export function setDb(db: Db): void {
  instance = db
}

export function closeDatabase(): void {
  if (!instance) return
  try {
    // Fold the WAL back into the main file so a copy of pos.db is complete.
    instance.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    // A checkpoint failure must not stop the app from quitting.
  }
  instance.close()
  instance = null
}

/** Flush the write-ahead log into pos.db. Required before copying the file. */
export function checkpoint(): void {
  getDb().pragma('wal_checkpoint(TRUNCATE)')
}
