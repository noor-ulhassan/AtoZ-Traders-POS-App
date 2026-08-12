import type { Id, IsoDate, IsoTimestamp } from './common'
import type { PartyType } from './parties'

export type PaymentDirection = 'in' | 'out'
export type PaymentMethod = 'cash' | 'bank' | 'cheque' | 'online' | 'other'

export interface Payment {
  id: Id
  partyType: PartyType
  partyId: Id
  partyName: string
  direction: PaymentDirection
  amount: number
  method: PaymentMethod
  date: IsoDate
  notes: string | null
  createdAt: IsoTimestamp
}

export interface PaymentInput {
  partyType: PartyType
  partyId: Id
  amount: number
  method?: PaymentMethod
  date?: IsoDate
  notes?: string | null
}

export interface PaymentFilters {
  from?: IsoDate
  to?: IsoDate
  partyType?: PartyType | 'all'
  partyId?: Id | null
  limit?: number
  offset?: number
}

export interface ExpenseCategory {
  id: Id
  name: string
  expenseCount?: number
}

export interface Expense {
  id: Id
  categoryId: Id | null
  categoryName: string | null
  title: string
  amount: number
  date: IsoDate
  notes: string | null
  createdAt: IsoTimestamp
}

export interface ExpenseInput {
  categoryId?: Id | null
  title: string
  amount: number
  date?: IsoDate
  notes?: string | null
}

export interface ExpenseFilters {
  from?: IsoDate
  to?: IsoDate
  categoryId?: Id | null
  search?: string
  limit?: number
  offset?: number
}
