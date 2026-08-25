import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from './helpers/database'
import * as authService from '../src/main/services/authService'
import * as userService from '../src/main/services/userService'
import { currentRole, lock as lockSession, unlock } from '../src/main/auth/session'
import { isAuthorized } from '../src/main/ipc/registry'
import { IPC_CHANNELS } from '../src/shared/ipc'
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
