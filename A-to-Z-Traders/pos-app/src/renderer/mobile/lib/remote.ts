import { IPC_CHANNELS } from '@shared/ipc'
import type {
  Category,
  Customer,
  ExpenseCategory,
  ExpenseInput,
  Expense,
  Id,
  PartyInput,
  Payment,
  PaymentInput,
  PriceSuggestion,
  Product,
  Receipt,
  SaleInput,
  SaleSettleInput,
  SaleWithItems,
  SellableUnit,
  StockAdjustmentInput,
  Supplier
} from '@shared/types'
import { call } from './client'

/**
 * The writes the phone can make, named.
 *
 * Reads go through `useRemote(channel, payload)` with a channel constant, but
 * a write is called from a handler and deserves a typed function — the payload
 * envelopes below (`{ input }`, `{ id }`) are the handlers' own, and getting
 * one wrong should be a compile error rather than a validation message on a
 * phone in somebody's hand.
 *
 * `IPC_CHANNELS` is imported rather than the strings being written out, so a
 * renamed channel breaks this file at build time exactly as it breaks the
 * preload bridge.
 */
export const CHANNELS = IPC_CHANNELS

export const remote = {
  /** Writes a new bill and returns it with the receipt to show or print. */
  createSale: (input: SaleInput) =>
    call<{ sale: SaleWithItems; receipt: Receipt }>(CHANNELS.salesCreate, { input }),

  /** Records what a delivered bill was actually paid. Money only. */
  settleSale: (input: SaleSettleInput) => call<SaleWithItems>(CHANNELS.salesSettle, { input }),

  printReceipt: (id: Id) => call<{ printed: boolean }>(CHANNELS.printReceipt, { id }),

  sellableUnits: (productId: Id) =>
    call<SellableUnit[]>(CHANNELS.productsSellableUnits, { productId }),

  suggestPrice: (customerId: Id | null, productId: Id, unitName: string) =>
    call<PriceSuggestion>(CHANNELS.salesSuggestPrice, { customerId, productId, unitName }),

  addCustomer: (input: PartyInput) => call<Customer>(CHANNELS.customersAdd, { input }),

  updateCustomer: (id: Id, input: PartyInput) =>
    call<Customer>(CHANNELS.customersUpdate, { id, input }),

  getCustomer: (id: Id) => call<Customer>(CHANNELS.customersGet, { id }),

  getSupplier: (id: Id) => call<Supplier>(CHANNELS.suppliersGet, { id }),

  createPayment: (input: PaymentInput) => call<Payment>(CHANNELS.paymentsCreate, { input }),

  addExpense: (input: ExpenseInput) => call<Expense>(CHANNELS.expensesAdd, { input }),

  expenseCategories: () => call<ExpenseCategory[]>(CHANNELS.expenseCategoriesList),

  categories: () => call<Category[]>(CHANNELS.categoriesList),

  adjustStock: (input: StockAdjustmentInput) =>
    call<{ productId: Id; stockQty: number }>(CHANNELS.stockAdjust, input),

  searchProducts: (search: string) =>
    call<{ rows: Product[]; total: number }>(CHANNELS.productsList, {
      search,
      status: 'active',
      limit: 25
    })
}
