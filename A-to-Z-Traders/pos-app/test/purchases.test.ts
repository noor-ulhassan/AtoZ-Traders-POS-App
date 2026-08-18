import { beforeEach, describe, expect, it } from 'vitest'
import type { Supplier } from '@shared/types'
import { createTestDb } from './helpers/database'
import * as partyService from '../src/main/services/partyService'
import * as productService from '../src/main/services/productService'
import * as purchaseService from '../src/main/services/purchaseService'

let supplier: Supplier
let productId: number

beforeEach(() => {
  createTestDb()
  supplier = partyService.addParty('supplier', { name: 'Metro Wholesale' })
  productId = productService.addProduct({
    name: 'Detergent 1kg',
    baseUnit: 'piece',
    costPrice: 100,
    salePrice: 150,
    reorderLevel: 0
  }).id
})

describe('createPurchase', () => {
  it('rejects a cash purchase left partially unpaid, so the shortfall cannot vanish', () => {
    expect(() =>
      purchaseService.createPurchase({
        supplierId: null,
        items: [{ productId, unitName: 'piece', qty: 10, unitCost: 100 }],
        paidAmount: 500
      })
    ).toThrow(/select a supplier/i)
  })

  it('rejects a cash purchase left entirely unpaid', () => {
    expect(() =>
      purchaseService.createPurchase({
        supplierId: null,
        items: [{ productId, unitName: 'piece', qty: 10, unitCost: 100 }],
        paidAmount: 0
      })
    ).toThrow(/select a supplier/i)
  })

  it('allows a cash purchase paid in full', () => {
    const purchase = purchaseService.createPurchase({
      supplierId: null,
      items: [{ productId, unitName: 'piece', qty: 10, unitCost: 100 }],
      paidAmount: 1000
    })
    expect(purchase.paidAmount).toBe(1000)
    expect(productService.getProduct(productId).stockQty).toBe(10)
  })

  it('puts the unpaid balance on the supplier when one is chosen', () => {
    const purchase = purchaseService.createPurchase({
      supplierId: supplier.id,
      items: [{ productId, unitName: 'piece', qty: 10, unitCost: 100 }],
      paidAmount: 400
    })
    expect(purchase.paidAmount).toBe(400)
    expect(partyService.getParty('supplier', supplier.id).currentBalance).toBe(600)
  })

  it('still rejects paying more than the total with no supplier to hold the advance', () => {
    expect(() =>
      purchaseService.createPurchase({
        supplierId: null,
        items: [{ productId, unitName: 'piece', qty: 10, unitCost: 100 }],
        paidAmount: 1500
      })
    ).toThrow(/advance/i)
  })
})
