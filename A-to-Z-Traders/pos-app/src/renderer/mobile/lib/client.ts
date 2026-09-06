import type { ErrorCode, IpcResult } from '@shared/types'

/**
 * The phone's line to the shop computer.
 *
 * Every read and every write is one `POST /api/call` naming a channel from the
 * shared contract — the same channel the desktop window invokes over IPC, run
 * by the same service behind the same guard. So this file is small on purpose:
 * there is no second API to keep in step with the first, and a rule enforced
 * at the till is enforced here by construction rather than by remembering to.
 */

const TOKEN_KEY = 'pos.mobile.token'

export interface ShopIdentity {
  businessName: string
  currency: string
  /** Minutes a phone may idle before the shop computer signs it out. */
  sessionMinutes: number
}

export class MobileApiError extends Error {
  readonly code: ErrorCode | 'OFFLINE'
  readonly fields: Record<string, string>

  constructor(code: ErrorCode | 'OFFLINE', message: string, fields: Record<string, string> = {}) {
    super(message)
    this.name = 'MobileApiError'
    this.code = code
    this.fields = fields
  }

  /** True when the shop computer could not be reached at all. */
  get isOffline(): boolean {
    return this.code === 'OFFLINE'
  }

  /** True when the session has gone and the phone must sign in again. */
  get isSignedOut(): boolean {
    return this.code === 'AUTH'
  }
}

const OFFLINE = (): MobileApiError =>
  new MobileApiError(
    'OFFLINE',
    'The shop computer cannot be reached. Check you are on the shop Wi-Fi and that the app is open on the computer.'
  )

// ------------------------------------------------------------------ token

/**
 * The session token, kept in `localStorage` so the app survives a reload and
 * the home-screen icon does not ask for the password every single time.
 *
 * It is not a permanent key: the shop computer holds these in memory only, so
 * closing the app there signs every phone out, and an untouched phone is
 * signed out on its own after a trading day. Losing the phone therefore costs
 * at most one day, and the owner can end it sooner from the Settings screen.
 */
let token: string | null = readToken()

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    // Private browsing, or storage turned off. The app still works; it just
    // asks for the password again after a reload.
    return null
  }
}

export function currentToken(): string | null {
  return token
}

function setToken(next: string | null): void {
  token = next
  try {
    if (next) localStorage.setItem(TOKEN_KEY, next)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* see readToken */
  }
}

/** Called when the shop computer says the session is gone. */
let onSignedOut: (() => void) | null = null

export function setSignedOutHandler(handler: () => void): void {
  onSignedOut = handler
}

function forgetSession(): void {
  setToken(null)
  onSignedOut?.()
}

// ------------------------------------------------------------------ fetch

async function post(path: string, body: unknown, withAuth = true): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (withAuth && token) headers.Authorization = `Bearer ${token}`

  try {
    return await fetch(path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? {}),
      // Same origin by construction; saying so keeps a stray cookie out of it.
      credentials: 'omit',
      cache: 'no-store'
    })
  } catch {
    throw OFFLINE()
  }
}

function toError(result: IpcResult<unknown>): MobileApiError {
  if (result.ok) throw new Error('toError called on a successful result')
  return new MobileApiError(result.error.code, result.error.message, result.error.fields ?? {})
}

/**
 * Signs in with the shop's own password — the one that unlocks the app on the
 * computer. There is no separate phone account to create or forget.
 */
export async function signIn(password: string): Promise<ShopIdentity> {
  const response = await post('/api/login', { password }, false)
  const result = (await response.json()) as IpcResult<ShopIdentity & { token: string }>

  if (!result.ok) throw toError(result)

  const { token: issued, ...identity } = result.data
  setToken(issued)
  return identity
}

/** Confirms the stored token is still good, and returns what the shop is called. */
export async function resumeSession(): Promise<ShopIdentity | null> {
  if (!token) return null

  let response: Response
  try {
    response = await fetch('/api/session', {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'omit',
      cache: 'no-store'
    })
  } catch {
    throw OFFLINE()
  }

  const result = (await response.json()) as IpcResult<ShopIdentity>
  if (!result.ok) {
    if (result.error.code === 'AUTH') setToken(null)
    return null
  }
  return result.data
}

export async function signOut(): Promise<void> {
  try {
    await post('/api/logout', {})
  } catch {
    // Being unable to tell the computer does not change what the phone does
    // next: the token is dropped either way, and it expires there on its own.
  }
  setToken(null)
}

/**
 * Invokes one channel and returns its data, throwing a typed error otherwise.
 *
 * The envelope on the wire is the app's own `IpcResult`, so a refused business
 * rule arrives here exactly as it arrives in the desktop renderer — same code,
 * same message, same field errors on a form.
 */
export async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const response = await post('/api/call', { channel, payload })

  if (response.status === 401) {
    forgetSession()
    throw new MobileApiError('AUTH', 'Signed out. Enter the shop password again.')
  }

  const result = (await response.json()) as IpcResult<T>
  if (!result.ok) throw toError(result)
  return result.data
}

/**
 * Downloads a report as a CSV file.
 *
 * The desktop's own export opens a Save dialog on the shop computer, which is
 * exactly the wrong thing to do for a request from a phone — so the network
 * path builds the identical report and hands it to the browser instead.
 */
export async function downloadCsv(
  report: string,
  filters?: Record<string, unknown>
): Promise<void> {
  const response = await post('/api/export', { report, filters })

  if (response.status === 401) {
    forgetSession()
    throw new MobileApiError('AUTH', 'Signed out. Enter the shop password again.')
  }

  if (!response.ok) {
    const result = (await response.json()) as IpcResult<never>
    throw toError(result)
  }

  const disposition = response.headers.get('Content-Disposition') ?? ''
  const named = /filename="([^"]+)"/.exec(disposition)
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = named?.[1] ?? 'report.csv'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Give the browser a moment to start the download before the blob is freed.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
