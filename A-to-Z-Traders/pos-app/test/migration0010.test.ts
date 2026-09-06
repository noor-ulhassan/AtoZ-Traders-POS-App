import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import type { Db } from '../src/main/db/connection'
import { migrate } from '../src/main/db/migrate'
import { LATEST_VERSION, MIGRATIONS } from '../src/main/db/migrations'
import { getSettings, updateSettings } from '../src/main/repositories/settingsRepository'

/**
 * The upgrade path to 0010, not the fresh install.
 *
 * The case that matters is the shop's own file, already holding a settings row
 * with a business name, a backup folder and a schedule in it. Two columns are
 * added to that row, and the one thing this test exists to prove is that the
 * new one arrives OFF.
 *
 * That is not a stylistic preference. `mobile_enabled` opens a port on the
 * shop's network. A default of 1 would mean that installing an update turned
 * on network access to a shop's books without anybody choosing to — the exact
 * kind of thing that must be impossible rather than merely unlikely.
 */

/** A database at schema version 9 — what a live install is upgrading from. */
function databaseAtVersion(version: number): Db {
  const db = openDatabase(':memory:')

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `)

  const record = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
  for (const migration of MIGRATIONS.filter((entry) => entry.version <= version)) {
    db.exec(migration.sql)
    record.run(migration.version, migration.name)
  }
  return db
}

/** A shop that has been running for a while and configured its own settings. */
function seedVersion9(db: Db): void {
  db.prepare(
    `UPDATE settings
        SET business_name = 'A to Z Traders',
            currency = 'PKR',
            tax_enabled = 1,
            tax_rate = 17,
            auto_backup_dir = 'D:\\Backups',
            backup_interval_minutes = 30
      WHERE id = 1`
  ).run()
}

describe('migration 0010 — phone access', () => {
  it('brings a version 9 shop up to the latest schema', () => {
    const db = databaseAtVersion(9)
    seedVersion9(db)

    expect(migrate(db)).toBe(LATEST_VERSION)
    expect(LATEST_VERSION).toBe(10)
  })

  it('leaves phone access OFF on an existing install', () => {
    const db = databaseAtVersion(9)
    seedVersion9(db)
    migrate(db)

    // The property this migration lives or dies by: upgrading never opens a
    // port. Only the owner does, deliberately, from the Settings screen.
    expect(getSettings(db).mobileEnabled).toBe(false)
  })

  it('leaves phone access OFF on a fresh install too', () => {
    const db = openDatabase(':memory:')
    migrate(db)

    expect(getSettings(db).mobileEnabled).toBe(false)
  })

  it('defaults to a port that is free to change', () => {
    const db = databaseAtVersion(9)
    migrate(db)

    const settings = getSettings(db)
    expect(settings.mobilePort).toBe(8420)
    // Above 1023, so binding it never needs administrator rights on Windows.
    expect(settings.mobilePort).toBeGreaterThan(1023)
  })

  it('keeps every setting the shop had already chosen', () => {
    const db = databaseAtVersion(9)
    seedVersion9(db)
    migrate(db)

    const settings = getSettings(db)
    expect(settings.businessName).toBe('A to Z Traders')
    expect(settings.currency).toBe('PKR')
    expect(settings.taxEnabled).toBe(true)
    expect(settings.taxRate).toBe(17)
    expect(settings.autoBackupDir).toBe('D:\\Backups')
    expect(settings.backupIntervalMinutes).toBe(30)
  })

  it('round-trips the two new fields through the repository', () => {
    const db = databaseAtVersion(9)
    migrate(db)

    updateSettings(db, { mobileEnabled: true, mobilePort: 9100 })
    expect(getSettings(db).mobileEnabled).toBe(true)
    expect(getSettings(db).mobilePort).toBe(9100)

    updateSettings(db, { mobileEnabled: false })
    expect(getSettings(db).mobileEnabled).toBe(false)
    // Turning it off does not forget which port was chosen.
    expect(getSettings(db).mobilePort).toBe(9100)
  })
})
