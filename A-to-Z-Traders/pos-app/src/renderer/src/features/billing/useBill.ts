import { useCallback, useMemo, useRef, useState } from 'react'
import type { Customer, PriceSuggestion, Product, SellableUnit } from '@shared/types'
import { money, percentOf, qty as roundQty, sumMoney } from '@shared/money'
import { api, unwrap } from '../../lib/api'

export interface BillLine {
  key: number
  product: Product
  units: SellableUnit[]
  unitName: string
  factor: number
  qty: number
  rate: number
  lineDiscount: number
  /** Where the pre-filled rate came from, so the biller knows why. */
  priceSource: PriceSuggestion['source']
}

export interface BillTotals {
  subtotal: number
  discount: number
  tax: number
  total: number
  /** What this bill earns, at the cost captured when each line was added. */
  profit: number
}

interface UseBillOptions {
  taxEnabled: boolean
  taxRate: number
}

/** A product the bill asks for more of than the shelf holds. */
export interface BillShortage {
  product: Product
  needed: number
}

export interface Bill {
  customer: Customer | null
  setCustomer: (customer: Customer | null) => void
  lines: BillLine[]
  addProduct: (product: Product, customerId: number | null) => Promise<void>
  updateLine: (key: number, patch: Partial<BillLine>) => void
  changeUnit: (line: BillLine, unitName: string, customerId: number | null) => Promise<void>
  removeLine: (key: number) => void
  discount: number
  setDiscount: (discount: number) => void
  notes: string
  setNotes: (notes: string) => void
  totals: BillTotals
  shortages: BillShortage[]
  reset: () => void
}

/**
 * All of a bill's state and arithmetic in one place.
 *
 * Kept out of the page component so the totals can be reasoned about — and
 * unit tested — without rendering anything. The rules here mirror
 * `salesService` exactly; the server still recomputes everything, but the
 * screen must never show a total that the save then disagrees with.
 */
export function useBill({ taxEnabled, taxRate }: UseBillOptions): Bill {
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [lines, setLines] = useState<BillLine[]>([])
  const [discount, setDiscount] = useState(0)
  const [notes, setNotes] = useState('')
  const nextKey = useRef(1)

  const totals = useMemo<BillTotals>(() => {
    const subtotal = sumMoney(lines.map((line) => money(line.qty * line.rate - line.lineDiscount)))
    const cappedDiscount = Math.min(discount, subtotal)
    const taxable = money(subtotal - cappedDiscount)
    const tax = taxEnabled ? percentOf(taxable, taxRate) : 0
    const cost = sumMoney(
      lines.map((line) => money(line.product.costPrice * roundQty(line.qty * line.factor)))
    )

    return {
      subtotal,
      discount: cappedDiscount,
      tax,
      total: money(taxable + tax),
      profit: money(subtotal - cappedDiscount - cost)
    }
  }, [lines, discount, taxEnabled, taxRate])

  /**
   * Adds a product to the bill.
   *
   * If the same product and unit is already on the bill, the quantity is
   * incremented instead of adding a second line — scanning the same item five
   * times should read "5", not five separate rows.
   */
  const addProduct = useCallback(
    async (product: Product, customerId: number | null): Promise<void> => {
      const units = await unwrap(api.products.sellableUnits(product.id))
      const base = units[0] as SellableUnit
      const suggestion = await unwrap(api.sales.suggestPrice(customerId, product.id, base.unitName))

      setLines((current) => {
        const existing = current.find(
          (line) => line.product.id === product.id && line.unitName === base.unitName
        )
        if (existing) {
          return current.map((line) =>
            line.key === existing.key ? { ...line, qty: roundQty(line.qty + 1) } : line
          )
        }

        return [
          ...current,
          {
            key: nextKey.current++,
            product,
            units,
            unitName: base.unitName,
            factor: base.factor,
            qty: 1,
            rate: suggestion.rate,
            lineDiscount: 0,
            priceSource: suggestion.source
          }
        ]
      })
    },
    []
  )

  const updateLine = useCallback((key: number, patch: Partial<BillLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }, [])

  /** Switching unit re-asks for the right price for that unit. */
  const changeUnit = useCallback(
    async (line: BillLine, unitName: string, customerId: number | null): Promise<void> => {
      const unit = line.units.find((candidate) => candidate.unitName === unitName)
      if (!unit) return

      const suggestion = await unwrap(
        api.sales.suggestPrice(customerId, line.product.id, unit.unitName)
      )

      setLines((current) =>
        current.map((candidate) =>
          candidate.key === line.key
            ? {
                ...candidate,
                unitName: unit.unitName,
                factor: unit.factor,
                rate: suggestion.rate,
                priceSource: suggestion.source
              }
            : candidate
        )
      )
    },
    []
  )

  const removeLine = useCallback((key: number) => {
    setLines((current) => current.filter((line) => line.key !== key))
  }, [])

  const reset = useCallback(() => {
    setCustomer(null)
    setLines([])
    setDiscount(0)
    setNotes('')
  }, [])

  /** Lines asking for more than is on the shelf, checked before saving. */
  const shortages = useMemo(() => {
    const needed = new Map<number, number>()
    for (const line of lines) {
      const baseQty = roundQty(line.qty * line.factor)
      needed.set(line.product.id, roundQty((needed.get(line.product.id) ?? 0) + baseQty))
    }

    return lines
      .filter(
        (line, index, all) => all.findIndex((l) => l.product.id === line.product.id) === index
      )
      .filter((line) => (needed.get(line.product.id) ?? 0) > roundQty(line.product.stockQty))
      .map((line) => ({
        product: line.product,
        needed: needed.get(line.product.id) ?? 0
      }))
  }, [lines])

  return {
    customer,
    setCustomer,
    lines,
    addProduct,
    updateLine,
    changeUnit,
    removeLine,
    discount,
    setDiscount,
    notes,
    setNotes,
    totals,
    shortages,
    reset
  }
}
