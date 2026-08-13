import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * Password (and security-answer) hashing.
 *
 * Uses scrypt from Node's built-in `crypto` — deliberately no bcrypt/argon2
 * dependency, so `better-sqlite3` stays the only native module the app builds.
 * scrypt is memory-hard, which is what makes an offline guess against a stolen
 * `pos.db` expensive rather than instant.
 *
 * A per-secret random salt is stored alongside the hash, so two owners who
 * happen to choose the same password never share a hash. Verification is a
 * constant-time compare — never `===` — so a near-miss cannot be timed.
 */

// N=2^14 keeps a single hash well under ~100ms on shop-counter hardware while
// still costing an attacker real memory and time per guess.
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const
const KEY_LENGTH = 64
const SALT_BYTES = 16

export interface HashedSecret {
  hash: string
  salt: string
}

/** Hashes a plain secret, generating a fresh random salt. */
export function hashSecret(plain: string): HashedSecret {
  const salt = randomBytes(SALT_BYTES).toString('hex')
  const hash = scryptSync(plain, salt, KEY_LENGTH, SCRYPT_PARAMS).toString('hex')
  return { hash, salt }
}

/** Constant-time check of a plain secret against a stored salt + hash. */
export function verifySecret(plain: string, salt: string, expectedHash: string): boolean {
  const actual = scryptSync(plain, salt, KEY_LENGTH, SCRYPT_PARAMS)
  let expected: Buffer
  try {
    expected = Buffer.from(expectedHash, 'hex')
  } catch {
    return false
  }
  // timingSafeEqual throws on a length mismatch; guard so a corrupted row is a
  // clean "no" rather than a crash.
  if (expected.length !== actual.length) return false
  return timingSafeEqual(actual, expected)
}

/**
 * Normalises a security answer before hashing so "Karachi", " karachi " and
 * "KARACHI" all match. Applied identically on setup and on verification.
 */
export function normalizeAnswer(answer: string): string {
  return answer.trim().toLowerCase().replace(/\s+/g, ' ')
}
