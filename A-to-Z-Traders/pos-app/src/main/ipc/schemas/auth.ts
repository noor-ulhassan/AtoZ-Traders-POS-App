import { z } from 'zod'

/**
 * A deliberately modest password policy: a minimum length is the rule that
 * actually resists guessing, and a shop owner typing this a dozen times a day
 * should not be fought with symbol requirements. 72 is a safe upper bound.
 */
const password = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(72, 'Keep it under 72 characters.')

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
