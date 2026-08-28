import type { Id, IsoDate, IsoTimestamp } from './common'

interface PartyBase {
  id: Id
  name: string
  phone: string | null
  address: string | null
  openingBalance: number
  /** Cached running balance. */
  currentBalance: number
  createdAt: IsoTimestamp
}

/** Positive `currentBalance` means the customer owes the shop. */
export interface Customer extends PartyBase {}

/** Positive `currentBalance` means the shop owes the supplier. */
export interface Supplier extends PartyBase {}

export type PartyType = 'customer' | 'supplier'

export interface PartyInput {
  name: string
  phone?: string | null
  address?: string | null
  /** Create-only. Changing it after transactions exist would rewrite history. */
  openingBalance?: number
}

export interface PartyFilters {
  search?: string
  /** Only parties with a non-zero balance. */
  withBalanceOnly?: boolean
  limit?: number
  offset?: number
}

export type LedgerEntryKind =
  | 'opening'
  | 'sale_credit'
  | 'payment_in'
  | 'sale_return'
  | 'purchase_credit'
  | 'payment_out'
  | 'purchase_return'

export interface LedgerEntry {
  date: IsoDate
  kind: LedgerEntryKind
  /** Human label, e.g. "Sale INV-000123". */
  description: string
  reference: string
  /** Increases what the party owes (customer) / what we owe (supplier). */
  debit: number
  /** Decreases it. */
  credit: number
  /** Balance after this row. */
  balance: number
  sourceTable: string | null
  sourceId: Id | null
}

export interface LedgerStatement {
  partyType: PartyType
  partyId: Id
  partyName: string
  /** Balance immediately before `range.from`. */
  openingBalance: number
  entries: LedgerEntry[]
  totalDebit: number
  totalCredit: number
  closingBalance: number
}

/** Aggregates over every party the filters match, not just the page shown. */
export interface PartyPageTotals {
  /** SUM of positive balances: receivable for customers, payable for suppliers. */
  outstanding: number
}
