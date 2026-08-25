import type {
  Id,
  StaffCreateInput,
  StaffResetPinInput,
  StaffSetActiveInput,
  StaffUser
} from '@shared/types'
import { getDb } from '../db/connection'
import * as repo from '../repositories/userRepository'
import { hashSecret } from '../utils/password'
import { businessRule, notFound } from '../utils/errors'

/**
 * Managing staff accounts. Admin-only at the boundary (the IPC allowlist never
 * lets a shopkeeper reach these channels), so these functions assume the caller
 * is the owner and only enforce the shape rules a valid account needs.
 *
 * Staff can never be granted the admin role: the `role` column is CHECK-locked
 * to 'shopkeeper' in the schema, so a full-access account cannot be minted here
 * even by a bug.
 */

export function listUsers(): StaffUser[] {
  return repo.listUsers(getDb())
}

export function createUser(input: StaffCreateInput): StaffUser {
  const db = getDb()
  const { pinHash, pinSalt } = hashPin(input.pin)
  const id = repo.insertUser(db, { username: input.username, pinHash, pinSalt })
  return repo.toStaffUser(repo.findById(db, id)!)
}

export function resetPin(input: StaffResetPinInput): StaffUser {
  const db = getDb()
  const row = repo.findById(db, input.id)
  if (!row) throw notFound('Staff member')
  const { pinHash, pinSalt } = hashPin(input.pin)
  repo.updatePin(db, input.id, pinHash, pinSalt)
  return repo.toStaffUser(repo.findById(db, input.id)!)
}

export function setUserActive(input: StaffSetActiveInput): StaffUser {
  const db = getDb()
  const row = repo.findById(db, input.id)
  if (!row) throw notFound('Staff member')
  repo.setActive(db, input.id, input.isActive)
  return repo.toStaffUser(repo.findById(db, input.id)!)
}

export function getUser(id: Id): StaffUser {
  const row = repo.findById(getDb(), id)
  if (!row) throw notFound('Staff member')
  return repo.toStaffUser(row)
}

/** A PIN is exactly four digits; hashing follows the same scrypt path as the
 *  admin password so a stolen `pos.db` is no cheaper to attack for staff. */
function hashPin(pin: string): { pinHash: string; pinSalt: string } {
  if (!/^\d{4}$/.test(pin)) {
    throw businessRule('The PIN must be exactly four digits.')
  }
  const secret = hashSecret(pin)
  return { pinHash: secret.hash, pinSalt: secret.salt }
}
