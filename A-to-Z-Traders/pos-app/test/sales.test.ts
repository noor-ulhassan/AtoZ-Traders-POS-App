import { beforeEach, describe, expect, it } from 'vitest'
import type { Customer, Product } from '@shared/types'
import type { Db } from '../src/main/db/connection'
import { createTestDb } from './helpers/database'
import { sumMovements } from '../src/main/repositories/stockRepository'
import * as ledgerService from '../src/main/services/ledgerService'
import * as partyService from '../src/main/services/partyService'
import * as paymentService from '../src/main/services/paymentService'
import * as productService from '../src/main/services/productService'
import * as purchaseService from '../src/main/services/purchaseService'
import * as reportService from '../src/main/services/reportService'
import * as returnService from '../src/main/services/returnService'
import * as salesService from '../src/main/services/salesService'
import * as settingsService from '../src/main/services/settingsService'
import { today } from '@shared/date'

let db: Db
let customer: Customer
let product: Product

/** A shop with one customer and 100 units of stock bought at 100 each. */
function seed(): void {
  customer = partyService.addParty('customer', { name: 'Karim General Store' })
  product = productService.addProduct({
    name: 'Detergent 1kg',
    baseUnit: 'piece',
    costPrice: 0,
    salePrice: 150,
    reorderLevel: 10,
    units: [{ unitName: 'carton', factor: 12, salePrice: 1700 }]
  })

  purchaseService.createPurchase({
    items: [{ productId: product.id, unitName: 'piece', qty: 100, unitCost: 100 }],
    paidAmount: 10000
  })

  product = productService.getProduct(product.id)
}

beforeEach(() => {
  db = createTestDb()
  seed()
})

describe('a cash sale', () => {
  it('takes stock out, leaves the khata alone and returns a receipt', () => {
    const { sale, receipt } = salesService.createSale({
      items: [{ productId: product.id, unitName: 'piece', qty: 10, rate: 150 }],
      paymentType: 'cash',
      paidAmount: 1500
    })

    expect(sale.total).toBe(1500)
    expect(sale.paymentType).toBe('cash')
    expect(productService.getProduct(product.id).stockQty).toBe(90)
    expect(sumMovements(db, product.id)).toBe(90)

    expect(receipt.invoiceNo).toBe(sale.invoiceNo)
    expect(receipt.totals.balance).toBe(0)
    expect(receipt.amountInWords).toContain('One Thousand Five Hundred')
  })

  it('numbers invoices in sequence', () => {
    const first = salesService.createSale({
      items: [{ productId: product.id, unitName: 'piece', qty: 1, rate: 150 }],
      paymentType: 'cash',
      paidAmount: 150
    })
    const second = salesService.createSale({
      items: [{ productId: product.id, unitName: 'piece', qty: 1, rate: 150 }],
      paymentType: 'cash',
      paidAmount: 150
    })

    expect(first.sale.invoiceNo).toBe('INV-000001')
    expect(second.sale.invoiceNo).toBe('INV-000002')
  })
})

describe('a credit sale', () => {
  it('increases the customer balance by exactly the unpaid amount', () => {
    salesService.createSale({
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 10, rate: 150 }],
      paymentType: 'credit',
      paidAmount: 0
    })

    expect(partyService.getParty('customer', customer.id).currentBalance).toBe(1500)
  })

  it('handles a part payment', () => {
    const { sale } = salesService.createSale({
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 10, rate: 150 }],
      paymentType: 'partial',
      paidAmount: 500
    })

    expect(sale.paymentType).toBe('partial')
    expect(partyService.getParty('customer', customer.id).currentBalance).toBe(1000)
  })

  it('derives the payment type from the money actually received', () => {
    // Marked credit, but paid in full — the record must say cash, or the bill
    // would show as outstanding on a khata that was already settled.
    const { sale } = salesService.createSale({
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 1, rate: 150 }],
      paymentType: 'credit',
      paidAmount: 150
    })

    expect(sale.paymentType).toBe('cash')
    expect(partyService.getParty('customer', customer.id).currentBalance).toBe(0)
  })

  it('refuses to leave an amount unpaid without a customer', () => {
    expect(() =>
      salesService.createSale({
        items: [{ productId: product.id, unitName: 'piece', qty: 1, rate: 150 }],
        paymentType: 'credit',
        paidAmount: 0
      })
    ).toThrowError(/walk-in bill must be paid in cash/i)
  })
})

