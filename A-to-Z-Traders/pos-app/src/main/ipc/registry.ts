import { ipcMain } from 'electron'
import { z } from 'zod'
import type { IpcChannel } from '@shared/ipc'
import { IPC_CHANNELS } from '@shared/ipc'
import type { IpcResult, UserRole } from '@shared/types'
import { currentRole, isUnlocked } from '../auth/session'
import { isBusy } from './maintenance'
import { AppError, translateSqliteError } from '../utils/errors'
import { logger } from '../utils/logger'

const log = logger.child('ipc')

/**
 * Every registered channel, keyed by name.
 *
 * This is a map rather than the set of names it used to be because the desktop
 * window is no longer the only caller. The companion app on the phone reaches
 * the same channels over HTTP, and it must reach them through the same guard,
 * the same schema and the same service — so the pipeline lives in
 * `invokeChannel` below and both callers go through it. Two copies of it would
 * drift, and the copy that drifted would be the one that let something through.
 */
interface RegisteredHandler {
  schema: z.ZodTypeAny
  service: (input: never) => unknown
  options: HandlerOptions
}

const handlers = new Map<IpcChannel, RegisteredHandler>()

/**
 * What a shopkeeper may do — the authoritative access policy, enforced in the
 * main process so the lock is real even against a scripted renderer (Guide
 * §1.3). It is a strict allowlist: the admin has full access exactly as before
 * roles existed, and a shopkeeper is granted ONLY the channels named here.
 * Anything absent is denied — fail closed, so a new sensitive channel is
 * owner-only until someone deliberately opens it.
 *
 * `true` allows the channel outright; a predicate further restricts the
 * (already validated) payload — e.g. a shopkeeper records customer receipts,
 * never supplier payouts.
 */
type PayloadRule = true | ((input: unknown) => boolean)

const isCustomerReceipt = (input: unknown): boolean =>
  (input as { input?: { partyType?: string } })?.input?.partyType === 'customer'

const SHOPKEEPER_CHANNELS: Partial<Record<IpcChannel, PayloadRule>> = {
  // Read settings so the billing screen knows the currency and tax rate.
  [IPC_CHANNELS.settingsGet]: true,

  // Find products to put on a bill.
  [IPC_CHANNELS.categoriesList]: true,
  [IPC_CHANNELS.productsList]: true,
  [IPC_CHANNELS.productsGet]: true,
  [IPC_CHANNELS.productsSellableUnits]: true,
  [IPC_CHANNELS.productsUnitsList]: true,

  // Find, view and add customers (editing an existing one stays with the admin).
  [IPC_CHANNELS.customersList]: true,
  [IPC_CHANNELS.customersGet]: true,
  [IPC_CHANNELS.customersLedger]: true,
  [IPC_CHANNELS.customersAdd]: true,

  // Bill, and reprint what was billed.
  [IPC_CHANNELS.salesList]: true,
  [IPC_CHANNELS.salesGet]: true,
  [IPC_CHANNELS.salesCreate]: true,
  [IPC_CHANNELS.salesNextInvoiceNo]: true,
  [IPC_CHANNELS.salesSuggestPrice]: true,
  [IPC_CHANNELS.salesReceipt]: true,
  [IPC_CHANNELS.printReceipt]: true,

  // Record what a delivered bill was actually paid, and read a bill's edit
  // history. Settling is money the shopkeeper already handles - it is the same
  // act as taking a customer receipt, just booked against the bill it came
  // with. EDITING and VOIDING a bill are NOT here: they move stock and rewrite
  // what a past day earned, which is the owner's decision.
  [IPC_CHANNELS.salesSettle]: true,
  [IPC_CHANNELS.salesRevisions]: true,

  // Take goods back from a customer.
  [IPC_CHANNELS.saleReturnsList]: true,
  [IPC_CHANNELS.saleReturnsGet]: true,
  [IPC_CHANNELS.saleReturnsCreate]: true,

  // Receive money against a customer's khata — customer receipts only.
  [IPC_CHANNELS.paymentsCreate]: isCustomerReceipt,
  [IPC_CHANNELS.paymentsList]: true,

  // The day's-trade views: the dashboard, and the sales-list summary tiles.
  // (The owner-only P&L, valuation and product-profit reports are NOT here.)
  [IPC_CHANNELS.dashboardSummary]: true,
  [IPC_CHANNELS.reportsSalesSummary]: true,

  // Innocuous plumbing every screen may need.
  [IPC_CHANNELS.systemLogError]: true
}

