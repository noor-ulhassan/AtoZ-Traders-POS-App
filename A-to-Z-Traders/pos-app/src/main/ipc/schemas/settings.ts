import { z } from 'zod'

export const settingsUpdateSchema = z
  .object({
    businessName: z.string().trim().max(120),
    address: z.string().trim().max(300),
    phone: z.string().trim().max(60),
    taxNumber: z.string().trim().max(60),
    taxEnabled: z.boolean(),
    taxRate: z
      .number()
      .min(0, 'Tax rate cannot be negative.')
      .max(100, 'Tax rate cannot exceed 100%.'),
    receiptFooter: z.string().trim().max(300),
    logoPath: z.string().trim().max(500),
    currency: z.string().trim().min(1).max(8),
    autoBackupDir: z.string().trim().max(500)
  })
  .partial()
