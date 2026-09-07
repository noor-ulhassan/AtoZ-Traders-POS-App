import { z } from 'zod'

/**
 * Signing a phone out. An absent id means "every one of them", which is the
 * button the owner reaches for when a phone is lost rather than merely stale.
 */
export const mobileSignOutSchema = z
  .object({ id: z.string().trim().min(1).max(100).optional() })
  .optional()
  .transform((value) => value ?? {})
