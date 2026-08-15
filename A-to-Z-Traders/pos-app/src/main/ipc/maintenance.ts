/**
 * A brief "the database is being swapped" flag.
 *
 * Restore closes the connection, renames the live file aside and reopens it.
 * That is the one moment when `getDb()` would throw for a business channel that
 * fires from the renderer in parallel (backup/restore are async IPC, so the
 * event loop is free during their dialogs). While this flag is set the IPC
 * guard turns those channels away with a calm "try again" instead of an
 * internal error — and, more importantly, no write can land on a database
 * that is about to be replaced.
 */

let busy = false

export function isBusy(): boolean {
  return busy
}

/** Runs `work` with maintenance mode on, clearing it even if `work` throws. */
export async function underMaintenance<T>(work: () => Promise<T>): Promise<T> {
  busy = true
  try {
    return await work()
  } finally {
    busy = false
  }
}
