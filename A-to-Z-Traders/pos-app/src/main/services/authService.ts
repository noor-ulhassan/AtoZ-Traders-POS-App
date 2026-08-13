import type {
  AuthChangePasswordInput,
  AuthLoginInput,
  AuthResetInput,
  AuthSetupInput,
  AuthStatus,
  SecurityQuestion
} from '@shared/types'
import { getDb } from '../db/connection'
import * as repo from '../repositories/authRepository'
import type { AdminCredentialRow } from '../repositories/authRepository'
import { isUnlocked, lock as lockSession, unlock as unlockSession } from '../auth/session'
import { hashSecret, normalizeAnswer, verifySecret } from '../utils/password'
import { AppError } from '../utils/errors'

/**
 * The admin gate for the whole app.
 *
 * The session lives in `auth/session.ts` (main-process memory only), so this
 * service is the sole place a password is checked and the only thing that can
 * flip the app to unlocked. The IPC guard in `ipc/registry.ts` reads that
 * session for every non-auth channel, which is what makes the lock a real
 * boundary rather than a hidden screen.
 */

const MAX_ATTEMPTS = 5
const LOCK_MINUTES = 15

const authError = (message: string, fields?: Record<string, string>): AppError =>
  new AppError('AUTH', message, fields)

/** Returns the active lockout timestamp, or null when not currently locked. */
function activeLock(db: import('../db/connection').Db, row: AdminCredentialRow): string | null {
  if (!row.locked_until) return null
  return row.locked_until > repo.now(db) ? row.locked_until : null
}

/** '2026-08-13 14:32:00' -> '14:32', for a human-friendly "try again after". */
const clockOf = (timestamp: string): string => timestamp.slice(11, 16)

export function getStatus(): AuthStatus {
  const db = getDb()
  const row = repo.getCredential(db)
  if (!row) {
    return { configured: false, unlocked: isUnlocked(), locked: false }
  }
  const lockedUntil = activeLock(db, row)
  return {
    configured: true,
    unlocked: isUnlocked(),
    locked: lockedUntil !== null,
    ...(lockedUntil ? { lockedUntil } : {}),
    securityQuestion: row.security_question
  }
}

/** First-run: set the password + recovery question. Only allowed once. */
export function setup(input: AuthSetupInput): AuthStatus {
  const db = getDb()
  if (repo.isConfigured(db)) {
    throw authError('An admin password has already been set on this device.')
  }
  const password = hashSecret(input.password)
  const answer = hashSecret(normalizeAnswer(input.securityAnswer))
  repo.insertCredential(db, {
    passwordHash: password.hash,
    passwordSalt: password.salt,
    securityQuestion: input.securityQuestion.trim(),
    securityAnswerHash: answer.hash,
    securityAnswerSalt: answer.salt
  })
  unlockSession()
  return getStatus()
}

export function login(input: AuthLoginInput): AuthStatus {
  const db = getDb()
  const row = repo.getCredential(db)
  if (!row) throw authError('No admin password has been set up yet.')

  const locked = activeLock(db, row)
  if (locked) {
    throw authError(`Too many attempts. Try again after ${clockOf(locked)}.`)
  }

  if (verifySecret(input.password, row.password_salt, row.password_hash)) {
    repo.clearLockout(db)
    unlockSession()
    return getStatus()
  }

  const attempts = row.failed_attempts + 1
  if (attempts >= MAX_ATTEMPTS) {
    const until = repo.lockTimestamp(db, LOCK_MINUTES)
    repo.recordFailedAttempt(db, attempts, until)
    throw authError(`Too many attempts. The app is locked until ${clockOf(until)}.`)
  }
  repo.recordFailedAttempt(db, attempts, null)
  const remaining = MAX_ATTEMPTS - attempts
  throw authError(
    `Incorrect password. ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} left before a temporary lock.`,
    { password: 'Incorrect password.' }
  )
}

export function lock(): AuthStatus {
  lockSession()
  return getStatus()
}

export function changePassword(input: AuthChangePasswordInput): AuthStatus {
  const db = getDb()
  if (!isUnlocked()) throw authError('Unlock the app before changing the password.')

  const row = repo.getCredential(db)
  if (!row) throw authError('No admin password has been set up yet.')

  if (!verifySecret(input.currentPassword, row.password_salt, row.password_hash)) {
    throw authError('Your current password is incorrect.', {
      currentPassword: 'Incorrect password.'
    })
  }

  const password = hashSecret(input.newPassword)
  repo.updatePassword(db, password.hash, password.salt)
  return getStatus()
}

/** The recovery prompt, for the "forgot password" flow. */
export function getSecurityQuestion(): SecurityQuestion {
  const row = repo.getCredential(getDb())
  return { question: row?.security_question ?? null }
}

/** Recover by answering the security question, then choose a new password. */
export function resetPassword(input: AuthResetInput): AuthStatus {
  const db = getDb()
  const row = repo.getCredential(db)
  if (!row) throw authError('No admin password has been set up yet.')

  const locked = activeLock(db, row)
  if (locked) {
    throw authError(`Too many attempts. Try again after ${clockOf(locked)}.`)
  }

  const answerMatches = verifySecret(
    normalizeAnswer(input.securityAnswer),
    row.security_answer_salt,
    row.security_answer_hash
  )
  if (!answerMatches) {
    // Throttle the recovery path too, or it becomes the weakest way in.
    const attempts = row.failed_attempts + 1
    if (attempts >= MAX_ATTEMPTS) {
      const until = repo.lockTimestamp(db, LOCK_MINUTES)
      repo.recordFailedAttempt(db, attempts, until)
      throw authError(`Too many attempts. Recovery is locked until ${clockOf(until)}.`)
    }
    repo.recordFailedAttempt(db, attempts, null)
    throw authError('That answer does not match what was saved.', {
      securityAnswer: 'Incorrect answer.'
    })
  }

  const password = hashSecret(input.newPassword)
  repo.updatePassword(db, password.hash, password.salt) // also clears the lockout
  unlockSession()
  return getStatus()
}
