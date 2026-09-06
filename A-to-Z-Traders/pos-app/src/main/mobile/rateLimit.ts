import { normalizeAddress } from './network'

/**
 * Throttling for the one endpoint on the network that takes a password.
 *
 * This deliberately does NOT reuse the admin lockout in `authService.login`.
 * That one locks the stored credential for fifteen minutes after five wrong
 * tries, which is exactly right for the keyboard in front of the till — and
 * exactly wrong for a port on the shop Wi-Fi, where it turns into a weapon:
 * anyone in range could lock the owner out of his own till by guessing badly
 * at his phone login. So the network path is throttled per device, here, and
 * `verifyAdminPassword` leaves the credential's counters alone.
 *
 * There is no global cap on top of the per-device one for the same reason. A
 * global cap would let one visitor deny the owner the phone app entirely; the
 * fixed delay below slows a guesser without handing anyone that lever.
 */

/** Wrong tries from one address before it is turned away for a while. */
const MAX_ATTEMPTS = 5

/** How long a blocked address waits, and how long failures are remembered. */
const WINDOW_MS = 15 * 60 * 1000

/**
 * A flat pause on every failed attempt.
 *
 * Small enough that a mistyped password feels like nothing, large enough that
 * a script working through a wordlist gets four tries a second per connection
 * instead of thousands — which matters because the per-address counter is the
 * only other brake, and addresses on a local network are cheap to change.
 */
export const FAILURE_DELAY_MS = 250

interface Attempts {
  count: number
  /** When the count started; failures older than the window are forgotten. */
  since: number
}

const attempts = new Map<string, Attempts>()

function prune(now: number): void {
  for (const [address, record] of attempts) {
    if (now - record.since > WINDOW_MS) attempts.delete(address)
  }
}

export interface LoginGate {
  allowed: boolean
  /** Seconds until this address may try again. 0 when it is allowed now. */
  retryAfterSeconds: number
}

/** Whether `address` may attempt a sign-in right now. */
export function checkLoginAllowed(address: string, now = Date.now()): LoginGate {
  prune(now)
  const record = attempts.get(normalizeAddress(address))
  if (!record || record.count < MAX_ATTEMPTS) return { allowed: true, retryAfterSeconds: 0 }

  const waitMs = WINDOW_MS - (now - record.since)
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) }
}

/** Records a wrong password from `address`. */
export function recordLoginFailure(address: string, now = Date.now()): void {
  prune(now)
  const key = normalizeAddress(address)
  const record = attempts.get(key)
  if (!record || now - record.since > WINDOW_MS) {
    attempts.set(key, { count: 1, since: now })
    return
  }
  record.count += 1
}

/** Clears the count for `address` after a successful sign-in. */
export function recordLoginSuccess(address: string): void {
  attempts.delete(normalizeAddress(address))
}

/** Forgets every recorded attempt. Called when the server stops. */
export function resetLoginAttempts(): void {
  attempts.clear()
}
