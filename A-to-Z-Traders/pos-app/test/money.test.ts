import { describe, expect, it } from 'vitest'
import { isSameMoney, money, percentOf, qty, sumMoney } from '../src/shared/money'
import { amountInWords } from '../src/main/utils/amountInWords'

describe('money rounding', () => {
  it('rounds to two decimal places', () => {
    expect(money(10.005)).toBe(10.01)
    expect(money(10.004)).toBe(10)
    expect(money(1 / 3)).toBe(0.33)
  })

  it('survives the float cases that break naive rounding', () => {
    // 1.005 * 100 is 100.49999999999999 in IEEE 754, so Math.round gives 1.00.
    expect(money(1.005)).toBe(1.01)
    expect(money(8.475)).toBe(8.48)
    expect(money(0.615)).toBe(0.62)
  })

  it('rounds negatives away from zero, symmetrically', () => {
    expect(money(-1.005)).toBe(-1.01)
    expect(money(-10.004)).toBe(-10)
  })

  it('treats non-finite input as zero rather than propagating NaN', () => {
    expect(money(Number.NaN)).toBe(0)
    expect(money(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('keeps a sum of rounded values consistent', () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3)
    expect(sumMoney([33.333, 33.333, 33.334])).toBe(100)
  })

  it('rounds quantities to three places', () => {
    expect(qty(1.23456)).toBe(1.235)
    expect(qty(0.0004)).toBe(0)
  })

  it('computes a percentage of an amount', () => {
    expect(percentOf(1000, 17)).toBe(170)
    expect(percentOf(999.99, 5)).toBe(50)
  })

  it('compares amounts within half a paisa', () => {
    expect(isSameMoney(10, 10.004)).toBe(true)
    expect(isSameMoney(10, 10.01)).toBe(false)
  })
})

describe('amount in words', () => {
  it('uses the South Asian numbering system', () => {
    expect(amountInWords(120000)).toBe('Rupees One Lakh Twenty Thousand Only')
    expect(amountInWords(10000000)).toBe('Rupees One Crore Only')
    expect(amountInWords(1234)).toBe('Rupees One Thousand Two Hundred Thirty Four Only')
  })

  it('includes paisa when there are any', () => {
    expect(amountInWords(1250.75)).toBe(
      'Rupees One Thousand Two Hundred Fifty and Seventy Five Paisa Only'
    )
  })

  it('handles zero and negatives', () => {
    expect(amountInWords(0)).toBe('Rupees Zero Only')
    expect(amountInWords(-500)).toBe('Minus Rupees Five Hundred Only')
  })

  it('carries a fraction that rounds up to a full rupee', () => {
    // 0.999 * 100 rounds to 100 paisa; it must fold into the rupees rather
    // than read "... and One Hundred Paisa".
    expect(amountInWords(1250.999)).toBe('Rupees One Thousand Two Hundred Fifty One Only')
    expect(amountInWords(0.999)).toBe('Rupees One Only')
  })
})
