import { beforeEach, describe, expect, it } from 'vitest'
import type { Customer, Product, Supplier } from '@shared/types'
import { createTestDb } from './helpers/database'
import * as partyService from '../src/main/services/partyService'
import * as productService from '../src/main/services/productService'
import * as purchaseService from '../src/main/services/purchaseService'
import * as returnService from '../src/main/services/returnService'
import * as salesService from '../src/main/services/salesService'

let customer: Customer
let supplier: Supplier
let product: Product

/** One product, base unit "piece", with a "carton" = 12 pieces alt unit, and
 *  100 pieces bought at 100 each from one supplier. */
function seed(): void {
  customer = partyService.addParty('customer', { name: 'Karim General Store' })
  supplier = partyService.addParty('supplier', { name: 'Metro Wholesale' })
  product = productService.addProduct({
    name: 'Detergent 1kg',
    baseUnit: 'piece',
    costPrice: 0,
    salePrice: 150,
    reorderLevel: 10,
    units: [{ unitName: 'carton', factor: 12, salePrice: 1700 }]
  })
  purchaseService.createPurchase({
    supplierId: supplier.id,
    items: [{ productId: product.id, unitName: 'piece', qty: 100, unitCost: 100 }],
    paidAmount: 0
  })
  product = productService.getProduct(product.id)
}

beforeEach(() => {
  createTestDb()
  seed()
})

describe('sale returns', () => {
  it('puts stock back and reduces the khata on a credit refund', () => {
    const { sale } = salesService.createSale({
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 10, rate: 150 }],
      paymentType: 'credit',
      paidAmount: 0
    })
    expect(partyService.getParty('customer', customer.id).currentBalance).toBe(1500)

    returnService.createSaleReturn({
      saleId: sale.id,
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 4, rate: 150 }],
      refundType: 'credit'
    })

    expect(productService.getProduct(product.id).stockQty).toBe(94)
    expect(partyService.getParty('customer', customer.id).currentBalance).toBe(900)
  })

  it('rejects an over-return spread across duplicate product lines', () => {
    const { sale } = salesService.createSale({
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 12, rate: 150 }],
      paymentType: 'credit',
      paidAmount: 0
    })

    // 1 carton (=12) + 6 pieces = 18 base units against a 12-piece bill.
    expect(() =>
      returnService.createSaleReturn({
        saleId: sale.id,
        customerId: customer.id,
        items: [
          { productId: product.id, unitName: 'carton', qty: 1, rate: 1800 },
          { productId: product.id, unitName: 'piece', qty: 6, rate: 150 }
        ],
        refundType: 'credit'
      })
    ).toThrow(/left to return/i)

    // The whole return is one transaction, so nothing partial leaked through.
    expect(productService.getProduct(product.id).stockQty).toBe(88)
  })
})

describe('purchase returns', () => {
  it('takes stock out and reduces the payable', () => {
    expect(partyService.getParty('supplier', supplier.id).currentBalance).toBe(10000)

    returnService.createPurchaseReturn({
      purchaseId: undefined,
      supplierId: supplier.id,
      items: [{ productId: product.id, unitName: 'carton', qty: 2 }]
    })

    expect(productService.getProduct(product.id).stockQty).toBe(76)
    expect(partyService.getParty('supplier', supplier.id).currentBalance).toBe(7600)
  })

  it('never drives cached stock below zero across duplicate lines', () => {
    // 100 in stock; 8 cartons (=96) + 10 pieces = 106 base units.
    expect(() =>
      returnService.createPurchaseReturn({
        supplierId: supplier.id,
        items: [
          { productId: product.id, unitName: 'carton', qty: 8 },
          { productId: product.id, unitName: 'piece', qty: 10 }
        ]
      })
    ).toThrow(/in stock/i)

    expect(productService.getProduct(product.id).stockQty).toBe(100)
  })

  it('cannot return more than a linked purchase brought in', () => {
    const created = purchaseService.createPurchase({
      supplierId: supplier.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 5, unitCost: 100 }],
      paidAmount: 0
    })

    expect(() =>
      returnService.createPurchaseReturn({
        purchaseId: created.id,
        supplierId: supplier.id,
        items: [{ productId: product.id, unitName: 'piece', qty: 6 }]
      })
    ).toThrow(/left to return on this purchase/i)
  })
})
