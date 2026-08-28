import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PAGE_SIZE, offsetFor, pageCount } from '@shared/pagination'
import type { Db } from '../src/main/db/connection'
import { createTestDb } from './helpers/database'
import * as partyService from '../src/main/services/partyService'
import * as productService from '../src/main/services/productService'
import * as salesService from '../src/main/services/salesService'
import * as purchaseService from '../src/main/services/purchaseService'

/**
 * Paging is the fix for a bug that hid data: every list screen used to stop at
 * its repository's default limit and say nothing about the rest. So these
 * assertions are about completeness as much as ordering — that walking the
 * pages reaches every row exactly once, and that the summary figures describe
 * the whole filtered set rather than whichever page is open.
 */

let db: Db

beforeEach(() => {
  db = createTestDb()
})

function makeProducts(count: number, prefix = 'Item'): void {
  for (let index = 0; index < count; index += 1) {
    productService.addProduct({
      // Zero-padded so alphabetical order is also numeric order, which lets a
      // test say exactly which rows a given page should hold.
      name: `${prefix} ${String(index).padStart(4, '0')}`,
      baseUnit: 'piece',
      costPrice: 10,
      salePrice: 25,
      reorderLevel: 0,
      openingStock: 100
    })
  }
}

describe('paging a product list', () => {
  it('reports the full total while returning only the page asked for', () => {
    makeProducts(120)

    const page = productService.listProducts({ limit: 50, offset: 0 })

    expect(page.rows).toHaveLength(50)
    expect(page.total).toBe(120)
  })

  it('walks every row exactly once across pages, with no gap or repeat', () => {
    makeProducts(120)

    const seen: string[] = []
    for (let offset = 0; offset < 120; offset += 50) {
      seen.push(...productService.listProducts({ limit: 50, offset }).rows.map((row) => row.name))
    }

    expect(seen).toHaveLength(120)
    expect(new Set(seen).size).toBe(120)
    expect(seen[0]).toBe('Item 0000')
    expect(seen[119]).toBe('Item 0119')
  })

  it('returns a short last page rather than padding it', () => {
    makeProducts(120)

    expect(productService.listProducts({ limit: 50, offset: 100 }).rows).toHaveLength(20)
  })

  it('returns nothing past the end instead of failing', () => {
    makeProducts(10)

    const page = productService.listProducts({ limit: 50, offset: 500 })
    expect(page.rows).toHaveLength(0)
    expect(page.total).toBe(10)
  })

  it('counts and values the whole filtered set, not the page', () => {
    makeProducts(120)

    const first = productService.listProducts({ limit: 10, offset: 0 })
    const later = productService.listProducts({ limit: 10, offset: 60 })

    // 120 products x 100 units x cost 10.
    expect(first.totals.stockValue).toBe(120_000)
    // The tile must not move when the owner turns the page.
    expect(later.totals.stockValue).toBe(first.totals.stockValue)
    expect(later.total).toBe(first.total)
  })

  it('narrows the total and the value when a filter is applied', () => {
    makeProducts(30, 'Soap')
    makeProducts(20, 'Rice')

    const page = productService.listProducts({ search: 'Rice', limit: 50, offset: 0 })

    expect(page.total).toBe(20)
    expect(page.totals.stockValue).toBe(20_000)
  })
})

describe('list totals', () => {
  it('sums bills across every page of a sales list', () => {
    const customer = partyService.addParty('customer', { name: 'Karim Store' })
    const product = productService.addProduct({
      name: 'Detergent',
      baseUnit: 'piece',
      costPrice: 0,
      salePrice: 100,
      reorderLevel: 0
    })
    purchaseService.createPurchase({
      items: [{ productId: product.id, unitName: 'piece', qty: 500, unitCost: 60 }],
      paidAmount: 30_000
    })

    // Ten bills of 100 each: half paid in full, half left entirely on khata.
    for (let index = 0; index < 10; index += 1) {
      const onKhata = index % 2 === 1
      salesService.createSale({
        customerId: customer.id,
        items: [{ productId: product.id, unitName: 'piece', qty: 1, rate: 100 }],
        paymentType: onKhata ? 'credit' : 'cash',
        paidAmount: onKhata ? 0 : 100
      })
    }

    const page = salesService.listSales({ limit: 3, offset: 0 })

    expect(page.rows).toHaveLength(3)
    expect(page.total).toBe(10)
    expect(page.totals.total).toBe(1000)
    expect(page.totals.paid).toBe(500)
    expect(page.totals.onKhata).toBe(500)
  })

  it('counts only what a party filter matches', () => {
    partyService.addParty('customer', { name: 'Owes money', openingBalance: 4000 })
    partyService.addParty('customer', { name: 'Settled', openingBalance: 0 })
    partyService.addParty('customer', { name: 'In credit', openingBalance: -500 })

    const all = partyService.listParties('customer', { limit: 50, offset: 0 })
    const owing = partyService.listParties('customer', {
      withBalanceOnly: true,
      limit: 50,
      offset: 0
    })

    expect(all.total).toBe(3)
    // A customer in credit must not net off what the others owe.
    expect(all.totals.outstanding).toBe(4000)
    expect(owing.total).toBe(2)
  })
})

describe('the database backing the paging', () => {
  it('keeps the cached stock total equal to the ledger for every product', () => {
    makeProducts(50)

    const drift = db
      .prepare<[], { drifted: number }>(
        `SELECT COUNT(*) AS drifted
           FROM products p
          WHERE ROUND(p.stock_qty, 3) <> ROUND(
                  COALESCE((SELECT SUM(m.change_qty) FROM stock_movements m
                             WHERE m.product_id = p.id), 0), 3)`
      )
      .get()

    expect(drift?.drifted).toBe(0)
  })
})

describe('the arithmetic the pager displays', () => {
  it('turns a page number into an offset', () => {
    expect(offsetFor(1, 50)).toBe(0)
    expect(offsetFor(2, 50)).toBe(50)
    expect(offsetFor(4, 25)).toBe(75)
  })

  it('treats anything below page 1 as page 1', () => {
    expect(offsetFor(0, 50)).toBe(0)
    expect(offsetFor(-3, 50)).toBe(0)
  })

  it('does not invent an empty final page when the total divides exactly', () => {
    expect(pageCount(100, 50)).toBe(2)
    expect(pageCount(101, 50)).toBe(3)
    expect(pageCount(99, 50)).toBe(2)
  })

  it('always reports at least one page, even with nothing to show', () => {
    expect(pageCount(0, 50)).toBe(1)
  })

  it('reaches the last row of any total from its last page', () => {
    for (const total of [1, 49, 50, 51, 100, 1000, 1001]) {
      const last = pageCount(total, DEFAULT_PAGE_SIZE)
      const offset = offsetFor(last, DEFAULT_PAGE_SIZE)
      // The final page must start before the end and cover the remainder.
      expect(offset).toBeLessThan(Math.max(total, 1))
      expect(offset + DEFAULT_PAGE_SIZE).toBeGreaterThanOrEqual(total)
    }
  })
})
