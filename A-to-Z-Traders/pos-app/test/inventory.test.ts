import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/main/db/connection'
import { createTestDb } from './helpers/database'
import { weightedAverageCost } from '../src/main/services/inventoryService'
import * as inventoryService from '../src/main/services/inventoryService'
import * as productService from '../src/main/services/productService'
import * as purchaseService from '../src/main/services/purchaseService'
import * as partyService from '../src/main/services/partyService'
import { sumMovements } from '../src/main/repositories/stockRepository'

let db: Db

beforeEach(() => {
  db = createTestDb()
})

describe('weighted average cost', () => {
  it('averages the running stock against the incoming lot', () => {
    // 10 @ 100 then 10 @ 120 -> 110
    expect(weightedAverageCost(10, 100, 10, 120)).toBe(110)
  })

  it('weights by quantity, not by lot count', () => {
    // 90 @ 100 then 10 @ 200 -> 110, not 150
    expect(weightedAverageCost(90, 100, 10, 200)).toBe(110)
  })

  it('adopts the incoming cost when there was no stock', () => {
    // A product that ran to zero must not keep a stale historical cost.
    expect(weightedAverageCost(0, 500, 5, 80)).toBe(80)
  })

  it('adopts the incoming cost when stock is negative from a correction', () => {
    expect(weightedAverageCost(-3, 500, 5, 80)).toBe(80)
  })

  it('rounds the result to two decimals', () => {
    expect(weightedAverageCost(3, 10, 1, 11)).toBe(10.25)
    expect(weightedAverageCost(3, 10, 2, 11.11)).toBe(10.44)
  })
})

describe('stock ledger', () => {
  it('records opening stock as a movement, not just a number', () => {
    const product = productService.addProduct({
      name: 'Sugar 50kg bag',
      baseUnit: 'bag',
      costPrice: 5000,
      salePrice: 5400,
      reorderLevel: 5,
      openingStock: 20
    })

    expect(product.stockQty).toBe(20)
    expect(sumMovements(db, product.id)).toBe(20)

    const movements = inventoryService.listMovements({ productId: product.id })
    expect(movements.rows).toHaveLength(1)
    expect(movements.rows[0]?.reason).toBe('opening')
  })

  it('keeps the cached quantity equal to the sum of movements', () => {
    const product = productService.addProduct({
      name: 'Cooking oil 5L',
      baseUnit: 'piece',
      costPrice: 1200,
      salePrice: 1400,
      reorderLevel: 10,
      openingStock: 10
    })

    inventoryService.adjustStock({ productId: product.id, changeQty: -3, notes: 'Damaged' })
    inventoryService.adjustStock({ productId: product.id, changeQty: 5, notes: 'Found in store' })

    const updated = productService.getProduct(product.id)
    expect(updated.stockQty).toBe(12)
    expect(sumMovements(db, product.id)).toBe(12)
  })

  it('refuses an adjustment that would drive stock below zero', () => {
    const product = productService.addProduct({
      name: 'Tea 500g',
      baseUnit: 'packet',
      costPrice: 400,
      salePrice: 460,
      reorderLevel: 0,
      openingStock: 2
    })

    expect(() =>
      inventoryService.adjustStock({ productId: product.id, changeQty: -3 })
    ).toThrowError(/cannot go below zero/i)

    expect(productService.getProduct(product.id).stockQty).toBe(2)
  })
})

describe('purchases', () => {
  it('brings stock in and recalculates the average cost', () => {
    const supplier = partyService.addParty('supplier', { name: 'Metro Wholesale' })
    const product = productService.addProduct({
      name: 'Rice 25kg',
      baseUnit: 'bag',
      costPrice: 0,
      salePrice: 4000,
      reorderLevel: 0,
      openingStock: 0
    })

    purchaseService.createPurchase({
      supplierId: supplier.id,
      items: [{ productId: product.id, unitName: 'bag', qty: 10, unitCost: 3000 }],
      paidAmount: 30000
    })

    purchaseService.createPurchase({
      supplierId: supplier.id,
      items: [{ productId: product.id, unitName: 'bag', qty: 10, unitCost: 3400 }],
      paidAmount: 34000
    })

    const updated = productService.getProduct(product.id)
    expect(updated.stockQty).toBe(20)
    expect(updated.costPrice).toBe(3200)
  })

  it('converts a cost given per box into a cost per base unit', () => {
    const product = productService.addProduct({
      name: 'Biscuits',
      baseUnit: 'piece',
      costPrice: 0,
      salePrice: 30,
      reorderLevel: 0,
      units: [{ unitName: 'box', factor: 24, salePrice: 700 }]
    })

    purchaseService.createPurchase({
      items: [{ productId: product.id, unitName: 'box', qty: 5, unitCost: 480 }],
      paidAmount: 2400
    })

    const updated = productService.getProduct(product.id)
    expect(updated.stockQty).toBe(120)
    expect(updated.costPrice).toBe(20)
  })

  it('averages two lines of the same product against the running total', () => {
    const product = productService.addProduct({
      name: 'Salt 1kg',
      baseUnit: 'packet',
      costPrice: 0,
      salePrice: 60,
      reorderLevel: 0
    })

    purchaseService.createPurchase({
      items: [
        { productId: product.id, unitName: 'packet', qty: 10, unitCost: 40 },
        { productId: product.id, unitName: 'packet', qty: 10, unitCost: 50 }
      ],
      paidAmount: 900
    })

    const updated = productService.getProduct(product.id)
    expect(updated.stockQty).toBe(20)
    expect(updated.costPrice).toBe(45)
  })

  it('puts the unpaid portion on the supplier account', () => {
    const supplier = partyService.addParty('supplier', { name: 'Al-Karam Traders' })
    const product = productService.addProduct({
      name: 'Flour 10kg',
      baseUnit: 'bag',
      costPrice: 0,
      salePrice: 1500,
      reorderLevel: 0
    })

    purchaseService.createPurchase({
      supplierId: supplier.id,
      items: [{ productId: product.id, unitName: 'bag', qty: 20, unitCost: 1200 }],
      discount: 1000,
      paidAmount: 10000
    })

    // 20 * 1200 = 24,000 - 1,000 discount = 23,000 total, 10,000 paid.
    expect(partyService.getParty('supplier', supplier.id).currentBalance).toBe(13000)
  })

  it('rolls the whole purchase back if a line is invalid', () => {
    const product = productService.addProduct({
      name: 'Ghee 1kg',
      baseUnit: 'tin',
      costPrice: 0,
      salePrice: 900,
      reorderLevel: 0
    })

    expect(() =>
      purchaseService.createPurchase({
        items: [
          { productId: product.id, unitName: 'tin', qty: 5, unitCost: 700 },
          { productId: product.id, unitName: 'carton', qty: 1, unitCost: 8000 }
        ],
        paidAmount: 0
      })
    ).toThrowError(/not sold in/i)

    expect(productService.getProduct(product.id).stockQty).toBe(0)
    expect(purchaseService.listPurchases().total).toBe(0)
  })
})
