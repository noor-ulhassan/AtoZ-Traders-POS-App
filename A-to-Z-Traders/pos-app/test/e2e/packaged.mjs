/**
 * The thing users actually get: the packaged WholesalePOS.exe from
 * release/win-unpacked, not the dev tree.
 */
import { spawn, execSync } from 'node:child_process'
import { existsSync, rmSync, mkdirSync } from 'node:fs'
import { collectProblems, makeEval, sleep } from './driver.mjs'
import { INSTALL } from './ui.mjs'

import { PACKAGED_EXE as EXE, userDataDir } from './paths.mjs'

const ROOT = userDataDir('packaged')
const PORT = 9337

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

if (!existsSync(EXE)) {
  console.log(`the packaged app is not built: ${EXE}`)
  process.exit(1)
}
rmSync(ROOT, { recursive: true, force: true })
mkdirSync(ROOT, { recursive: true })

const child = spawn(
  EXE,
  [`--remote-debugging-port=${PORT}`, '--no-sandbox', `--user-data-dir=${ROOT}`],
  { stdio: ['ignore', 'pipe', 'pipe'] }
)
const out = []
child.stdout.on('data', (b) => out.push(b.toString()))
child.stderr.on('data', (b) => out.push(b.toString()))

let target = null
const deadline = Date.now() + 45000
while (Date.now() < deadline && !target) {
  await sleep(500)
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  } catch {
    /* not up yet */
  }
}
if (!target) {
  console.log('the packaged app never opened a window')
  console.log(out.join(''))
  try {
    execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' })
  } catch {
    /* gone */
  }
  process.exit(1)
}

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 1
const pending = new Map()
const listeners = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id != null) {
    const p = pending.get(m.id)
    pending.delete(m.id)
    if (p) (m.error ? p.reject : p.resolve)(m.error ? new Error(m.error.message) : m.result)
    return
  }
  for (const fn of listeners) fn(m)
})
const cdp = {
  send: (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = id++
      pending.set(n, { resolve, reject })
      ws.send(JSON.stringify({ id: n, method, params }))
    }),
  onEvent: (fn) => listeners.push(fn)
}
const problems = collectProblems(cdp)
await cdp.send('Runtime.enable')
await cdp.send('Log.enable')
await sleep(1000)
await cdp.send('Runtime.evaluate', { expression: INSTALL })
const evaluate = makeEval(cdp)
const ui = (fn, ...a) => evaluate(fn, ...a)
const api = async (path, ...args) => {
  const res = await evaluate(async (p, a) => await window.__t.api(p, ...a), path, args)
  if (!res || res.ok !== true) throw new Error(`${path}: ${JSON.stringify(res?.error ?? res)}`)
  return res.data
}

console.log('\n=== the packaged application ===')

await check('the packaged app opens on the first-run setup screen', async () => {
  const text = await ui(() => document.body.innerText)
  assert(text.includes('Protect this app'), `saw: ${text.slice(0, 200)}`)
  return 'setup screen shown'
})

await check('the packaged renderer is still sealed off from Node', async () => {
  const leaked = await ui(() => [typeof require, typeof process, typeof module])
  assert(
    leaked.every((t) => t === 'undefined'),
    `leaked: ${leaked.join(', ')}`
  )
  return 'no Node in the renderer'
})

await check('the packaged app runs migrations and answers over IPC', async () => {
  await ui(() => {
    window.__t.fill('Admin password', 'shopOwner#2026')
    window.__t.fill('Confirm password', 'shopOwner#2026')
    window.__t.fill('Answer', 'Lahore')
    window.__t.click('Set password')
  })
  assert(await ui(async () => await window.__t.waitFor('Dashboard', 15000)), 'no dashboard')
  const info = await api('backup.info')
  assert(info.schemaVersion >= 9, `schema version ${info.schemaVersion}`)
  assert(info.path.startsWith(ROOT), `database went to ${info.path}, not the throwaway folder`)
  return `schema ${info.schemaVersion} at ${info.path}`
})

await check('a bill can be written and read back in the packaged app', async () => {
  const product = await api('products.add', {
    name: 'Sugar 1kg',
    baseUnit: 'kg',
    costPrice: 100,
    salePrice: 130,
    reorderLevel: 0,
    openingStock: 50
  })
  const { sale, receipt } = await api('sales.create', {
    items: [{ productId: product.id, unitName: 'kg', qty: 4, rate: 130 }],
    paymentType: 'cash',
    paidAmount: 520
  })
  assert(sale.total === 520, `total ${sale.total}`)
  assert(receipt.invoiceNo === sale.invoiceNo, 'receipt invoice mismatch')
  const back = await api('sales.get', sale.id)
  assert(back.items.length === 1, 'the bill came back without its line')
  return `${sale.invoiceNo} for ${sale.total}`
})

await check('every screen renders in the packaged build', async () => {
  const routes = [
    '/',
    '/billing',
    '/sales',
    '/products',
    '/purchases',
    '/customers',
    '/reports',
    '/settings'
  ]
  for (const route of routes) {
    await ui((h) => {
      location.hash = h
    }, `#${route}`)
    await sleep(700)
    const text = await ui(() => document.body.innerText)
    assert(
      !text.includes('Something went wrong on this screen'),
      `${route} crashed: ${text.split('\n').slice(0, 6).join(' | ')}`
    )
  }
  return `${routes.length} screens`
})

console.log('\n=== RESULT ===')
const failed = results.filter((r) => !r.ok)
console.log(`${results.length - failed.length}/${results.length} checks passed`)
for (const f of failed) console.log(`  FAIL ${f.name}\n       ${f.detail}`)
console.log('\n--- RENDERER CONSOLE PROBLEMS ---')
if (!problems.length) console.log('  none')
for (const p of problems.slice(0, 30)) console.log(`  ${p.kind}: ${String(p.text).slice(0, 300)}`)

try {
  execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' })
} catch {
  /* gone */
}
process.exit(failed.length > 0 ? 1 : 0)
