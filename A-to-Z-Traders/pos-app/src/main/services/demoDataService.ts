import type { DemoClearResult, DemoSeedResult, DemoStatus, DemoTableCount, Id } from '@shared/types'
import { addDays, today } from '@shared/date'
import { money } from '@shared/money'
import type { Db } from '../db/connection'
import { getDb } from '../db/connection'
import { businessRule } from '../utils/errors'
import { logger } from '../utils/logger'
import { computeBalance } from './ledgerService'
import { reconcileStockCache } from './inventoryService'
import { applyBalanceDelta } from '../repositories/partyRepository'
import * as categoryService from './categoryService'
import * as expenseService from './expenseService'
import * as inventoryService from './inventoryService'
import * as otherStockService from './otherStockService'
import * as partyService from './partyService'
import * as paymentService from './paymentService'
import * as productService from './productService'
import * as purchaseService from './purchaseService'
import * as returnService from './returnService'
import * as salesService from './salesService'
import * as userService from './userService'

const log = logger.child('demo')

/**
 * Sample data for trying the app out on real hardware.
 *
 * Two rules shape all of this.
 *
 * **It is written through the real services.** Not straight into SQL. Every
 * bill goes through `createSale`, every purchase through `createPurchase`, so
 * the samples carry the same stock movements, khata entries and frozen costs
 * that genuine trade would — and seeding doubles as a smoke test of the whole
 * write path. Data that skipped the services would look right on screen and be
 * wrong underneath, which is the worst possible sample data.
 *
 * **Every row it creates is written down.** The shop's own records and the
 * samples share one database, so `demo_records` lists what the seeder made and
 * removal works only from that list. Nothing the owner typed is ever in scope,
 * and the seeder is safe to run on a database already in real use.
 */

// ---------------------------------------------------------------- manifest

/**
 * Parents only, in the order they must be removed.
 *
 * Children with ON DELETE CASCADE go with their parent. The order is a real
 * constraint, not a preference: `sale_returns` point at `sales`, `sales` point
 * at `customers`, and SQLite enforces every one of those foreign keys.
 */
const REMOVAL_ORDER = [
  'sale_returns',
  'purchase_returns',
  'sales',
  'purchases',
  'payments',
  'expenses',
  'products',
  'customers',
  'suppliers',
  'categories',
  'expense_categories',
  'staff_users'
] as const

type DemoTable = (typeof REMOVAL_ORDER)[number]

const LABELS: Record<DemoTable, string> = {
  categories: 'Categories',
  expense_categories: 'Expense categories',
  products: 'Products',
  customers: 'Customers',
  suppliers: 'Suppliers',
  purchases: 'Purchases',
  sales: 'Bills',
  sale_returns: 'Sale returns',
  purchase_returns: 'Purchase returns',
  payments: 'Payments',
  expenses: 'Expenses',
  staff_users: 'Staff accounts'
}

/** Reads best top-to-bottom on screen; removal order is the reverse of need. */
const DISPLAY_ORDER: DemoTable[] = [
  'categories',
  'products',
  'customers',
  'suppliers',
  'purchases',
  'sales',
  'sale_returns',
  'purchase_returns',
  'payments',
  'expense_categories',
  'expenses',
  'staff_users'
]

function record(db: Db, table: DemoTable, rowId: Id): void {
  db.prepare('INSERT OR IGNORE INTO demo_records (table_name, row_id) VALUES (?, ?)').run(
    table,
    rowId
  )
}

function idsFor(db: Db, table: DemoTable): number[] {
  return db
    .prepare<[string], { row_id: number }>(
      'SELECT row_id FROM demo_records WHERE table_name = ? ORDER BY row_id'
    )
    .all(table)
    .map((row) => row.row_id)
}

function countsByTable(db: Db): DemoTableCount[] {
  const rows = db
    .prepare<[], { table_name: DemoTable; n: number }>(
      'SELECT table_name, COUNT(*) AS n FROM demo_records GROUP BY table_name'
    )
    .all()

  const found = new Map(rows.map((row) => [row.table_name, row.n]))
  return DISPLAY_ORDER.filter((table) => (found.get(table) ?? 0) > 0).map((table) => ({
    label: LABELS[table],
    count: found.get(table) ?? 0
  }))
}

// ------------------------------------------------------------- the content

