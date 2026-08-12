import type { Db } from './connection'
import { MIGRATIONS } from './migrations'
import { logger } from '../utils/logger'

const log = logger.child('migrate')

function ensureMigrationsTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `)
}

function appliedVersions(db: Db): Set<number> {
  const rows = db.prepare<[], { version: number }>('SELECT version FROM schema_migrations').all()
  return new Set(rows.map((row) => row.version))
}

/**
 * Applies every migration not yet recorded, each in its own transaction, in
 * ascending version order. A failing migration rolls back and aborts startup —
 * running the app against a half-migrated database is worse than not starting.
 */
export function migrate(db: Db): number {
  ensureMigrationsTable(db)
  const applied = appliedVersions(db)
  const pending = MIGRATIONS.filter((migration) => !applied.has(migration.version)).sort(
    (a, b) => a.version - b.version
  )

  if (pending.length === 0) {
    return currentVersion(db)
  }

  const record = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')

  for (const migration of pending) {
    log.info(`applying ${migration.name}`)
    const run = db.transaction(() => {
      db.exec(migration.sql)
      record.run(migration.version, migration.name)
    })
    try {
      run()
    } catch (error) {
      log.error(`migration ${migration.name} failed`, error)
      throw new Error(`Database migration ${migration.name} failed: ${(error as Error).message}`)
    }
  }

  const version = currentVersion(db)
  log.info(`schema at version ${version}`)
  return version
}

export function currentVersion(db: Db): number {
  const row = db
    .prepare<[], { version: number | null }>(
      'SELECT MAX(version) AS version FROM schema_migrations'
    )
    .get()
  return row?.version ?? 0
}