describe('units and pricing', () => {
  it('converts a carton into base units', () => {
    salesService.createSale({
      items: [{ productId: product.id, unitName: 'carton', qty: 2, rate: 1700 }],
      paymentType: 'cash',
      paidAmount: 3400
    })

    expect(productService.getProduct(product.id).stockQty).toBe(76)
  })

  it('remembers the price a customer was given and suggests it next time', () => {
    salesService.createSale({
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 5, rate: 138 }],
      paymentType: 'cash',
      paidAmount: 690
    })

    const suggestion = salesService.suggestPrice(customer.id, product.id, 'piece')
    expect(suggestion).toEqual({ rate: 138, source: 'customer_history' })

    // A different customer still gets the list price.
    const other = partyService.addParty('customer', { name: 'New Shop' })
    expect(salesService.suggestPrice(other.id, product.id, 'piece')).toEqual({
      rate: 150,
      source: 'product_default'
    })
  })

  it('falls back to the unit price for alternate units', () => {
    expect(salesService.suggestPrice(null, product.id, 'carton')).toEqual({
      rate: 1700,
      source: 'unit_default'
    })
  })
})

describe('sale guards', () => {
  it('refuses to sell more than is in stock', () => {
    expect(() =>
      salesService.createSale({
        items: [{ productId: product.id, unitName: 'piece', qty: 200, rate: 150 }],
        paymentType: 'cash',
        paidAmount: 30000
      })
    ).toThrowError(/in stock/i)

    expect(productService.getProduct(product.id).stockQty).toBe(100)
  })

  it('counts the same product across several lines when checking stock', () => {
    expect(() =>
      salesService.createSale({
        items: [
          { productId: product.id, unitName: 'piece', qty: 60, rate: 150 },
          { productId: product.id, unitName: 'piece', qty: 60, rate: 150 }
        ],
        paymentType: 'cash',
        paidAmount: 18000
      })
    ).toThrowError(/in stock/i)
  })

  it('refuses a bill discount larger than the bill', () => {
    expect(() =>
      salesService.createSale({
        items: [{ productId: product.id, unitName: 'piece', qty: 1, rate: 150 }],
        discount: 200,
        paymentType: 'cash',
        paidAmount: 0
      })
    ).toThrowError(/discount cannot be more/i)
  })

  it('writes nothing at all when a line fails', () => {
    expect(() =>
      salesService.createSale({
        items: [
          { productId: product.id, unitName: 'piece', qty: 5, rate: 150 },
          { productId: 9999, unitName: 'piece', qty: 1, rate: 10 }
        ],
        paymentType: 'cash',
        paidAmount: 760
      })
    ).toThrowError(/not found/i)

    expect(productService.getProduct(product.id).stockQty).toBe(100)
    expect(salesService.listSales().total).toBe(0)
  })
})

describe('tax', () => {
  it('adds tax after the bill discount when it is switched on', () => {
    settingsService.updateSettings({ taxEnabled: true, taxRate: 10 })

    const { sale } = salesService.createSale({
      items: [{ productId: product.id, unitName: 'piece', qty: 10, rate: 100 }],
      discount: 100,
      paymentType: 'cash',
      paidAmount: 990
    })

    expect(sale.subtotal).toBe(1000)
    expect(sale.discount).toBe(100)
    expect(sale.tax).toBe(90)
    expect(sale.total).toBe(990)
  })
})

