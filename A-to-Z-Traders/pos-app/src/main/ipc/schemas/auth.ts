import { z } from 'zod'
import { idSchema } from './common'

/**
 * A deliberately modest password policy: a minimum length is the rule that
 * actually resists guessing, and a shop owner typing this a dozen times a day
 * should not be fought with symbol requirements. 72 is a safe upper bound.
 */
const password = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(72, 'Keep it under 72 characters.')

/** A staff username: 3–40 characters, letters/digits and simple separators. */
const username = z
  .string()
  .trim()
  .min(3, 'The username needs at least 3 characters.')
  .max(40, 'Keep the username under 40 characters.')
  .regex(/^[A-Za-z0-9._-]+$/, 'Use only letters, numbers, dots, dashes or underscores.')

/** A staff PIN: exactly four digits. */
const pin = z.string().regex(/^\d{4}$/, 'The PIN must be exactly four digits.')

const securityQuestion = z.string().trim().min(1, 'Choose a security question.').max(200)

const securityAnswer = z.string().trim().min(1, 'Enter an answer.').max(200)

export const authSetupSchema = z.object({
  password,
  securityQuestion,
  securityAnswer
})

export const authLoginSchema = z.object({
  // Not length-checked: a wrong length is just a wrong password, and the
  // service reports both the same way so nothing about the stored value leaks.
  password: z.string().min(1, 'Enter your password.').max(72)
})

export const authChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.').max(72),
  newPassword: password
})

export const authResetSchema = z.object({
  securityAnswer,
  newPassword: password
})

// ------------------------------------------------------------- staff / roles

export const staffLoginSchema = z.object({
  username,
  // Not regex-checked on login: a malformed PIN is just a wrong PIN, and the
  // service reports both the same way so nothing about the stored value leaks.
  pin: z.string().min(1, 'Enter your PIN.').max(72)
})

export const staffCreateSchema = z.object({ username, pin })

export const staffResetPinSchema = z.object({ id: idSchema, pin })

export const staffSetActiveSchema = z.object({ id: idSchema, isActive: z.boolean() })
