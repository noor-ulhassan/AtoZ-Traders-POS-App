import type {
  Id,
  PageWithTotals,
  PriceSuggestion,
  Receipt,
  Sale,
  SaleFilters,
  SaleInput,
  SalePageTotals,
  SaleWithItems
} from '@shared/types'
import { today } from '@shared/date'
import { money, percentOf, qty, sumMoney } from '@shared/money'
import { getDb } from '../db/connection'
import * as parties from '../repositories/partyRepository'
import * as sales from '../repositories/saleRepository'
import { businessRule, notFound } from '../utils/errors'
import { buildReceipt } from '../printing/receiptBuilder'
import { recordMovement } from './inventoryService'
import { requireParty } from './partyService'
import { requireProduct, resolveUnit } from './productService'
import { getSettings } from './settingsService'

export function listSales(filters: SaleFilters = {}): PageWithTotals<Sale, SalePageTotals> {
  return sales.listSales(getDb(), filters)
}

export function getSale(id: Id): SaleWithItems {
  const db = getDb()
  const sale = sales.findSale(db, id)
  if (!sale) throw notFound('Sale')
  return { ...sale, items: sales.listItems(db, id) }
}

export function peekNextInvoiceNo(): string {
  return sales.nextInvoiceNo(getDb())
}

/**
 * The rate to pre-fill on the billing screen.
 *
 * Wholesale is a relationship business: the price a customer was last given is
 * the price they expect next time. That takes priority over the list price,
 * and the biller can still type over it.
 */
export function suggestPrice(
  customerId: Id | null,
  productId: Id,
  unitName: string
): PriceSuggestion {
  const db = getDb()
  const product = requireProduct(db, productId)
  const unit = resolveUnit(db, product, unitName)

  if (customerId != null) {
    const remembered = sales.findCustomerPrice(db, customerId, productId, unit.unitName)
    if (remembered != null) {
      return { rate: remembered, source: 'customer_history' }
    }
  }

  return {
    rate: unit.salePrice,
    source: unit.isBase ? 'product_default' : 'unit_default'
  }
}

/**
 * Records a sale as one atomic transaction (Guide §1.5, §4):
 * sale header + items + one stock movement per line + cached stock + customer
 * balance + remembered prices. Any failure leaves the shop exactly as it was.
 */
