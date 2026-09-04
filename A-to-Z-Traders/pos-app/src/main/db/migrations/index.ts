import init0001 from './0001_init.sql?raw'
import adminAuth0002 from './0002_admin_auth.sql?raw'
import businessProfile0003 from './0003_business_profile.sql?raw'
import staffUsers0004 from './0004_staff_users.sql?raw'
import barcodeUnique0005 from './0005_product_barcode_unique.sql?raw'
import backupSchedule0006 from './0006_backup_schedule.sql?raw'
import otherStock0007 from './0007_other_stock.sql?raw'
import demoRecords0008 from './0008_demo_records.sql?raw'
import billEditing0009 from './0009_bill_editing.sql?raw'

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
  { version: 4, name: '0004_staff_users', sql: staffUsers0004 },
  { version: 5, name: '0005_product_barcode_unique', sql: barcodeUnique0005 },
  { version: 6, name: '0006_backup_schedule', sql: backupSchedule0006 },
  { version: 7, name: '0007_other_stock', sql: otherStock0007 },
  { version: 8, name: '0008_demo_records', sql: demoRecords0008 },
  { version: 9, name: '0009_bill_editing', sql: billEditing0009 }
]

export const LATEST_VERSION = MIGRATIONS.reduce(
  (highest, migration) => Math.max(highest, migration.version),
  0
)
