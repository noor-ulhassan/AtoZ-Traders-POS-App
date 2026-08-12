import type {
  Customer,
  Id,
  Page,
  PartyFilters,
  PartyInput,
  PartyType,
  Supplier
} from '@shared/types'
import type { Db } from '../db/connection'
import { getDb } from '../db/connection'
import * as parties from '../repositories/partyRepository'
import { businessRule, notFound } from '../utils/errors'

const LABEL: Record<PartyType, string> = { customer: 'Customer', supplier: 'Supplier' }

export function listParties(type: PartyType, filters: PartyFilters = {}): Page<Customer> {
  return parties.listParties(getDb(), type, filters)
}

export function getParty(type: PartyType, id: Id): Customer {
  const party = parties.findParty(getDb(), type, id)
  if (!party) throw notFound(LABEL[type])
  return party
}

export function requireParty(db: Db, type: PartyType, id: Id): Customer {
  const party = parties.findParty(db, type, id)
  if (!party) throw notFound(`${LABEL[type]} #${id}`)
  return party
}

export function addParty(type: PartyType, input: PartyInput): Customer {
  const db = getDb()
  const id = parties.insertParty(db, type, {
    name: input.name,
    phone: input.phone ?? null,
    address: input.address ?? null,
    openingBalance: input.openingBalance ?? 0
  })
  return parties.findParty(db, type, id) as Customer
}

/**
 * Profile edits are always allowed. The opening balance is only editable while
 * the party has no history: changing it afterwards would move a number that
 * every past statement was calculated from.
 */
export function updateParty(type: PartyType, id: Id, input: PartyInput): Customer {
  const db = getDb()
  const existing = requireParty(db, type, id)

  const run = db.transaction(() => {
    parties.updatePartyProfile(db, type, id, {
      name: input.name,
      phone: input.phone ?? null,
      address: input.address ?? null
    })

    const nextOpening = input.openingBalance
    if (nextOpening !== undefined && nextOpening !== existing.openingBalance) {
      if (hasTransactions(db, type, id)) {
        throw businessRule(
          `${existing.name} already has transactions, so the opening balance can no longer be changed. Record a payment or an adjustment instead.`
        )
      }
      parties.setOpeningBalance(db, type, id, nextOpening)
    }
  })

  run()
  return parties.findParty(db, type, id) as Customer
}

function hasTransactions(db: Db, type: PartyType, id: Id): boolean {
  const sql =
    type === 'customer'
      ? `SELECT
           (SELECT COUNT(*) FROM sales WHERE customer_id = @id) +
           (SELECT COUNT(*) FROM sale_returns WHERE customer_id = @id) +
           (SELECT COUNT(*) FROM payments WHERE party_type = 'customer' AND party_id = @id) AS total`
      : `SELECT
           (SELECT COUNT(*) FROM purchases WHERE supplier_id = @id) +
           (SELECT COUNT(*) FROM purchase_returns WHERE supplier_id = @id) +
           (SELECT COUNT(*) FROM payments WHERE party_type = 'supplier' AND party_id = @id) AS total`

  const row = db.prepare<{ id: Id }, { total: number }>(sql).get({ id })
  return (row?.total ?? 0) > 0
}

export const customers = {
  list: (filters?: PartyFilters): Page<Customer> => listParties('customer', filters),
  get: (id: Id): Customer => getParty('customer', id),
  add: (input: PartyInput): Customer => addParty('customer', input),
  update: (id: Id, input: PartyInput): Customer => updateParty('customer', id, input)
}

export const suppliers = {
  list: (filters?: PartyFilters): Page<Supplier> => listParties('supplier', filters),
  get: (id: Id): Supplier => getParty('supplier', id),
  add: (input: PartyInput): Supplier => addParty('supplier', input),
  update: (id: Id, input: PartyInput): Supplier => updateParty('supplier', id, input)
}