/**
 * A small deterministic generator.
 *
 * Seeded rather than `Math.random` so two runs produce the same shop. When a
 * number looks wrong on a report, it has to be possible to reproduce it.
 */
function makeRandom(seed: number): {
  int: (min: number, max: number) => number
  pick: <T>(items: readonly T[]) => T
  chance: (probability: number) => boolean
} {
  let state = seed
  const next = (): number => {
    // Numerical Recipes LCG — small, fast and perfectly adequate for samples.
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296
    return state / 4_294_967_296
  }

  return {
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)] as (typeof items)[number],
    chance: (probability) => next() < probability
  }
}

const CATEGORIES = [
  'Grocery',
  'Cooking oil & ghee',
  'Rice & pulses',
  'Beverages',
  'Household & cleaning',
  'Personal care',
  'Stationery',
  'Hardware'
] as const

const EXPENSE_CATEGORIES = [
  'Rent',
  'Electricity',
  'Salaries',
  'Transport',
  'Packaging',
  'Repairs'
] as const

/** Product name parts, combined into a realistic wholesale catalogue. */
const BRANDS = [
  'Sunrise',
  'Golden',
  'Shahi',
  'Chenab',
  'Malka',
  'Everfresh',
  'Roshan',
  'Nayab',
  'Alfa',
  'Tibet'
] as const

const ITEMS: readonly { name: string; unit: string; cost: number; category: number }[] = [
  { name: 'Cooking Oil 5L', unit: 'bottle', cost: 2400, category: 1 },
  { name: 'Banaspati Ghee 1kg', unit: 'pack', cost: 520, category: 1 },
  { name: 'Basmati Rice 5kg', unit: 'bag', cost: 1750, category: 2 },
  { name: 'Chana Daal 1kg', unit: 'pack', cost: 260, category: 2 },
  { name: 'Masoor Daal 1kg', unit: 'pack', cost: 310, category: 2 },
  { name: 'Sugar 1kg', unit: 'pack', cost: 145, category: 0 },
  { name: 'Tea 950g', unit: 'pack', cost: 1450, category: 3 },
  { name: 'Soft Drink 1.5L', unit: 'bottle', cost: 130, category: 3 },
  { name: 'Mineral Water 1.5L', unit: 'bottle', cost: 55, category: 3 },
  { name: 'Detergent Powder 1kg', unit: 'pack', cost: 330, category: 4 },
  { name: 'Dishwash Bar', unit: 'piece', cost: 45, category: 4 },
  { name: 'Floor Cleaner 1L', unit: 'bottle', cost: 240, category: 4 },
  { name: 'Bath Soap 130g', unit: 'piece', cost: 110, category: 5 },
  { name: 'Shampoo 200ml', unit: 'bottle', cost: 290, category: 5 },
  { name: 'Toothpaste 150g', unit: 'piece', cost: 260, category: 5 },
  { name: 'Notebook 100pg', unit: 'piece', cost: 85, category: 6 },
  { name: 'Ball Pen', unit: 'piece', cost: 22, category: 6 },
  { name: 'A4 Paper Ream', unit: 'ream', cost: 1250, category: 6 },
  { name: 'Insulation Tape', unit: 'piece', cost: 60, category: 7 },
  { name: 'LED Bulb 12W', unit: 'piece', cost: 310, category: 7 }
]

const CUSTOMER_NAMES = [
  'Karim General Store',
  'Bismillah Kiryana',
  'Al-Madina Traders',
  'New Shaheen Store',
  'Rehmat Provision',
  'Chishti Kiryana',
  'Faisal Cash & Carry',
  'Sabir General Store',
  'Zam Zam Mart',
  'Iqbal Brothers',
  'Noor Kiryana',
  'Ittefaq Store',
  'Hilal Provision',
  'Punjab Traders',
  'Ravi Superstore',
  'Ghousia Kiryana',
  'Anwar & Sons',
  'Makkah Store',
  'Sharif Provision',
  'Usman General Store'
] as const

const SUPPLIER_NAMES = [
  'Sultan Distributors',
  'Pak Foods Supply',
  'Crescent Wholesale',
  'Lahore Trading Co',
  'Indus Agencies',
  'Meezan Suppliers',
  'National Distributors',
  'Shalimar Traders'
] as const