describe('profit', () => {
  it('freezes the cost onto each line so later purchases do not change it', () => {
    salesService.createSale({
      items: [{ productId: product.id, unitName: 'piece', qty: 10, rate: 150 }],
      paymentType: 'cash',
      paidAmount: 1500
    })

    // Buying more stock at a higher price must not rewrite yesterday's profit.
    purchaseService.createPurchase({
      items: [{ productId: product.id, unitName: 'piece', qty: 100, unitCost: 130 }],
      paidAmount: 13000
    })

    const report = reportService.profitAndLoss({ from: today(), to: today() })
    expect(report.cogs).toBe(1000)
    expect(report.grossProfit).toBe(500)
  })

  it('subtracts expenses to reach net profit', async () => {
    const { addExpense } = await import('../src/main/services/expenseService')

    salesService.createSale({
      items: [{ productId: product.id, unitName: 'piece', qty: 20, rate: 150 }],
      paymentType: 'cash',
      paidAmount: 3000
    })
    addExpense({ title: 'Shop rent', amount: 800 })

    const report = reportService.profitAndLoss({ from: today(), to: today() })
    expect(report.grossProfit).toBe(1000)
    expect(report.expenses).toBe(800)
    expect(report.netProfit).toBe(200)
  })
})

describe('returns', () => {
  it('puts stock back and reverses profit at the original cost', () => {
    const { sale } = salesService.createSale({
      items: [{ productId: product.id, unitName: 'piece', qty: 10, rate: 150 }],
      paymentType: 'cash',
      paidAmount: 1500
    })

    returnService.createSaleReturn({
      saleId: sale.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 4, rate: 150 }],
      refundType: 'cash'
    })

    expect(productService.getProduct(product.id).stockQty).toBe(94)

    const report = reportService.profitAndLoss({ from: today(), to: today() })
    expect(report.salesReturns).toBe(600)
    expect(report.returnedCogs).toBe(400)
    // 6 pieces really sold: 900 revenue against 600 cost.
    expect(report.grossProfit).toBe(300)
  })

  it('reduces the khata when the refund is on credit', () => {
    const { sale } = salesService.createSale({
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 10, rate: 150 }],
      paymentType: 'credit',
      paidAmount: 0
    })

    returnService.createSaleReturn({
      saleId: sale.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 2, rate: 150 }],
      refundType: 'credit'
    })

    expect(partyService.getParty('customer', customer.id).currentBalance).toBe(1200)
  })

  it('will not accept more back than was sold on that bill', () => {
    const { sale } = salesService.createSale({
      items: [{ productId: product.id, unitName: 'piece', qty: 3, rate: 150 }],
      paymentType: 'cash',
      paidAmount: 450
    })

    expect(() =>
      returnService.createSaleReturn({
        saleId: sale.id,
        items: [{ productId: product.id, unitName: 'piece', qty: 5, rate: 150 }],
        refundType: 'cash'
      })
    ).toThrowError(/left to return/i)
  })

  it('takes stock out and reduces the payable on a purchase return', () => {
    const supplier = partyService.addParty('supplier', { name: 'Sunrise Distributors' })
    purchaseService.createPurchase({
      supplierId: supplier.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 50, unitCost: 100 }],
      paidAmount: 0
    })

    expect(partyService.getParty('supplier', supplier.id).currentBalance).toBe(5000)

    returnService.createPurchaseReturn({
      supplierId: supplier.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 10 }]
    })

    expect(partyService.getParty('supplier', supplier.id).currentBalance).toBe(4000)
    expect(productService.getProduct(product.id).stockQty).toBe(140)
  })
})

