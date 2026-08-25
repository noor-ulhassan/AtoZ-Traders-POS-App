import type { UserRole } from '@shared/types'

/**
 * The unlocked state of the current app run, and who is signed in.
 *
 * Deliberately in-memory only: nothing about the session is persisted, so
 * quitting the app always re-locks it and a relaunch demands credentials
 * again. This is the value the IPC guard (registry.ts) reads to decide whether
 * a channel is allowed to run, and — via the role — which channels.
 */

interface Session {
  role: UserRole
  /** The staff username, when the role is 'shopkeeper'. Null for the admin. */
  username: string | null
}

let session: Session | null = null

/** Marks the session unlocked as `role`. Called only by the auth service. */
export function unlock(role: UserRole, username: string | null = null): void {
  session = { role, username }
}

export function lock(): void {
  session = null
}

export function isUnlocked(): boolean {
  return session !== null
}

/** The signed-in role, or null when locked. Drives per-channel authorization. */
export function currentRole(): UserRole | null {
  return session?.role ?? null
}

/** The signed-in staff username, or null (admin, or locked). */
export function currentUsername(): string | null {
  return session?.username ?? null
}