/** The refusal a shopkeeper gets for an owner-only channel. */
const FORBIDDEN_RESULT: IpcResult<never> = {
  ok: false,
  error: { code: 'AUTH', message: 'Your account does not have access to that.' }
}

/**
 * Decides whether `role` may run `channel` with this payload.
 *
 * Pure — it reads no session — so a caller that carries its own identity (a
 * request from the phone) is judged by exactly the policy the desktop window
 * is judged by, out of the same table.
 */
export function isRoleAuthorized(
  role: UserRole | null,
  channel: IpcChannel,
  input: unknown
): boolean {
  if (role === 'admin') return true
  const rule = SHOPKEEPER_CHANNELS[channel]
  if (rule === true) return true
  return typeof rule === 'function' && rule(input)
}

/** As `isRoleAuthorized`, for whoever is signed in right now.
 *  Exported for direct testing of the access policy. */
export function isAuthorized(channel: IpcChannel, input: unknown): boolean {
  return isRoleAuthorized(currentRole(), channel, input)
}

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
  error: {
    code: 'INTERNAL',
    message: 'The app is busy restoring data. Please try again in a moment.'
  }
}

/**
 * Returned for a channel name with no handler. Unreachable from the preload,
 * which can only name channels the shared contract declares, but the companion
 * server takes a channel name off the wire and must have an answer for one
 * that does not exist.
 */
const UNKNOWN_RESULT: IpcResult<never> = {
  ok: false,
  error: { code: 'NOT_FOUND', message: 'That action does not exist.' }
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
 * Runs one channel end to end: enforce the lock, validate the input, check the
 * role, call the service, wrap the result. Never throws — every failure comes
 * back as `{ ok: false, error }`.
 *
 * The lock and the role are enforced here, in the main process, rather than by
 * hiding screens in the renderer: a channel invoked from a scripted renderer,
 * or from a phone on the shop Wi-Fi, still gets nothing back until the session
 * is unlocked and the role permits it.
 *
 * The caller's identity is ambient — the desktop window's own session, or the
 * one a phone request installs around this call with `runAs`. Both arrive at
 * `currentRole()`, so neither this function nor any service below it needs to
 * know which kind of caller it is serving.
 */
export async function invokeChannel(
  channel: IpcChannel,
  payload: unknown
): Promise<IpcResult<unknown>> {
  const handler = handlers.get(channel)
  if (!handler) {
    log.warn(`${channel} has no handler`)
    return UNKNOWN_RESULT
  }

  const { schema, service, options } = handler

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

  // Role check runs on the validated payload so a payload rule (e.g. "customer
  // receipts only") sees clean data. Public channels are exempt — they are how
  // a session is established in the first place.
  if (!options.public && !isAuthorized(channel, parsed.data)) {
    log.warn(`${channel} blocked: role ${currentRole()} not permitted`)
    return FORBIDDEN_RESULT
  }

  try {
    const data = await service(parsed.data as never)
    return { ok: true, data }
  } catch (error) {
    return toResult(error, channel)
  }
}

/**
 * Registers a thin IPC handler: a channel, the schema its payload must satisfy
 * and the service behind it. Handlers hold no business logic — the pipeline
 * around them is `invokeChannel`.
 */
export function registerHandler<Schema extends z.ZodTypeAny, Output>(
  channel: IpcChannel,
  schema: Schema,
  service: (input: z.infer<Schema>) => Output | Promise<Output>,
  options: HandlerOptions = {}
): void {
  if (handlers.has(channel)) {
    throw new Error(`IPC channel "${channel}" is registered twice.`)
  }
  handlers.set(channel, { schema, service: service as (input: never) => unknown, options })

  ipcMain.handle(
    channel,
    (_event, payload: unknown): Promise<IpcResult<Output>> =>
      invokeChannel(channel, payload) as Promise<IpcResult<Output>>
  )
}

/** True when `channel` names a registered handler. Narrows an off-the-wire string. */
export function isChannelRegistered(channel: string): channel is IpcChannel {
  return handlers.has(channel as IpcChannel)
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
  const missing = Object.values(IPC_CHANNELS).filter((channel) => !handlers.has(channel))
  if (missing.length > 0) {
    throw new Error(`No IPC handler registered for: ${missing.join(', ')}`)
  }
  log.info(`${handlers.size} IPC channels registered`)
}
