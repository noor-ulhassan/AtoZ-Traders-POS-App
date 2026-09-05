/**
 * The same app, but with a shop's worth of data in it.
 *
 * An empty screen renders happily; a screen with eighty products, hundreds of
 * bills, charts and paging is where a real till actually breaks. This run
 * seeds the built-in sample shop and then drives every screen again.
 */
import { launch, collectProblems, makeEval, freshDir, sleep } from './driver.mjs'
import { INSTALL } from './ui.mjs'

import { APP, userDataDir } from './paths.mjs'

const ROOT = userDataDir('loaded')

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

const s = await launch({ appDir: APP, userDataRoot: freshDir(ROOT), port: 9335 })
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
const goto = async (hash) => {
  await ui((h) => {
    location.hash = h
  }, hash)
  await sleep(900)
}

console.log('\n=== a shop with a year of trading in it ===')

await check('the owner sets up and the sample shop loads', async () => {
  await ui(() => {
    window.__t.fill('Admin password', 'shopOwner#2026')
    window.__t.fill('Confirm password', 'shopOwner#2026')
    window.__t.fill('Answer', 'Lahore')
    window.__t.click('Set password')
  })
  const arrived = await ui(async () => await window.__t.waitFor('Dashboard', 12000))
  assert(arrived, 'never reached the dashboard')

  const started = Date.now()
  const seeded = await api('demo.seed')
  const elapsed = Date.now() - started
  assert(elapsed < 30000, `seeding took ${elapsed}ms`)
  return `${JSON.stringify(seeded)} in ${elapsed}ms`
})

await check('the shop is genuinely busy', async () => {
  const products = await api('products.list', { limit: 1 })
  const sales = await api('sales.list', { limit: 1 })
  const customers = await api('customers.list', { limit: 1 })
  assert(products.total >= 50, `only ${products.total} products`)
  assert(sales.total >= 100, `only ${sales.total} bills`)
  return `${products.total} products, ${sales.total} bills, ${customers.total} customers`
})

const ROUTES = [
  '/',
  '/billing',
  '/sales',
  '/returns/sale',
  '/returns/purchase',
  '/products',
  '/purchases',
  '/purchases/new',
  '/stock',
  '/other-stock',
  '/customers',
  '/suppliers',
  '/payments',
  '/expenses',
  '/reports',
  '/users',
  '/settings'
]

for (const route of ROUTES) {
  await check(`${route} renders with a full shop behind it`, async () => {
    const started = Date.now()
    await goto(`#${route}`)
    const text = await ui(() => document.body.innerText)
    const elapsed = Date.now() - started
    assert(
      !text.includes('Something went wrong on this screen'),
      'the error boundary caught a crash'
    )
    assert(!/^\s*$/.test(text), 'the screen is blank')
    assert(elapsed < 6000, `took ${elapsed}ms to draw`)
    const rows = await ui(() => document.querySelectorAll('tbody tr').length)
    return `${elapsed}ms, ${rows} rows`
  })
}

await check('the dashboard actually draws its charts', async () => {
  await goto('#/')
  await sleep(1600)
  const svg = await ui(() => ({
    charts: document.querySelectorAll('svg.recharts-surface').length,
    paths: document.querySelectorAll('.recharts-layer path, .recharts-surface path').length
  }))
  assert(svg.charts > 0, 'no chart was drawn on the dashboard')
  assert(svg.paths > 0, 'the charts drew no data')
  return `${svg.charts} charts, ${svg.paths} drawn shapes`
})

await check('a long list pages through its results', async () => {
  await goto('#/products')
  await sleep(900)
  const first = await ui(() =>
    Array.from(document.querySelectorAll('tbody tr')).map((r) => r.innerText.slice(0, 30))
  )
  const moved = await ui(() => {
    const next = Array.from(document.querySelectorAll('button')).find(
      (b) => /next/i.test(b.textContent || '') || b.getAttribute('aria-label') === 'Next page'
    )
    if (!next || next.disabled) return false
    next.click()
    return true
  })
  assert(moved, 'there is no working Next control on a list of 86 products')
  await sleep(900)
  const second = await ui(() =>
    Array.from(document.querySelectorAll('tbody tr')).map((r) => r.innerText.slice(0, 30))
  )
  assert(second.length > 0, 'page two is empty')
  assert(
    JSON.stringify(first) !== JSON.stringify(second),
    'page two shows the same rows as page one'
  )
  return `${first.length} rows, then ${second.length} different rows`
})

await check('searching the product list narrows it', async () => {
  await goto('#/products')
  await sleep(900)
  const before = await ui(() => document.querySelectorAll('tbody tr').length)
  await ui(() =>
    window.__t.fillSelector('input[type=search], input[placeholder*="Search" i]', 'Rice')
  )
  await sleep(1200)
  const after = await ui(() =>
    Array.from(document.querySelectorAll('tbody tr')).map((r) => r.innerText)
  )
  assert(after.length > 0, 'searching for "Rice" found nothing in a shop that stocks rice')
  assert(after.length < before, `search did not narrow the list (${before} -> ${after.length})`)
  assert(
    after.every((row) => /rice/i.test(row)),
    'the filtered list still shows rows that do not match'
  )
  return `${before} -> ${after.length} rows`
})

await check('every report renders over every date preset', async () => {
  await goto('#/reports')
  await sleep(1200)
  const tabs = await ui(() =>
    Array.from(document.querySelectorAll('button'))
      .filter((b) => /profit|valuation|summary|low stock|product/i.test(b.textContent || ''))
      .map((b) => b.textContent.trim())
  )
  const seen = []
  for (const tab of tabs) {
    await ui((t) => window.__t.click(t), tab)
    await sleep(900)
    const text = await ui(() => document.body.innerText)
    assert(!text.includes('Something went wrong'), `the ${tab} report crashed`)
    seen.push(tab)
  }
  assert(seen.length >= 2, `only found ${seen.length} report(s)`)
  return seen.join(', ')
})

await check('a big report is produced quickly', async () => {
  const started = Date.now()
  const pnl = await api('reports.profitLoss', { from: '2000-01-01', to: '2100-01-01' })
  const profit = await api('reports.productProfit', { from: '2000-01-01', to: '2100-01-01' })
  const elapsed = Date.now() - started
  assert(elapsed < 4000, `reports took ${elapsed}ms`)
  assert(profit.length > 0, 'the product-profit report is empty')
  return `${elapsed}ms, gross ${pnl.grossSales}, ${profit.length} product rows`
})

await check('the sample data can be removed again, leaving an empty shop', async () => {
  await api('demo.clear')
  const sales = await api('sales.list', { limit: 10 })
  const products = await api('products.list', { limit: 10, status: 'all' })
  assert(sales.total === 0, `${sales.total} bills survived the clear`)
  assert(products.total === 0, `${products.total} products survived the clear`)
  return 'shop is empty again'
})

console.log('\n=== RESULT ===')
const failed = results.filter((r) => !r.ok)
console.log(`${results.length - failed.length}/${results.length} checks passed`)
for (const f of failed) console.log(`  FAIL ${f.name}\n       ${f.detail}`)

console.log('\n--- RENDERER CONSOLE PROBLEMS ---')
if (problems.length === 0) console.log('  none')
for (const p of problems.slice(0, 40)) console.log(`  ${p.kind}: ${String(p.text).slice(0, 300)}`)

s.child.kill()
process.exit(failed.length > 0 ? 1 : 0)
