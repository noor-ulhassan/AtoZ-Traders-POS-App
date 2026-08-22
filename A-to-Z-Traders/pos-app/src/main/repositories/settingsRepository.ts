import type { Settings, SettingsUpdate } from '@shared/types'
import type { Db } from '../db/connection'
import { fromBool, toBool } from '../db/rows'

interface SettingsRow {
  business_name: string
  address: string
  phone: string
  email: string
  website: string
  tax_number: string
  tax_enabled: number
  tax_rate: number
  receipt_footer: string
  logo_path: string
  currency: string
  auto_backup_dir: string
}

/** Maps `Settings` keys to their column names — the only place the two meet. */
const COLUMNS: Record<keyof Settings, keyof SettingsRow> = {
  businessName: 'business_name',
  address: 'address',
  phone: 'phone',
  email: 'email',
  website: 'website',
  taxNumber: 'tax_number',
  taxEnabled: 'tax_enabled',
  taxRate: 'tax_rate',
  receiptFooter: 'receipt_footer',
  logoPath: 'logo_path',
  currency: 'currency',
  autoBackupDir: 'auto_backup_dir'
}

function toSettings(row: SettingsRow): Settings {
  return {
    businessName: row.business_name,
    address: row.address,
    phone: row.phone,
    email: row.email,
    website: row.website,
    taxNumber: row.tax_number,
    taxEnabled: toBool(row.tax_enabled),
    taxRate: row.tax_rate,
    receiptFooter: row.receipt_footer,
    logoPath: row.logo_path,
    currency: row.currency,
    autoBackupDir: row.auto_backup_dir
  }
}

export function getSettings(db: Db): Settings {
  const row = db.prepare<[], SettingsRow>('SELECT * FROM settings WHERE id = 1').get()
  if (!row) {
    // The row is seeded by migration 0001 and guarded by CHECK (id = 1); if it
    // is missing the database has been tampered with.
    throw new Error('Settings row is missing from the database.')
  }
  return toSettings(row)
}

export function updateSettings(db: Db, patch: SettingsUpdate): void {
  const assignments: string[] = []
  const values: (string | number)[] = []

  for (const [key, column] of Object.entries(COLUMNS) as [keyof Settings, keyof SettingsRow][]) {
    const value = patch[key]
    if (value === undefined) continue
    assignments.push(`${column} = ?`)
    values.push(typeof value === 'boolean' ? fromBool(value) : value)
  }

  if (assignments.length === 0) return
  db.prepare(`UPDATE settings SET ${assignments.join(', ')} WHERE id = 1`).run(...values)
}
