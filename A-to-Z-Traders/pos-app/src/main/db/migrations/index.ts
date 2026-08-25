import init0001 from './0001_init.sql?raw'
import adminAuth0002 from './0002_admin_auth.sql?raw'
import businessProfile0003 from './0003_business_profile.sql?raw'
import staffUsers0004 from './0004_staff_users.sql?raw'

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
export const MIGRATIONS: Migration[] = [
  { version: 1, name: '0001_init', sql: init0001 },
  { version: 2, name: '0002_admin_auth', sql: adminAuth0002 },
  { version: 3, name: '0003_business_profile', sql: businessProfile0003 },
  { version: 4, name: '0004_staff_users', sql: staffUsers0004 }
]

export const LATEST_VERSION = MIGRATIONS.reduce(
  (highest, migration) => Math.max(highest, migration.version),
  0
)