const CONSIGNMENT: readonly { name: string; unit: string; price: number; owner: string }[] = [
  { name: 'Imported Blender 400W', unit: 'piece', price: 8500, owner: 'Bilal Electronics' },
  { name: 'Electric Kettle 1.8L', unit: 'piece', price: 4200, owner: 'Bilal Electronics' },
  { name: 'Rechargeable Fan', unit: 'piece', price: 9800, owner: 'Bilal Electronics' },
  { name: 'Handmade Rug 4x6', unit: 'piece', price: 15_000, owner: 'Zainab Textiles' },
  { name: 'Cotton Bedsheet Set', unit: 'piece', price: 4800, owner: 'Zainab Textiles' },
  { name: 'Prayer Mat', unit: 'piece', price: 1600, owner: 'Zainab Textiles' },
  { name: 'Steel Water Cooler', unit: 'piece', price: 12_500, owner: 'Hassan Steel Works' }
]

const PAYMENT_METHODS = ['cash', 'bank', 'cheque', 'online'] as const

/** How far back the sample history reaches. Long enough for every date preset. */
const HISTORY_DAYS = 90

// ---------------------------------------------------------------- seeding

export function demoStatus(): DemoStatus {
  const db = getDb()
  const counts = countsByTable(db)
  const total = counts.reduce((sum, entry) => sum + entry.count, 0)

  const createdAt =
    db
      .prepare<[], { created_at: string }>('SELECT MIN(created_at) AS created_at FROM demo_records')
      .get()?.created_at ?? null

  return {
    present: total > 0,
    counts,
    total,
    createdAt: total > 0 ? createdAt : null,
    blockers: total > 0 ? findBlockers(db) : []
  }
}

/**
 * Real records that have come to depend on sample records.
 *
 * If the owner bills a demo customer or sells a demo product for real, removing
 * the samples would leave their own data pointing at rows that no longer exist.
 * Rather than cascade into the shop's records or leave them dangling, removal
 * stops and says exactly what is in the way.
 */
function findBlockers(db: Db): string[] {
  const checks: { sql: string; describe: (n: number) => string }[] = [
    {
      sql: `SELECT COUNT(*) AS n FROM sales s
             WHERE s.id NOT IN (SELECT row_id FROM demo_records WHERE table_name = 'sales')
               AND s.customer_id IN (SELECT row_id FROM demo_records WHERE table_name = 'customers')`,
      describe: (n) => `${n} of your own bills are made out to a sample customer`
    },
    {
      sql: `SELECT COUNT(DISTINCT si.sale_id) AS n FROM sale_items si
             WHERE si.sale_id NOT IN (SELECT row_id FROM demo_records WHERE table_name = 'sales')
               AND si.product_id IN (SELECT row_id FROM demo_records WHERE table_name = 'products')`,
      describe: (n) => `${n} of your own bills contain a sample product`
    },
    {
      sql: `SELECT COUNT(DISTINCT pi.purchase_id) AS n FROM purchase_items pi
             WHERE pi.purchase_id NOT IN (SELECT row_id FROM demo_records WHERE table_name = 'purchases')
               AND pi.product_id IN (SELECT row_id FROM demo_records WHERE table_name = 'products')`,
      describe: (n) => `${n} of your own purchases contain a sample product`
    },
    {
      sql: `SELECT COUNT(*) AS n FROM purchases p
             WHERE p.id NOT IN (SELECT row_id FROM demo_records WHERE table_name = 'purchases')
               AND p.supplier_id IN (SELECT row_id FROM demo_records WHERE table_name = 'suppliers')`,
      describe: (n) => `${n} of your own purchases are against a sample supplier`
    },
    {
      sql: `SELECT COUNT(*) AS n FROM payments pm
             WHERE pm.id NOT IN (SELECT row_id FROM demo_records WHERE table_name = 'payments')
               AND ((pm.party_type = 'customer'
                     AND pm.party_id IN (SELECT row_id FROM demo_records WHERE table_name = 'customers'))
                 OR (pm.party_type = 'supplier'
                     AND pm.party_id IN (SELECT row_id FROM demo_records WHERE table_name = 'suppliers')))`,
      describe: (n) => `${n} of your own payments are against a sample customer or supplier`
    },
    {
      sql: `SELECT COUNT(*) AS n FROM sale_returns r
             WHERE r.id NOT IN (SELECT row_id FROM demo_records WHERE table_name = 'sale_returns')
               AND (r.sale_id IN (SELECT row_id FROM demo_records WHERE table_name = 'sales')
                 OR r.customer_id IN (SELECT row_id FROM demo_records WHERE table_name = 'customers'))`,
      describe: (n) => `${n} of your own sale returns refer to sample records`
    }
  ]

  const blockers: string[] = []
  for (const check of checks) {
    const n = db.prepare<[], { n: number }>(check.sql).get()?.n ?? 0
    if (n > 0) blockers.push(check.describe(n))
  }
  return blockers
}

