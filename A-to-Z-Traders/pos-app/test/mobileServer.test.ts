import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from './helpers/database'
import { IPC_CHANNELS } from '../src/shared/ipc'
import type { IpcChannel } from '../src/shared/ipc'
import type { IpcResult } from '../src/shared/types'
import { registerIpcHandlers } from '../src/main/ipc'
import { isRoleAuthorized } from '../src/main/ipc/registry'
import { currentRole, lock, runAs, unlock } from '../src/main/auth/session'
import * as authService from '../src/main/services/authService'
import * as userService from '../src/main/services/userService'
import * as productService from '../src/main/services/productService'
import * as purchaseService from '../src/main/services/purchaseService'
import * as salesService from '../src/main/services/salesService'
import * as expenseService from '../src/main/services/expenseService'
import * as dashboardService from '../src/main/services/dashboardService'
import { updateSettings } from '../src/main/services/settingsService'
import { getDb } from '../src/main/db/connection'
import { today } from '../src/shared/date'

import { MOBILE_CHANNELS, isMobileChannel } from '../src/main/mobile/channels'
import { isPrivateAddress, normalizeAddress } from '../src/main/mobile/network'
import {
  describeDevice,
  issueSession,
  listDevices,
  revokeAllDevices,
  revokeDevice,
  revokeToken,
  verifySession
} from '../src/main/mobile/sessions'
import {
  checkLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
  resetLoginAttempts
} from '../src/main/mobile/rateLimit'
import { resolveStaticFile, securityHeaders } from '../src/main/mobile/staticFiles'
import { mobileStatus, stopMobileServer, syncMobileServer } from '../src/main/mobile/server'

/**
 * The phone on the shop's Wi-Fi.
 *
 * Three things are worth testing here and the rest is plumbing:
 *
 *  1. **The door is closed by default.** `MOBILE_CHANNELS` is an allowlist, and
 *     the property test below asserts that a channel added to the app tomorrow
 *     is unreachable from the network until somebody puts it there on purpose
 *     — exactly the shape of the fail-closed test in `roles.test.ts`.
 *
 *  2. **A phone carries its own identity.** Two services redact their payloads
 *     by the signed-in role and one stamps a name onto a bill's history. A
 *     request from a phone must be judged as the owner even while a shopkeeper
 *     is signed in at the till, and must not move that session either way.
 *
 *  3. **Guessing at the password over the network cannot lock the till.** The
 *     network path is throttled per device and deliberately leaves the admin
 *     credential's own lockout counters alone.
 */

const ADMIN = {
  password: 'correct-horse-battery',
  securityQuestion: 'What was your first pet?',
  securityAnswer: 'Rex'
}

/** A port unlikely to be taken on a developer's machine or a CI box. */
const PORT = 8791
const BASE = `http://127.0.0.1:${PORT}`

beforeAll(() => {
  // Handlers register into a module-level map and refuse to be registered
  // twice, so this happens once for the whole file.
  createTestDb()
  registerIpcHandlers()
})

beforeEach(() => {
  createTestDb()
  lock()
  resetLoginAttempts()
  revokeAllDevices()
  authService.setup(ADMIN) // leaves the desktop session unlocked as admin
})

/* ------------------------------------------------------------- allowlist */

