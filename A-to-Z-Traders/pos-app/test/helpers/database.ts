import { openDatabase, setDb } from '../../src/main/db/connection'
import type { Db } from '../../src/main/db/connection'
import { migrate } from '../../src/main/db/migrate'

/**
 * A fresh, fully migrated database per test.
 *
 * `:memory:` means every test starts from the same known-empty state and none
 * of them can see each other's rows — and it runs the real `0001_init.sql`,
 * so a schema mistake fails here rather than on a shop counter.
 */
export function createTestDb(): Db {
  const db = openDatabase(':memory:')
  migrate(db)
  setDb(db)
  return db
}
