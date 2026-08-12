import { z } from 'zod'
import { isValidIsoDate } from '@shared/date'

/**
 * Shared validation primitives.
 *
 * These are the authority on what may enter the database. The renderer does
 * its own inline validation for a good typing experience, but it is never
 * trusted — every IPC payload is re-validated here.
 */

export const idSchema = z.number().int().positive()

export const optionalIdSchema = idSchema.nullish().transform((value) => value ?? null)

export const isoDateSchema = z.string().refine(isValidIsoDate, { message: 'Enter a valid date.' })

export const dateRangeSchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((range) => range.from <= range.to, {
    message: 'The start date must be on or before the end date.',
    path: ['from']
  })

/** A monetary input: non-negative and within a sane ceiling for a shop. */
export const moneySchema = z
  .number()
  .finite()
  .min(0, 'Amount cannot be negative.')
  .max(1_000_000_000, 'Amount is unrealistically large.')

/** Money that may be negative (adjustments, signed balances). */
export const signedMoneySchema = z.number().finite().min(-1_000_000_000).max(1_000_000_000)

export const quantitySchema = z
  .number()
  .finite()
  .positive('Quantity must be more than zero.')
  .max(10_000_000, 'Quantity is unrealistically large.')

export const signedQuantitySchema = z
  .number()
  .finite()
  .max(10_000_000)
  .min(-10_000_000)
  .refine((value) => value !== 0, 'Quantity change cannot be zero.')

export const nonEmptyText = (label: string, max = 200): z.ZodString =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`)

export const optionalText = (
  max = 200
): z.ZodEffects<z.ZodNullable<z.ZodOptional<z.ZodString>>, string | null> =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((value) => (value === undefined || value === '' ? null : value))

export const paginationSchema = {
  limit: z.number().int().min(1).max(1000).optional(),
  offset: z.number().int().min(0).optional()
}
