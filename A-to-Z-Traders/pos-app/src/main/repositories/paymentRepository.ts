import type {
  Id,
  PageWithTotals,
  Payment,
  PaymentDirection,
  PaymentFilters,
  PaymentMethod,
  PaymentPageTotals,
  PartyType
} from '@shared/types'
import { money } from '@shared/money'
import { DEFAULT_PAGE_SIZE } from '@shared/pagination'
import type { Db } from '../db/connection'
import { toText } from '../db/rows'

interface PaymentRow {
  id: number
  party_type: PartyType
  party_id: number
  party_name: string | null
  direction: PaymentDirection
  amount: number
  method: PaymentMethod
  date: string
  notes: string | null
  created_at: string
}

const toPayment = (row: PaymentRow): Payment => ({
  id: row.id,
  partyType: row.party_type,
  partyId: row.party_id,
  partyName: row.party_name ?? 'Unknown',
  direction: row.direction,
  amount: row.amount,
  method: row.method,
  date: row.date,
  notes: toText(row.notes),
  createdAt: row.created_at
})

/**
 * `payments.party_id` is a soft reference — it points at either table
 * depending on `party_type` — so the name is resolved with two LEFT JOINs and
 * a CASE rather than a single foreign key.
 */
const SELECT = `
  SELECT pm.*,
         CASE pm.party_type WHEN 'customer' THEN c.name ELSE s.name END AS party_name
    FROM payments pm
    LEFT JOIN customers c ON pm.party_type = 'customer' AND c.id = pm.party_id
    LEFT JOIN suppliers s ON pm.party_type = 'supplier' AND s.id = pm.party_id
`

function buildFilter(filters: PaymentFilters): { where: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []

  if (filters.from) {
    clauses.push('pm.date >= ?')
    params.push(filters.from)
  }
  if (filters.to) {
    clauses.push('pm.date <= ?')
    params.push(filters.to)
  }
  if (filters.partyType && filters.partyType !== 'all') {
    clauses.push('pm.party_type = ?')
    params.push(filters.partyType)
  }
  if (filters.partyId != null) {
    clauses.push('pm.party_id = ?')
    params.push(filters.partyId)
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export function listPayments(
  db: Db,
  filters: PaymentFilters = {}
): PageWithTotals<Payment, PaymentPageTotals> {
  const { where, params } = buildFilter(filters)
  const limit = filters.limit ?? DEFAULT_PAGE_SIZE
  const offset = filters.offset ?? 0

  const rows = db
    .prepare<unknown[], PaymentRow>(
      `${SELECT} ${where} ORDER BY pm.date DESC, pm.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)

  const summary = db
    .prepare<unknown[], { total: number; received: number | null; paid: number | null }>(
      `SELECT COUNT(*)                                             AS total,
              SUM(CASE WHEN pm.direction = 'in'  THEN pm.amount END) AS received,
              SUM(CASE WHEN pm.direction = 'out' THEN pm.amount END) AS paid
         FROM payments pm ${where}`
    )
    .get(...params)

  return {
    rows: rows.map(toPayment),
    total: summary?.total ?? 0,
    totals: {
      received: money(summary?.received ?? 0),
      paid: money(summary?.paid ?? 0)
    }
  }
}

export function findPayment(db: Db, id: Id): Payment | null {
  const row = db.prepare<[Id], PaymentRow>(`${SELECT} WHERE pm.id = ?`).get(id)
  return row ? toPayment(row) : null
}

export function insertPayment(
  db: Db,
  fields: {
    partyType: PartyType
    partyId: Id
    direction: PaymentDirection
    amount: number
    method: PaymentMethod
    date: string
    notes: string | null
  }
): Id {
  const info = db
    .prepare(
      `INSERT INTO payments (party_type, party_id, direction, amount, method, date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      fields.partyType,
      fields.partyId,
      fields.direction,
      money(fields.amount),
      fields.method,
      fields.date,
      fields.notes
    )
  return Number(info.lastInsertRowid)
}

export function deletePayment(db: Db, id: Id): void {
  db.prepare('DELETE FROM payments WHERE id = ?').run(id)
}
