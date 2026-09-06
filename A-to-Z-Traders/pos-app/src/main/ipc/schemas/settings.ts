import { z } from 'zod'

export const settingsUpdateSchema = z
  .object({
    businessName: z.string().trim().max(120),
    address: z.string().trim().max(300),
    phone: z.string().trim().max(60),
    email: z.string().trim().max(160),
    website: z.string().trim().max(200),
    taxNumber: z.string().trim().max(60),
    taxEnabled: z.boolean(),
    taxRate: z
      .number()
      .min(0, 'Tax rate cannot be negative.')
      .max(100, 'Tax rate cannot exceed 100%.'),
    receiptFooter: z.string().trim().max(300),
    logoPath: z.string().trim().max(500),
    currency: z.string().trim().min(1).max(8),
    autoBackupDir: z.string().trim().max(500),
    backupIntervalMinutes: z
      .number()
      .int()
      .min(0, 'Choose how often to back up.')
      .max(1440, 'Back up at least once a day.'),
    mobileEnabled: z.boolean(),
    // Below 1024 needs administrator rights on most systems and collides with
    // the well-known services; above 65535 is not a port at all.
    mobilePort: z
      .number()
      .int()
      .min(1024, 'Choose a port between 1024 and 65535.')
      .max(65535, 'Choose a port between 1024 and 65535.')
  })
  .partial()