/** A date `daysAgo` before today, as `YYYY-MM-DD`. */
function dayAgo(daysAgo: number): string {
  return addDays(today(), -daysAgo)
}

/**
 * Fills the database with a shop's worth of sample trading.
 *
 * Deliberately generous: enough products and bills to page through, ninety days
 * of history so every date preset and chart has something to draw, and at least
 * one example of every state a screen can show — paid, part paid, on khata,
 * returned, out of stock, below reorder level, inactive, consignment.
 */
export function seedDemoData(): DemoSeedResult {
  const db = getDb()

  if (demoStatus().present) {
    throw businessRule('Sample data is already loaded. Remove it first to load a fresh set.')
  }

  const random = makeRandom(20_260_828)

  const run = db.transaction(() => {
    // ---- categories -------------------------------------------------------
    const categoryIds = CATEGORIES.map((name) => {
      const category = categoryService.addCategory(name)
      record(db, 'categories', category.id)
      return category.id
    })

    // ---- products ---------------------------------------------------------
    // 20 items x 4 brands = 80, comfortably past one page.
    const products: { id: Id; unit: string; cost: number; price: number }[] = []

    ITEMS.forEach((item, itemIndex) => {
      BRANDS.slice(0, 4).forEach((brand, brandIndex) => {
        const index = itemIndex * 4 + brandIndex
        const cost = money(item.cost * (0.9 + random.int(0, 20) / 100))
        const price = money(cost * (1.08 + random.int(0, 12) / 100))

        const product = productService.addProduct({
          name: `${brand} ${item.name}`,
          sku: `SKU-${String(index + 1).padStart(4, '0')}`,
          barcode: `890${String(index + 1).padStart(7, '0')}`,
          categoryId: categoryIds[item.category] ?? null,
          baseUnit: item.unit,
          costPrice: cost,
          salePrice: price,
          // The shelves the shop already had on the day it started using the
          // app. Entering existing stock as opening stock is how a real shop
          // adopts a POS, and it matters here for more than realism: buying
          // every last item inside the visible window instead would show a shop
          // that had sunk its entire capital into stock and had none left, so
          // cash in hand sat deep in the red from the first screen.
          openingStock: random.int(20, 60),
          reorderLevel: random.int(5, 20),
          // A few carry a carton unit, so multi-unit pricing has examples.
          units: random.chance(0.35)
            ? [{ unitName: 'carton', factor: 12, salePrice: money(price * 11.5) }]
            : []
        })

        record(db, 'products', product.id)
        products.push({ id: product.id, unit: item.unit, cost, price })
      })
    })

    // ---- consignment stock ------------------------------------------------
    const consignment: { id: Id; unit: string; price: number }[] = []
    for (const item of CONSIGNMENT) {
      const product = productService.addProduct({
        name: item.name,
        sku: null,
        barcode: null,
        categoryId: null,
        baseUnit: item.unit,
        costPrice: 0,
        salePrice: item.price,
        reorderLevel: 0,
        ownership: 'other',
        ownerName: item.owner
      })
      record(db, 'products', product.id)

      otherStockService.receiveOtherStock({
        productId: product.id,
        qty: random.int(8, 25),
        date: dayAgo(random.int(60, HISTORY_DAYS)),
        notes: 'Sample consignment delivery'
      })
      consignment.push({ id: product.id, unit: item.unit, price: item.price })
    }

    // ---- parties ----------------------------------------------------------
    const customers = CUSTOMER_NAMES.map((name, index) => {
      const party = partyService.addParty('customer', {
        name,
        phone: `03${random.int(10, 49)}${String(random.int(1_000_000, 9_999_999))}`,
        address: `Shop ${index + 1}, Main Bazaar`,
        // A couple start in credit, so negative balances are represented.
        openingBalance: random.chance(0.12) ? -money(random.int(500, 4000)) : 0
      })
      record(db, 'customers', party.id)
      return party.id
    })

    const suppliers = SUPPLIER_NAMES.map((name) => {
      const party = partyService.addParty('supplier', {
        name,
        phone: `042${String(random.int(1_000_000, 9_999_999))}`,
        address: 'Wholesale Market'
      })
      record(db, 'suppliers', party.id)
      return party.id
    })

    // ---- purchases: stock has to exist before it can be sold ---------------
    // Sized against what the bills below actually consume, plus headroom. Buy
    // much more than that and the sample shop reads as bankrupt — every rupee
    // of capital sunk into stock that has not sold yet, a cash position deep in
    // the red, and an owner reasonably concluding the app cannot add up.
    // Restocking from here on, not the original fit-out — that arrived as
    // opening stock above.
    for (let batch = 0; batch < 16; batch += 1) {
      const lineCount = random.int(3, 7)
      const items = Array.from({ length: lineCount }, () => {
        const product = random.pick(products)
        return {
          productId: product.id,
          unitName: product.unit,
          qty: random.int(10, 30),
          unitCost: money(product.cost * (0.97 + random.int(0, 6) / 100))
        }
      })

      const total = items.reduce((sum, item) => sum + item.qty * item.unitCost, 0)
      const supplierId = random.pick(suppliers)
      // A third are left partly unpaid, so suppliers carry real balances.
      const paid = random.chance(0.34) ? money(total * (random.int(20, 70) / 100)) : money(total)

      const purchase = purchaseService.createPurchase({
        supplierId,
        invoiceNo: `SUP-${String(batch + 1).padStart(4, '0')}`,
        date: dayAgo(HISTORY_DAYS - batch * 3),
        items,
        paidAmount: paid,
        notes: batch % 5 === 0 ? 'Monthly stock-up' : null
      })
      record(db, 'purchases', purchase.id)
    }

    // ---- bills -------------------------------------------------------------
    const saleIds: Id[] = []
    for (let index = 0; index < 300; index += 1) {
      // Weighted towards recent days, the way a real ledger looks.
      const daysAgo = Math.floor((random.int(0, 100) / 100) ** 1.6 * HISTORY_DAYS)
      const date = dayAgo(daysAgo)

      const walkIn = random.chance(0.28)
      const customerId = walkIn ? null : random.pick(customers)

      const lineCount = random.int(1, 5)
      const items = Array.from({ length: lineCount }, () => {
        const product = random.pick(products)
        return {
          productId: product.id,
          unitName: product.unit,
          qty: random.int(1, 12),
          rate: money(product.price * (0.97 + random.int(0, 8) / 100)),
          lineDiscount: 0
        }
      })

      // Roughly one bill in seven carries a consignment line, so the split
      // subtotal, the receipt marker and the register all have examples.
      if (!walkIn && random.chance(0.15)) {
        const item = random.pick(consignment)
        items.push({
          productId: item.id,
          unitName: item.unit,
          qty: 1,
          rate: item.price,
          lineDiscount: 0
        })
      }

      let subtotal = 0
      let ownSubtotal = 0
      for (const item of items) {
        const amount = money(item.qty * item.rate)
        subtotal = money(subtotal + amount)
        if (!consignment.some((entry) => entry.id === item.productId)) {
          ownSubtotal = money(ownSubtotal + amount)
        }
      }

      // A discount may only come off the shop's own goods.
      const discount = random.chance(0.18) ? money(Math.min(ownSubtotal * 0.05, 500)) : 0
      const total = money(subtotal - discount)

      const paymentType = walkIn
        ? 'cash'
        : random.chance(0.34)
          ? random.chance(0.5)
            ? 'credit'
            : 'partial'
          : 'cash'

      const paidAmount =
        paymentType === 'cash'
          ? total
          : paymentType === 'credit'
            ? 0
            : money(total * (random.int(20, 70) / 100))

      try {
        const { sale } = salesService.createSale({
          customerId,
          date,
          items,
          discount,
          paymentType,
          paidAmount,
          notes: random.chance(0.1) ? 'Delivered to shop' : null
        })
        record(db, 'sales', sale.id)
        saleIds.push(sale.id)
      } catch {
        // A line that outran the shelf. Skipping is correct: the samples must
        // obey the same stock rules as real trade, never bypass them.
      }
    }

    // ---- returns -----------------------------------------------------------
    for (let index = 0; index < 14 && index < saleIds.length; index += 1) {
      const saleId = saleIds[random.int(0, saleIds.length - 1)] as Id
      const sale = salesService.getSale(saleId)
      const line = sale.items[0]
      if (!line || line.qty < 2) continue

      try {
        const saleReturn = returnService.createSaleReturn({
          saleId,
          date: sale.date,
          items: [
            {
              productId: line.productId,
              unitName: line.unitName,
              qty: Math.max(1, Math.floor(line.qty / 2)),
              rate: line.rate
            }
          ],
          refundType: sale.customerId != null && random.chance(0.5) ? 'credit' : 'cash',
          notes: 'Damaged in transit'
        })
        record(db, 'sale_returns', saleReturn.id)
      } catch {
        // Already returned in full by an earlier iteration.
      }
    }

    const purchaseIds = idsFor(db, 'purchases')
    for (let index = 0; index < 5; index += 1) {
      const purchaseId = purchaseIds[random.int(0, purchaseIds.length - 1)] as Id
      const purchase = purchaseService.getPurchase(purchaseId)
      const line = purchase.items[0]
      if (!line) continue

      try {
        const purchaseReturn = returnService.createPurchaseReturn({
          purchaseId,
          date: purchase.date,
          items: [
            {
              productId: line.productId,
              unitName: line.unitName,
              qty: Math.max(1, Math.floor(line.qty / 4)),
              unitCost: line.costPrice
            }
          ],
          notes: 'Short delivery'
        })
        record(db, 'purchase_returns', purchaseReturn.id)
      } catch {
        // Stock already moved on; skip rather than force it.
      }
    }

    // ---- money in and out --------------------------------------------------
    for (const customerId of customers) {
      const balance = partyService.getParty('customer', customerId).currentBalance
      if (balance <= 0 || !random.chance(0.65)) continue

      const payment = paymentService.createPayment({
        partyType: 'customer',
        partyId: customerId,
        amount: money(balance * (random.int(30, 90) / 100)),
        method: random.pick(PAYMENT_METHODS),
        date: dayAgo(random.int(0, 30)),
        notes: null
      })
      record(db, 'payments', payment.id)
    }

    for (const supplierId of suppliers) {
      const balance = partyService.getParty('supplier', supplierId).currentBalance
      if (balance <= 0 || !random.chance(0.7)) continue

      const payment = paymentService.createPayment({
        partyType: 'supplier',
        partyId: supplierId,
        amount: money(balance * (random.int(40, 95) / 100)),
        method: random.pick(PAYMENT_METHODS),
        date: dayAgo(random.int(0, 40)),
        notes: null
      })
      record(db, 'payments', payment.id)
    }

    // ---- expenses ----------------------------------------------------------
    const expenseCategoryIds = EXPENSE_CATEGORIES.map((name) => {
      const category = expenseService.addExpenseCategory(name)
      record(db, 'expense_categories', category.id)
      return category.id
    })

    // Overheads for a shop turning over roughly this much: together they should
    // take a healthy bite out of gross profit without swallowing it. Set too
    // high, every month shows a loss and the P&L looks broken rather than
    // instructive.
    const EXPENSE_TITLES: Record<string, [number, number]> = {
      Rent: [12_000, 12_000],
      Electricity: [3000, 7000],
      Salaries: [14_000, 18_000],
      Transport: [1000, 3000],
      Packaging: [500, 1500],
      Repairs: [300, 2000]
    }

    for (let month = 0; month < 3; month += 1) {
      EXPENSE_CATEGORIES.forEach((name, index) => {
        const [low, high] = EXPENSE_TITLES[name] as [number, number]
        // Rent and salaries land monthly; the rest are occasional.
        const times = name === 'Rent' || name === 'Salaries' ? 1 : random.int(1, 3)

        for (let occurrence = 0; occurrence < times; occurrence += 1) {
          const expense = expenseService.addExpense({
            categoryId: expenseCategoryIds[index] ?? null,
            title: name,
            amount: money(random.int(low, high)),
            date: dayAgo(month * 30 + random.int(0, 28)),
            notes: null
          })
          record(db, 'expenses', expense.id)
        }
      })
    }

    // ---- a few hand corrections, so the adjustment reason is represented ----
    for (let index = 0; index < 8; index += 1) {
      const product = random.pick(products)
      const onHand = productService.getProduct(product.id).stockQty
      const change = random.chance(0.5) ? random.int(1, 6) : -Math.min(3, Math.floor(onHand))
      if (change === 0) continue

      try {
        inventoryService.adjustStock({
          productId: product.id,
          changeQty: change,
          date: dayAgo(random.int(0, 45)),
          notes: change > 0 ? 'Found in back store' : 'Breakage'
        })
      } catch {
        // Would have gone below zero; leave the shelf alone.
      }
    }

    // ---- some consignment goes back to its owner ---------------------------
    for (const item of consignment.slice(0, 3)) {
      const onHand = productService.getProduct(item.id).stockQty
      if (onHand < 2) continue

      otherStockService.returnOtherStock({
        productId: item.id,
        qty: Math.max(1, Math.floor(onHand / 4)),
        date: dayAgo(random.int(0, 20)),
        notes: 'Unsold, returned to owner'
      })
    }

    // ---- states a product can be in ---------------------------------------
    // One deactivated product, so the "Inactive" filter has something.
    const spare = products[products.length - 1]
    if (spare) {
      const current = productService.getProduct(spare.id)
      if (current.stockQty > 0) {
        inventoryService.adjustStock({
          productId: spare.id,
          changeQty: -current.stockQty,
          notes: 'Discontinued line'
        })
      }
      productService.setProductActive(spare.id, false)
    }

    // ---- a staff account, so roles can be tried -----------------------------
    try {
      const staff = userService.createUser({ username: 'salesman', pin: '1234' })
      record(db, 'staff_users', staff.id)
    } catch {
      // A real account already uses that name; the samples do not need one.
    }

    return countsByTable(db)
  })

  const counts = run()
  const total = counts.reduce((sum, entry) => sum + entry.count, 0)
  log.info(`sample data added: ${total} records`)

  return { total, counts }
}