export function createSale(input: SaleInput): { sale: SaleWithItems; receipt: Receipt } {
  const db = getDb()

  if (input.items.length === 0) {
    throw businessRule('Add at least one item to the bill.')
  }

  const date = input.date ?? today()
  const customerId = input.customerId ?? null

  if (customerId != null) requireParty(db, 'customer', customerId)
  if (customerId == null && input.paymentType !== 'cash') {
    throw businessRule('A walk-in bill must be paid in cash. Select a customer to sell on credit.')
  }

  const settings = getSettings()

  // Price everything and check stock before writing anything.
  const lines = input.items.map((item) => {
    const product = requireProduct(db, item.productId)
    const unit = resolveUnit(db, product, item.unitName)
    const lineQty = qty(item.qty)
    const baseQty = qty(lineQty * unit.factor)
    const lineDiscount = money(item.lineDiscount ?? 0)
    const gross = money(lineQty * item.rate)

    if (lineDiscount > gross) {
      throw businessRule(`The discount on "${product.name}" is more than the line total.`)
    }

    const isOther = product.ownership === 'other'

    return {
      product,
      unitName: unit.unitName,
      factor: unit.factor,
      qty: lineQty,
      baseQty,
      rate: money(item.rate),
      lineDiscount,
      // Cost is frozen onto the line so profit is fixed at sale time and
      // unaffected by later purchases (Guide §1.8). Consignment goods have no
      // cost to the shop, so the line carries zero and is marked, which is what
      // keeps it out of COGS and every margin below.
      costPrice: isOther ? 0 : product.costPrice,
      isOther,
      amount: money(gross - lineDiscount)
    }
  })

  assertStockIsAvailable(lines)

  const subtotal = sumMoney(lines.map((line) => line.amount))
  const otherSubtotal = sumMoney(lines.filter((line) => line.isOther).map((line) => line.amount))
  const ownSubtotal = money(subtotal - otherSubtotal)

  const discount = money(input.discount ?? 0)
  // A bill discount comes out of the shop's own margin, so it may only be given
  // against the shop's own goods. Letting it eat into consignment lines would
  // quietly hand away money that belongs to whoever owns them.
  if (discount > ownSubtotal) {
    throw otherSubtotal > 0
      ? businessRule(
          'A discount can only be given on your own goods. Other stock on this bill is sold at its full price.'
        )
      : businessRule('The bill discount cannot be more than the bill subtotal.')
  }

  const taxable = money(subtotal - discount)
  const tax = settings.taxEnabled ? percentOf(taxable, settings.taxRate) : 0
  const total = money(taxable + tax)
  const paidAmount = money(input.paidAmount)

  if (paidAmount > total) {
    throw businessRule('The amount received is more than the bill total.')
  }

  const paymentType = resolvePaymentType(total, paidAmount)
  const unpaid = money(total - paidAmount)

  if (unpaid > 0 && customerId == null) {
    throw businessRule('Select a customer before leaving an amount unpaid.')
  }

  const create = db.transaction(() => {
    const invoiceNo = sales.nextInvoiceNo(db)

    const saleId = sales.insertSale(db, {
      invoiceNo,
      customerId,
      date,
      subtotal,
      otherSubtotal,
      discount,
      tax,
      total,
      paidAmount,
      paymentType,
      notes: input.notes ?? null
    })

    for (const line of lines) {
      sales.insertSaleItem(db, {
        saleId,
        productId: line.product.id,
        unitName: line.unitName,
        factor: line.factor,
        qty: line.qty,
        baseQty: line.baseQty,
        rate: line.rate,
        lineDiscount: line.lineDiscount,
        costPrice: line.costPrice,
        isOther: line.isOther,
        amount: line.amount
      })

      recordMovement(db, {
        productId: line.product.id,
        changeQty: -line.baseQty,
        reason: 'sale',
        refTable: 'sales',
        refId: saleId,
        costPrice: line.costPrice,
        date,
        notes: null
      })

      if (customerId != null) {
        sales.rememberCustomerPrice(db, customerId, line.product.id, line.unitName, line.rate)
      }
    }

    if (customerId != null && unpaid !== 0) {
      parties.applyBalanceDelta(db, 'customer', customerId, unpaid)
    }

    return saleId
  })

  const saleId = create()
  const sale = getSale(saleId)
  return { sale, receipt: buildReceipt(sale) }
}

/**
 * Selling below zero is refused rather than warned about: in a wholesale shop
 * a negative shelf quantity means the stock ledger has stopped describing
 * reality, and every profit number downstream becomes a guess.
 */
function assertStockIsAvailable(
  lines: {
    product: { id: Id; name: string; stockQty: number; baseUnit: string }
    baseQty: number
  }[]
): void {
  const requested = new Map<Id, number>()
  for (const line of lines) {
    requested.set(line.product.id, qty((requested.get(line.product.id) ?? 0) + line.baseQty))
  }

  for (const line of lines) {
    const need = requested.get(line.product.id) ?? 0
    if (need > qty(line.product.stockQty)) {
      throw businessRule(
        `Only ${line.product.stockQty} ${line.product.baseUnit} of "${line.product.name}" are in stock; the bill needs ${need}.`
      )
    }
  }
}

/**
 * The payment type is derived from the money actually received rather than
 * trusted from the form — a bill marked "cash" with nothing paid would
 * silently vanish from the khata.
 */
function resolvePaymentType(total: number, paidAmount: number): SaleInput['paymentType'] {
  if (paidAmount >= total) return 'cash'
  if (paidAmount <= 0) return 'credit'
  return 'partial'
}

export function getReceipt(saleId: Id): Receipt {
  return buildReceipt(getSale(saleId))
}
