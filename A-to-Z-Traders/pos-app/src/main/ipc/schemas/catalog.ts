import { z } from 'zod'
import {
  idSchema,
  isoDateSchema,
  moneySchema,
  nonEmptyText,
  optionalIdSchema,
  optionalText,
  paginationSchema,
  quantitySchema,
  signedQuantitySchema
} from './common'

export const categoryNameSchema = nonEmptyText('Category name', 60)

export const categoryAddSchema = z.object({ name: categoryNameSchema })

export const categoryUpdateSchema = z.object({ id: idSchema, name: categoryNameSchema })

export const categoryDeleteSchema = z.object({ id: idSchema })

const productUnitSchema = z.object({
  unitName: nonEmptyText('Unit name', 40),
  factor: z
    .number()
    .positive('A unit must contain more than zero base units.')
    .max(100_000, 'That conversion factor is unrealistically large.'),
  salePrice: moneySchema.nullish().transform((value) => value ?? null)
})

export const productInputSchema = z.object({
  name: nonEmptyText('Product name', 160),
  sku: optionalText(60),
  barcode: optionalText(60),
  categoryId: optionalIdSchema,
  baseUnit: nonEmptyText('Base unit', 40),
  costPrice: moneySchema,
  salePrice: moneySchema,
  reorderLevel: z.number().min(0, 'Reorder level cannot be negative.').max(10_000_000),
  isActive: z.boolean().optional(),
  openingStock: z.number().min(0, 'Opening stock cannot be negative.').max(10_000_000).optional(),
  units: z
    .array(productUnitSchema)
    .max(20, 'A product can have at most 20 alternate units.')
    .optional()
})

export const productAddSchema = z.object({ input: productInputSchema })

export const productUpdateSchema = z.object({ id: idSchema, input: productInputSchema })

export const productSetActiveSchema = z.object({ id: idSchema, isActive: z.boolean() })

export const productGetSchema = z.object({ id: idSchema })

export const productIdSchema = z.object({ productId: idSchema })

export const productUnitsSetSchema = z.object({
  productId: idSchema,
  units: z.array(productUnitSchema).max(20)
})

export const productFiltersSchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    categoryId: optionalIdSchema.optional(),
    status: z.enum(['active', 'inactive', 'all']).optional(),
    lowStockOnly: z.boolean().optional(),
    ...paginationSchema
  })
  .optional()
  .transform((value) => value ?? {})

export const stockAdjustSchema = z.object({
  productId: idSchema,
  changeQty: signedQuantitySchema,
  date: isoDateSchema.optional(),
  notes: optionalText(300)
})

export const stockMovementFiltersSchema = z
  .object({
    productId: idSchema.optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    reason: z
      .enum(['opening', 'purchase', 'sale', 'sale_return', 'purchase_return', 'adjustment', 'all'])
      .optional(),
    ...paginationSchema
  })
  .optional()
  .transform((value) => value ?? {})

/** Exported for the purchase/sale line schemas, which share the shape. */
export const lineQuantitySchema = quantitySchema
