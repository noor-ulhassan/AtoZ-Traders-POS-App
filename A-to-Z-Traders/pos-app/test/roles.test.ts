import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from './helpers/database'
import * as authService from '../src/main/services/authService'
import * as userService from '../src/main/services/userService'
import * as dashboardService from '../src/main/services/dashboardService'
import * as reportService from '../src/main/services/reportService'
import * as expenseService from '../src/main/services/expenseService'
import * as productService from '../src/main/services/productService'
import * as purchaseService from '../src/main/services/purchaseService'
import * as salesService from '../src/main/services/salesService'
import { currentRole, lock as lockSession, unlock } from '../src/main/auth/session'
import { isAuthorized } from '../src/main/ipc/registry'
import { IPC_CHANNELS } from '../src/shared/ipc'
import { today } from '../src/shared/date'
import { getDb } from '../src/main/db/connection'
import { findByUsername } from '../src/main/repositories/userRepository'

const ADMIN = {
  password: 'correct-horse-battery',
  securityQuestion: 'What was your first pet?',
  securityAnswer: 'Rex'
}

beforeEach(() => {
  createTestDb()
  lockSession()
  authService.setup(ADMIN) // leaves the admin session unlocked
})

describe('staff accounts', () => {
  it('creates a shopkeeper and stores only a hash of the PIN', () => {
    const user = userService.createUser({ username: 'ali', pin: '1234' })
    expect(user.role).toBe('shopkeeper')
    expect(user.isActive).toBe(true)

    const row = findByUsername(getDb(), 'ali')!
    expect(row.pin_hash).not.toContain('1234')
    expect(row.pin_hash.length).toBeGreaterThan(16)
  })

  it('rejects a PIN that is not four digits', () => {
    expect(() => userService.createUser({ username: 'ali', pin: '12' })).toThrow(/four digits/i)
    expect(() => userService.createUser({ username: 'ali', pin: 'abcd' })).toThrow(/four digits/i)
  })

  it('refuses a duplicate username (case-insensitive)', () => {
    userService.createUser({ username: 'Ali', pin: '1234' })
    expect(() => userService.createUser({ username: 'ali', pin: '5678' })).toThrow()
  })
})

describe('staff login', () => {
  beforeEach(() => {
    userService.createUser({ username: 'ali', pin: '1234' })
    lockSession()
  })

  it('signs in with the right PIN as a shopkeeper', () => {
    const status = authService.staffLogin({ username: 'ali', pin: '1234' })
    expect(status.unlocked).toBe(true)
    expect(status.role).toBe('shopkeeper')
    expect(status.username).toBe('ali')
    expect(currentRole()).toBe('shopkeeper')
  })

  it('rejects a wrong PIN and stays locked', () => {
    expect(() => authService.staffLogin({ username: 'ali', pin: '0000' })).toThrow()
    expect(currentRole()).toBeNull()
  })

  it('fails identically for an unknown username (no user enumeration)', () => {
    let unknownError = ''
    let wrongPinError = ''
    try {
      authService.staffLogin({ username: 'ghost', pin: '1234' })
    } catch (error) {
      unknownError = (error as Error).message
    }
    try {
      authService.staffLogin({ username: 'ali', pin: '0000' })
    } catch (error) {
      wrongPinError = (error as Error).message
    }
    expect(unknownError).toBe(wrongPinError)
  })

  it('locks the account after five wrong PINs, refusing even the right one', () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(() => authService.staffLogin({ username: 'ali', pin: '0000' })).toThrow()
    }
    expect(() => authService.staffLogin({ username: 'ali', pin: '1234' })).toThrow(
      /too many attempts/i
    )
  })

  it('refuses a disabled account', () => {
    const user = findByUsername(getDb(), 'ali')!
    userService.setUserActive({ id: user.id, isActive: false })
    expect(() => authService.staffLogin({ username: 'ali', pin: '1234' })).toThrow(/turned off/i)
  })

  it('signs in again after the admin resets the PIN', () => {
    const user = findByUsername(getDb(), 'ali')!
    userService.resetPin({ id: user.id, pin: '9999' })
    expect(() => authService.staffLogin({ username: 'ali', pin: '1234' })).toThrow()
    expect(authService.staffLogin({ username: 'ali', pin: '9999' }).role).toBe('shopkeeper')
  })
})

