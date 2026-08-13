import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from './helpers/database'
import * as authService from '../src/main/services/authService'
import { isUnlocked, lock as lockSession } from '../src/main/auth/session'
import { getCredential } from '../src/main/repositories/authRepository'
import { getDb } from '../src/main/db/connection'

const SETUP = {
  password: 'correct-horse-battery',
  securityQuestion: 'What was your first pet?',
  securityAnswer: 'Rex'
}

beforeEach(() => {
  createTestDb()
  // The session flag is module-level global state; start every test locked.
  lockSession()
})

describe('setup', () => {
  it('reports unconfigured on a fresh database', () => {
    expect(authService.getStatus().configured).toBe(false)
  })

  it('configures the admin and unlocks the session', () => {
    const status = authService.setup(SETUP)
    expect(status.configured).toBe(true)
    expect(status.unlocked).toBe(true)
    expect(isUnlocked()).toBe(true)
  })

  it('stores only hashes — never the plain password or answer', () => {
    authService.setup(SETUP)
    const row = getCredential(getDb())!
    expect(row.password_hash).not.toContain(SETUP.password)
    expect(row.security_answer_hash).not.toContain('rex')
    expect(row.password_hash.length).toBeGreaterThan(16)
    expect(row.password_salt).not.toEqual(row.security_answer_salt)
  })

  it('refuses a second setup', () => {
    authService.setup(SETUP)
    expect(() => authService.setup(SETUP)).toThrow()
  })
})

describe('login', () => {
  beforeEach(() => {
    authService.setup(SETUP)
    lockSession()
  })

  it('unlocks with the correct password', () => {
    expect(authService.login({ password: SETUP.password }).unlocked).toBe(true)
    expect(isUnlocked()).toBe(true)
  })

  it('rejects a wrong password and stays locked', () => {
    expect(() => authService.login({ password: 'wrong' })).toThrow()
    expect(isUnlocked()).toBe(false)
  })

  it('locks out after five failed attempts, refusing even the right password', () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(() => authService.login({ password: 'wrong' })).toThrow()
    }
    expect(authService.getStatus().locked).toBe(true)
    expect(() => authService.login({ password: SETUP.password })).toThrow(/too many attempts/i)
  })
})

describe('changePassword', () => {
  beforeEach(() => {
    authService.setup(SETUP) // setup leaves the session unlocked
  })

  it('swaps the password when the current one is correct', () => {
    authService.changePassword({
      currentPassword: SETUP.password,
      newPassword: 'a-brand-new-secret'
    })
    lockSession()
    expect(() => authService.login({ password: SETUP.password })).toThrow()
    expect(authService.login({ password: 'a-brand-new-secret' }).unlocked).toBe(true)
  })

  it('rejects a wrong current password', () => {
    expect(() =>
      authService.changePassword({ currentPassword: 'wrong', newPassword: 'a-brand-new-secret' })
    ).toThrow()
  })

  it('requires an unlocked session', () => {
    lockSession()
    expect(() =>
      authService.changePassword({
        currentPassword: SETUP.password,
        newPassword: 'a-brand-new-secret'
      })
    ).toThrow(/unlock/i)
  })
})

describe('resetPassword (recovery)', () => {
  beforeEach(() => {
    authService.setup(SETUP)
    lockSession()
  })

  it('exposes the security question for the prompt', () => {
    expect(authService.getSecurityQuestion().question).toBe(SETUP.securityQuestion)
  })

  it('resets and unlocks on the right answer, matched case-insensitively', () => {
    const status = authService.resetPassword({
      securityAnswer: '  rEx ',
      newPassword: 'recovered-secret'
    })
    expect(status.unlocked).toBe(true)
    lockSession()
    expect(authService.login({ password: 'recovered-secret' }).unlocked).toBe(true)
  })

  it('rejects a wrong answer and does not unlock', () => {
    expect(() =>
      authService.resetPassword({ securityAnswer: 'Fluffy', newPassword: 'recovered-secret' })
    ).toThrow()
    expect(isUnlocked()).toBe(false)
  })
})
