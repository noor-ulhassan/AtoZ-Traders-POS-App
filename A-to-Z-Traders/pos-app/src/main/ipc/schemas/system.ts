import { z } from 'zod'

/** A renderer-side crash report, bounded so a runaway stack cannot flood the log. */
export const logErrorSchema = z.object({
  message: z.string().max(2000),
  stack: z.string().max(20000).optional(),
  context: z.string().max(200).optional()
})
