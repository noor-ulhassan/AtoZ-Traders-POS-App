import type { Db } from '../db/connection'

/** The stored admin credential (id = 1). Hashes only — never plain text. */
export interface AdminCredentialRow {
  password_hash: string
  password_salt: string
  security_question: string
  security_answer_hash: string
  security_answer_salt: string
  failed_attempts: number
  locked_until: string | null
}

export interface AdminCredentialInput {
  passwordHash: string
  passwordSalt: string
  securityQuestion: string
  securityAnswerHash: string
  securityAnswerSalt: string
}

export function getCredential(db: Db): AdminCredentialRow | undefined {
  return db.prepare<[], AdminCredentialRow>('SELECT * FROM admin_credential WHERE id = 1').get()
}

export function isConfigured(db: Db): boolean {
  return getCredential(db) !== undefined
}

/** Inserts the one and only credential row. Used by first-run setup. */
export function insertCredential(db: Db, input: AdminCredentialInput): void {
  db.prepare(
    `INSERT INTO admin_credential
       (id, password_hash, password_salt,
        security_question, security_answer_hash, security_answer_salt)
     VALUES (1, ?, ?, ?, ?, ?)`
  ).run(
    input.passwordHash,
    input.passwordSalt,
    input.securityQuestion,
    input.securityAnswerHash,
    input.securityAnswerSalt
  )
}

/** Replaces the stored password and clears any lockout. */
export function updatePassword(db: Db, passwordHash: string, passwordSalt: string): void {
  db.prepare(
    `UPDATE admin_credential
       SET password_hash = ?, password_salt = ?,
           failed_attempts = 0, locked_until = NULL,
           updated_at = datetime('now','localtime')
     WHERE id = 1`
  ).run(passwordHash, passwordSalt)
}

export function recordFailedAttempt(db: Db, attempts: number, lockedUntil: string | null): void {
  db.prepare(`UPDATE admin_credential SET failed_attempts = ?, locked_until = ? WHERE id = 1`).run(
    attempts,
    lockedUntil
  )
}

export function clearLockout(db: Db): void {
  db.prepare(
    `UPDATE admin_credential SET failed_attempts = 0, locked_until = NULL WHERE id = 1`
  ).run()
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
