import type { Id, Page, Payment, PaymentFilters, PaymentInput } from '@shared/types'
import { today } from '@shared/date'
import { money } from '@shared/money'
import { getDb } from '../db/connection'
import * as parties from '../repositories/partyRepository'
import * as payments from '../repositories/paymentRepository'
import { businessRule, notFound } from '../utils/errors'
import { requireParty } from './partyService'

export function listPayments(filters: PaymentFilters = {}): Page<Payment> {
  return payments.listPayments(getDb(), filters)
}

/**
 * Money received from a customer or paid to a supplier.
 *
 * Direction follows the party type: a customer pays in, a supplier is paid
 * out. Both reduce the balance the party carries, so the sign of the ledger
 * delta is the same in each case (Guide §4).
 */
export function createPayment(input: PaymentInput): Payment {
  const db = getDb()
  const party = requireParty(db, input.partyType, input.partyId)
  const amount = money(input.amount)

  if (amount <= 0) {
    throw businessRule('Enter an amount greater than zero.')
  }

  const direction = input.partyType === 'customer' ? 'in' : 'out'

  const create = db.transaction(() => {
    const id = payments.insertPayment(db, {
      partyType: input.partyType,
      partyId: party.id,
      direction,
      amount,
      method: input.method ?? 'cash',
      date: input.date ?? today(),
      notes: input.notes ?? null
    })

    parties.applyBalanceDelta(db, input.partyType, party.id, -amount)
    return id
  })

  return payments.findPayment(db, create()) as Payment
}

/**
 * Reverses a payment entered by mistake.
 *
 * Deleting rather than voiding is acceptable here because a single owner runs
 * this shop and a wrong entry is far more likely than fraud — but the balance
 * must be put back in the same transaction.
 */
export function removePayment(id: Id): { id: Id } {
  const db = getDb()
  const payment = payments.findPayment(db, id)
  if (!payment) throw notFound('Payment')

  db.transaction(() => {
    parties.applyBalanceDelta(db, payment.partyType, payment.partyId, payment.amount)
    payments.deletePayment(db, id)
  })()

  return { id }
}
