import { z } from 'zod'
import {
  dateRangeSchema,
  idSchema,
  nonEmptyText,
  optionalText,
  paginationSchema,
  signedMoneySchema
} from './common'

export const partyInputSchema = z.object({
  name: nonEmptyText('Name', 120),
  phone: optionalText(40),
  address: optionalText(300),
  openingBalance: signedMoneySchema.optional()
})

export const partyAddSchema = z.object({ input: partyInputSchema })

export const partyUpdateSchema = z.object({ id: idSchema, input: partyInputSchema })

export const partyGetSchema = z.object({ id: idSchema })

export const partyFiltersSchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    withBalanceOnly: z.boolean().optional(),
    ...paginationSchema
  })
  .optional()
  .transform((value) => value ?? {})

export const ledgerSchema = z.object({ id: idSchema, range: dateRangeSchema })
