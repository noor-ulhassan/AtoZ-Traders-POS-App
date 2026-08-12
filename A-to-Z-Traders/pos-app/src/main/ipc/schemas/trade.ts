import { z } from 'zod'
import {
  idSchema,
  isoDateSchema,
  moneySchema,
  nonEmptyText,
  optionalIdSchema,
  optionalText,
  paginationSchema,
  quantitySchema
} from './common'

// ------------------------------------------------------------- purchases

const purchaseItemSchema = z.object({
  productId: idSchema,
  unitName: nonEmptyText('Unit', 40),
  qty: quantitySchema,
  unitCost: moneySchema
})

export const purchaseCreateSchema = z.object({
  input: z.object({
    supplierId: optionalIdSchema.optional(),
    invoiceNo: optionalText(60),
    date: isoDateSchema.optional(),
    items: z.array(purchaseItemSchema).min(1, 'Add at least one item to the purchase.').max(500),
    discount: moneySchema.optional(),
    paidAmount: moneySchema,
    notes: optionalText(500)
  })
})

export const purchaseFiltersSchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    supplierId: optionalIdSchema.optional(),
    search: z.string().trim().max(120).optional(),
    ...paginationSchema
  })
  .optional()
  .transform((value) => value ?? {})

// ----------------------------------------------------------------- sales

const saleItemSchema = z.object({
  productId: idSchema,
  unitName: nonEmptyText('Unit', 40),
  qty: quantitySchema,
  rate: moneySchema,
  lineDiscount: moneySchema.optional()
})

export const saleCreateSchema = z.object({
  input: z.object({
    customerId: optionalIdSchema.optional(),
    date: isoDateSchema.optional(),
    items: z.array(saleItemSchema).min(1, 'Add at least one item to the bill.').max(500),
    discount: moneySchema.optional(),
    paymentType: z.enum(['cash', 'credit', 'partial']),
    paidAmount: moneySchema,
    notes: optionalText(500)
  })
})

export const saleFiltersSchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    customerId: optionalIdSchema.optional(),
    paymentType: z.enum(['cash', 'credit', 'partial', 'all']).optional(),
    search: z.string().trim().max(120).optional(),
    ...paginationSchema
  })
  .optional()
  .transform((value) => value ?? {})

export const suggestPriceSchema = z.object({
  customerId: optionalIdSchema,
  productId: idSchema,
  unitName: nonEmptyText('Unit', 40)
})

export const saleIdSchema = z.object({ id: idSchema })

// --------------------------------------------------------------- returns

export const saleReturnCreateSchema = z.object({
  input: z.object({
    saleId: optionalIdSchema.optional(),
    customerId: optionalIdSchema.optional(),
    date: isoDateSchema.optional(),
    items: z
      .array(
        z.object({
          productId: idSchema,
          unitName: nonEmptyText('Unit', 40),
          qty: quantitySchema,
          rate: moneySchema
        })
      )
      .min(1, 'Add at least one item to the return.')
      .max(500),
    refundType: z.enum(['cash', 'credit']),
    notes: optionalText(500)
  })
})

export const purchaseReturnCreateSchema = z.object({
  input: z.object({
    purchaseId: optionalIdSchema.optional(),
    supplierId: optionalIdSchema.optional(),
    date: isoDateSchema.optional(),
    items: z
      .array(
        z.object({
          productId: idSchema,
          unitName: nonEmptyText('Unit', 40),
          qty: quantitySchema,
          unitCost: moneySchema.optional()
        })
      )
      .min(1, 'Add at least one item to the return.')
      .max(500),
    notes: optionalText(500)
  })
})

export const returnFiltersSchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    partyId: optionalIdSchema.optional(),
    ...paginationSchema
  })
  .optional()
  .transform((value) => value ?? {})
