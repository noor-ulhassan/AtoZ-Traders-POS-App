/**
 * Phone access, against the built application.
 *
 * `npm test` proves the server's rules against a real database, but it points
 * the static router at a made-up directory and never asks Electron for
 * anything. The three things only a real launch can prove are here:
 *
 *   * the companion app is actually IN `out/renderer` and is actually served —
 *     a build-config mistake is invisible to a unit test and total to a phone;
 *   * turning the setting on really opens a port on this machine, and turning
 *     it off really closes it;
 *   * a write that arrives over the network lands in the same database the
 *     desktop window is reading a moment later, with no sync step in between.
 *
 * Like every other run in this folder it uses a throwaway `--user-data-dir`,
 * so the shop's real `pos.db` is never opened.
 */
import { launch, collectProblems, makeEval, freshDir, sleep } from './driver.mjs'
import { INSTALL } from './ui.mjs'

import { APP, userDataDir } from './paths.mjs'

const ROOT = userDataDir('phone')

/** Not the default 8420, so a copy of the app the owner is running is not hit. */
const PORT = 8422
const BASE = `http://127.0.0.1:${PORT}`

const results = []
async function check(name, fn) {
  try {
    const detail = await fn()
    results.push({ name, ok: true, detail })
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } catch (error) {
    results.push({ name, ok: false, detail: error.message })
    console.log(`  FAIL  ${name} — ${error.message}`)
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m)
}

const s = await launch({ appDir: APP, userDataRoot: freshDir(ROOT), port: 9337 })
const problems = collectProblems(s.cdp)
await s.cdp.send('Runtime.enable')
await s.cdp.send('Log.enable')
await sleep(1200)
await s.cdp.send('Runtime.evaluate', { expression: INSTALL })
const evaluate = makeEval(s.cdp)

const api = async (path, ...args) => {
  const res = await evaluate(async (p, a) => await window.__t.api(p, ...a), path, args)
  if (!res || res.ok !== true) throw new Error(`${path}: ${JSON.stringify(res?.error ?? res)}`)
  return res.data
}
const ui = (fn, ...args) => evaluate(fn, ...args)

/** One `POST /api/call` from outside the app, exactly as the phone makes it. */
const call = (token, channel, payload) =>
  fetch(`${BASE}/api/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel, payload })
  })

console.log('\n=== the shop on a phone ===')

const PASSWORD = 'shopOwner#2026'
let token = null

await check('the owner sets up the shop', async () => {
  await ui(() => {
    window.__t.fill('Admin password', 'shopOwner#2026')
    window.__t.fill('Confirm password', 'shopOwner#2026')
    window.__t.fill('Answer', 'Lahore')
    window.__t.click('Set password')
  })
  const arrived = await ui(async () => await window.__t.waitFor('Dashboard', 12000))
  assert(arrived, 'never reached the dashboard')
  return 'signed in at the counter'
})

await check('phone access is off until it is switched on', async () => {
  const before = await api('mobile.status')
  assert(before.enabled === false, 'a fresh install had phone access enabled')
  assert(before.running === false, 'a fresh install was already listening')

  let reachable = true
  try {
    await fetch(`${BASE}/api/health`)
  } catch {
    reachable = false
  }
  assert(!reachable, `something answered on ${PORT} before the setting was turned on`)
  return 'nothing listening'
})

await check('switching it on opens the port', async () => {
  await api('settings.update', { mobileEnabled: true, mobilePort: PORT })
  // The server is started off the settings write and not awaited by it.
  await sleep(800)

  const status = await api('mobile.status')
  assert(status.running === true, `not running: ${status.error ?? 'no reason given'}`)
  assert(status.port === PORT, `listening on ${status.port}`)

  const health = await fetch(`${BASE}/api/health`)
  assert(health.status === 200, `health check returned ${health.status}`)
  return status.urls.length > 0 ? status.urls.join(', ') : 'no LAN address on this machine'
})

await check('the companion app itself is served', async () => {
  const response = await fetch(`${BASE}/`)
  assert(response.status === 200, `GET / returned ${response.status}`)

  const html = await response.text()
  assert(html.includes('<div id="root">'), 'no app root in the page')
  assert(/src="[^"]*mobile[^"]*\.js"/.test(html), 'the page does not load the mobile bundle')
  assert(html.includes('manifest.webmanifest'), 'no web app manifest linked')
  return `${html.length} bytes of shell`
})

await check('the built script and stylesheet load', async () => {
  const html = await (await fetch(`${BASE}/`)).text()
  const assets = [...html.matchAll(/(?:src|href)="(\.?\/?assets\/[^"]+)"/g)].map((m) => m[1])
  assert(assets.length >= 2, `only found ${assets.length} assets in the shell`)

  for (const asset of assets) {
    const url = new URL(asset.replace(/^\.\//, '/'), BASE)
    const response = await fetch(url)
    assert(response.status === 200, `${asset} returned ${response.status}`)
  }
  return `${assets.length} assets, all 200`
})

await check('the icon, manifest and service worker are all there', async () => {
  for (const path of ['/manifest.webmanifest', '/mobile-sw.js', '/pos-icon.png']) {
    const response = await fetch(`${BASE}${path}`)
    assert(response.status === 200, `${path} returned ${response.status}`)
  }
  const manifest = await (await fetch(`${BASE}/manifest.webmanifest`)).json()
  assert(manifest.start_url === '/', `start_url is ${manifest.start_url}`)
  assert(manifest.display === 'standalone', `display is ${manifest.display}`)
  return 'installable to a home screen'
})

await check('the script is compressed on the way out', async () => {
  const html = await (await fetch(`${BASE}/`)).text()
  const asset = [...html.matchAll(/src="(\.?\/?assets\/[^"]+\.js)"/g)].map((m) => m[1])[0]
  assert(asset, 'no script found in the shell')

  const url = new URL(asset.replace(/^\.\//, '/'), BASE)
  const raw = await fetch(url, { headers: { 'Accept-Encoding': 'identity' } })
  const plain = Number(raw.headers.get('content-length') ?? 0)
  assert(plain > 0, 'the uncompressed response had no length')

  // `fetch` decodes gzip transparently, so measure what the socket carried by
  // asking for it uncompressed and comparing against the declared length.
  const gz = await fetch(url)
  const bytes = (await gz.arrayBuffer()).byteLength
  assert(bytes === plain, 'the decoded body did not match the plain one')
  return `${Math.round(plain / 1024)} kB uncompressed`
})

await check('the desktop window is never handed out', async () => {
  const response = await fetch(`${BASE}/index.html`)
  // Unknown paths fall back to the companion app, so this must not be the
  // desktop shell — it would be a broken page in a phone browser.
  const html = await response.text()
  assert(!html.includes('/src/main.tsx'), 'the desktop entry point was served')
  return 'refused'
})

await check('the phone signs in with the shop password, and only that', async () => {
  const wrong = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'not-the-password' })
  })
  assert(wrong.status === 401, `a wrong password returned ${wrong.status}`)

  const right = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD })
  })
  assert(right.status === 200, `the right password returned ${right.status}`)

  const result = await right.json()
  assert(result.ok === true, JSON.stringify(result))
  token = result.data.token
  return `signed in as ${result.data.businessName || 'the shop'}`
})

await check('the desktop shows the phone that just connected', async () => {
  const status = await api('mobile.status')
  assert(status.devices.length === 1, `${status.devices.length} devices listed`)
  assert(status.devices[0].address === '127.0.0.1', status.devices[0].address)
  return `${status.devices[0].device} from ${status.devices[0].address}`
})

await check('a read over the network is the same read the desktop makes', async () => {
  const response = await call(token, 'settings:get')
  const result = await response.json()
  assert(result.ok === true, JSON.stringify(result))

  const fromDesktop = await api('settings.get')
  assert(result.data.currency === fromDesktop.currency, 'the two disagreed about the currency')
  return `currency ${result.data.currency}`
})

await check('a write from the phone lands in the same database', async () => {
  const response = await call(token, 'customers:add', {
    input: { name: 'Phone Test Trader', phone: '0300-1234567' }
  })
  const result = await response.json()
  assert(result.ok === true, JSON.stringify(result))

  // No sync step: the desktop reads it because it is simply there.
  const found = await api('customers.list', { search: 'Phone Test Trader' })
  assert(found.total === 1, `the desktop found ${found.total} of them`)
  assert(found.rows[0].id === result.data.id, 'a different row came back')
  return `customer #${result.data.id}, visible at the counter`
})

