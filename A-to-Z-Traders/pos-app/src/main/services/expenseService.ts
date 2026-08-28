import type {
  Expense,
  ExpenseCategory,
  ExpenseFilters,
  ExpenseInput,
  ExpensePageTotals,
  Id,
  PageWithTotals
} from '@shared/types'
import { today } from '@shared/date'
import { getDb } from '../db/connection'
import * as expenses from '../repositories/expenseRepository'
import { businessRule, notFound } from '../utils/errors'

export function listExpenseCategories(): ExpenseCategory[] {
  return expenses.listExpenseCategories(getDb())
}

export function addExpenseCategory(name: string): ExpenseCategory {
  const db = getDb()
  const id = expenses.insertExpenseCategory(db, name)
  return expenses.findExpenseCategory(db, id) as ExpenseCategory
}

export function listExpenses(
  filters: ExpenseFilters = {}
): PageWithTotals<Expense, ExpensePageTotals> {
  return expenses.listExpenses(getDb(), filters)
}

function assertCategoryExists(id: Id | null | undefined): Id | null {
  if (id == null) return null
  const category = expenses.findExpenseCategory(getDb(), id)
  if (!category) throw notFound('Expense category')
  return category.id
}

export function addExpense(input: ExpenseInput): Expense {
  const db = getDb()
  if (input.amount <= 0) throw businessRule('An expense must be greater than zero.')

  const id = expenses.insertExpense(db, {
    categoryId: assertCategoryExists(input.categoryId),
    title: input.title,
    amount: input.amount,
    date: input.date ?? today(),
    notes: input.notes ?? null
  })
  return expenses.findExpense(db, id) as Expense
}

export function updateExpense(id: Id, input: ExpenseInput): Expense {
  const db = getDb()
  if (!expenses.findExpense(db, id)) throw notFound('Expense')
  if (input.amount <= 0) throw businessRule('An expense must be greater than zero.')

  expenses.updateExpense(db, id, {
    categoryId: assertCategoryExists(input.categoryId),
    title: input.title,
    amount: input.amount,
    date: input.date ?? today(),
    notes: input.notes ?? null
  })
  return expenses.findExpense(db, id) as Expense
}

export function removeExpense(id: Id): { id: Id } {
  const db = getDb()
  if (!expenses.findExpense(db, id)) throw notFound('Expense')
  expenses.deleteExpense(db, id)
  return { id }
}