describe('access policy (fail-closed)', () => {
  it('lets the admin reach every channel', () => {
    unlock('admin')
    expect(isAuthorized(IPC_CHANNELS.salesCreate, {})).toBe(true)
    expect(isAuthorized(IPC_CHANNELS.reportsProfitLoss, {})).toBe(true)
    expect(isAuthorized(IPC_CHANNELS.usersCreate, {})).toBe(true)
    expect(isAuthorized(IPC_CHANNELS.backupRestore, {})).toBe(true)
    expect(isAuthorized(IPC_CHANNELS.settingsUpdate, {})).toBe(true)
  })

  it('lets a shopkeeper bill, view products and see the dashboard', () => {
    unlock('shopkeeper', 'ali')
    expect(isAuthorized(IPC_CHANNELS.salesCreate, {})).toBe(true)
    expect(isAuthorized(IPC_CHANNELS.productsList, {})).toBe(true)
    expect(isAuthorized(IPC_CHANNELS.dashboardSummary, {})).toBe(true)
    expect(isAuthorized(IPC_CHANNELS.reportsSalesSummary, {})).toBe(true)
    expect(isAuthorized(IPC_CHANNELS.saleReturnsCreate, {})).toBe(true)
    expect(isAuthorized(IPC_CHANNELS.customersAdd, {})).toBe(true)
  })

  it('denies a shopkeeper the owner-only channels', () => {
    unlock('shopkeeper', 'ali')
    expect(isAuthorized(IPC_CHANNELS.reportsProfitLoss, {})).toBe(false)
    expect(isAuthorized(IPC_CHANNELS.reportsStockValuation, {})).toBe(false)
    expect(isAuthorized(IPC_CHANNELS.exportCsv, {})).toBe(false)
    expect(isAuthorized(IPC_CHANNELS.backupInfo, {})).toBe(false)
    expect(isAuthorized(IPC_CHANNELS.settingsUpdate, {})).toBe(false)
    expect(isAuthorized(IPC_CHANNELS.usersCreate, {})).toBe(false)
    expect(isAuthorized(IPC_CHANNELS.usersList, {})).toBe(false)
    expect(isAuthorized(IPC_CHANNELS.purchasesCreate, {})).toBe(false)
    expect(isAuthorized(IPC_CHANNELS.purchaseReturnsCreate, {})).toBe(false)
    expect(isAuthorized(IPC_CHANNELS.customersUpdate, {})).toBe(false)
    expect(isAuthorized(IPC_CHANNELS.stockAdjust, {})).toBe(false)
    expect(isAuthorized(IPC_CHANNELS.expensesAdd, {})).toBe(false)
    expect(isAuthorized(IPC_CHANNELS.backupRestore, {})).toBe(false)
    expect(isAuthorized(IPC_CHANNELS.paymentsDelete, {})).toBe(false)
  })

  it('lets a shopkeeper record a customer receipt but never a supplier payout', () => {
    unlock('shopkeeper', 'ali')
    expect(isAuthorized(IPC_CHANNELS.paymentsCreate, { input: { partyType: 'customer' } })).toBe(
      true
    )
    expect(isAuthorized(IPC_CHANNELS.paymentsCreate, { input: { partyType: 'supplier' } })).toBe(
      false
    )
  })
})

describe('dashboard redaction', () => {
  const range = { from: today(), to: today() }

  /** One credit sale at a profit, plus an expense, so every figure is non-zero. */
  function seedTradingDay(): void {
    const product = productService.addProduct({
      name: 'Rice 25kg',
      baseUnit: 'bag',
      costPrice: 0,
      salePrice: 3000,
      reorderLevel: 5
    })
    purchaseService.createPurchase({
      items: [{ productId: product.id, unitName: 'bag', qty: 20, unitCost: 2000 }],
      paidAmount: 40000
    })
    const buyer = getDb().prepare('INSERT INTO customers (name) VALUES (?)').run('Khan Store')
    salesService.createSale({
      customerId: Number(buyer.lastInsertRowid),
      items: [{ productId: product.id, unitName: 'bag', qty: 5, rate: 3000 }],
      paymentType: 'credit',
      paidAmount: 0
    })
    expenseService.addExpense({ title: 'Shop rent', amount: 5000 })
  }

  beforeEach(seedTradingDay)

  it('gives the admin the full financial picture', () => {
    unlock('admin')
    const summary = dashboardService.getSummary(range)
    expect(summary.sales).toBeGreaterThan(0)
    expect(summary.profit).toBeGreaterThan(0)
    expect(summary.expenses).toBe(5000)
    expect(summary.receivables).toBeGreaterThan(0)
    expect(summary.topProducts.length).toBeGreaterThan(0)
  })

  it('strips profit, expenses, cash and payables for a shopkeeper', () => {
    unlock('shopkeeper', 'ali')
    const summary = dashboardService.getSummary(range)
    // Sensitive figures are zeroed in the payload itself.
    expect(summary.profit).toBe(0)
    expect(summary.expenses).toBe(0)
    expect(summary.cashInHand).toBe(0)
    expect(summary.payables).toBe(0)
    expect(summary.topProducts).toEqual([])
    expect(summary.trend.every((point) => point.profit === 0)).toBe(true)
    // Operational figures a counter needs survive.
    expect(summary.sales).toBeGreaterThan(0)
    expect(summary.receivables).toBeGreaterThan(0)
    expect(summary.recentSales.length).toBeGreaterThan(0)
  })

  it('strips profit from the Sales-page summary for a shopkeeper but keeps sales', () => {
    unlock('admin')
    const asAdmin = reportService.salesSummary(range)
    expect(asAdmin.totalProfit).toBeGreaterThan(0)
    expect(asAdmin.topProducts.length).toBeGreaterThan(0)

    unlock('shopkeeper', 'ali')
    const asStaff = reportService.salesSummary(range)
    expect(asStaff.totalSales).toBe(asAdmin.totalSales)
    expect(asStaff.billCount).toBe(asAdmin.billCount)
    expect(asStaff.totalProfit).toBe(0)
    expect(asStaff.topProducts).toEqual([])
    expect(asStaff.daily.every((point) => point.profit === 0)).toBe(true)
  })
})
