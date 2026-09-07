import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { ErrorCode, IpcResult } from '@shared/types'
import { runAs } from '../auth/session'
import { isBusy } from '../ipc/maintenance'
import { invokeChannel, isChannelRegistered } from '../ipc/registry'
import { exportSchema } from '../ipc/schemas/money'
import { isAdminConfigured, verifyAdminPassword } from '../services/authService'
import { buildCsvExport } from '../services/exportService'
import { getSettings } from '../services/settingsService'
import { logger } from '../utils/logger'
import { isMobileChannel } from './channels'
import {
  FAILURE_DELAY_MS,
  checkLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess
} from './rateLimit'
import { IDLE_TIMEOUT_MINUTES, issueSession, revokeToken, verifySession } from './sessions'
import { securityHeaders } from './staticFiles'

const log = logger.child('mobile-api')

/**
 * The network face of the app.
 *
 * There are five endpoints and only one of them does any real work: everything
 * the companion app can ask for goes through `POST /api/call`, which is the
 * SAME `invokeChannel` the desktop window's IPC goes through — same schema,
 * same lock, same role policy, same error envelope. This file adds exactly two
 * things on top of it: who is calling (a bearer token), and whether that
 * channel is exposed to the network at all (`MOBILE_CHANNELS`).
 *
 * Deliberately not a REST API. A route per resource would be a second copy of
 * the contract in `@shared/ipc`, and the copy would drift — the same reason
 * `priceBill` is the only place a bill's rules live.
 */

/**
 * The phone signs in as the owner, so every request acts as the owner.
 *
 * `runAs` rather than `unlock()`: the desktop's own session must not move
 * because somebody picked up a phone, and two requests in flight must not see
 * each other's identity. See `auth/session.ts`.
 */
function asOwner<T>(work: () => T): T {
  return runAs('admin', null, work)
}

/** A request body larger than this is refused unread. */
const MAX_BODY_BYTES = 1024 * 1024

const loginSchema = z.object({ password: z.string().min(1).max(200) })

const callSchema = z.object({
  channel: z.string().min(1).max(120),
  payload: z.unknown().optional()
})

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    ...securityHeaders(false),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text)
  })
  response.end(text)
}

/** Every failure the phone can see, in the envelope the desktop already uses. */
function sendError(
  response: ServerResponse,
  status: number,
  code: ErrorCode,
  message: string
): void {
  const body: IpcResult<never> = { ok: false, error: { code, message } }
  sendJson(response, status, body)
}

/** Reads and parses a JSON body, refusing anything oversized or malformed. */
async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of request) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large.')
    chunks.push(buffer)
  }

  if (size === 0) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * The token on the request, if any.
 *
 * A bearer header rather than a cookie, on purpose: a cookie would be attached
 * by the browser to requests another page started, which is the whole shape of
 * a cross-site request forgery. A header is not, so the shop's records cannot
 * be operated by a page the owner happens to have open in another tab.
 */
function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization
  if (!header || !header.startsWith('Bearer ')) return null
  const token = header.slice(7).trim()
  return token.length > 0 ? token : null
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** What the phone is told about the shop the moment it signs in. */
function shopIdentity(): { businessName: string; currency: string; sessionMinutes: number } {
  const settings = getSettings()
  return {
    businessName: settings.businessName?.trim() || 'Wholesale POS',
    currency: settings.currency,
    sessionMinutes: IDLE_TIMEOUT_MINUTES
  }
}

async function handleLogin(
  request: IncomingMessage,
  response: ServerResponse,
  address: string
): Promise<void> {
  const gate = checkLoginAllowed(address)
  if (!gate.allowed) {
    log.warn(`sign-in from ${address} refused: too many attempts`)
    response.setHeader('Retry-After', String(gate.retryAfterSeconds))
    sendError(
      response,
      429,
      'AUTH',
      `Too many attempts from this device. Try again in ${Math.ceil(gate.retryAfterSeconds / 60)} minute(s).`
    )
    return
  }

  if (!isAdminConfigured()) {
    sendError(response, 403, 'AUTH', 'This shop has not finished setting up on the computer yet.')
    return
  }

  const parsed = loginSchema.safeParse(await readJsonBody(request))
  if (!parsed.success) {
    sendError(response, 400, 'VALIDATION', 'Enter the shop password.')
    return
  }

  if (!verifyAdminPassword(parsed.data.password)) {
    recordLoginFailure(address)
    // Slows a wordlist without being noticeable to someone who mistyped.
    await sleep(FAILURE_DELAY_MS)
    log.warn(`wrong password from ${address}`)
    sendError(response, 401, 'AUTH', 'That password is not right.')
    return
  }

  recordLoginSuccess(address)
  const token = issueSession(address, request.headers['user-agent'] ?? '')
  log.info(`phone signed in from ${address}`)
  sendJson(response, 200, { ok: true, data: { token, ...shopIdentity() } })
}

