import { ipcMain } from 'electron'
import { z } from 'zod'
import type { IpcChannel } from '@shared/ipc'
import { IPC_CHANNELS } from '@shared/ipc'
import type { IpcResult } from '@shared/types'
import { isUnlocked } from '../auth/session'
import { isBusy } from './maintenance'
import { AppError, translateSqliteError } from '../utils/errors'
import { logger } from '../utils/logger'

const log = logger.child('ipc')

const registered = new Set<string>()

function validationError(error: z.ZodError): AppError {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const path = issue.path.join('.') || 'value'
    // Keep the first message per field; later ones are usually noise.
    if (!(path in fields)) fields[path] = issue.message
  }
  const first = error.issues[0]
  return new AppError(
    'VALIDATION',
    first?.message ?? 'The information provided is not valid.',
    fields
  )
}

function toResult(error: unknown, channel: string): IpcResult<never> {
  if (error instanceof AppError) {
    log.warn(`${channel} rejected`, error.message)
    return { ok: false, error: error.toIpcError() }
  }

  const translated = translateSqliteError(error)
  if (translated) {
    log.warn(`${channel} rejected`, translated.message)
    return { ok: false, error: translated.toIpcError() }
  }

  // Anything reaching here is a bug. Log the detail, show the user a generic
  // message — SQL fragments and file paths must not reach the screen.
  log.error(`${channel} failed`, error)
  return {
    ok: false,
    error: {
      code: 'INTERNAL',
      message: 'Something went wrong. The action was not saved. Please try again.'
    }
  }
}

/** The auth error the guard returns for a locked session (see errors.ts AUTH). */
const LOCKED_RESULT: IpcResult<never> = {
  ok: false,
  error: { code: 'AUTH', message: 'Please unlock the app to continue.' }
}

/** Returned while the database is being swapped by a restore. */
const BUSY_RESULT: IpcResult<never> = {
  ok: false,
  error: { code: 'INTERNAL', message: 'The app is busy restoring data. Please try again in a moment.' }
}

export interface HandlerOptions {
  /**
   * When true the channel runs even while the app is locked. Reserved for the
   * auth channels themselves — logging in is impossible if login is gated on
   * being logged in. Every other channel is guarded (Guide §1.3).
   */
  public?: boolean
}

/**
 * Registers a thin IPC handler: enforce the lock, validate input, call the
 * service, wrap the result. Handlers hold no business logic.
 *
 * The lock is enforced here, in the main process, rather than by hiding
 * screens in the renderer — a channel invoked from a compromised or scripted
 * renderer still gets nothing back until the session is unlocked.
 */
export function registerHandler<Schema extends z.ZodTypeAny, Output>(
  channel: IpcChannel,
  schema: Schema,
  service: (input: z.infer<Schema>) => Output | Promise<Output>,
  options: HandlerOptions = {}
): void {
  if (registered.has(channel)) {
    throw new Error(`IPC channel "${channel}" is registered twice.`)
  }
  registered.add(channel)

  ipcMain.handle(channel, async (_event, payload: unknown): Promise<IpcResult<Output>> => {
    if (!options.public && !isUnlocked()) {
      log.warn(`${channel} blocked: app is locked`)
      return LOCKED_RESULT
    }

    // Hold business channels off the database while a restore swaps the file.
    if (!options.public && isBusy()) {
      log.warn(`${channel} blocked: maintenance in progress`)
      return BUSY_RESULT
    }

    const parsed = schema.safeParse(payload)
    if (!parsed.success) {
      const error = validationError(parsed.error)
      log.warn(`${channel} invalid input`, error.fields)
      return { ok: false, error: error.toIpcError() }
    }

    try {
      const data = await service(parsed.data)
      return { ok: true, data }
    } catch (error) {
      return toResult(error, channel)
    }
  })
}

/** No-payload channels. Tolerates the `undefined` the preload sends. */
export const noInput = z
  .undefined()
  .or(z.null())
  .transform(() => undefined)

/**
 * Fails the build-time contract at startup rather than at 2pm on a Saturday:
 * every channel in the shared contract must have a handler.
 */
export function assertAllChannelsRegistered(): void {
  const missing = Object.values(IPC_CHANNELS).filter((channel) => !registered.has(channel))
  if (missing.length > 0) {
    throw new Error(`No IPC handler registered for: ${missing.join(', ')}`)
  }
  log.info(`${registered.size} IPC channels registered`)
}