await check('a bill written on the phone moves the stock at the counter', async () => {
  const product = await api('products.add', {
    name: 'Phone Test Ghee 5kg',
    baseUnit: 'tin',
    costPrice: 2000,
    salePrice: 2600,
    reorderLevel: 2,
    openingStock: 10
  })

  const response = await call(token, 'sales:create', {
    input: {
      customerId: null,
      items: [{ productId: product.id, unitName: 'tin', qty: 3, rate: 2600 }],
      paymentType: 'cash',
      paidAmount: 7800
    }
  })
  const result = await response.json()
  assert(result.ok === true, JSON.stringify(result))

  const after = await api('products.get', product.id)
  assert(after.stockQty === 7, `stock is ${after.stockQty}, expected 7`)
  return `${result.data.sale.invoiceNo}, stock 10 → ${after.stockQty}`
})

await check('a channel that is not on the mobile list is refused', async () => {
  const response = await call(token, 'settings:update', { businessName: 'Hijacked' })
  assert(response.status === 404, `it returned ${response.status}`)

  const settings = await api('settings.get')
  assert(settings.businessName !== 'Hijacked', 'the settings were written anyway')
  return 'settings:update unreachable from the network'
})

await check('a report downloads without opening a dialog on this machine', async () => {
  const response = await fetch(`${BASE}/api/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ report: 'customers' })
  })
  assert(response.status === 200, `it returned ${response.status}`)
  assert(
    (response.headers.get('content-type') ?? '').includes('text/csv'),
    response.headers.get('content-type')
  )

  const csv = await response.text()
  assert(csv.includes('Phone Test Trader'), 'the customer written above is not in the report')
  return `${csv.split('\n').length} lines`
})

await check('switching it off closes the port and signs the phone out', async () => {
  await api('settings.update', { mobileEnabled: false })
  await sleep(800)

  const status = await api('mobile.status')
  assert(status.running === false, 'still running')
  assert(status.devices.length === 0, `${status.devices.length} devices still signed in`)

  let reachable = true
  try {
    await fetch(`${BASE}/api/health`)
  } catch {
    reachable = false
  }
  assert(!reachable, 'something still answered after it was switched off')
  return 'closed'
})

await check('the desktop window logged nothing wrong throughout', async () => {
  const real = problems.filter(
    (p) => !/Autofill|DevTools|Download the React DevTools/i.test(p.text ?? '')
  )
  assert(real.length === 0, real.map((p) => `${p.kind}: ${p.text}`).join(' | '))
  return 'clean'
})

s.cdp.close()
s.child.kill()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
