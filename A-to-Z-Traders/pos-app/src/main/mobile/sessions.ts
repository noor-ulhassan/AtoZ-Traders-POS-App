import { randomBytes, randomUUID } from 'node:crypto'
import type { MobileDevice } from '@shared/types'
import { normalizeAddress } from './network'

/**
 * Who is signed in on a phone, right now.
 *
 * In memory only, exactly like the desktop's own lock in `auth/session.ts`,
 * and for the same reason plus one more. The same reason: closing the app must
 * sign everything out, or "locked" stops meaning anything. The extra one: a
 * token that survived a restart would be a password that never expires,
 * written in clear text on disk — and therefore in every backup the shop ever
 * takes, forever. Signing in again on the phone costs a moment; that does not.
 */

/** 256 bits of randomness. Guessing one is not a threat model, it is a joke. */
const TOKEN_BYTES = 32

/**
 * How long a phone may sit untouched before it has to sign in again.
 *
 * Twelve hours is one trading day: the owner signs in when he opens and is
 * still signed in when he closes, and a phone left in a drawer overnight is
 * not still a key to the shop's books in the morning.
 */
const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000

interface MobileSession {
  /** The opaque handle the desktop uses to revoke this device. */
  id: string
  token: string
  address: string
  device: string
  signedInAt: number
  lastSeenAt: number
}

const sessions = new Map<string, MobileSession>()

/** `2026-09-06 14:32:00`, matching the timestamps the database produces. */
function stamp(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

/**
 * A short, readable name for a device, from its user agent.
 *
 * The owner is trying to answer one question on the Settings screen — "is that
 * row my phone, or somebody else's?" — so this picks out the handful of words
 * that answer it and throws the rest of the string away. Anything unrecognised
 * shows as "Phone or tablet" rather than a wall of version numbers.
 */
export function describeDevice(userAgent: string): string {
  const agent = userAgent.slice(0, 400)
  const platform = /iPhone/i.test(agent)
    ? 'iPhone'
    : /iPad/i.test(agent)
      ? 'iPad'
      : /Android/i.test(agent)
        ? 'Android'
        : /Windows/i.test(agent)
          ? 'Windows'
          : /Macintosh|Mac OS X/i.test(agent)
            ? 'Mac'
            : null

  const browser = /EdgA?\//i.test(agent)
    ? 'Edge'
    : /OPR\/|Opera/i.test(agent)
      ? 'Opera'
      : /Firefox\//i.test(agent)
        ? 'Firefox'
        : /Chrome\//i.test(agent)
          ? 'Chrome'
          : /Safari\//i.test(agent)
            ? 'Safari'
            : null

  if (platform && browser) return `${platform} · ${browser}`
  return platform ?? browser ?? 'Phone or tablet'
}

function isExpired(session: MobileSession, now: number): boolean {
  return now - session.lastSeenAt > IDLE_TIMEOUT_MS
}

/** Drops every session that has gone quiet for longer than the idle timeout. */
function sweep(now: number): void {
  for (const [token, session] of sessions) {
    if (isExpired(session, now)) sessions.delete(token)
  }
}

/** Signs a phone in and returns the token it should send back from then on. */
export function issueSession(address: string, userAgent: string, now = Date.now()): string {
  sweep(now)
  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  sessions.set(token, {
    id: randomUUID(),
    token,
    address: normalizeAddress(address),
    device: describeDevice(userAgent),
    signedInAt: now,
    lastSeenAt: now
  })
  return token
}

/**
 * Checks a token and, if it is good, marks the device as seen just now.
 *
 * The address is recorded but deliberately NOT part of the check: a phone's
 * address changes when the router renews its lease, and signing the owner out
 * mid-bill because DHCP did something would be a bug wearing a security
 * badge. The token is the credential; the address is for the owner to read.
 */
export function verifySession(token: string, address: string, now = Date.now()): boolean {
  const session = sessions.get(token)
  if (!session) return false
  if (isExpired(session, now)) {
    sessions.delete(token)
    return false
  }
  session.lastSeenAt = now
  session.address = normalizeAddress(address)
  return true
}

/** Signs out the device holding `token`. Used by the phone's own sign-out. */
export function revokeToken(token: string): void {
  sessions.delete(token)
}

/** Signs out one device by the id the desktop shows. True if it was there. */
export function revokeDevice(id: string): boolean {
  for (const [token, session] of sessions) {
    if (session.id === id) {
      sessions.delete(token)
      return true
    }
  }
  return false
}

/** Signs out every phone. Called when the server stops, and from Settings. */
export function revokeAllDevices(): number {
  const count = sessions.size
  sessions.clear()
  return count
}

/** The devices currently signed in, most recently active first. */
export function listDevices(now = Date.now()): MobileDevice[] {
  sweep(now)
  return [...sessions.values()]
    .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
    .map((session) => ({
      id: session.id,
      address: session.address,
      device: session.device,
      signedInAt: stamp(session.signedInAt),
      lastSeenAt: stamp(session.lastSeenAt)
    }))
}

/** Minutes a signed-in phone may idle before it must sign in again. */
export const IDLE_TIMEOUT_MINUTES = IDLE_TIMEOUT_MS / 60000
