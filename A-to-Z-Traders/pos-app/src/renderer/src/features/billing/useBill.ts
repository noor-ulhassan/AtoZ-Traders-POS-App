import { useCallback, useMemo, useRef, useState } from 'react'
import type { Customer, PriceSuggestion, Product, SaleWithItems, SellableUnit } from '@shared/types'
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
  /**
   * Base quantities the screen may count as already back on the shelf, keyed
   * by product id.
   *
   * Only used when editing an issued bill. The saved bill's own deduction is
   * still in `products.stock_qty`, but saving reverses it before it re-checks
   * anything (`salesService.updateSale`) — so without this the screen would
   * refuse to re-save a bill that sold the last of an item, for a shortage the
   * server would never see. The allowance keeps the warning honest in both
   * directions: adding MORE than the bill originally took still warns.
   */
  stockAllowance?: Map<number, number>
}

export interface LoadOptions {
  /**
   * Keep the rates the bill was saved with (an edit), or re-ask for today's
   * suggested price (repeating an order weeks later). Editing must keep them:
   * a rate the owner negotiated is the one thing an edit must not silently
   * change under him.
   */
  keepRates?: boolean
  /** Also adopt the saved bill's customer. */
  keepCustomer?: boolean
}

/** A product the bill asks for more of than the shelf holds. */
export interface BillShortage {
  product: Product
  needed: number
  /** What the save will actually have to draw on, allowance included. */
  available: number
}

export interface Bill {
  customer: Customer | null
  setCustomer: (customer: Customer | null) => void
  lines: BillLine[]
  addProduct: (product: Product, customerId: number | null) => Promise<void>
  updateLine: (key: number, patch: Partial<BillLine>) => void
  changeUnit: (line: BillLine, unitName: string, customerId: number | null) => Promise<void>
  removeLine: (key: number) => void
  /** Fills the bill from a saved one — used to edit it, or to repeat it. */
  load: (sale: SaleWithItems, options?: LoadOptions) => Promise<void>
  isLoading: boolean
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
export function useBill({ taxEnabled, taxRate, stockAllowance }: UseBillOptions): Bill {
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [lines, setLines] = useState<BillLine[]>([])
  const [discount, setDiscount] = useState(0)
  const [notes, setNotes] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const nextKey = useRef(1)

  const totals = useMemo<BillTotals>(() => {
    // Mirror salesService exactly: the rate is rounded first, then the gross,
    // then the (rounded) line discount comes off it — so the screen can never
    // show a subtotal the save then disagrees with by a paisa.
    const subtotal = sumMoney(
      lines.map((line) => money(money(line.qty * money(line.rate)) - money(line.lineDiscount)))
    )
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

  /**
   * Fills the bill from one that is already saved.
   *
   * Each line is rebuilt from the *current* product and unit list rather than
   * from the saved row alone, because the screen needs the live stock figure
   * to warn about shortages and the live unit list for the unit dropdown. The
   * quantity, rate and line discount come from the saved bill.
   *
   * A line whose product has since been deleted is skipped rather than
   * crashing the screen; the owner sees a shorter bill and can re-add it.
   */
  const load = useCallback(
    async (sale: SaleWithItems, options: LoadOptions = {}): Promise<void> => {
      setIsLoading(true)
      try {
        const loaded = await Promise.all(
          sale.items.map(async (item): Promise<BillLine | null> => {
            try {
              const [product, units] = await Promise.all([
                unwrap(api.products.get(item.productId)),
                unwrap(api.products.sellableUnits(item.productId))
              ])
              const unit =
                units.find((candidate) => candidate.unitName === item.unitName) ??
                (units[0] as SellableUnit)

              let rate = item.rate
              if (!options.keepRates) {
                const suggestion = await unwrap(
                  api.sales.suggestPrice(
                    options.keepCustomer ? sale.customerId : null,
                    product.id,
                    unit.unitName
                  )
                )
                rate = suggestion.rate
              }

              return {
                key: nextKey.current++,
                product,
                units,
                unitName: unit.unitName,
                factor: unit.factor,
                qty: item.qty,
                rate,
                lineDiscount: options.keepRates ? item.lineDiscount : 0,
                priceSource: options.keepRates ? 'customer_history' : 'product_default'
              }
            } catch {
              return null
            }
          })
        )

        setLines(loaded.filter((line): line is BillLine => line !== null))
        setDiscount(options.keepRates ? sale.discount : 0)
        setNotes(options.keepRates ? (sale.notes ?? '') : '')

        if (options.keepCustomer && sale.customerId != null) {
          setCustomer(await unwrap(api.customers.get(sale.customerId)))
        }
      } finally {
        setIsLoading(false)
      }
    },
    []
  )

  /** Lines asking for more than is on the shelf, checked before saving. */
  const shortages = useMemo(() => {
    const needed = new Map<number, number>()
    for (const line of lines) {
      const baseQty = roundQty(line.qty * line.factor)
      needed.set(line.product.id, roundQty((needed.get(line.product.id) ?? 0) + baseQty))
    }

    const available = (product: Product): number =>
      roundQty(product.stockQty + (stockAllowance?.get(product.id) ?? 0))

    return lines
      .filter(
        (line, index, all) => all.findIndex((l) => l.product.id === line.product.id) === index
      )
      .filter((line) => (needed.get(line.product.id) ?? 0) > available(line.product))
      .map((line) => ({
        product: line.product,
        needed: needed.get(line.product.id) ?? 0,
        available: available(line.product)
      }))
  }, [lines, stockAllowance])

  return {
    customer,
    setCustomer,
    lines,
    addProduct,
    updateLine,
    changeUnit,
    removeLine,
    load,
    isLoading,
    discount,
    setDiscount,
    notes,
    setNotes,
    totals,
    shortages,
    reset
  }
}