describe('what the network can reach (fail-closed)', () => {
  it('only names channels that actually exist', () => {
    const real = new Set<string>(Object.values(IPC_CHANNELS))
    const unknown = [...MOBILE_CHANNELS].filter((channel) => !real.has(channel))
    expect(unknown).toEqual([])
  })

  it('never exposes a channel that opens a window on the shop computer', () => {
    // Each of these raises a native dialog. Over the network that is a request
    // that never returns and a modal nobody is standing in front of.
    expect(isMobileChannel(IPC_CHANNELS.exportCsv)).toBe(false)
    expect(isMobileChannel(IPC_CHANNELS.backupNow)).toBe(false)
    expect(isMobileChannel(IPC_CHANNELS.backupRestore)).toBe(false)
    expect(isMobileChannel(IPC_CHANNELS.productsImportPreview)).toBe(false)
  })

  it('never exposes anything that replaces the database or the keys to it', () => {
    expect(isMobileChannel(IPC_CHANNELS.backupRestoreFrom)).toBe(false)
    expect(isMobileChannel(IPC_CHANNELS.demoSeed)).toBe(false)
    expect(isMobileChannel(IPC_CHANNELS.demoClear)).toBe(false)
    expect(isMobileChannel(IPC_CHANNELS.settingsUpdate)).toBe(false)
    expect(isMobileChannel(IPC_CHANNELS.usersCreate)).toBe(false)
    expect(isMobileChannel(IPC_CHANNELS.usersResetPin)).toBe(false)
    expect(isMobileChannel(IPC_CHANNELS.authChangePassword)).toBe(false)
    expect(isMobileChannel(IPC_CHANNELS.authLock)).toBe(false)
    // A phone cannot close the door it came in by.
    expect(isMobileChannel(IPC_CHANNELS.mobileStatus)).toBe(false)
    expect(isMobileChannel(IPC_CHANNELS.mobileSignOut)).toBe(false)
  })

  it('lets a bill be settled from the phone but never rewritten or cancelled', () => {
    // Settling is the delivery round: the bill was right, and the money is now
    // known. Editing and voiding move stock and restate a past day's earnings.
    expect(isMobileChannel(IPC_CHANNELS.salesSettle)).toBe(true)
    expect(isMobileChannel(IPC_CHANNELS.salesUpdate)).toBe(false)
    expect(isMobileChannel(IPC_CHANNELS.salesVoid)).toBe(false)
  })

  it('denies any channel added since the allowlist was written', () => {
    // The property rather than the list, so it keeps holding as the app grows.
    // A new channel is unreachable from the network until it is added above.
    const exposed = Object.values(IPC_CHANNELS).filter((channel) => isMobileChannel(channel))
    const declared = [...MOBILE_CHANNELS]
    expect(exposed.sort()).toEqual(declared.sort())

    const notExposed = Object.values(IPC_CHANNELS).filter(
      (channel) => !MOBILE_CHANNELS.has(channel)
    )
    expect(notExposed.every((channel) => !isMobileChannel(channel))).toBe(true)
  })

  it('is a second gate, not a replacement for the role policy', () => {
    // Both must pass. A channel on the mobile list is still refused to a role
    // that may not have it — the two lists compose rather than overlap.
    const ownerOnly: IpcChannel = IPC_CHANNELS.reportsProfitLoss
    expect(isMobileChannel(ownerOnly)).toBe(true)
    expect(isRoleAuthorized('admin', ownerOnly, {})).toBe(true)
    expect(isRoleAuthorized('shopkeeper', ownerOnly, {})).toBe(false)
  })
})

/* --------------------------------------------------------------- network */

describe('who may connect', () => {
  it('accepts the machine itself and the shop network', () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true)
    expect(isPrivateAddress('::1')).toBe(true)
    expect(isPrivateAddress('192.168.1.34')).toBe(true)
    expect(isPrivateAddress('10.0.0.7')).toBe(true)
    expect(isPrivateAddress('172.16.0.1')).toBe(true)
    expect(isPrivateAddress('172.31.255.254')).toBe(true)
  })

  it('refuses anything that is not obviously next door', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
    expect(isPrivateAddress('172.32.0.1')).toBe(false) // just past the /12
    expect(isPrivateAddress('172.15.0.1')).toBe(false) // just before it
    expect(isPrivateAddress('203.0.113.5')).toBe(false)
    expect(isPrivateAddress('')).toBe(false)
    expect(isPrivateAddress('not-an-address')).toBe(false)
    expect(isPrivateAddress('999.1.1.1')).toBe(false)
  })

  it('sees through the IPv4-mapped form Node hands back', () => {
    expect(normalizeAddress('::ffff:192.168.1.9')).toBe('192.168.1.9')
    expect(isPrivateAddress('::ffff:192.168.1.9')).toBe(true)
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false)
  })
})

