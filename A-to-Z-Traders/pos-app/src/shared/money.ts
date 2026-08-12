/**
 * Money and quantity arithmetic.
 *
 * Convention (Guide §1.7): money is stored as REAL and rounded to 2 decimal
 * places on every write and in every intermediate total. Every monetary value
 * that enters the database must pass through `money()`.
 */

const MONEY_DP = 2
const QTY_DP = 3

/** Round half-away-from-zero, avoiding the float artefacts of `Math.round`. */
function roundTo(value: number, dp: number): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** dp
  // The epsilon nudge fixes cases such as 1.005 * 100 === 100.49999999999999.
  const scaled = value * factor
  const rounded = Math.round(Math.abs(scaled) + Number.EPSILON * Math.abs(scaled))
  return (Math.sign(scaled) * rounded) / factor
}

/** Round a monetary amount to 2 dp. */
export function money(value: number): number {
  return roundTo(value, MONEY_DP)
}

/** Round a quantity to 3 dp — enough for grams/litres without float noise. */
export function qty(value: number): number {
  return roundTo(value, QTY_DP)
}

/** Sum monetary values, rounding the result. */
export function sumMoney(values: number[]): number {
  return money(values.reduce((total, value) => total + value, 0))
}

/** `percent` is a whole-number percentage, e.g. 17 for 17%. */
export function percentOf(value: number, percent: number): number {
  return money((value * percent) / 100)
}

/** Guard against `-0` reaching the UI or the database. */
export function normalizeZero(value: number): number {
  return value === 0 ? 0 : value
}

export function isSameMoney(a: number, b: number): boolean {
  return Math.abs(money(a) - money(b)) < 0.005
}
