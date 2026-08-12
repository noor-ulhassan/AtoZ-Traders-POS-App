import { openDatabase, setDb } from '../db/connection'
import type { Db } from '../db/connection'
import { migrate } from '../db/migrate'
import { computeBalance } from '../services/ledgerService'
import { reconcileStockCache } from '../services/inventoryService'
import { applyBalanceDelta } from '../repositories/partyRepository'
import { logger } from '../utils/logger'
import type { PartyType } from '@shared/types'
import { money } from '@shared/money'

const log = logger.child('bootstrap')

/**
 * Repairs cached balances that disagree with the events behind them.
 *
 * Like the stock cache, `current_balance` is derived data. It should never
 * drift — every write that moves it happens inside the same transaction as
 * the event — but a cache that can silently lie about who owes money is not
 * one to leave unchecked on a shop floor.
 */
function reconcileBalances(db: Db, type: PartyType): number {
  const table = type === 'customer' ? 'customers' : 'suppliers'
  const parties = db
    .prepare<[], { id: number; current_balance: number }>(
      `SELECT id, current_balance FROM ${table}`
    )
    .all()

  let repaired = 0
  const fix = db.transaction(() => {
    for (const party of parties) {
      const actual = computeBalance(db, type, party.id)
      const drift = money(actual - party.current_balance)
      if (Math.abs(drift) > 0.005) {
        log.error(`${type} #${party.id} balance drift of ${drift}; correcting to ${actual}`)
        applyBalanceDelta(db, type, party.id, drift)
        repaired += 1
      }
    }
  })

  fix()
  return repaired
}

/**
 * Opens the database, brings the schema up to date and verifies the derived
 * caches before a single window is shown. If any of this fails the app must
 * not start — a POS running on a half-migrated database would quietly write
 * bad data all day.
 */
export function bootstrapDatabase(): void {
  const db = openDatabase()
  setDb(db)

  const version = migrate(db)
  log.info(`database ready at schema version ${version}`)

  reconcileStockCache(db)
  reconcileBalances(db, 'customer')
  reconcileBalances(db, 'supplier')
}
