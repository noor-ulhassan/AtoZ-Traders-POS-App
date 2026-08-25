import type { Id, IsoTimestamp } from './common'

/**
 * Who is signed in, and therefore what they may do.
 *
 * - `admin`  — the shop owner. Full access, exactly as the app worked before
 *   roles existed. Authenticated by the single `admin_credential`.
 * - `shopkeeper` — counter staff. A fail-closed subset: billing, sales,
 *   customer receipts, sale returns and the dashboard. Authenticated by a row
 *   in `staff_users` (username + PIN).
 */
export type UserRole = 'admin' | 'shopkeeper'

/**
 * The renderer's view of the gate. Never carries a hash or a salt — only
 * enough for the UI to decide between the setup screen, the lock screen and the
 * app, which role is signed in, plus the security question for recovery.
 */
export interface AuthStatus {
  /** Has an admin password been set on this device yet? false on first run. */
  configured: boolean
  /** Is the current app run unlocked? */
  unlocked: boolean
  /** The role of the signed-in session, when unlocked. */
  role?: UserRole
  /** The staff username, when a shopkeeper is signed in. */
  username?: string
  /** Is a failed-attempt lockout on the admin password currently in effect? */
  locked: boolean
  /** When the lockout lifts, if `locked`. */
  lockedUntil?: IsoTimestamp
  /** The recovery prompt, once configured. */
  securityQuestion?: string
}

/** A staff account as the admin manages it. Never carries the PIN hash. */
export interface StaffUser {
  id: Id
  username: string
  role: UserRole
  isActive: boolean
  createdAt: IsoTimestamp
  lastLoginAt: IsoTimestamp | null
}

export interface StaffLoginInput {
  username: string
  pin: string
}

export interface StaffCreateInput {
  username: string
  pin: string
}

export interface StaffResetPinInput {
  id: Id
  pin: string
}

export interface StaffSetActiveInput {
  id: Id
  isActive: boolean
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
