import type {
  DateRange,
  Id,
  LedgerEntry,
  LedgerEntryKind,
  LedgerStatement,
  PartyType
} from '@shared/types'
import { money } from '@shared/money'
import type { Db } from '../db/connection'
import { getDb } from '../db/connection'
import { requireParty } from './partyService'

interface LedgerRow {
  date: string
  kind: LedgerEntryKind
  description: string
  reference: string
  /** Signed: positive increases the balance the party carries. */
  delta: number
  source_table: string
  source_id: number
}

/**
 * The khata.
 *
 * One signed `delta` per event drives everything: positive means the party
 * owes more (a credit sale to a customer, an unpaid purchase from a supplier),
 * negative means the balance came down (a payment, a credit return). Debit and
 * credit columns are just a presentation of that sign, so the running balance
 * can never disagree with `current_balance`.
 */
const CUSTOMER_SQL = `
  SELECT s.date                                AS date,
         'sale_credit'                         AS kind,
         'Credit sale ' || s.invoice_no        AS description,
         s.invoice_no                          AS reference,
         ROUND(s.total - s.paid_amount, 2)     AS delta,
         'sales'                               AS source_table,
         s.id                                  AS source_id
    FROM sales s
   WHERE s.customer_id = @partyId
     AND ROUND(s.total - s.paid_amount, 2) > 0

  UNION ALL

  SELECT p.date,
         'payment_in',
         'Payment received (' || p.method || ')',
         'PMT-' || p.id,
         -p.amount,
         'payments',
         p.id
    FROM payments p
   WHERE p.party_type = 'customer' AND p.party_id = @partyId AND p.direction = 'in'

  UNION ALL

  SELECT r.date,
         'sale_return',
         'Return credit' || COALESCE(' against ' || s.invoice_no, ''),
         'SR-' || r.id,
         -r.total,
         'sale_returns',
         r.id
    FROM sale_returns r
    LEFT JOIN sales s ON s.id = r.sale_id
   WHERE r.customer_id = @partyId AND r.refund_type = 'credit'
`

const SUPPLIER_SQL = `
  SELECT pu.date,
         'purchase_credit'                          AS kind,
         'Purchase' || COALESCE(' ' || pu.invoice_no, '') AS description,
         COALESCE(pu.invoice_no, 'PUR-' || pu.id)   AS reference,
         ROUND(pu.total - pu.paid_amount, 2)        AS delta,
         'purchases'                                AS source_table,
         pu.id                                      AS source_id
    FROM purchases pu
   WHERE pu.supplier_id = @partyId
     AND ROUND(pu.total - pu.paid_amount, 2) <> 0

  UNION ALL

  SELECT p.date,
         'payment_out',
         'Payment made (' || p.method || ')',
         'PMT-' || p.id,
         -p.amount,
         'payments',
         p.id
    FROM payments p
   WHERE p.party_type = 'supplier' AND p.party_id = @partyId AND p.direction = 'out'

  UNION ALL

  SELECT r.date,
         'purchase_return',
         'Goods returned',
         'PR-' || r.id,
         -r.total,
         'purchase_returns',
         r.id
    FROM purchase_returns r
   WHERE r.supplier_id = @partyId
`

function sourceSql(type: PartyType): string {
  return type === 'customer' ? CUSTOMER_SQL : SUPPLIER_SQL
}

function sumBefore(db: Db, type: PartyType, partyId: Id, before: string): number {
  const row = db
    .prepare<{ partyId: Id; before: string }, { total: number | null }>(
      `SELECT SUM(delta) AS total FROM (${sourceSql(type)}) WHERE date < @before`
    )
    .get({ partyId, before })
  return money(row?.total ?? 0)
}

function entriesInRange(db: Db, type: PartyType, partyId: Id, range: DateRange): LedgerRow[] {
  return db
    .prepare<{ partyId: Id; from: string; to: string }, LedgerRow>(
      `SELECT * FROM (${sourceSql(type)})
        WHERE date >= @from AND date <= @to
        ORDER BY date ASC, source_id ASC`
    )
    .all({ partyId, from: range.from, to: range.to })
}

export function getStatement(type: PartyType, partyId: Id, range: DateRange): LedgerStatement {
  const db = getDb()
  const party = requireParty(db, type, partyId)

  // The opening balance was set when the party was created, so it belongs at
  // the head of the very first statement and inside the carried-forward figure
  // of every later one.
  const openingBalance = money(party.openingBalance + sumBefore(db, type, partyId, range.from))

  const rows = entriesInRange(db, type, partyId, range)
  const entries: LedgerEntry[] = []
  let balance = openingBalance
  let totalDebit = 0
  let totalCredit = 0

  for (const row of rows) {
    const delta = money(row.delta)
    balance = money(balance + delta)
    const debit = delta > 0 ? delta : 0
    const credit = delta < 0 ? money(-delta) : 0
    totalDebit = money(totalDebit + debit)
    totalCredit = money(totalCredit + credit)

    entries.push({
      date: row.date,
      kind: row.kind,
      description: row.description,
      reference: row.reference,
      debit,
      credit,
      balance,
      sourceTable: row.source_table,
      sourceId: row.source_id
    })
  }

  return {
    partyType: type,
    partyId,
    partyName: party.name,
    openingBalance,
    entries,
    totalDebit,
    totalCredit,
    closingBalance: balance
  }
}

/**
 * Recomputes a party's balance from its events. Used by the integrity check at
 * startup, and the definition the cached `current_balance` must always match.
 */
export function computeBalance(db: Db, type: PartyType, partyId: Id): number {
  const party = requireParty(db, type, partyId)
  const row = db
    .prepare<{ partyId: Id }, { total: number | null }>(
      `SELECT SUM(delta) AS total FROM (${sourceSql(type)})`
    )
    .get({ partyId })
  return money(party.openingBalance + (row?.total ?? 0))
}
