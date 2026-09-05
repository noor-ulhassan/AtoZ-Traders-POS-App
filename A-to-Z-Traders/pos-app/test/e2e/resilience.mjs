/**
 * What happens when the shop machine misbehaves: a power cut mid-sale, a
 * second copy of the app, and the kind of data people actually type.
 */
import { spawn, execSync } from 'node:child_process'
import { launch, collectProblems, makeEval, freshDir, sleep } from './driver.mjs'
import { INSTALL } from './ui.mjs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
import { APP, userDataDir } from './paths.mjs'

const ROOT = userDataDir('resilience')

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
const eq = (a, b, w) =>
  assert(a === b, `${w}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)

let s = null
const evaluate = () => makeEval(s.cdp)
const api = async (path, ...args) => {
  const res = await evaluate()(async (p, a) => await window.__t.api(p, ...a), path, args)
  if (!res || res.ok !== true) throw new Error(`${path}: ${JSON.stringify(res?.error ?? res)}`)
  return res.data
}
const rawApi = (path, ...args) =>
  evaluate()(async (p, a) => await window.__t.api(p, ...a), path, args)
const ui = (fn, ...args) => evaluate()(fn, ...args)

async function open({ wipe }) {
  s = await launch({ appDir: APP, userDataRoot: freshDir(ROOT, { wipe }), port: 9336 })
  s.problems = collectProblems(s.cdp)
  await s.cdp.send('Runtime.enable')
  await s.cdp.send('Log.enable')
  await sleep(1300)
  await s.cdp.send('Runtime.evaluate', { expression: INSTALL })
}

/** SIGKILL the whole Electron tree — as close to pulling the plug as it gets. */
function pullThePlug(pid) {
  try {
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' })
  } catch {
    // Already gone.
  }
}

console.log('\n=== the shop machine misbehaving ===')

await open({ wipe: true })

let ids = {}

await check('a shop is set up and stocked', async () => {
  await ui(() => {
    window.__t.fill('Admin password', 'shopOwner#2026')
    window.__t.fill('Confirm password', 'shopOwner#2026')
    window.__t.fill('Answer', 'Lahore')
    window.__t.click('Set password')
  })
  assert(await ui(async () => await window.__t.waitFor('Dashboard', 12000)), 'no dashboard')

  const supplier = await api('suppliers.add', { name: 'Metro Distributors' })
  const customer = await api('customers.add', { name: 'Bilal Kiryana Store' })
  const rice = await api('products.add', {
    name: 'Basmati Rice 5kg',
    baseUnit: 'bag',
    costPrice: 0,
    salePrice: 2100,
    reorderLevel: 5
  })
  await api('purchases.create', {
    supplierId: supplier.id,
    items: [{ productId: rice.id, unitName: 'bag', qty: 1000, unitCost: 1800 }],
    paidAmount: 1800000
  })
  ids = { supplier, customer, rice }
  return '1,000 bags in stock'
})

// ------------------------------------------------- names people actually type

await check('Urdu names, long names and odd characters survive a round trip', async () => {
  const awkward = [
    'اے ٹو زیڈ ٹریڈرز',
    "O'Brien & Sons — Wholesale (Pvt) Ltd.",
    'A'.repeat(120),
    'Ali\tKhan\nSecond line'
  ]
  const saved = []
  for (const name of awkward) {
    const party = await api('customers.add', { name })
    const read = await api('customers.get', party.id)
    saved.push(read.name)
  }
  eq(saved[0], awkward[0], 'the Urdu name came back changed')
  eq(saved[1], awkward[1], 'the punctuation came back changed')
  eq(saved[2].length, 120, 'a 120-character name was truncated')
  return `stored: ${saved[0]}, ${saved[1].slice(0, 24)}…`
})

await check('a name longer than the field allows is refused, not silently cut', async () => {
  const res = await rawApi('customers.add', { name: 'A'.repeat(500) })
  assert(res.ok === false, 'a 500-character name was accepted')
  eq(res.error.code, 'VALIDATION', 'error code')
  return res.error.message
})

await check('an empty name is refused', async () => {
  const res = await rawApi('customers.add', { name: '   ' })
  assert(res.ok === false, 'a blank name was accepted')
  return res.error.message
})

let awkwardSale = null

await check('awkward money and quantities round the way the shop expects', async () => {
  const { sale } = await api('sales.create', {
    customerId: ids.customer.id,
    items: [
      { productId: ids.rice.id, unitName: 'bag', qty: 3, rate: 1000.005 },
      { productId: ids.rice.id, unitName: 'bag', qty: 0.333, rate: 999.994 }
    ],
    paymentType: 'credit',
    paidAmount: 0
  })
  assert(Number.isFinite(sale.total), 'the total is not a number')
  // Half-away-from-zero at 2dp, as the money helper promises.
  eq(sale.items[0].rate, 1000.01, 'a rate of 1000.005 did not round half-up')
  eq(Math.round(sale.total * 100) / 100, sale.total, 'the total carries more than 2 decimals')
  eq(
    sale.subtotal,
    Math.round((sale.items[0].amount + sale.items[1].amount) * 100) / 100,
    'the subtotal is not the sum of its lines'
  )
  for (const item of sale.items) {
    eq(
      Math.round(item.amount * 100) / 100,
      item.amount,
      'a line amount carries more than 2 decimals'
    )
  }
  awkwardSale = sale
  return `total ${sale.total} from ${sale.items.length} awkward lines`
})

await check('a printed line reconciles: quantity x rate - discount = amount', async () => {
  assert(awkwardSale, 'no bill to check')
  const receipt = await api('sales.receipt', awkwardSale.id)
  for (const line of receipt.lines) {
    const expected = Math.round((line.qty * line.rate - line.discount) * 100) / 100
    eq(
      line.amount,
      expected,
      `${line.name}: ${line.qty} x ${line.rate} - ${line.discount} should be ${expected}`
    )
  }
  return `${receipt.lines.length} lines reconcile`
})

await check('a very large bill is handled without losing precision', async () => {
  const { sale } = await api('sales.create', {
    items: [{ productId: ids.rice.id, unitName: 'bag', qty: 500, rate: 9999.99 }],
    paymentType: 'cash',
    paidAmount: 4999995
  })
  eq(sale.total, 4999995, 'a five-million-rupee bill did not total correctly')
  return `${sale.total} on one bill`
})

// ------------------------------------------------------------ the power cut

const beforeCut = {
  sales: await api('sales.list', { limit: 1000 }),
  stock: (await api('products.get', ids.rice.id)).stockQty,
  khata: (await api('customers.get', ids.customer.id)).currentBalance
}

await check('the plug is pulled in the middle of a run of sales', async () => {
  // Fire a stream of bills and kill the process while they are in flight.
  void evaluate()(
    async (productId, customerId) => {
      for (let i = 0; i < 400; i += 1) {
        await window.api.sales.create({
          customerId,
          items: [{ productId, unitName: 'bag', qty: 1, rate: 2100 }],
          paymentType: 'credit',
          paidAmount: 0
        })
      }
      return true
    },
    ids.rice.id,
    ids.customer.id
  ).catch(() => undefined)

  await sleep(700)
  pullThePlug(s.child.pid)
  await sleep(2500)
  return 'killed mid-write'
})

await check('the app reopens on the same database with no damage', async () => {
  await open({ wipe: false })
  const text = await ui(() => document.body.innerText)
  assert(!text.includes('could not start'), `startup failed: ${text.slice(0, 200)}`)
  assert(
    text.includes('Sign in to continue'),
    `expected the lock screen, saw ${text.slice(0, 120)}`
  )
  await ui(() => {
    window.__t.fill('Admin password', 'shopOwner#2026')
    window.__t.clickAny('Unlock', 'Sign in')
  })
  assert(
    await ui(async () => await window.__t.waitFor('Dashboard', 12000)),
    'could not get back in'
  )
  return 'reopened and unlocked'
})

await check('the startup check found no drift after the power cut', async () => {
  const log = s.mainOut.map(([, t]) => t).join('')
  assert(!/drift/i.test(log), `the reconciler had to repair something:\n${log}`)
  assert(/database ready at schema version/.test(log), 'the database never reported ready')
  return 'stock and khata both intact'
})

await check('every bill that survived is complete — no half-written sale', async () => {
  const sales = await api('sales.list', { limit: 1000 })
  const survived = sales.total - beforeCut.sales.total
  assert(survived >= 0, 'bills disappeared')

  // Each surviving bill must have its lines, its stock movements and its
  // share of the khata. Check the aggregate the app itself derives.
  const customer = await api('customers.get', ids.customer.id)
  const statement = await api('customers.ledger', ids.customer.id, {
    from: '2000-01-01',
    to: '2100-01-01'
  })
  eq(statement.closingBalance, customer.currentBalance, 'khata vs statement after the cut')

  const rice = await api('products.get', ids.rice.id)
  const expected = Math.round((beforeCut.stock - survived) * 1000) / 1000
  eq(rice.stockQty, expected, 'stock does not match the bills that survived')

  // And spot-check the newest bill really has its lines.
  const newest = sales.rows[0]
  const full = await api('sales.get', newest.id)
  assert(full.items.length > 0 || full.voidedAt != null, 'a surviving bill has no lines')
  return `${survived} bills committed before the cut, all consistent`
})

await check('the database file itself passes SQLite’s own integrity check', async () => {
  const info = await api('backup.info')
  assert(info.size > 0, 'the database file is empty')
  assert(info.schemaVersion >= 9, `schema version ${info.schemaVersion}`)

  // Open the very same file from outside the app and ask SQLite directly.
  const Database = require(`${APP}/.native-cache/better-sqlite3`)
  const db = new Database(info.path, { readonly: true })
  const integrity = db.pragma('integrity_check', { simple: true })
  const foreignKeys = db.pragma('foreign_key_check')
  db.close()
  eq(integrity, 'ok', 'SQLite integrity_check')
  eq(foreignKeys.length, 0, `orphan rows: ${JSON.stringify(foreignKeys.slice(0, 3))}`)
  return `integrity_check ok, no orphan rows, ${info.counts.sales} sales, ${info.size} bytes`
})

// -------------------------------------------------------- a second copy

await check('a second copy of the app does not open a second till', async () => {
  const electronPath = require(`${APP}/node_modules/electron`)
  const second = spawn(electronPath, ['.', `--user-data-dir=${ROOT}`], {
    cwd: APP,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let out = ''
  second.stdout.on('data', (b) => (out += b))
  second.stderr.on('data', (b) => (out += b))

  const exited = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 12000)
    second.on('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
  if (!exited) pullThePlug(second.pid)

  assert(exited, 'a second copy of the app stayed open on the same database')
  assert(!/applying 000/.test(out), 'the second copy ran migrations on a live database')
  // The first copy must still be working.
  const sales = await api('sales.list', { limit: 1 })
  assert(sales.total >= 0, 'the original window stopped answering')
  return 'the second launch quit and handed focus to the first'
})

console.log('\n=== RESULT ===')
const failed = results.filter((r) => !r.ok)
console.log(`${results.length - failed.length}/${results.length} checks passed`)
for (const f of failed) console.log(`  FAIL ${f.name}\n       ${f.detail}`)

console.log('\n--- RENDERER CONSOLE PROBLEMS ---')
if (!s.problems.length) console.log('  none')
for (const p of s.problems.slice(0, 30)) console.log(`  ${p.kind}: ${String(p.text).slice(0, 300)}`)

pullThePlug(s.child.pid)
process.exit(failed.length > 0 ? 1 : 0)