async function handleCall(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const parsed = callSchema.safeParse(await readJsonBody(request))
  if (!parsed.success) {
    sendError(response, 400, 'VALIDATION', 'That request was not understood.')
    return
  }

  const { channel, payload } = parsed.data

  // Fail closed twice over: the name must be a real channel, and that channel
  // must be one this feature deliberately exposes to the network.
  if (!isChannelRegistered(channel) || !isMobileChannel(channel)) {
    log.warn(`refused off-list channel "${channel}"`)
    sendError(response, 404, 'NOT_FOUND', 'That action is not available on the phone.')
    return
  }

  const result = await asOwner(() => invokeChannel(channel, payload))
  // The envelope is the app's, not HTTP's: a refused business rule is a
  // successful exchange that says no, exactly as it is over IPC. Only the
  // transport-level failures above use a status code to say anything.
  sendJson(response, 200, result)
}

async function handleExport(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const parsed = exportSchema.safeParse(await readJsonBody(request))
  if (!parsed.success) {
    sendError(response, 400, 'VALIDATION', 'That report does not exist.')
    return
  }

  // The same builder the desktop's Save-as uses; only the destination differs.
  // Here the browser is the destination, so there is no dialog and no file.
  // `toReportCsv` already prepends the UTF-8 BOM Excel needs; do not add a second.
  const built = asOwner(() => buildCsvExport(parsed.data))
  const body = Buffer.from(built.csv, 'utf8')

  response.writeHead(200, {
    ...securityHeaders(false),
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${built.fileName}"`,
    'Content-Length': body.length
  })
  response.end(body)
}

/**
 * Routes one `/api/...` request.
 *
 * Returns true when it handled the request. The caller (`server.ts`) has
 * already refused anything from outside the local network, so everything here
 * is talking to a device on the shop's own Wi-Fi.
 */
export async function routeApi(
  request: IncomingMessage,
  response: ServerResponse,
  address: string
): Promise<boolean> {
  const path = (request.url ?? '/').split('?')[0] ?? '/'
  if (!path.startsWith('/api/')) return false

  const method = request.method ?? 'GET'

  try {
    // ---- open: proves the app is reachable, and says nothing about the shop.
    if (path === '/api/health' && method === 'GET') {
      sendJson(response, 200, { ok: true, data: { app: 'Wholesale POS' } })
      return true
    }

    // `invokeChannel` turns business channels away while a restore swaps the
    // database file, but sign-in and the CSV builder reach the database
    // directly and would meet a closed connection instead. Same answer, said
    // in the same words, before either of them gets there.
    if (isBusy()) {
      sendError(
        response,
        503,
        'INTERNAL',
        'The shop computer is busy restoring data. Try again in a moment.'
      )
      return true
    }

    if (path === '/api/login' && method === 'POST') {
      await handleLogin(request, response, address)
      return true
    }

    // ---- everything below needs a session.
    const token = bearerToken(request)
    if (!token || !verifySession(token, address)) {
      sendError(response, 401, 'AUTH', 'Sign in on the phone to continue.')
      return true
    }

    if (path === '/api/session' && method === 'GET') {
      sendJson(response, 200, { ok: true, data: shopIdentity() })
      return true
    }

    if (path === '/api/logout' && method === 'POST') {
      revokeToken(token)
      sendJson(response, 200, { ok: true, data: { signedOut: true } })
      return true
    }

    if (path === '/api/call' && method === 'POST') {
      await handleCall(request, response)
      return true
    }

    if (path === '/api/export' && method === 'POST') {
      await handleExport(request, response)
      return true
    }

    sendError(response, 404, 'NOT_FOUND', 'That address does not exist.')
    return true
  } catch (error) {
    // A malformed body or a broken socket. Nothing about the shop goes out
    // with it — the detail is for the log on the machine, not for the wire.
    log.error(`${method} ${path} failed`, error)
    if (!response.headersSent) {
      sendError(response, 400, 'INTERNAL', 'That request could not be completed.')
    } else {
      response.end()
    }
    return true
  }
}