// ---------------------------------------------------------------- removal

/**
 * Removes every row the seeder created, and nothing else.
 *
 * Works strictly from the manifest, parents in dependency order, with the
 * cached balances and stock totals rebuilt from what remains afterwards. If the
 * shop's own records have come to reference sample ones, it refuses rather than
 * cascading into data the owner typed.
 */
export function clearDemoData(): DemoClearResult {
  const db = getDb()
  const status = demoStatus()

  if (!status.present) {
    throw businessRule('There is no sample data to remove.')
  }
  if (status.blockers.length > 0) {
    throw businessRule(
      `Sample data cannot be removed yet: ${status.blockers.join('; ')}. Delete or re-enter those records first.`
    )
  }

  const productIds = idsFor(db, 'products')
  const customerIds = idsFor(db, 'customers')
  const supplierIds = idsFor(db, 'suppliers')

  const run = db.transaction(() => {
    let removed = 0

    // Stock movements have no cascade, and every movement of a sample product
    // is a sample movement — the product itself was created by the seeder.
    for (const productId of productIds) {
      db.prepare('DELETE FROM stock_movements WHERE product_id = ?').run(productId)
    }

    for (const table of REMOVAL_ORDER) {
      for (const rowId of idsFor(db, table)) {
        db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(rowId)
        removed += 1
      }
    }

    db.prepare('DELETE FROM demo_records').run()

    // Anything the shop really owns keeps its numbers: both caches are derived,
    // so recomputing them from the surviving events is exact.
    reconcileStockCache(db)
    for (const type of ['customer', 'supplier'] as const) {
      const table = type === 'customer' ? 'customers' : 'suppliers'
      const gone = new Set(type === 'customer' ? customerIds : supplierIds)

      for (const party of db
        .prepare<[], { id: number; current_balance: number }>(
          `SELECT id, current_balance FROM ${table}`
        )
        .all()) {
        if (gone.has(party.id)) continue
        const actual = computeBalance(db, type, party.id)
        const drift = money(actual - party.current_balance)
        if (Math.abs(drift) > 0.005) applyBalanceDelta(db, type, party.id, drift)
      }
    }

    return removed
  })

  const removed = run()
  log.info(`sample data removed: ${removed} records`)
  return { removed }
}
