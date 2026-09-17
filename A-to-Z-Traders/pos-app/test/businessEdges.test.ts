import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Product, Supplier } from '@shared/types'
import { closeDatabase, getDb } from '../src/main/db/connection'
import { createTestDb } from './helpers/database'
import * as parties from '../src/main/services/partyService'
import * as products from '../src/main/services/productService'
import * as purchases from '../src/main/services/purchaseService'
import * as sales from '../src/main/services/salesService'
import * as returns from '../src/main/services/returnService'
import * as inventory from '../src/main/services/inventoryService'
import * as expenses from '../src/main/services/expenseService'
import { computeBalance } from '../src/main/services/ledgerService'

let product: Product
let supplier: Supplier

beforeEach(() => {
  createTestDb()
  supplier = parties.addParty('supplier', { name: 'Original supplier' })
  product = products.addProduct({
    name: 'Soap',
    baseUnit: 'piece',
    costPrice: 10,
    salePrice: 15,
    reorderLevel: 0,
    openingStock: 100,
    units: [
      { unitName: 'carton', factor: 12, salePrice: 180 },
      { unitName: 'tiny', factor: 0.001, salePrice: 1 }
    ]
  })
})

afterEach(() => closeDatabase())

function stockAndBalancesAreConsistent(): void {
  const db = getDb()
  expect(inventory.reconcileStockCache(db)).toBe(0)
  for (const type of ['customer', 'supplier'] as const) {
    for (const party of parties.listParties(type).rows) {
      expect(party.currentBalance).toBe(computeBalance(db, type, party.id))
    }
  }
  expect(db.pragma('foreign_key_check')).toEqual([])
}

describe('quantities at storage precision', () => {
  for (const [unitName, quantity] of [
    ['piece', 0.0001],
    ['tiny', 0.001]
  ] as const) {
    it(`rejects a sale of ${quantity} ${unitName} without writing an empty bill`, () => {
      expect(() =>
        sales.createSale({
          items: [{ productId: product.id, unitName, qty: quantity, rate: 0 }],
          paymentType: 'cash',
          paidAmount: 0
        })
      ).toThrow(/quantity|zero|small/i)
      expect(sales.listSales().total).toBe(0)
      expect(products.getProduct(product.id).stockQty).toBe(100)
      stockAndBalancesAreConsistent()
    })

    it(`rejects a customer return of ${quantity} ${unitName}`, () => {
      expect(() =>
        returns.createSaleReturn({
          items: [{ productId: product.id, unitName, qty: quantity, rate: 0 }],
          refundType: 'cash'
        })
      ).toThrow(/quantity|zero|small/i)
      expect(returns.listSaleReturns().total).toBe(0)
      stockAndBalancesAreConsistent()
    })

    it(`rejects a supplier return of ${quantity} ${unitName}`, () => {
      expect(() =>
        returns.createPurchaseReturn({
          supplierId: supplier.id,
          items: [{ productId: product.id, unitName, qty: quantity }]
        })
      ).toThrow(/quantity|zero|small/i)
      expect(returns.listPurchaseReturns().total).toBe(0)
      stockAndBalancesAreConsistent()
    })
  }

  it('rejects an adjustment that becomes zero instead of creating a phantom movement', () => {
    const before = inventory.listMovements().total
    expect(() => inventory.adjustStock({ productId: product.id, changeQty: 0.0001 })).toThrow(
      /zero|small/i
    )
    expect(inventory.listMovements().total).toBe(before)
  })

  it('accepts the smallest supported base quantity', () => {
    const { sale } = sales.createSale({
      items: [{ productId: product.id, unitName: 'piece', qty: 0.001, rate: 10 }],
      paymentType: 'cash',
      paidAmount: 0.01
    })
    expect(sale.total).toBe(0.01)
    expect(products.getProduct(product.id).stockQty).toBe(99.999)
    stockAndBalancesAreConsistent()
  })
})

