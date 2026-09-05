import type {
  Id,
  PageWithTotals,
  PaymentType,
  PriceSuggestion,
  Product,
  Receipt,
  Sale,
  SaleFilters,
  SaleInput,
  SalePageTotals,
  SaleRevision,
  SaleRevisionAction,
  SaleRevisionSnapshot,
  SaleSettleInput,
  SaleUpdateInput,
  SaleVoidInput,
  SaleWithItems
} from '@shared/types'
import { today } from '@shared/date'
import { money, percentOf, qty, sumMoney } from '@shared/money'
import { currentUsername } from '../auth/session'
import type { Db } from '../db/connection'
import { getDb } from '../db/connection'
import * as parties from '../repositories/partyRepository'
import * as returns from '../repositories/returnRepository'
import * as sales from '../repositories/saleRepository'
import { businessRule, notFound } from '../utils/errors'
import { buildReceipt } from '../printing/receiptBuilder'
import { recordMovement, removeMovementsFor } from './inventoryService'
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

/** One bill line, priced and checked, ready to be written. */
interface PricedLine {
  product: Product
  unitName: string
  factor: number
  qty: number
  baseQty: number
  rate: number
  lineDiscount: number
  costPrice: number
  isOther: boolean
  amount: number
}

/** A whole bill, priced and checked, ready to be written. */
interface PricedBill {
  customerId: Id | null
  date: string
  lines: PricedLine[]
  subtotal: number
  otherSubtotal: number
  discount: number
  tax: number
  total: number
  paidAmount: number
  paymentType: PaymentType
  /** total - paidAmount; what this bill puts on the khata. */
  unpaid: number
  notes: string | null
}

/**
 * Every rule a bill has to satisfy, in one place.
 *
 * Split out of `createSale` when editing arrived (Phase 4b): a re-issued bill
 * must obey exactly the same rules as a new one — the same stock check, the
 * same walk-in and discount rules, the same derived payment type. Two copies
 * of this would drift, and the copy that drifted would be the one that lets a
 * bad bill through.
 *
 * `frozenCosts` is how an edit keeps history honest: a line whose product was
 * already on the bill keeps the cost captured when it was first sold, so
 * correcting a typo cannot restate what an old month earned. Only genuinely
 * new lines take today's cost.
 */
function priceBill(
  db: Db,
  input: SaleInput,
  frozenCosts: Map<Id, number> = new Map()
): PricedBill {
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
  const lines = input.items.map<PricedLine>((item) => {
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
      costPrice: isOther ? 0 : (frozenCosts.get(product.id) ?? product.costPrice),
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

  const unpaid = money(total - paidAmount)

  if (unpaid > 0 && customerId == null) {
    throw businessRule('Select a customer before leaving an amount unpaid.')
  }

  return {
    customerId,
    date,
    lines,
    subtotal,
    otherSubtotal,
    discount,
    tax,
    total,
    paidAmount,
    paymentType: resolvePaymentType(total, paidAmount),
    unpaid,
    notes: input.notes ?? null
  }
}

/**
 * Writes a priced bill's lines: the item rows, one stock movement each, and
 * the remembered price for next time. Caller supplies the sale id and must
 * already be inside a transaction.
 */
function writeLines(db: Db, saleId: Id, bill: PricedBill): void {
  for (const line of bill.lines) {
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
      date: bill.date,
      notes: null
    })

    if (bill.customerId != null) {
      sales.rememberCustomerPrice(db, bill.customerId, line.product.id, line.unitName, line.rate)
    }
  }
}

/**
 * Records a sale as one atomic transaction (Guide §1.5, §4):
 * sale header + items + one stock movement per line + cached stock + customer
 * balance + remembered prices. Any failure leaves the shop exactly as it was.
 */
