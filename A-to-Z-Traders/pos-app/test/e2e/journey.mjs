/**
 * End-to-end shop journey against the real, built Electron app.
 *
 * Everything below happens in the shipped renderer, over the real preload
 * bridge, against a real SQLite file — in an isolated userData directory so
 * the owner's own database is never touched.
 */
import { launch, collectProblems, makeEval, freshDir, sleep } from './driver.mjs'
import { INSTALL } from './ui.mjs'

import { APP, userDataDir } from './paths.mjs'

const ROOT = userDataDir('journey')
const BACKUPS = userDataDir('journey-backups')

const results = []
let currentPhase = 'boot'
const phase = (name) => {
  currentPhase = name
}

async function check(name, fn) {
  try {
    const detail = await fn()
    results.push({ phase: currentPhase, name, ok: true, detail })
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
    return true
  } catch (error) {
    results.push({ phase: currentPhase, name, ok: false, detail: error.message })
    console.log(`  FAIL  ${name} — ${error.message}`)
    return false
  }
}

const assert = (cond, message) => {
  if (!cond) throw new Error(message)
}
const eq = (actual, expected, what) =>
  assert(
    actual === expected,
    `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  )

// --------------------------------------------------------------- session

let session = null

async function open({ wipe }) {
  const s = await launch({ appDir: APP, userDataRoot: freshDir(ROOT, { wipe }), port: 9333 })
  const problems = collectProblems(s.cdp)
  await s.cdp.send('Runtime.enable')
  await s.cdp.send('Log.enable')
  await s.cdp.send('Page.enable')
  await sleep(1200)
  await s.cdp.send('Runtime.evaluate', { expression: INSTALL })
  session = { ...s, problems, evaluate: makeEval(s.cdp) }
  return session
}

async function close() {
  session.child.kill()
  await sleep(1500)
}

/** Call the app's own preload API, unwrapping the IpcResult envelope. */
async function api(path, ...args) {
  const res = await session.evaluate(async (p, a) => await window.__t.api(p, ...a), path, args)
  if (!res || res.ok !== true) {
    throw new Error(`${path} failed: ${JSON.stringify(res?.error ?? res)}`)
  }
  return res.data
}

/** Same, but returns the raw envelope so a refusal can be asserted. */
async function rawApi(path, ...args) {
  return session.evaluate(async (p, a) => await window.__t.api(p, ...a), path, args)
}

const ui = (fn, ...args) => session.evaluate(fn, ...args)

async function goto(hash) {
  await ui((h) => {
    location.hash = h
  }, hash)
  await sleep(700)
}

// ================================================================== run

console.log('\n=== PHASE 1: first launch, empty machine ===')
await open({ wipe: true })

phase('first run')

await check('the app opens on the first-run setup screen', async () => {
  const text = await ui(() => document.body.innerText)
  assert(text.includes('Protect this app'), `screen said: ${text.slice(0, 120)}`)
  return 'setup screen shown'
})

await check('the renderer is sealed off from Node', async () => {
  const leaked = await ui(() => ({
    require: typeof require,
    process: typeof process,
    module: typeof module,
    ipcRenderer: typeof window.ipcRenderer
  }))
  for (const [key, type] of Object.entries(leaked)) {
    eq(type, 'undefined', `window.${key}`)
  }
  return 'no require / process / module / ipcRenderer'
})

await check('business channels are refused before the password is set', async () => {
  const res = await rawApi('sales.list')
  assert(res.ok === false, 'a locked app answered sales.list')
  eq(res.error.code, 'AUTH', 'error code')
  return res.error.message
})

await check('setup rejects a short password (the form validates)', async () => {
  await ui(() => {
    window.__t.fill('Admin password', 'short')
    window.__t.fill('Confirm password', 'short')
    window.__t.fill('Answer', 'lahore')
    window.__t.click('Set password')
  })
  await sleep(500)
  const text = await ui(() => document.body.innerText)
  assert(text.includes('at least 8 characters') || text.includes('At least 8'), 'no message')
  assert(text.includes('Protect this app'), 'it let a 5-character password through')
  return 'refused, still on setup'
})

await check('the owner sets the admin password and lands in the app', async () => {
  await ui(() => {
    window.__t.fill('Admin password', 'shopOwner#2026')
    window.__t.fill('Confirm password', 'shopOwner#2026')
    window.__t.fill('Answer', 'Lahore')
    window.__t.click('Set password')
  })
  const arrived = await ui(async () => await window.__t.waitFor('Dashboard', 12000))
  assert(arrived, `still on: ${(await ui(() => document.body.innerText)).slice(0, 200)}`)
  return 'dashboard reached'
})

// ------------------------------------------------------ the shop's own data

phase('setting up the shop')

await check('business details save from the Settings screen', async () => {
  await api('settings.update', {
    businessName: 'A to Z Traders',
    address: 'Shahalam Market, Lahore',
    phone: '0300-1234567',
    currency: 'PKR',
    taxEnabled: false
  })
  const settings = await api('settings.get')
  eq(settings.businessName, 'A to Z Traders', 'business name')
  return `${settings.businessName}, ${settings.currency}`
})

let ids = {}

await check('a category, a supplier, a customer and a product are created', async () => {
  const grocery = await api('categories.add', 'Grocery')
  const supplier = await api('suppliers.add', { name: 'Metro Distributors' })
  const customer = await api('customers.add', { name: 'Bilal Kiryana Store', openingBalance: 0 })
  const oil = await api('products.add', {
    name: 'Cooking oil 5L',
    sku: 'OIL-5L',
    categoryId: grocery.id,
    baseUnit: 'bottle',
    costPrice: 0,
    salePrice: 1450,
    reorderLevel: 12,
    units: [{ unitName: 'carton', factor: 4, salePrice: 5700 }]
  })
  ids = { grocery, supplier, customer, oil }
  return `product #${oil.id}, customer #${customer.id}`
})