/* -------------------------------------------------------------- sessions */

describe('phone sessions', () => {
  const AGENT =
    'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36'

  it('issues a token that verifies once and keeps verifying', () => {
    const token = issueSession('192.168.1.9', AGENT)
    expect(token.length).toBeGreaterThan(30)
    expect(verifySession(token, '192.168.1.9')).toBe(true)
    expect(verifySession(token, '192.168.1.9')).toBe(true)
  })

  it('refuses a token it never issued', () => {
    issueSession('192.168.1.9', AGENT)
    expect(verifySession('not-a-real-token', '192.168.1.9')).toBe(false)
  })

  it('does not tie a session to an address', () => {
    // A phone's address changes when the router renews its lease. Signing the
    // owner out mid-bill because DHCP did something would be a bug wearing a
    // security badge.
    const token = issueSession('192.168.1.9', AGENT)
    expect(verifySession(token, '192.168.1.44')).toBe(true)
    expect(listDevices()[0]?.address).toBe('192.168.1.44')
  })

  it('expires a phone left untouched for a trading day', () => {
    const start = Date.now()
    const token = issueSession('192.168.1.9', AGENT, start)

    const elevenHours = start + 11 * 60 * 60 * 1000
    expect(verifySession(token, '192.168.1.9', elevenHours)).toBe(true)

    // Idle is measured from the last use, so the clock restarted above.
    const thirteenLater = elevenHours + 13 * 60 * 60 * 1000
    expect(verifySession(token, '192.168.1.9', thirteenLater)).toBe(false)
    expect(verifySession(token, '192.168.1.9', thirteenLater)).toBe(false)
  })

  it('revokes one device without touching the others', () => {
    const kept = issueSession('192.168.1.9', AGENT)
    issueSession('192.168.1.10', AGENT)
    expect(listDevices()).toHaveLength(2)

    const target = listDevices().find((device) => device.address === '192.168.1.10')
    expect(revokeDevice(target!.id)).toBe(true)
    expect(listDevices()).toHaveLength(1)
    expect(verifySession(kept, '192.168.1.9')).toBe(true)
  })

  it('revokes them all at once', () => {
    const a = issueSession('192.168.1.9', AGENT)
    const b = issueSession('192.168.1.10', AGENT)
    expect(revokeAllDevices()).toBe(2)
    expect(verifySession(a, '192.168.1.9')).toBe(false)
    expect(verifySession(b, '192.168.1.10')).toBe(false)
  })

  it('lets a phone sign itself out', () => {
    const token = issueSession('192.168.1.9', AGENT)
    revokeToken(token)
    expect(verifySession(token, '192.168.1.9')).toBe(false)
  })

  it('names a device in a way the owner can recognise', () => {
    expect(describeDevice(AGENT)).toBe('Android · Chrome')
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Safari/605')).toBe(
      'iPhone · Safari'
    )
    expect(describeDevice('')).toBe('Phone or tablet')
  })

  it('never puts the token itself in the list the desktop shows', () => {
    const token = issueSession('192.168.1.9', AGENT)
    const shown = JSON.stringify(listDevices())
    expect(shown).not.toContain(token)
  })
})

/* ------------------------------------------------------------ throttling */

