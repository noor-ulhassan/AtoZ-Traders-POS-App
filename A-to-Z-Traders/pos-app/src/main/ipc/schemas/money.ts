import { z } from 'zod'
import {
  idSchema,
  isoDateSchema,
  moneySchema,
  nonEmptyText,
  optionalIdSchema,
  optionalText,
  paginationSchema
} from './common'

export const paymentCreateSchema = z.object({
  input: z.object({
    partyType: z.enum(['customer', 'supplier']),
    partyId: idSchema,
    amount: moneySchema.refine((value) => value > 0, 'Enter an amount greater than zero.'),
    method: z.enum(['cash', 'bank', 'cheque', 'online', 'other']).optional(),
    date: isoDateSchema.optional(),
    notes: optionalText(300)
  })
})

export const paymentFiltersSchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    partyType: z.enum(['customer', 'supplier', 'all']).optional(),
    partyId: optionalIdSchema.optional(),
    ...paginationSchema
  })
  .optional()
  .transform((value) => value ?? {})

export const paymentDeleteSchema = z.object({ id: idSchema })

export const expenseCategoryAddSchema = z.object({ name: nonEmptyText('Category name', 60) })

export const expenseInputSchema = z.object({
  categoryId: optionalIdSchema.optional(),
  title: nonEmptyText('Title', 160),
  amount: moneySchema.refine((value) => value > 0, 'Enter an amount greater than zero.'),
  date: isoDateSchema.optional(),
  notes: optionalText(500)
})

export const expenseAddSchema = z.object({ input: expenseInputSchema })

export const expenseUpdateSchema = z.object({ id: idSchema, input: expenseInputSchema })

export const expenseDeleteSchema = z.object({ id: idSchema })

export const expenseFiltersSchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    categoryId: optionalIdSchema.optional(),
    search: z.string().trim().max(120).optional(),
    ...paginationSchema
  })
  .optional()
  .transform((value) => value ?? {})

export const exportSchema = z.object({
  report: z.enum([
    'sales',
    'sale-items',
    'purchases',
    'inventory',
    'stock-valuation',
    'stock-movements',
    'profit-loss',
    'customer-ledger',
    'supplier-ledger',
    'customers',
    'suppliers',
    'expenses',
    'payments'
  ]),
  filters: z.record(z.string(), z.unknown()).optional()
})