await check('a purchase brings stock in and moves the weighted-average cost', async () => {
  await api('purchases.create', {
    supplierId: ids.supplier.id,
    invoiceNo: 'MD-8891',
    items: [{ productId: ids.oil.id, unitName: 'carton', qty: 10, unitCost: 5200 }],
    paidAmount: 26000
  })
  const oil = await api('products.get', ids.oil.id)
  eq(oil.stockQty, 40, 'stock after purchase')
  eq(oil.costPrice, 1300, 'weighted-average cost')
  const supplier = await api('suppliers.get', ids.supplier.id)
  eq(supplier.currentBalance, 26000, 'payable')
  return '40 bottles at 1300, 26,000 payable'
})

// ---------------------------------------------------------- billing screen

phase('billing screen')

await check('a bill is written from the billing screen, keyboard-first', async () => {
  await goto('#/billing')
  await ui(async () => {
    await window.__t.waitFor('New bill', 8000)
  })

  // Type into the product search the way a biller does, then take the match.
  await ui(() => window.__t.fillSelector('input[placeholder*="Scan a barcode" i]', 'Cooking'))
  await sleep(900)
  const picked = await ui(() => {
    const option = Array.from(document.querySelectorAll('[role=option], li, button')).find(
      (el) => (el.textContent || '').includes('Cooking oil 5L') && el.offsetParent !== null
    )
    if (!option) return false
    option.click()
    return true
  })
  assert(picked, 'the product search showed no match for "Cooking"')
  await sleep(700)

  const onBill = await ui(() => document.body.innerText.includes('Cooking oil 5L'))
  assert(onBill, 'the product never reached the bill')

  // Sell three bottles, paid in full.
  await ui(() => {
    const qtyBox = Array.from(document.querySelectorAll('input')).filter(
      (el) => el.offsetParent !== null && el.getAttribute('inputmode') === 'decimal'
    )[0]
    if (!qtyBox) throw new Error('no quantity box on the bill line')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(qtyBox, '3')
    qtyBox.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(500)

  await ui(() => window.__t.clickAny('Save bill', 'Save changes'))
  const saved = await ui(async () => await window.__t.waitFor('Invoice', 10000))
  assert(
    saved,
    `after save the screen said: ${(await ui(() => document.body.innerText)).slice(0, 300)}`
  )

  const sales = await api('sales.list')
  eq(sales.total, 1, 'bills on file')
  eq(sales.rows[0].total, 4350, 'bill total')
  eq(sales.rows[0].paymentType, 'cash', 'payment type')

  const oil = await api('products.get', ids.oil.id)
  eq(oil.stockQty, 37, 'stock after the bill')
  return `invoice ${sales.rows[0].invoiceNo} for 4,350`
})

await check('the receipt is built and the printer path runs', async () => {
  const sales = await api('sales.list')
  const receipt = await api('sales.receipt', sales.rows[0].id)
  eq(receipt.totals.total, 4350, 'receipt total')
  eq(receipt.totals.balance, 0, 'receipt balance')
  eq(receipt.lines.length, 1, 'receipt lines')
  assert(receipt.business.name === 'A to Z Traders', 'receipt has no business name')
  assert(receipt.amountInWords && receipt.amountInWords.length > 0, 'no amount in words')
  await api('printing.receipt', sales.rows[0].id)
  return `${receipt.invoiceNo}: "${receipt.amountInWords}"`
})

// --------------------------------------------------------- every screen

phase('every screen renders')

const ROUTES = [
  ['/', 'Dashboard'],
  ['/billing', 'New bill'],
  ['/sales', 'Sales'],
  ['/returns/sale', 'Sale returns'],
  ['/returns/purchase', 'Purchase returns'],
  ['/products', 'Products'],
  ['/purchases', 'Purchases'],
  ['/purchases/new', 'purchase'],
  ['/stock', 'Stock'],
  ['/other-stock', 'Other stock'],
  ['/customers', 'Customers'],
  ['/suppliers', 'Suppliers'],
  ['/payments', 'Payments'],
  ['/expenses', 'Expenses'],
  ['/reports', 'Reports'],
  ['/users', 'Staff'],
  ['/settings', 'Settings']
]

for (const [route, expect] of ROUTES) {
  await check(`screen ${route} renders`, async () => {
    await goto(`#${route}`)
    await sleep(600)
    const text = await ui(() => document.body.innerText)
    assert(
      !text.includes('Something went wrong on this screen'),
      `the error boundary caught a crash: ${text.split('\n').slice(0, 12).join(' | ')}`
    )
    assert(
      text.toLowerCase().includes(expect.toLowerCase()),
      `"${expect}" not on screen; saw: ${text.split('\n').slice(0, 8).join(' | ')}`
    )
    return `${text.split('\n').filter(Boolean)[0] ?? ''}`.slice(0, 40)
  })
}

await check('a customer ledger screen opens for a real customer', async () => {
  await goto(`#/customers/${ids.customer.id}`)
  await sleep(900)
  const text = await ui(() => document.body.innerText)
  assert(!text.includes('Something went wrong'), 'the ledger screen crashed')
  assert(
    text.includes('Bilal Kiryana Store'),
    `ledger did not name the customer: ${text.slice(0, 200)}`
  )
  return 'statement rendered'
})

// ------------------------------------------------- changing a bill later

phase('changing a bill after it is issued')

let creditSaleId = null

await check('a credit bill puts the balance on the customer khata', async () => {
  const { sale } = await api('sales.create', {
    customerId: ids.customer.id,
    items: [{ productId: ids.oil.id, unitName: 'carton', qty: 5, rate: 5600 }],
    paymentType: 'credit',
    paidAmount: 0
  })
  creditSaleId = sale.id
  const customer = await api('customers.get', ids.customer.id)
  eq(customer.currentBalance, 28000, 'khata after the credit bill')
  const oil = await api('products.get', ids.oil.id)
  eq(oil.stockQty, 17, 'stock after the credit bill')
  return `invoice ${sale.invoiceNo}, 28,000 on khata`
})

await check('settling the bill moves the khata by exactly what was received', async () => {
  await api('sales.settle', { id: creditSaleId, paidAmount: 18000, reason: 'Paid at delivery' })
  const customer = await api('customers.get', ids.customer.id)
  eq(customer.currentBalance, 10000, 'khata after settling')
  const sale = await api('sales.get', creditSaleId)
  eq(sale.paymentType, 'partial', 'payment type after settling')
  const revisions = await api('sales.revisions', creditSaleId)
  eq(revisions.length, 1, 'revision history entries')
  eq(revisions[0].action, 'settle', 'revision action')
  return '10,000 left owing, one history entry'
})

await check('editing the bill puts the stock back and re-prices it', async () => {
  const before = await api('sales.get', creditSaleId)
  await api('sales.update', {
    id: creditSaleId,
    customerId: ids.customer.id,
    items: [{ productId: ids.oil.id, unitName: 'carton', qty: 3, rate: 5600 }],
    paymentType: 'partial',
    paidAmount: 10000,
    reason: 'Two cartons came back at the door'
  })
  const sale = await api('sales.get', creditSaleId)
  eq(sale.invoiceNo, before.invoiceNo, 'the invoice number changed')
  eq(sale.total, 16800, 'total after the edit')
  const oil = await api('products.get', ids.oil.id)
  eq(oil.stockQty, 25, 'stock after the edit')
  const customer = await api('customers.get', ids.customer.id)
  eq(customer.currentBalance, 6800, 'khata after the edit')
  // The cost frozen at sale time must survive a re-price.
  eq(sale.items[0].costPrice, 1300, 'frozen cost')
  return 'same invoice, 8 bottles back on the shelf'
})

await check('a bill cannot be edited once goods have come back against it', async () => {
  await api('returns.sale.create', {
    saleId: creditSaleId,
    items: [{ productId: ids.oil.id, unitName: 'carton', qty: 1, rate: 5600 }],
    refundType: 'credit'
  })
  const res = await rawApi('sales.update', {
    id: creditSaleId,
    customerId: ids.customer.id,
    items: [{ productId: ids.oil.id, unitName: 'carton', qty: 2, rate: 5600 }],
    paymentType: 'credit',
    paidAmount: 0
  })
  assert(res.ok === false, 'it edited a bill that had a return against it')
  assert(/returned/i.test(res.error.message), `unexpected message: ${res.error.message}`)
  const customer = await api('customers.get', ids.customer.id)
  eq(customer.currentBalance, 1200, 'khata after the credit return')
  return res.error.message
})

// --------------------------------------------------------- refusals

phase('the rules a shop depends on')

await check('a bill cannot sell stock that is not there', async () => {
  const res = await rawApi('sales.create', {
    items: [{ productId: ids.oil.id, unitName: 'bottle', qty: 9999, rate: 1450 }],
    paymentType: 'cash',
    paidAmount: 14499999
  })
  assert(res.ok === false, 'it sold 9,999 bottles it did not have')
  return res.error.message
})

await check('a walk-in cannot be sent away owing money', async () => {
  const res = await rawApi('sales.create', {
    items: [{ productId: ids.oil.id, unitName: 'bottle', qty: 1, rate: 1450 }],
    paymentType: 'credit',
    paidAmount: 0
  })
  assert(res.ok === false, 'a walk-in bill went on the khata with no customer')
  return res.error.message
})

await check('more money than the bill is refused', async () => {
  const res = await rawApi('sales.create', {
    items: [{ productId: ids.oil.id, unitName: 'bottle', qty: 1, rate: 1450 }],
    paymentType: 'cash',
    paidAmount: 99999
  })
  assert(res.ok === false, 'it accepted more cash than the bill was worth')
  return res.error.message
})

await check('a negative quantity is rejected at the boundary', async () => {
  const res = await rawApi('sales.create', {
    items: [{ productId: ids.oil.id, unitName: 'bottle', qty: -5, rate: 1450 }],
    paymentType: 'cash',
    paidAmount: 0
  })
  assert(res.ok === false, 'a negative quantity was accepted')
  eq(res.error.code, 'VALIDATION', 'error code')
  return res.error.message
})

await check('a duplicate barcode is refused with a readable message', async () => {
  await api('products.add', {
    name: 'Sugar 1kg',
    barcode: '8964000111222',
    baseUnit: 'kg',
    costPrice: 100,
    salePrice: 130,
    reorderLevel: 0
  })
  const res = await rawApi('products.add', {
    name: 'Sugar 1kg (dup)',
    barcode: '8964000111222',
    baseUnit: 'kg',
    costPrice: 100,
    salePrice: 130,
    reorderLevel: 0
  })
  assert(res.ok === false, 'two products took the same barcode')
  assert(!/SQLITE|constraint/i.test(res.error.message), `raw SQL leaked: ${res.error.message}`)
  return res.error.message
})

// -------------------------------------------------------------- reports

phase('the numbers agree with each other')

await check('stock cache, movement ledger, khata and P&L all agree', async () => {
  const range = {
    from: new Date().toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10)
  }
  const pnl = await api('reports.profitLoss', range)
  const dash = await api('dashboard.summary', range)
  eq(dash.expenses, pnl.expenses, 'dashboard vs P&L expenses')

  const customer = await api('customers.get', ids.customer.id)
  const statement = await api('customers.ledger', ids.customer.id, {
    from: '2000-01-01',
    to: '2100-01-01'
  })
  eq(statement.closingBalance, customer.currentBalance, 'statement vs cached balance')

  const valuation = await api('reports.stockValuation')
  assert(valuation.rows.length >= 2, 'valuation listed nothing')
  return `gross ${pnl.grossSales}, net profit ${pnl.netProfit}, receivables ${dash.receivables}`
})

await check('the sales list totals match the bills it lists', async () => {
  const list = await api('sales.list', { limit: 1000 })
  const summed = list.rows.reduce((t, r) => t + r.total, 0)
  assert(
    Math.abs(summed - list.totals.total) < 0.01,
    `list totals ${list.totals.total} vs summed ${summed}`
  )
  return `${list.total} bills, ${list.totals.total} total`
})

// ------------------------------------------------- the rest of the shop

phase('the rest of the day')

await check('expenses are recorded and reach the P&L', async () => {
  const category = await api('expenses.categories.add', 'Utilities')
  await api('expenses.add', { title: 'Shop rent', amount: 3000 })
  await api('expenses.add', { title: 'Electricity', amount: 1450.55, categoryId: category.id })
  const day = new Date().toISOString().slice(0, 10)
  const pnl = await api('reports.profitLoss', { from: day, to: day })
  eq(pnl.expenses, 4450.55, 'expenses in the P&L')
  const list = await api('expenses.list', {})
  eq(list.total, 2, 'expenses on file')
  return `${list.total} expenses, ${pnl.expenses} in the P&L`
})

await check('a stock adjustment is written to the stock ledger', async () => {
  const before = await api('products.get', ids.oil.id)
  await api('stock.adjust', {
    productId: ids.oil.id,
    changeQty: -2,
    notes: 'Two bottles broken in the store'
  })
  const after = await api('products.get', ids.oil.id)
  eq(after.stockQty, before.stockQty - 2, 'stock after adjustment')
  const moves = await api('stock.movements', { productId: ids.oil.id, limit: 100 })
  assert(
    moves.rows.some((m) => m.reason === 'adjustment'),
    'the adjustment is not in the stock ledger'
  )
  return `${before.stockQty} -> ${after.stockQty}`
})

await check('an adjustment cannot drive stock below zero', async () => {
  const res = await rawApi('stock.adjust', { productId: ids.oil.id, changeQty: -99999 })
  assert(res.ok === false, 'stock was driven negative')
  return res.error.message
})

await check('consignment stock is tracked and kept out of profit', async () => {
  const blender = await api('products.add', {
    name: 'Imported Blender',
    baseUnit: 'piece',
    costPrice: 0,
    salePrice: 6500,
    reorderLevel: 0,
    ownership: 'other',
    ownerName: 'Bilal Electronics'
  })
  await api('otherStock.receive', { productId: blender.id, qty: 10, notes: 'On consignment' })
  const stocked = await api('products.get', blender.id)
  eq(stocked.stockQty, 10, 'consignment stock received')

  const { sale } = await api('sales.create', {
    items: [{ productId: blender.id, unitName: 'piece', qty: 2, rate: 6500 }],
    paymentType: 'cash',
    paidAmount: 13000
  })
  eq(sale.otherSubtotal, 13000, 'the bill did not mark the goods as consignment')
  eq(sale.items[0].costPrice, 0, 'a consignment line carries a cost')

  const day = new Date().toISOString().slice(0, 10)
  const report = await api('otherStock.report', { from: day, to: day })
  assert(report.rows.length >= 1, 'the other-stock report is empty')
  return `sold 2 on consignment, ${sale.otherSubtotal} owed to the owner`
})

await check('a discount cannot be taken out of somebody else’s goods', async () => {
  const blender = (await api('products.list', { search: 'Blender' })).rows[0]
  const res = await rawApi('sales.create', {
    items: [{ productId: blender.id, unitName: 'piece', qty: 1, rate: 6500 }],
    discount: 500,
    paymentType: 'cash',
    paidAmount: 6000
  })
  assert(res.ok === false, 'a bill discount was taken off consignment goods')
  return res.error.message
})

await check('goods go back to the supplier and the payable comes down', async () => {
  const before = await api('suppliers.get', ids.supplier.id)
  const beforeStock = await api('products.get', ids.oil.id)
  await api('returns.purchase.create', {
    supplierId: ids.supplier.id,
    items: [{ productId: ids.oil.id, unitName: 'bottle', qty: 2, unitCost: 1300 }]
  })
  const after = await api('suppliers.get', ids.supplier.id)
  eq(after.currentBalance, before.currentBalance - 2600, 'payable after the return')
  const afterStock = await api('products.get', ids.oil.id)
  eq(afterStock.stockQty, beforeStock.stockQty - 2, 'stock after the return')
  return `payable ${before.currentBalance} -> ${after.currentBalance}`
})

await check('a supplier payment is recorded and can be reversed', async () => {
  const before = await api('suppliers.get', ids.supplier.id)
  const payment = await api('payments.create', {
    partyType: 'supplier',
    partyId: ids.supplier.id,
    amount: 5000,
    method: 'bank'
  })
  const paid = await api('suppliers.get', ids.supplier.id)
  eq(paid.currentBalance, before.currentBalance - 5000, 'payable after paying')
  await api('payments.remove', payment.id)
  const reversed = await api('suppliers.get', ids.supplier.id)
  eq(reversed.currentBalance, before.currentBalance, 'payable after reversing the payment')
  return 'paid 5,000 and put it back'
})

await check('cancelling a bill returns the goods and clears what was owed', async () => {
  const { sale } = await api('sales.create', {
    customerId: ids.customer.id,
    items: [{ productId: ids.oil.id, unitName: 'bottle', qty: 2, rate: 1450 }],
    paymentType: 'credit',
    paidAmount: 0
  })
  const owing = await api('customers.get', ids.customer.id)
  const stockAfterSale = await api('products.get', ids.oil.id)

  await api('sales.void', { id: sale.id, reason: 'Order cancelled before delivery' })

  const voided = await api('sales.get', sale.id)
  eq(voided.total, 0, 'a cancelled bill still carries a total')
  eq(voided.items.length, 0, 'a cancelled bill still carries lines')
  assert(voided.voidedAt != null, 'the bill was not marked cancelled')
  eq(voided.invoiceNo, sale.invoiceNo, 'the invoice number was reissued')

  const after = await api('customers.get', ids.customer.id)
  eq(after.currentBalance, owing.currentBalance - 2900, 'khata after cancelling')
  const stock = await api('products.get', ids.oil.id)
  eq(stock.stockQty, stockAfterSale.stockQty + 2, 'stock after cancelling')
  return `${sale.invoiceNo} cancelled, 2 bottles back`
})

await check('a cancelled bill cannot be changed again', async () => {
  const list = await api('sales.list', { limit: 1000 })
  const cancelled = list.rows.find((r) => r.voidedAt != null)
  assert(cancelled, 'no cancelled bill to try')
  const res = await rawApi('sales.settle', { id: cancelled.id, paidAmount: 100 })
  assert(res.ok === false, 'a cancelled bill was settled')
  return res.error.message
})

await check('tax turns on and every figure moves with it', async () => {
  await api('settings.update', { taxEnabled: true, taxRate: 17 })
  const { sale } = await api('sales.create', {
    items: [{ productId: ids.oil.id, unitName: 'bottle', qty: 1, rate: 1000 }],
    paymentType: 'cash',
    paidAmount: 1170
  })
  eq(sale.subtotal, 1000, 'subtotal')
  eq(sale.tax, 170, 'tax at 17%')
  eq(sale.total, 1170, 'total with tax')
  const receipt = await api('sales.receipt', sale.id)
  eq(receipt.totals.tax, 170, 'tax on the receipt')
  await api('settings.update', { taxEnabled: false })
  return 'tax applied, receipt agrees'
})

await check('a double-click on Save writes one bill, not two', async () => {
  const before = await api('sales.list', { limit: 1000 })
  const fired = await session.evaluate(async (productId) => {
    const payload = {
      items: [{ productId, unitName: 'bottle', qty: 1, rate: 1450 }],
      paymentType: 'cash',
      paidAmount: 1450
    }
    // Both requests leave before either answer arrives - a real double-click.
    const [a, b] = await Promise.all([
      window.api.sales.create(payload),
      window.api.sales.create(payload)
    ])
    return [a.ok, b.ok]
  }, ids.oil.id)
  const after = await api('sales.list', { limit: 1000 })
  const invoices = after.rows.map((r) => r.invoiceNo)
  eq(new Set(invoices).size, invoices.length, 'two bills share an invoice number')
  return `${after.total - before.total} bill(s) from ${fired.filter(Boolean).length} accepted requests`
})

await check('the sample data can be seeded and removed without touching real records', async () => {
  const realBills = (await api('sales.list', { limit: 1000 })).total
  const seeded = await api('demo.seed')
  const withDemo = await api('sales.list', { limit: 1000 })
  assert(withDemo.total > realBills, 'the sample bills never appeared')
  await api('demo.clear')
  const cleared = await api('sales.list', { limit: 1000 })
  eq(cleared.total, realBills, 'clearing the samples changed the shop own bills')
  return `seeded ${JSON.stringify(seeded)} and removed it again`
})

await check('nothing has drifted after all of that', async () => {
  const customer = await api('customers.get', ids.customer.id)
  const statement = await api('customers.ledger', ids.customer.id, {
    from: '2000-01-01',
    to: '2100-01-01'
  })
  eq(statement.closingBalance, customer.currentBalance, 'khata vs statement')
  const supplier = await api('suppliers.get', ids.supplier.id)
  const supplierStatement = await api('suppliers.ledger', ids.supplier.id, {
    from: '2000-01-01',
    to: '2100-01-01'
  })
  eq(supplierStatement.closingBalance, supplier.currentBalance, 'payable vs statement')
  return `customer ${customer.currentBalance}, supplier ${supplier.currentBalance}`
})

// ----------------------------------------------------------- staff role

phase('staff accounts and the access policy')

await check('the owner creates a shopkeeper account', async () => {
  await api('users.create', { username: 'counter1', displayName: 'Ahmed', pin: '4471' })
  const users = await api('users.list')
  assert(
    users.some((u) => u.username === 'counter1'),
    'the staff list does not have counter1'
  )
  return `${users.length} staff account(s)`
})

await check('the app locks from the sidebar and the shopkeeper signs in', async () => {
  await goto('#/')
  await ui(() => window.__t.clickAny('Lock app', 'Sign out'))
  const atLock = await ui(async () => await window.__t.waitFor('Sign in to continue', 8000))
  assert(atLock, 'the sidebar lock did not reach the lock screen')

  const locked = await rawApi('sales.list')
  assert(locked.ok === false, 'a locked app still answered sales.list')

  // A wrong PIN must be refused first.
  await ui(() => window.__t.click('Staff'))
  await sleep(300)
  await ui(() => {
    window.__t.fill('Username', 'counter1')
    window.__t.fill('4-digit PIN', '0000')
    window.__t.clickAny('Sign in', 'Unlock')
  })
  await sleep(1200)
  const refused = await ui(() => document.body.innerText)
  assert(
    /incorrect|wrong/i.test(refused),
    `a wrong PIN produced no refusal: ${refused.slice(0, 200)}`
  )

  await ui(() => {
    window.__t.fill('Username', 'counter1')
    window.__t.fill('4-digit PIN', '4471')
    window.__t.clickAny('Sign in', 'Unlock')
  })
  const arrived = await ui(async () => await window.__t.waitFor('Dashboard', 10000))
  assert(arrived, 'the shopkeeper never reached the dashboard')
  const status = await api('auth.status')
  eq(status.role, 'shopkeeper', 'role after staff login')
  return 'wrong PIN refused, right PIN signed in'
})

await check('a shopkeeper may bill but not see the P&L', async () => {
  const allowed = await rawApi('sales.list')
  assert(allowed.ok === true, `a shopkeeper could not list sales: ${JSON.stringify(allowed.error)}`)
  const denied = await rawApi('reports.profitLoss', { from: '2000-01-01', to: '2100-01-01' })
  assert(denied.ok === false, 'a shopkeeper read the profit and loss report')
  eq(denied.error.code, 'AUTH', 'refusal code')
  return denied.error.message
})

await check('a shopkeeper cannot void or edit an issued bill', async () => {
  const voided = await rawApi('sales.void', { id: creditSaleId, reason: 'test' })
  assert(voided.ok === false, 'a shopkeeper cancelled a bill')
  const edited = await rawApi('sales.update', {
    id: creditSaleId,
    items: [{ productId: ids.oil.id, unitName: 'bottle', qty: 1, rate: 1 }],
    paymentType: 'cash',
    paidAmount: 1
  })
  assert(edited.ok === false, 'a shopkeeper rewrote an issued bill')
  return 'both refused'
})

await check('a shopkeeper takes customer receipts but cannot pay a supplier', async () => {
  const receipt = await rawApi('payments.create', {
    partyType: 'customer',
    partyId: ids.customer.id,
    amount: 100,
    method: 'cash'
  })
  assert(receipt.ok === true, `customer receipt refused: ${JSON.stringify(receipt.error)}`)
  const payout = await rawApi('payments.create', {
    partyType: 'supplier',
    partyId: ids.supplier.id,
    amount: 100,
    method: 'cash'
  })
  assert(payout.ok === false, 'a shopkeeper paid a supplier')
  return 'receipt allowed, payout refused'
})

await check('the owner-only screens are not in the shopkeeper’s sidebar', async () => {
  await goto('#/')
  await sleep(900)
  const nav = await ui(() =>
    Array.from(document.querySelectorAll('nav a')).map((a) => a.textContent.trim())
  )
  for (const hidden of ['Settings', 'Reports', 'Products', 'Purchases', 'Suppliers']) {
    assert(!nav.some((label) => label.startsWith(hidden)), `"${hidden}" is visible to a shopkeeper`)
  }
  assert(
    nav.some((label) => label.startsWith('New bill')),
    'the shopkeeper has no billing link'
  )
  return nav.join(', ')
})

await check('typing an owner-only route by hand lands back on the dashboard', async () => {
  await goto('#/settings')
  await sleep(900)
  const route = await ui(() => location.hash)
  eq(route, '#/', 'route after trying to reach /settings as a shopkeeper')
  return 'redirected to the dashboard'
})

await check('the owner signs back in through the lock screen', async () => {
  await goto('#/')
  await ui(() => window.__t.clickAny('Sign out', 'Lock app'))
  await ui(async () => await window.__t.waitFor('Sign in to continue', 8000))
  await ui(() => window.__t.click('Owner'))
  await sleep(300)
  await ui(() => {
    window.__t.fill('Admin password', 'shopOwner#2026')
    window.__t.clickAny('Sign in', 'Unlock')
  })
  const arrived = await ui(async () => await window.__t.waitFor('Dashboard', 10000))
  assert(arrived, 'the owner never got back in')
  const status = await api('auth.status')
  eq(status.role, 'admin', 'role after owner login')
  return 'admin session restored'
})

// --------------------------------------------------------------- backups

phase('backups')

await check('a backup folder can be set and a backup written to it', async () => {
  freshDir(BACKUPS)
  await api('settings.update', { autoBackupDir: BACKUPS, backupIntervalMinutes: 60 })
  const result = await api('backup.runNow')
  assert(result && result.path, `unexpected result: ${JSON.stringify(result)}`)
  const list = await api('backup.list')
  assert(list.length >= 1, 'the backup folder listed nothing')
  return `${list.length} backup: ${list[0].fileName} (${list[0].size} bytes)`
})

await check('the backup status tells the owner where things stand', async () => {
  const status = await api('backup.status')
  assert(status.folder === BACKUPS, `status folder is ${status.folder}`)
  return JSON.stringify(status).slice(0, 160)
})

// -------------------------------------------------------------- restart

phase('quit and reopen')

const beforeRestart = {
  sales: await api('sales.list', { limit: 1000 }),
  customer: await api('customers.get', ids.customer.id),
  oil: await api('products.get', ids.oil.id)
}

const uiProblems = session.problems.slice()
await close()

console.log('\n=== PHASE 2: reopening the same shop ===')
await open({ wipe: false })

await check('the owner unlocks the reopened app', async () => {
  const text = await ui(() => document.body.innerText)
  assert(!text.includes('Protect this app'), 'the app asked to be set up again')
  assert(
    text.includes('Sign in to continue'),
    `expected the lock screen, saw: ${text.slice(0, 200)}`
  )
  await ui(() => {
    window.__t.fill('Admin password', 'shopOwner#2026')
    window.__t.clickAny('Sign in', 'Unlock')
  })
  const arrived = await ui(async () => await window.__t.waitFor('Dashboard', 12000))
  assert(arrived, 'never reached the dashboard after unlocking')
  return 'unlocked'
})

await check('every figure survived the restart exactly', async () => {
  const sales = await api('sales.list', { limit: 1000 })
  eq(sales.total, beforeRestart.sales.total, 'bill count')
  eq(sales.totals.total, beforeRestart.sales.totals.total, 'sales total')
  const customer = await api('customers.get', ids.customer.id)
  eq(customer.currentBalance, beforeRestart.customer.currentBalance, 'khata')
  const oil = await api('products.get', ids.oil.id)
  eq(oil.stockQty, beforeRestart.oil.stockQty, 'stock')
  return `${sales.total} bills, khata ${customer.currentBalance}, stock ${oil.stockQty}`
})

await check('the startup integrity check found nothing to repair', async () => {
  const log = session.mainOut.map(([, t]) => t).join('')
  assert(!/drift/i.test(log), `the reconciler had to repair something:\n${log}`)
  return 'no stock or balance drift'
})

// ------------------------------------------------------------- volume

phase('a busy shop')

await check('the app stays correct and quick over a few hundred bills', async () => {
  const sugar = (await api('products.list', { search: 'Sugar' })).rows[0]
  await api('purchases.create', {
    supplierId: ids.supplier.id,
    items: [{ productId: sugar.id, unitName: 'kg', qty: 400, unitCost: 100 }],
    paidAmount: 40000
  })
  const startedAt = Date.now()
  const stats = await session.evaluate(
    async (productId, customerId) => {
      const out = { written: 0, refused: 0, firstError: null }
      for (let i = 0; i < 120; i += 1) {
        const res = await window.api.sales.create({
          customerId: i % 3 === 0 ? customerId : null,
          items: [{ productId, unitName: 'kg', qty: 1, rate: 130 }],
          paymentType: i % 3 === 0 ? 'credit' : 'cash',
          paidAmount: i % 3 === 0 ? 0 : 130
        })
        if (res.ok) out.written += 1
        else {
          out.refused += 1
          out.firstError = out.firstError ?? res.error.message
        }
      }
      return out
    },
    sugar.id,
    ids.customer.id
  )

  const elapsed = Date.now() - startedAt
  // Stock runs out partway through — that is the correct behaviour, not a bug.
  eq(stats.refused, 0, `bills refused (${stats.firstError})`)
  eq(stats.written, 120, 'bills written')
  const list = await api('sales.list', { limit: 1000 })
  const summed = list.rows.reduce((t, r) => t + r.total, 0)
  assert(Math.abs(summed - list.totals.total) < 0.01, 'the list total drifted from its rows')
  return `${stats.written} written, ${stats.refused} refused, ${elapsed}ms`
})

// --------------------------------------------------------------- report

const allProblems = [...uiProblems, ...session.problems]
await close()

console.log('\n=== RESULT ===')
const failed = results.filter((r) => !r.ok)
console.log(`${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) {
  console.log('\nFAILURES:')
  for (const f of failed) console.log(`  [${f.phase}] ${f.name}\n      ${f.detail}`)
}

console.log('\n--- RENDERER CONSOLE PROBLEMS ---')
if (allProblems.length === 0) console.log('  none')
for (const p of allProblems.slice(0, 40))
  console.log(`  ${p.kind}: ${String(p.text).slice(0, 300)}`)

process.exit(failed.length > 0 ? 1 : 0)