export function createSale(input: SaleInput): { sale: SaleWithItems; receipt: Receipt } {
  const db = getDb()
  const bill = priceBill(db, input)

  const create = db.transaction(() => {
    const invoiceNo = sales.nextInvoiceNo(db)

    const saleId = sales.insertSale(db, {
      invoiceNo,
      customerId: bill.customerId,
      date: bill.date,
      subtotal: bill.subtotal,
      otherSubtotal: bill.otherSubtotal,
      discount: bill.discount,
      tax: bill.tax,
      total: bill.total,
      paidAmount: bill.paidAmount,
      paymentType: bill.paymentType,
      notes: bill.notes
    })

    writeLines(db, saleId, bill)

    if (bill.customerId != null && bill.unpaid !== 0) {
      parties.applyBalanceDelta(db, 'customer', bill.customerId, bill.unpaid)
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


// ===========================================================================
// Phase 4 - changing a bill after it has been issued
//
// The client: "He will generate the bill. Deliver the product. And if he finds
// out the customer will pay half or full or no payment then he should be able
// to edit this bill, and all the data throughout the app and the database must
// be updated according to it."
//
// That is two requests in one sentence, and they are built as two operations
// on purpose:
//
//   * SETTLE - the money changed, the goods did not. The overwhelmingly common
//     case, and the one that prompted the request: the bill was always right,
//     he simply now knows what came back with the delivery.
//   * EDIT - the bill itself changed. Two of ten cartons came back at the door,
//     or the rate was renegotiated. Reverse the whole bill and re-issue it
//     under the same invoice number, in one transaction.
//
// A third, VOID, is deliberately separate from both: nothing was delivered and
// nothing is owed.
//
// Why this is safe rather than frightening: the khata is DERIVED - every
// customer statement is computed from sales, payments and returns - so
// correcting a bill corrects every statement that quotes it, and only the
// cached balance needs an explicit nudge. Stock is a ledger with a cache in
// front, and `(ref_table, ref_id)` addresses one bill's movements as a set, so
// a bill can take back exactly what it took. And `bootstrapDatabase()`
// recomputes both from the underlying events at every launch, logging loudly
// on drift - a real net under all of this, which the tests assert never has to
// catch anything.
// ===========================================================================

/** Who is making the change, for the revision history. */
function changedBy(): string {
  return currentUsername() ?? 'owner'
}

/** The bill exactly as it stands now, for the history. */
function snapshotOf(sale: SaleWithItems): SaleRevisionSnapshot {
  return {
    invoiceNo: sale.invoiceNo,
    customerId: sale.customerId,
    customerName: sale.customerName,
    date: sale.date,
    subtotal: sale.subtotal,
    otherSubtotal: sale.otherSubtotal,
    discount: sale.discount,
    tax: sale.tax,
    total: sale.total,
    paidAmount: sale.paidAmount,
    paymentType: sale.paymentType,
    notes: sale.notes,
    voidedAt: sale.voidedAt,
    items: sale.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      unitName: item.unitName,
      factor: item.factor,
      qty: item.qty,
      baseQty: item.baseQty,
      rate: item.rate,
      lineDiscount: item.lineDiscount,
      costPrice: item.costPrice,
      isOther: item.isOther,
      amount: item.amount
    }))
  }
}

/**
 * Files the bill as it was, before it is changed. Call inside the transaction
 * doing the changing, so an edit that fails leaves no orphan history entry.
 */
function fileRevision(
  db: Db,
  before: SaleWithItems,
  action: SaleRevisionAction,
  reason: string | null
): void {
  sales.insertRevision(db, {
    saleId: before.id,
    action,
    changedBy: changedBy(),
    reason,
    snapshot: snapshotOf(before)
  })
}

/** The bill this operation is about, refusing the states it cannot handle. */
function requireLiveSale(id: Id): SaleWithItems {
  const sale = getSale(id)
  if (sale.voidedAt != null) {
    throw businessRule(
      `Invoice ${sale.invoiceNo} was cancelled. A cancelled bill cannot be changed - raise a new bill instead.`
    )
  }
  return sale
}

/**
 * A return already taken against this bill blocks both editing and voiding.
 *
 * A sale return captures the cost from the original line and caps itself
 * against what that bill sold. Rewriting the bill underneath one leaves the
 * return quoting a line that no longer exists, and the goods counted back in
 * twice. Refusing is the honest answer; the owner reverses the return first.
 */
function assertNoReturns(db: Db, sale: Sale, verb: string): void {
  if (returns.hasReturnsForSale(db, sale.id)) {
    throw businessRule(
      `Goods have already been returned against invoice ${sale.invoiceNo}, so it cannot be ${verb}. Reverse the return first.`
    )
  }
}

export function listSaleRevisions(saleId: Id): SaleRevision[] {
  const db = getDb()
  if (!sales.findSale(db, saleId)) throw notFound('Sale')
  return sales.listRevisions(db, saleId)
}

/**
 * Phase 4a - record what was actually paid on a bill that is already correct.
 *
 * Moves `sales.paid_amount` and nothing else about the goods, then nudges the
 * customer's cached balance by the same delta in the same transaction. The
 * statement corrects itself because it is derived; cash in hand corrects
 * itself because it sums `sales.paid_amount`.
 *
 * NOTE FOR THE UI: settling a bill and recording a payment are two routes to
 * the same money, and doing both double-counts it. Settle the BILL when the
 * money arrives with the delivery; record a PAYMENT when collecting against
 * the khata generally. The screens must say which is which, in those words.
 */
export function settleSale(input: SaleSettleInput): SaleWithItems {
  const db = getDb()
  const sale = requireLiveSale(input.id)

  const paidAmount = money(input.paidAmount)
  if (paidAmount < 0) {
    throw businessRule('The amount received cannot be negative.')
  }
  if (paidAmount > sale.total) {
    throw businessRule('The amount received is more than the bill total.')
  }

  const before = money(sale.total - sale.paidAmount)
  const after = money(sale.total - paidAmount)

  if (after > 0 && sale.customerId == null) {
    throw businessRule(
      'A walk-in bill has no khata to carry a balance. Record the full amount, or edit the bill to put it on a customer.'
    )
  }

  // Nothing to record, and a history entry saying nothing changed is noise.
  if (paidAmount === sale.paidAmount) return sale

  db.transaction(() => {
    fileRevision(db, sale, 'settle', input.reason ?? null)
    sales.updateSalePayment(db, sale.id, paidAmount, resolvePaymentType(sale.total, paidAmount))
    if (sale.customerId != null) {
      parties.applyBalanceDelta(db, 'customer', sale.customerId, money(after - before))
    }
  })()

  return getSale(sale.id)
}

/**
 * Phase 4b - re-issue a bill that has changed, under its original number.
 *
 * Reverse and re-write, all inside one transaction:
 *
 *   1. file the old bill in the revision history;
 *   2. take back its stock movements - addressable as a set - and the cached
 *      quantity with them;
 *   3. reverse the customer's balance by the old unpaid amount, and drop the
 *      old lines;
 *   4. price the new bill against the shelf as it now stands, and write it.
 *
 * Because the reversal happens FIRST, step 4's stock check needs no special
 * case: re-billing the same ten cartons sees the ten cartons back on the
 * shelf. And because the original costs are carried forward for products that
 * were already on the bill, fixing a rate cannot restate an old month's
 * profit.
 *
 * The invoice number is untouched. One piece of paper, one number, always.
 */
export function updateSale(input: SaleUpdateInput): { sale: SaleWithItems; receipt: Receipt } {
  const db = getDb()
  const existing = requireLiveSale(input.id)
  assertNoReturns(db, existing, 'edited')

  // The costs this bill already froze, by product. A line for a product that
  // was on the bill before keeps the cost it was sold at; a genuinely new line
  // takes today's cost inside `priceBill`.
  const frozenCosts = new Map<Id, number>()
  for (const item of existing.items) {
    if (!item.isOther && !frozenCosts.has(item.productId)) {
      frozenCosts.set(item.productId, item.costPrice)
    }
  }

  const oldUnpaid = money(existing.total - existing.paidAmount)

  const edit = db.transaction(() => {
    fileRevision(db, existing, 'edit', input.reason ?? null)

    // Undo the old bill completely before pricing the new one, so the new bill
    // is checked against a shelf and a khata that never saw it.
    removeMovementsFor(db, 'sales', existing.id)
    if (existing.customerId != null && oldUnpaid !== 0) {
      parties.applyBalanceDelta(db, 'customer', existing.customerId, money(-oldUnpaid))
    }
    sales.deleteSaleItems(db, existing.id)

    const bill = priceBill(db, input, frozenCosts)

    sales.updateSaleHeader(db, existing.id, {
      customerId: bill.customerId,
      date: bill.date,
      subtotal: bill.subtotal,
      otherSubtotal: bill.otherSubtotal,
      discount: bill.discount,
      tax: bill.tax,
      total: bill.total,
      paidAmount: bill.paidAmount,
      paymentType: bill.paymentType,
      notes: bill.notes
    })

    writeLines(db, existing.id, bill)

    if (bill.customerId != null && bill.unpaid !== 0) {
      parties.applyBalanceDelta(db, 'customer', bill.customerId, bill.unpaid)
    }
  })

  edit()

  const sale = getSale(existing.id)
  return { sale, receipt: buildReceipt(sale) }
}

/**
 * Cancels a bill: nothing delivered, nothing owed.
 *
 * A different intent from an edit, so a different operation with its own
 * confirmation. The bill is emptied rather than deleted - its stock goes back,
 * its lines go, its figures become zero and the customer's balance is
 * reversed - but the row and its invoice number stay, because that number was
 * printed and handed over, and it must never be issued again.
 *
 * Emptying rather than flagging is what keeps the reports right: every money
 * aggregate in the app sums a zero for a void bill and needed no new filter.
 * Only the two aggregates that COUNT bills read `voided_at`.
 */
export function voidSale(input: SaleVoidInput): SaleWithItems {
  const db = getDb()
  const sale = requireLiveSale(input.id)
  assertNoReturns(db, sale, 'cancelled')

  const unpaid = money(sale.total - sale.paidAmount)

  db.transaction(() => {
    fileRevision(db, sale, 'void', input.reason ?? null)

    removeMovementsFor(db, 'sales', sale.id)
    if (sale.customerId != null && unpaid !== 0) {
      parties.applyBalanceDelta(db, 'customer', sale.customerId, money(-unpaid))
    }
    sales.deleteSaleItems(db, sale.id)

    sales.updateSaleHeader(db, sale.id, {
      // The customer stays on the row so the cancelled bill is still findable
      // from their history - it just carries nothing.
      customerId: sale.customerId,
      date: sale.date,
      subtotal: 0,
      otherSubtotal: 0,
      discount: 0,
      tax: 0,
      total: 0,
      paidAmount: 0,
      paymentType: 'cash',
      notes: sale.notes
    })
    sales.markVoided(db, sale.id)
  })()

  return getSale(sale.id)
}