describe('the khata', () => {
  it('matches the cached balance to the statement, entry by entry', () => {
    salesService.createSale({
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 10, rate: 150 }],
      paymentType: 'credit',
      paidAmount: 0
    })
    salesService.createSale({
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 4, rate: 150 }],
      paymentType: 'partial',
      paidAmount: 200
    })
    paymentService.createPayment({ partyType: 'customer', partyId: customer.id, amount: 900 })

    const statement = ledgerService.getStatement('customer', customer.id, {
      from: '1900-01-01',
      to: today()
    })

    // 1500 + 400 charged, 900 received.
    expect(statement.totalDebit).toBe(1900)
    expect(statement.totalCredit).toBe(900)
    expect(statement.closingBalance).toBe(1000)
    expect(statement.closingBalance).toBe(
      partyService.getParty('customer', customer.id).currentBalance
    )
  })

  it('carries an opening balance into the statement', () => {
    const opener = partyService.addParty('customer', {
      name: 'Old Account',
      openingBalance: 5000
    })

    paymentService.createPayment({ partyType: 'customer', partyId: opener.id, amount: 2000 })

    const statement = ledgerService.getStatement('customer', opener.id, {
      from: '1900-01-01',
      to: today()
    })

    expect(statement.openingBalance).toBe(5000)
    expect(statement.closingBalance).toBe(3000)
    expect(partyService.getParty('customer', opener.id).currentBalance).toBe(3000)
  })

  it('restores the balance when a payment is removed', () => {
    salesService.createSale({
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 10, rate: 150 }],
      paymentType: 'credit',
      paidAmount: 0
    })

    const payment = paymentService.createPayment({
      partyType: 'customer',
      partyId: customer.id,
      amount: 500
    })
    expect(partyService.getParty('customer', customer.id).currentBalance).toBe(1000)

    paymentService.removePayment(payment.id)
    expect(partyService.getParty('customer', customer.id).currentBalance).toBe(1500)
  })

  it('locks the opening balance once the account has history', () => {
    salesService.createSale({
      customerId: customer.id,
      items: [{ productId: product.id, unitName: 'piece', qty: 1, rate: 150 }],
      paymentType: 'credit',
      paidAmount: 0
    })

    expect(() =>
      partyService.updateParty('customer', customer.id, {
        name: customer.name,
        openingBalance: 9999
      })
    ).toThrowError(/opening balance can no longer be changed/i)
  })
})

describe('tax never inflates sales or profit', () => {
  // Guards the reportService fix: with tax on, the daily summary and P&L must
  // measure sales and profit net of tax — collected tax is not revenue.
  it('excludes collected tax from the daily summary and the P&L', () => {
    settingsService.updateSettings({ taxEnabled: true, taxRate: 10 })

    // 10 @ 150 = 1500 subtotal; cost 100/unit -> COGS 1000; 10% tax -> total 1650.
    const { sale } = salesService.createSale({
      items: [{ productId: product.id, unitName: 'piece', qty: 10, rate: 150 }],
      paymentType: 'cash',
      paidAmount: 1650
    })
    expect(sale.total).toBe(1650)
    expect(sale.tax).toBe(150)

    const range = { from: today(), to: today() }

    const summary = reportService.salesSummary(range)
    // Sales is net of tax (1500, not 1650); profit excludes tax (500, not 650).
    expect(summary.totalSales).toBe(1500)
    expect(summary.totalProfit).toBe(500)
    expect(summary.daily.at(-1)?.profit).toBe(500)

    const pnl = reportService.profitAndLoss(range)
    expect(pnl.taxCollected).toBe(150)
    expect(pnl.netSales).toBe(1500)
    expect(pnl.grossProfit).toBe(500)
    expect(pnl.netProfit).toBe(500)
  })
})

describe('opening stock and weight-sold products', () => {
  // Guards the ProductForm warning's premise: opening stock must carry its cost
  // into COGS, and a product counted in kg must sell at a fractional quantity.
  it('carries opening-stock cost into profit and sells by weight', () => {
    const ghee = productService.addProduct({
      name: 'Loose ghee',
      baseUnit: 'kg',
      costPrice: 900, // cost of the opening stock
      salePrice: 1200,
      reorderLevel: 0,
      openingStock: 5,
      units: []
    })

    const fresh = productService.getProduct(ghee.id)
    expect(fresh.stockQty).toBe(5)
    expect(fresh.costPrice).toBe(900)

    // Sell 2.5 kg — a fractional, weight-based quantity.
    salesService.createSale({
      items: [{ productId: ghee.id, unitName: 'kg', qty: 2.5, rate: 1200 }],
      paymentType: 'cash',
      paidAmount: 3000
    })

    expect(productService.getProduct(ghee.id).stockQty).toBe(2.5)

    const pnl = reportService.profitAndLoss({ from: today(), to: today() })
    expect(pnl.netSales).toBe(3000) // 2.5 × 1200
    expect(pnl.cogs).toBe(2250) // 2.5 × 900  — not zero
    expect(pnl.grossProfit).toBe(750)
  })
})
