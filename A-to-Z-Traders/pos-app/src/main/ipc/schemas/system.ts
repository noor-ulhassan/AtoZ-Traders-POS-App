import { z } from 'zod'

/** Restore names a file the main process itself listed; it re-checks that. */
export const backupPathSchema = z.object({
  path: z.string().trim().min(1).max(1000)
})

/** A renderer-side crash report, bounded so a runaway stack cannot flood the log. */
export const logErrorSchema = z.object({
  message: z.string().max(2000),
  stack: z.string().max(20000).optional(),
  context: z.string().max(200).optional()
})
