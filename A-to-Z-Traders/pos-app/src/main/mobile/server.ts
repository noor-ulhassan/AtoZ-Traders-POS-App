import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { MobileStatus } from '@shared/types'
import { getSettings } from '../services/settingsService'
import { logger } from '../utils/logger'
import { routeApi } from './api'
import { isPrivateAddress, mobileUrls, normalizeAddress } from './network'
import { listDevices, revokeAllDevices, revokeDevice } from './sessions'
import { resetLoginAttempts } from './rateLimit'
import { proxyToDevServer, resolveStaticFile, securityHeaders, sendFile } from './staticFiles'

const log = logger.child('mobile')

/**
 * The little web server that puts the till on the owner's phone.
 *
 * It is the same shape as the backup scheduler, and for the same reason: the
 * settings in the database are the only copy of what it should be doing.
 * `syncMobileServer()` reads them and makes reality match — start it, stop it,
 * move it to another port — so turning the feature on or off is one settings
 * write with nothing to wire up and nothing left holding a stale idea of the
 * configuration.
 *
 * Nothing here understands the business. It decides who may connect and hands
 * the request to `routeApi`, which hands it to the same `invokeChannel` the
 * desktop window uses.
 */

let server: Server | null = null
let listeningPort = 0

/** Why the server is not running, when the owner has asked for it to be. */
let lastError: string | null = null

/**
 * The dev server's URL, when `npm run dev` is what is running.
 *
 * `ELECTRON_RENDERER_URL` is set by electron-vite only while it is serving the
 * renderer, so its presence is the whole signal — no second "am I in
 * development" flag to disagree with it, and nothing imported from Electron
 * that a test would have to stub.
 */
function devServerUrl(): string | null {
  return process.env['ELECTRON_RENDERER_URL'] ?? null
}

/**
 * A plain, unstyled refusal for a caller from outside the local network.
 *
 * Reached only if the machine is somehow forwarding a port from the internet.
 * It should not be possible; the app says no anyway rather than trusting that
 * it is not. See `network.ts`.
 */
function refuseStranger(response: import('node:http').ServerResponse, address: string): void {
  log.warn(`refused a request from ${address || 'an unknown address'} — not a local address`)
  response.writeHead(403, {
    ...securityHeaders(false),
    'Content-Type': 'text/plain; charset=utf-8'
  })
  response.end('This app is only available on the shop network.')
}

function createMobileServer(): Server {
  const devUrl = devServerUrl()

  return createServer((request, response) => {
    void (async () => {
      const address = normalizeAddress(request.socket.remoteAddress)
      if (!isPrivateAddress(address)) {
        refuseStranger(response, address)
        return
      }

      if (await routeApi(request, response, address)) return

      const method = request.method ?? 'GET'
      if (method !== 'GET' && method !== 'HEAD') {
        response.writeHead(405, { ...securityHeaders(false), Allow: 'GET, HEAD' })
        response.end()
        return
      }

      // In development the app is not built to disk at all, so the phone is
      // served by the same Vite process the desktop window is — and reloads on
      // save exactly as the desktop does.
      if (devUrl) {
        proxyToDevServer(devUrl, request, response)
        return
      }

      const path = (request.url ?? '/').split('?')[0] ?? '/'
      const file = resolveStaticFile(path)
      if (file) {
        sendFile(response, file, true, request)
        return
      }

      // Unknown path: hand back the app itself, so a deep link and a reload of
      // one work the way the phone's back button expects them to.
      const shell = resolveStaticFile('/')
      if (shell) {
        sendFile(response, shell, true, request)
        return
      }

      response.writeHead(404, {
        ...securityHeaders(false),
        'Content-Type': 'text/plain; charset=utf-8'
      })
      response.end('The phone app has not been built into this copy of the program.')
    })()
  })
}

/** Starts listening on `port`. Resolves either way; failures land in `lastError`. */
function listen(port: number): Promise<void> {
  return new Promise((resolve) => {
    const next = createMobileServer()

    next.once('error', (error: NodeJS.ErrnoException) => {
      lastError =
        error.code === 'EADDRINUSE'
          ? `Another program on this computer is already using port ${port}. Choose a different port.`
          : `The phone app could not start: ${error.message}`
      log.error(`listen on ${port} failed`, error)
      server = null
      listeningPort = 0
      resolve()
    })

    next.listen(port, '0.0.0.0', () => {
      server = next
      listeningPort = port
      lastError = null
      const urls = mobileUrls(port)
      log.info(
        urls.length > 0
          ? `phone access on ${urls.join(', ')}`
          : `phone access listening on port ${port} (this machine is not on a local network)`
      )
      resolve()
    })
  })
}

function close(): Promise<void> {
  const current = server
  server = null
  listeningPort = 0
  if (!current) return Promise.resolve()

  // Every phone is signed out when the door closes. Sessions are in memory, so
  // this is belt and braces — but "turned off" has to mean turned off.
  revokeAllDevices()
  resetLoginAttempts()

  return new Promise((resolve) => {
    current.close(() => {
      log.info('phone access stopped')
      resolve()
    })
    // Close the sockets a phone is holding open, or the callback waits for
    // keep-alive to time out and "Stop" appears not to have worked.
    current.closeAllConnections?.()
  })
}

/**
 * One sync at a time.
 *
 * A sync closes a listener and opens another, and both halves take a turn of
 * the event loop. Two of them overlapping — two quick saves on the Settings
 * screen, or a save arriving while the startup sync is still binding — could
 * leave a listener open that nothing holds a reference to. Chaining is three
 * lines and removes the possibility rather than making it unlikely.
 */
let syncing: Promise<void> = Promise.resolve()

async function applySettings(): Promise<void> {
  const { mobileEnabled, mobilePort } = getSettings()

  if (!mobileEnabled) {
    lastError = null
    await close()
    return
  }

  if (server && listeningPort === mobilePort) return

  await close()
  await listen(mobilePort)
}

/**
 * Makes the server match the saved settings.
 *
 * Called at startup and whenever the settings are written, so there is never a
 * second copy of "is phone access on, and on which port" to fall out of step.
 */
export function syncMobileServer(): Promise<void> {
  syncing = syncing.then(applySettings, applySettings)
  return syncing
}

/** Stops the server for good. Called on quit. */
export function stopMobileServer(): Promise<void> {
  syncing = syncing.then(close, close)
  return syncing
}

/** What the Settings screen shows: on or off, where, and who is connected. */
export function mobileStatus(): MobileStatus {
  const { mobileEnabled, mobilePort } = getSettings()
  const running = server !== null
  const port = running ? listeningPort : mobilePort

  return {
    enabled: mobileEnabled,
    running,
    port,
    urls: running ? mobileUrls(port) : [],
    devices: listDevices(),
    error: lastError
  }
}

/** Signs out one phone, or every phone when no id is given. */
export function signOutMobileDevice(id?: string): MobileStatus {
  if (id) revokeDevice(id)
  else revokeAllDevices()
  return mobileStatus()
}
