import type { StaffUser, UserRole } from '@shared/types'
import type { Db } from '../db/connection'
import { toBool } from '../db/rows'

/**
 * Staff accounts (role 'shopkeeper'). Hashes only — the PIN never leaves this
 * process in plain text, and never reaches the renderer at all.
 */
export interface StaffUserRow {
  id: number
  username: string
  pin_hash: string
  pin_salt: string
  role: UserRole
  is_active: number
  failed_attempts: number
  locked_until: string | null
  last_login_at: string | null
  created_at: string
}

export interface StaffUserInput {
  username: string
  pinHash: string
  pinSalt: string
}

/** Maps a row to the renderer-safe shape — hashes and lockout state stripped. */
export function toStaffUser(row: StaffUserRow): StaffUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    isActive: toBool(row.is_active),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at
  }
}

export function listUsers(db: Db): StaffUser[] {
  return db
    .prepare<[], StaffUserRow>('SELECT * FROM staff_users ORDER BY username COLLATE NOCASE')
    .all()
    .map(toStaffUser)
}

export function findById(db: Db, id: number): StaffUserRow | undefined {
  return db.prepare<[number], StaffUserRow>('SELECT * FROM staff_users WHERE id = ?').get(id)
}

/** Case-insensitive lookup — usernames are unique under NOCASE collation. */
export function findByUsername(db: Db, username: string): StaffUserRow | undefined {
  return db
    .prepare<[string], StaffUserRow>('SELECT * FROM staff_users WHERE username = ? COLLATE NOCASE')
    .get(username)
}

export function insertUser(db: Db, input: StaffUserInput): number {
  const result = db
    .prepare(
      `INSERT INTO staff_users (username, pin_hash, pin_salt)
       VALUES (@username, @pinHash, @pinSalt)`
    )
    .run(input)
  return Number(result.lastInsertRowid)
}

export function updatePin(db: Db, id: number, pinHash: string, pinSalt: string): void {
  db.prepare(
    `UPDATE staff_users
        SET pin_hash = ?, pin_salt = ?,
            failed_attempts = 0, locked_until = NULL,
            updated_at = datetime('now','localtime')
      WHERE id = ?`
  ).run(pinHash, pinSalt, id)
}

export function setActive(db: Db, id: number, isActive: boolean): void {
  db.prepare(
    `UPDATE staff_users
        SET is_active = ?, updated_at = datetime('now','localtime')
      WHERE id = ?`
  ).run(isActive ? 1 : 0, id)
}

export function recordFailedAttempt(
  db: Db,
  id: number,
  attempts: number,
  lockedUntil: string | null
): void {
  db.prepare('UPDATE staff_users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(
    attempts,
    lockedUntil,
    id
  )
}

export function recordSuccessfulLogin(db: Db, id: number): void {
  db.prepare(
    `UPDATE staff_users
        SET failed_attempts = 0, locked_until = NULL,
            last_login_at = datetime('now','localtime')
      WHERE id = ?`
  ).run(id)
}

/** Current DB clock as 'YYYY-MM-DD HH:MM:SS' localtime — for lockout comparisons. */
export function now(db: Db): string {
  const row = db.prepare<[], { t: string }>(`SELECT datetime('now','localtime') AS t`).get()
  return row!.t
}

/** A timestamp `minutes` into the future, in the same format as `now`. */
export function lockTimestamp(db: Db, minutes: number): string {
  const row = db
    .prepare<[string], { t: string }>(`SELECT datetime('now','localtime', ?) AS t`)
    .get(`+${minutes} minutes`)
  return row!.t
}
