import init0001 from './0001_init.sql?raw'

export interface Migration {
  version: number
  name: string
  sql: string
}

/**
 * Ordered migration registry.
 *
 * The list is explicit rather than a directory scan: the packaged app has no
 * `migrations/` folder on disk, so the SQL is inlined at build time by Vite's
 * `?raw` import. Adding a migration means creating `NNNN_name.sql` and adding
 * one line here — the runner does the rest.
 *
 * Migrations are append-only. Never edit an applied migration; write a new one.
 */
export const MIGRATIONS: Migration[] = [{ version: 1, name: '0001_init', sql: init0001 }]

export const LATEST_VERSION = MIGRATIONS.reduce(
  (highest, migration) => Math.max(highest, migration.version),
  0
)
