import type { IncomingMessage, ServerResponse } from 'node:http'
import { request as httpRequest } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createGzip } from 'node:zlib'
import { join, normalize, sep } from 'node:path'

/**
 * Serving the companion app itself — the HTML, the script and the icon.
 *
 * The mobile app is a second entry point of the same Vite build as the desktop
 * window, so it is already sitting in `out/renderer` next to `index.html` and
 * shares its chunks. Nothing is built twice and nothing is copied; this file
 * only decides which of those files a request on the network may have.
 */

/** Where the built renderer lives, relative to the bundled main process. */
function rendererDir(): string {
  return join(__dirname, '../renderer')
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
}

function mimeFor(path: string): string {
  const dot = path.lastIndexOf('.')
  return (
    (dot === -1 ? undefined : MIME[path.slice(dot).toLowerCase()]) ?? 'application/octet-stream'
  )
}

/**
 * The desktop window's own entry point, which must not be served.
 *
 * It would not work — it is written against `window.api`, the preload bridge,
 * which does not exist in a phone browser — but a half-loading copy of the
 * till on somebody's phone is a confusing thing to hand out, so the route
 * answers 404 rather than a broken page.
 */
const HIDDEN = new Set(['/index.html'])

/**
 * Maps a request path to a file inside the renderer directory, or null.
 *
 * `normalize` plus the prefix check is the whole defence against `..` walking
 * out of the build directory into the rest of the machine. It is short because
 * the rule is short: a path that does not resolve inside `out/renderer` is not
 * served, whatever it looks like.
 */
export function resolveStaticFile(urlPath: string, root = rendererDir()): string | null {
  if (HIDDEN.has(urlPath)) return null

  // `/` is the companion app. The desktop's index.html keeps its own name.
  const relative = urlPath === '/' ? 'mobile.html' : decodeURIComponent(urlPath).replace(/^\/+/, '')
  if (relative.includes('\0')) return null

  const candidate = normalize(join(root, relative))
  if (candidate !== root && !candidate.startsWith(root + sep)) return null
  if (!existsSync(candidate) || !statSync(candidate).isFile()) return null
  return candidate
}

/**
 * The headers every response from this server carries.
 *
 * `nosniff` and the frame/referrer rules cost nothing and close off the easy
 * mistakes. The CSP is the same shape as the desktop window's: everything from
 * this origin, nothing from the web. A dependency that started phoning home
 * from a shop machine would be stopped here as well as there.
 */
export function securityHeaders(strictCsp: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    // A shop's records have no business in a search index or a shared cache.
    'Cache-Control': 'no-store'
  }

  if (strictCsp) {
    headers['Content-Security-Policy'] =
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; " +
      "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  }

  return headers
}

/**
 * Which files are worth compressing.
 *
 * The renderer bundle is built unminified — that is the desktop app's own
 * build, and it is served from disk there, so nothing about it needed to be
 * small. Over a shop's Wi-Fi it does: gzip takes the phone's first load from
 * roughly 800 kB to 150 kB, which is the difference between a shrug and a wait
 * on the hardware these shops actually have. Images and fonts are already
 * compressed and are left alone.
 */
const COMPRESSIBLE = /\.(html|js|mjs|css|json|webmanifest|svg|txt)$/i

function acceptsGzip(request: IncomingMessage): boolean {
  const header = request.headers['accept-encoding']
  return typeof header === 'string' && header.includes('gzip')
}

/** Sends one file, with the caching turned off that a POS wants turned off. */
export function sendFile(
  response: ServerResponse,
  filePath: string,
  strictCsp: boolean,
  request?: IncomingMessage
): void {
  const headers = {
    ...securityHeaders(strictCsp),
    'Content-Type': mimeFor(filePath)
  }

  if (request && acceptsGzip(request) && COMPRESSIBLE.test(filePath)) {
    // No Content-Length: the compressed size is not known until it has been
    // compressed, and the response is streamed rather than buffered.
    response.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' })
    createReadStream(filePath).pipe(createGzip()).pipe(response)
    return
  }

  response.writeHead(200, { ...headers, 'Content-Length': statSync(filePath).size })
  createReadStream(filePath).pipe(response)
}

/**
 * Development only: hand the request to the Vite dev server.
 *
 * `npm run dev` never writes `out/renderer`, so without this the phone would
 * get nothing but 404s while the desktop window hot-reloads happily. Proxying
 * means the companion app reloads on save too, from the same dev server, and
 * the production path below stays the one that ships.
 */
export function proxyToDevServer(
  devUrl: string,
  incoming: IncomingMessage,
  response: ServerResponse
): void {
  const target = new URL(incoming.url === '/' ? '/mobile.html' : (incoming.url ?? '/'), devUrl)

  const upstream = httpRequest(
    {
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: incoming.method,
      headers: { ...incoming.headers, host: target.host }
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
      upstreamResponse.pipe(response)
    }
  )

  upstream.on('error', () => {
    response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('The development server is not reachable.')
  })

  incoming.pipe(upstream)
}