describe('throttling the sign-in', () => {
  it('turns a device away after five wrong tries', () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      recordLoginFailure('192.168.1.9')
      expect(checkLoginAllowed('192.168.1.9').allowed).toBe(true)
    }
    recordLoginFailure('192.168.1.9')

    const gate = checkLoginAllowed('192.168.1.9')
    expect(gate.allowed).toBe(false)
    expect(gate.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('throttles one device without touching another', () => {
    for (let attempt = 0; attempt < 5; attempt += 1) recordLoginFailure('192.168.1.9')
    expect(checkLoginAllowed('192.168.1.9').allowed).toBe(false)
    expect(checkLoginAllowed('192.168.1.10').allowed).toBe(true)
  })

  it('forgets the count once the right password arrives', () => {
    for (let attempt = 0; attempt < 5; attempt += 1) recordLoginFailure('192.168.1.9')
    recordLoginSuccess('192.168.1.9')
    expect(checkLoginAllowed('192.168.1.9').allowed).toBe(true)
  })

  it('lets the device back in once the window has passed', () => {
    const start = Date.now()
    for (let attempt = 0; attempt < 5; attempt += 1) recordLoginFailure('192.168.1.9', start)
    expect(checkLoginAllowed('192.168.1.9', start).allowed).toBe(false)

    const later = start + 16 * 60 * 1000
    expect(checkLoginAllowed('192.168.1.9', later).allowed).toBe(true)
  })
})

/* ----------------------------------------------------------------- files */

describe('serving the app', () => {
  const root = '/srv/renderer'

  it('refuses to walk out of the build directory', () => {
    expect(resolveStaticFile('/../../../etc/passwd', root)).toBeNull()
    expect(resolveStaticFile('/..%2f..%2fsecrets.txt', root)).toBeNull()
    expect(resolveStaticFile('/assets/../../pos.db', root)).toBeNull()
  })

  it('refuses a null byte', () => {
    expect(resolveStaticFile('/assets/app.js%00.png', root)).toBeNull()
  })

  it('never hands out the desktop window', () => {
    // It could not work in a phone browser — no preload bridge — and a
    // half-loading copy of the till is a confusing thing to give somebody.
    expect(resolveStaticFile('/index.html', root)).toBeNull()
  })

  it('locks the shipped page down to this origin', () => {
    const csp = securityHeaders(true)['Content-Security-Policy'] ?? ''
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(securityHeaders(true)['X-Content-Type-Options']).toBe('nosniff')
    // A shop's records have no business in a shared cache.
    expect(securityHeaders(false)['Cache-Control']).toBe('no-store')
  })
})

/* ----------------------------------------------------- identity carrying */

describe('a phone carries its own identity', () => {
  /** One credit sale at a profit plus an expense, so every figure is non-zero. */
  function seedTradingDay(): void {
    const product = productService.addProduct({
      name: 'Rice 25kg',
      baseUnit: 'bag',
      costPrice: 0,
      salePrice: 3000,
      reorderLevel: 5
    })
    purchaseService.createPurchase({
      items: [{ productId: product.id, unitName: 'bag', qty: 20, unitCost: 2000 }],
      paidAmount: 40000
    })
    const buyer = getDb().prepare('INSERT INTO customers (name) VALUES (?)').run('Khan Store')
    salesService.createSale({
      customerId: Number(buyer.lastInsertRowid),
      items: [{ productId: product.id, unitName: 'bag', qty: 5, rate: 3000 }],
      paymentType: 'credit',
      paidAmount: 0
    })
    expenseService.addExpense({ title: 'Shop rent', amount: 5000 })
  }

  const range = { from: today(), to: today() }

  beforeEach(() => {
    seedTradingDay()
    userService.createUser({ username: 'ali', pin: '1234' })
  })

  it('sees the owner’s figures even while a shopkeeper is signed in at the till', () => {
    lock()
    authService.staffLogin({ username: 'ali', pin: '1234' })
    expect(currentRole()).toBe('shopkeeper')

    // Redaction is ambient: `dashboardService` reads the session directly. The
    // shopkeeper at the counter gets a redacted payload...
    expect(dashboardService.getSummary(range).profit).toBe(0)

    // ...and the owner on the phone, in the same instant, does not.
    const fromPhone = runAs('admin', null, () => dashboardService.getSummary(range))
    expect(fromPhone.profit).toBeGreaterThan(0)
    expect(fromPhone.expenses).toBe(5000)
  })

  it('leaves the till’s own session exactly where it was', () => {
    lock()
    authService.staffLogin({ username: 'ali', pin: '1234' })

    runAs('admin', null, () => dashboardService.getSummary(range))

    // The counter is still signed in as the shopkeeper it was before.
    expect(currentRole()).toBe('shopkeeper')
    expect(dashboardService.getSummary(range).profit).toBe(0)
  })

  it('unlocks nothing outside its own call', () => {
    lock()
    const seen = runAs('admin', null, () => currentRole())
    expect(seen).toBe('admin')
    expect(currentRole()).toBeNull()
  })

  it('keeps two callers apart while both are in flight', async () => {
    lock()
    unlock('shopkeeper', 'ali')

    // Interleaved on purpose: a swap-and-restore global would leak one
    // caller's identity into the other. AsyncLocalStorage does not.
    const [phone, till] = await Promise.all([
      runAs('admin', null, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return currentRole()
      }),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return currentRole()
      })()
    ])

    expect(phone).toBe('admin')
    expect(till).toBe('shopkeeper')
  })
})