describe('purchases use the quantities and prices that are saved', () => {
  it('normalises quantity before unit conversion and pricing', () => {
    const purchase = purchases.createPurchase({
      supplierId: supplier.id,
      items: [{ productId: product.id, unitName: 'carton', qty: 1.0004, unitCost: 120 }],
      paidAmount: 0
    })
    expect(purchase.items[0]).toMatchObject({ qty: 1, baseQty: 12, amount: 120 })
    expect(products.getProduct(product.id).stockQty).toBe(112)
    expect(parties.getParty('supplier', supplier.id).currentBalance).toBe(120)
    stockAndBalancesAreConsistent()
  })

  it('normalises the entered unit cost before multiplying it', () => {
    const purchase = purchases.createPurchase({
      supplierId: supplier.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 3, unitCost: 1000.005 }],
      paidAmount: 0
    })
    expect(purchase.items[0]).toMatchObject({ costPrice: 1000.01, amount: 3000.03 })
    expect(purchase.total).toBe(3000.03)
    stockAndBalancesAreConsistent()
  })
})

describe('returns keep the identity and history of the original trade', () => {
  it.each([false, true])(
    'credits the original supplier when supplied identity is wrong/omitted: %s',
    (omit) => {
      const wrong = parties.addParty('supplier', { name: 'Unrelated supplier' })
      const purchase = purchases.createPurchase({
        supplierId: supplier.id,
        items: [{ productId: product.id, unitName: 'piece', qty: 10, unitCost: 10 }],
        paidAmount: 0
      })
      const returned = returns.createPurchaseReturn({
        purchaseId: purchase.id,
        supplierId: omit ? undefined : wrong.id,
        items: [{ productId: product.id, unitName: 'piece', qty: 2 }]
      })
      expect(returned.supplierId).toBe(supplier.id)
      expect(parties.getParty('supplier', supplier.id).currentBalance).toBe(80)
      expect(parties.getParty('supplier', wrong.id).currentBalance).toBe(0)
      stockAndBalancesAreConsistent()
    }
  )

  it('keeps the original cost when a carton is returned as loose pieces', () => {
    const { sale } = sales.createSale({
      items: [{ productId: product.id, unitName: 'carton', qty: 1, rate: 180 }],
      paymentType: 'cash',
      paidAmount: 180
    })
    purchases.createPurchase({
      supplierId: supplier.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 100, unitCost: 30 }],
      paidAmount: 0
    })
    expect(products.getProduct(product.id).costPrice).toBeGreaterThan(10)
    const returned = returns.createSaleReturn({
      saleId: sale.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 6, rate: 15 }],
      refundType: 'cash'
    })
    expect(returned.items[0]?.costPrice).toBe(10)
    stockAndBalancesAreConsistent()
  })

  it('never invents a supplier credit by returning consignment through purchases', () => {
    const other = products.addProduct({
      name: 'Other owner goods',
      baseUnit: 'piece',
      ownership: 'other',
      ownerName: 'Consignor',
      costPrice: 0,
      salePrice: 20,
      reorderLevel: 0,
      openingStock: 10
    })
    expect(() =>
      returns.createPurchaseReturn({
        supplierId: supplier.id,
        items: [{ productId: other.id, unitName: 'piece', qty: 1, unitCost: 20 }]
      })
    ).toThrow(/other stock|belong/i)
    expect(products.getProduct(other.id).stockQty).toBe(10)
    expect(parties.getParty('supplier', supplier.id).currentBalance).toBe(0)
    stockAndBalancesAreConsistent()
  })
})

describe('expenses at currency precision', () => {
  it('rejects a positive input that rounds to no money', () => {
    expect(() => expenses.addExpense({ title: 'Tiny expense', amount: 0.001 })).toThrow(
      /greater than zero/i
    )
    expect(expenses.listExpenses().total).toBe(0)
  })
})
