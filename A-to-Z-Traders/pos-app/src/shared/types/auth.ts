import type { IsoTimestamp } from './common'

/**
 * The renderer's view of the admin gate. Never carries a hash or a salt — only
 * enough for the UI to decide between the setup screen, the lock screen and the
 * app, plus the security question for the recovery flow.
 */
export interface AuthStatus {
  /** Has an admin password been set on this device yet? false on first run. */
  configured: boolean
  /** Is the current app run unlocked? */
  unlocked: boolean
  /** Is a failed-attempt lockout currently in effect? */
  locked: boolean
  /** When the lockout lifts, if `locked`. */
  lockedUntil?: IsoTimestamp
  /** The recovery prompt, once configured. */
  securityQuestion?: string
}

export interface SecurityQuestion {
  question: string | null
}

export interface AuthSetupInput {
  password: string
  securityQuestion: string
  securityAnswer: string
}

export interface AuthLoginInput {
  password: string
}

export interface AuthChangePasswordInput {
  currentPassword: string
  newPassword: string
}

export interface AuthResetInput {
  securityAnswer: string
  newPassword: string
}
