import type {
  Customer,
  Id,
  PageWithTotals,
  PartyFilters,
  PartyPageTotals,
  PartyType,
  Supplier
} from '@shared/types'
import { money } from '@shared/money'
import { DEFAULT_PAGE_SIZE } from '@shared/pagination'
import type { Db } from '../db/connection'
import { toText } from '../db/rows'

/**
 * Customers and suppliers are the same shape with opposite balance semantics,
 * so they share one repository. The table name is derived from a closed union
 * — never from caller-supplied text — so it can never be an injection point.
 */
const TABLES: Record<PartyType, 'customers' | 'suppliers'> = {
  customer: 'customers',
  supplier: 'suppliers'
}

interface PartyRow {
  id: number
  name: string
  phone: string | null
  address: string | null
  opening_balance: number
  current_balance: number
  created_at: string
}

const toParty = (row: PartyRow): Customer & Supplier => ({
  id: row.id,
  name: row.name,
  phone: toText(row.phone),
  address: toText(row.address),
  openingBalance: row.opening_balance,
  currentBalance: row.current_balance,
  createdAt: row.created_at
})

function buildFilter(filters: PartyFilters): { where: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []

  if (filters.search) {
    const term = `%${filters.search.trim()}%`
    clauses.push('(name LIKE ? OR phone LIKE ?)')
    params.push(term, term)
  }
  if (filters.withBalanceOnly) {
    clauses.push('ABS(current_balance) > 0.005')
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export function listParties(
  db: Db,
  type: PartyType,
  filters: PartyFilters = {}
): PageWithTotals<Customer, PartyPageTotals> {
  const table = TABLES[type]
  const { where, params } = buildFilter(filters)
  const limit = filters.limit ?? DEFAULT_PAGE_SIZE
  const offset = filters.offset ?? 0

  const rows = db
    .prepare<unknown[], PartyRow>(
      `SELECT * FROM ${table} ${where} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)

  // Only positive balances are summed: a customer in credit does not reduce
  // what the rest of them owe, and netting the two would understate the debt.
  const summary = db
    .prepare<unknown[], { total: number; outstanding: number | null }>(
      `SELECT COUNT(*) AS total, SUM(MAX(0, current_balance)) AS outstanding
         FROM ${table} ${where}`
    )
    .get(...params)

  return {
    rows: rows.map(toParty),
    total: summary?.total ?? 0,
    totals: { outstanding: money(summary?.outstanding ?? 0) }
  }
}

export function findParty(db: Db, type: PartyType, id: Id): Customer | null {
  const row = db.prepare<[Id], PartyRow>(`SELECT * FROM ${TABLES[type]} WHERE id = ?`).get(id)
  return row ? toParty(row) : null
}

export interface PartyWriteFields {
  name: string
  phone: string | null
  address: string | null
  openingBalance: number
}

export function insertParty(db: Db, type: PartyType, fields: PartyWriteFields): Id {
  const opening = money(fields.openingBalance)
  const info = db
    .prepare(
      `INSERT INTO ${TABLES[type]} (name, phone, address, opening_balance, current_balance)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(fields.name, fields.phone, fields.address, opening, opening)
  return Number(info.lastInsertRowid)
}

/** Updates the profile only. Balances move through transactions, never a form. */
export function updatePartyProfile(
  db: Db,
  type: PartyType,
  id: Id,
  fields: Omit<PartyWriteFields, 'openingBalance'>
): void {
  db.prepare(`UPDATE ${TABLES[type]} SET name = ?, phone = ?, address = ? WHERE id = ?`).run(
    fields.name,
    fields.phone,
    fields.address,
    id
  )
}

/**
 * Rewrites the opening balance and shifts the cached current balance by the
 * same delta, keeping the statement consistent. Only allowed while the party
 * has no transactions — the service enforces that.
 */
export function setOpeningBalance(db: Db, type: PartyType, id: Id, value: number): void {
  db.prepare(
    `UPDATE ${TABLES[type]}
        SET current_balance = ROUND(current_balance - opening_balance + ?, 2),
            opening_balance = ?
      WHERE id = ?`
  ).run(money(value), money(value), id)
}

/** Applies a signed change to the cached balance, inside the caller's transaction. */
export function applyBalanceDelta(db: Db, type: PartyType, id: Id, delta: number): void {
  db.prepare(
    `UPDATE ${TABLES[type]} SET current_balance = ROUND(current_balance + ?, 2) WHERE id = ?`
  ).run(money(delta), id)
}

export function totalOutstanding(db: Db, type: PartyType): number {
  const row = db
    .prepare<[], { total: number | null }>(
      `SELECT SUM(current_balance) AS total FROM ${TABLES[type]} WHERE current_balance > 0`
    )
    .get()
  return money(row?.total ?? 0)
}
