import { AsyncLocalStorage } from 'node:async_hooks'
import type { UserRole } from '@shared/types'

/**
 * The unlocked state of the current app run, and who is signed in.
 *
 * Deliberately in-memory only: nothing about the session is persisted, so
 * quitting the app always re-locks it and a relaunch demands credentials
 * again. This is the value the IPC guard (registry.ts) reads to decide whether
 * a channel is allowed to run, and — via the role — which channels.
 *
 * Two services read it directly rather than through the guard, and that is why
 * the override below exists: `dashboardService` and `reportService` REDACT
 * their own payloads for a shopkeeper, and `salesService` stamps the signed-in
 * name onto a bill's revision history. Identity is therefore ambient, not a
 * parameter, and any caller that is not the desktop window has to say so.
 */

interface Session {
  role: UserRole
  /** The staff username, when the role is 'shopkeeper'. Null for the admin. */
  username: string | null
}

/** The desktop window's session. One per app run, exactly as before. */
let session: Session | null = null

/**
 * A session that applies only inside one call, for a caller that is not the
 * desktop window — today, a request from the companion app on the phone.
 *
 * `AsyncLocalStorage` rather than a swap-and-restore global: a request handler
 * awaits, and while it is suspended another request may run. A plain variable
 * would leak one caller's identity into another's redaction. The store follows
 * the async call chain instead, so two requests in flight cannot see each
 * other's, and the desktop's own session is never touched by either.
 */
const acting = new AsyncLocalStorage<Session>()

/** Marks the session unlocked as `role`. Called only by the auth service. */
export function unlock(role: UserRole, username: string | null = null): void {
  session = { role, username }
}

export function lock(): void {
  session = null
}

/**
 * Runs `work` as `role`, without touching the desktop's own session.
 *
 * Every phone request goes through this, so the guard, the dashboard's
 * redaction and a bill's "changed by" all see the phone's identity — whatever
 * the person at the counter happens to be signed in as.
 */
export function runAs<T>(role: UserRole, username: string | null, work: () => T): T {
  return acting.run({ role, username }, work)
}

/** The session in force right now: the acting one if inside `runAs`. */
function current(): Session | null {
  return acting.getStore() ?? session
}

export function isUnlocked(): boolean {
  return current() !== null
}

/** The signed-in role, or null when locked. Drives per-channel authorization. */
export function currentRole(): UserRole | null {
  return current()?.role ?? null
}

/** The signed-in staff username, or null (admin, or locked). */
export function currentUsername(): string | null {
  return current()?.username ?? null
}