/* --------------------------------------------------------- over the wire */

describe('the server itself', () => {
  async function start(): Promise<void> {
    updateSettings({ mobileEnabled: true, mobilePort: PORT })
    await syncMobileServer()
  }

  async function signIn(password = ADMIN.password): Promise<Response> {
    return fetch(`${BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    })
  }

  async function token(): Promise<string> {
    const result = (await (await signIn()).json()) as IpcResult<{ token: string }>
    if (!result.ok) throw new Error('sign-in failed in a test that expected it to work')
    return result.data.token
  }

  /**
   * One `POST /api/call`, retried once if the socket was pulled out from under
   * it.
   *
   * The retry is about the test client, not the server: Node's fetch keeps a
   * connection pool, and stopping the server closes those sockets, so the
   * first request after a restart can land on a dead one. A browser handles
   * this for itself; undici surfaces it as a `TypeError`.
   */
  async function callAs(bearer: string, channel: string, payload?: unknown): Promise<Response> {
    const send = (): Promise<Response> =>
      fetch(`${BASE}/api/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ channel, payload })
      })

    try {
      return await send()
    } catch {
      return send()
    }
  }

  beforeEach(async () => {
    await start()
  })

  afterAll(async () => {
    await stopMobileServer()
  })

  it('starts only when the owner has switched it on', async () => {
    expect(mobileStatus().running).toBe(true)

    updateSettings({ mobileEnabled: false })
    await syncMobileServer()
    expect(mobileStatus().running).toBe(false)

    await start()
    expect(mobileStatus().running).toBe(true)
  })

  it('answers a health check without a session', async () => {
    const response = await fetch(`${BASE}/api/health`)
    expect(response.status).toBe(200)
    expect(((await response.json()) as IpcResult<{ app: string }>).ok).toBe(true)
  })

  it('refuses everything else without a session', async () => {
    const response = await fetch(`${BASE}/api/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: IPC_CHANNELS.settingsGet })
    })
    expect(response.status).toBe(401)
  })

  it('refuses a made-up token', async () => {
    expect((await callAs('nonsense', IPC_CHANNELS.settingsGet)).status).toBe(401)
  })

  it('signs in with the shop password and nothing else', async () => {
    expect((await signIn('wrong')).status).toBe(401)
    expect((await signIn()).status).toBe(200)
  })

  it('shows the signed-in phone on the desktop’s Settings screen', async () => {
    await token()
    const devices = mobileStatus().devices
    expect(devices).toHaveLength(1)
    expect(devices[0]?.address).toBe('127.0.0.1')
  })

  it('never lets a network guesser lock the owner out of his own till', async () => {
    // The whole reason `verifyAdminPassword` exists. Five wrong passwords over
    // the network throttle THAT DEVICE — and leave the admin credential's own
    // lockout counters untouched, so the keyboard at the counter still works.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await signIn('wrong')).status).toBe(401)
    }
    expect((await signIn('wrong')).status).toBe(429)

    lock()
    expect(authService.login({ password: ADMIN.password }).unlocked).toBe(true)
  })

  it('runs an allowed channel through the very same pipeline the desktop uses', async () => {
    const bearer = await token()
    const response = await callAs(bearer, IPC_CHANNELS.settingsGet)
    const result = (await response.json()) as IpcResult<{ currency: string }>

    expect(response.status).toBe(200)
    expect(result.ok).toBe(true)
    expect(result.ok && result.data.currency).toBe('PKR')
  })

  it('refuses a channel that is not on the mobile list', async () => {
    const bearer = await token()
    const response = await callAs(bearer, IPC_CHANNELS.settingsUpdate, {
      businessName: 'Hijacked'
    })

    expect(response.status).toBe(404)
    // And nothing was written.
    expect(getDb().prepare('SELECT business_name AS n FROM settings').get()).not.toEqual({
      n: 'Hijacked'
    })
  })

  it('refuses a channel that does not exist at all', async () => {
    const bearer = await token()
    expect((await callAs(bearer, 'sales:deleteEverything')).status).toBe(404)
  })

  it('reports a refused business rule as a normal answer, not an HTTP failure', async () => {
    const bearer = await token()
    // A walk-in bill cannot go on credit; the service says so. That is the app
    // answering, so it comes back 200 with `ok: false` — exactly as over IPC.
    const response = await callAs(bearer, IPC_CHANNELS.salesCreate, {
      input: { customerId: null, items: [], paymentType: 'credit', paidAmount: 0 }
    })

    expect(response.status).toBe(200)
    const result = (await response.json()) as IpcResult<never>
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error.code).toBeTruthy()
  })

  it('writes a bill that the shop computer can immediately read back', async () => {
    const product = productService.addProduct({
      name: 'Sugar 50kg',
      baseUnit: 'bag',
      costPrice: 0,
      salePrice: 5000,
      reorderLevel: 2,
      openingStock: 10
    })

    const bearer = await token()
    const response = await callAs(bearer, IPC_CHANNELS.salesCreate, {
      input: {
        customerId: null,
        items: [{ productId: product.id, unitName: 'bag', qty: 2, rate: 5000 }],
        paymentType: 'cash',
        paidAmount: 10000
      }
    })

    const result = (await response.json()) as IpcResult<{ sale: { id: number; total: number } }>
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // There is no second database and nothing to sync: the bill was written by
    // the shop computer itself, so it is simply there.
    const sale = salesService.getSale(result.data.sale.id)
    expect(sale.total).toBe(10000)
    expect(productService.getProduct(product.id).stockQty).toBe(8)
  })

  it('builds a CSV without opening a dialog on the shop computer', async () => {
    const bearer = await token()
    const response = await fetch(`${BASE}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ report: 'customers' })
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(response.headers.get('content-disposition')).toContain('attachment')
    expect((await response.text()).length).toBeGreaterThan(0)
  })

  it('signs every phone out when phone access is switched off', async () => {
    const bearer = await token()
    expect((await callAs(bearer, IPC_CHANNELS.settingsGet)).status).toBe(200)

    updateSettings({ mobileEnabled: false })
    await syncMobileServer()
    expect(mobileStatus().devices).toHaveLength(0)

    // And the old token is worthless if it is ever switched back on.
    await start()
    expect((await callAs(bearer, IPC_CHANNELS.settingsGet)).status).toBe(401)
  })

  it('lets a phone sign itself out', async () => {
    const bearer = await token()
    const response = await fetch(`${BASE}/api/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}` }
    })

    expect(response.status).toBe(200)
    expect((await callAs(bearer, IPC_CHANNELS.settingsGet)).status).toBe(401)
  })
})
