/**
 * The unlocked state of the current app run.
 *
 * Deliberately in-memory only: nothing about the session is persisted, so
 * quitting the app always re-locks it and a relaunch demands the password
 * again. This is the value the IPC guard (registry.ts) reads to decide whether
 * a business channel is allowed to run.
 */

let unlocked = false

export function unlock(): void {
  unlocked = true
}

export function lock(): void {
  unlocked = false
}

export function isUnlocked(): boolean {
  return unlocked
}
