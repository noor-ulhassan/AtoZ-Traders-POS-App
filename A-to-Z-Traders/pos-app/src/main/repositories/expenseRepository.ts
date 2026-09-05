import type {
  Expense,
  ExpenseCategory,
  ExpenseFilters,
  ExpensePageTotals,
  Id,
  PageWithTotals
} from '@shared/types'
import { money } from '@shared/money'
import { DEFAULT_PAGE_SIZE } from '@shared/pagination'
import type { Db } from '../db/connection'
import { toText } from '../db/rows'

interface ExpenseRow {
  id: number
  category_id: number | null
  category_name: string | null
  title: string
  amount: number
  date: string
  notes: string | null
  created_at: string
}

const toExpense = (row: ExpenseRow): Expense => ({
  id: row.id,
  categoryId: row.category_id,
  categoryName: row.category_name,
  title: row.title,
  amount: row.amount,
  date: row.date,
  notes: toText(row.notes),
  createdAt: row.created_at
})

const SELECT = `
  SELECT e.*, ec.name AS category_name
    FROM expenses e
    LEFT JOIN expense_categories ec ON ec.id = e.category_id
`

function buildFilter(filters: ExpenseFilters): { where: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []

  if (filters.from) {
    clauses.push('e.date >= ?')
    params.push(filters.from)
  }
  if (filters.to) {
    clauses.push('e.date <= ?')
    params.push(filters.to)
  }
  if (filters.categoryId != null) {
    clauses.push('e.category_id = ?')
    params.push(filters.categoryId)
  }
  if (filters.search) {
    const term = `%${filters.search.trim()}%`
    clauses.push('(e.title LIKE ? OR e.notes LIKE ?)')
    params.push(term, term)
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export function listExpenses(
  db: Db,
  filters: ExpenseFilters = {}
): PageWithTotals<Expense, ExpensePageTotals> {
  const { where, params } = buildFilter(filters)
  const limit = filters.limit ?? DEFAULT_PAGE_SIZE
  const offset = filters.offset ?? 0

  const rows = db
    .prepare<unknown[], ExpenseRow>(
      `${SELECT} ${where} ORDER BY e.date DESC, e.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)

  const summary = db
    .prepare<unknown[], { total: number; amount: number | null }>(
      `SELECT COUNT(*) AS total, SUM(e.amount) AS amount FROM expenses e ${where}`
    )
    .get(...params)

  return {
    rows: rows.map(toExpense),
    total: summary?.total ?? 0,
    totals: { amount: money(summary?.amount ?? 0) }
  }
}

export function findExpense(db: Db, id: Id): Expense | null {
  const row = db.prepare<[Id], ExpenseRow>(`${SELECT} WHERE e.id = ?`).get(id)
  return row ? toExpense(row) : null
}

export interface ExpenseFields {
  categoryId: Id | null
  title: string
  amount: number
  date: string
  notes: string | null
}

export function insertExpense(db: Db, fields: ExpenseFields): Id {
  const info = db
    .prepare(
      'INSERT INTO expenses (category_id, title, amount, date, notes) VALUES (?, ?, ?, ?, ?)'
    )
    .run(fields.categoryId, fields.title, money(fields.amount), fields.date, fields.notes)
  return Number(info.lastInsertRowid)
}

export function updateExpense(db: Db, id: Id, fields: ExpenseFields): void {
  db.prepare(
    'UPDATE expenses SET category_id = ?, title = ?, amount = ?, date = ?, notes = ? WHERE id = ?'
  ).run(fields.categoryId, fields.title, money(fields.amount), fields.date, fields.notes, id)
}

export function deleteExpense(db: Db, id: Id): void {
  db.prepare('DELETE FROM expenses WHERE id = ?').run(id)
}

// ---------------------------------------------------------- categories

export function listExpenseCategories(db: Db): ExpenseCategory[] {
  return db
    .prepare<[], { id: number; name: string; expense_count: number }>(
      `SELECT ec.id, ec.name,
              (SELECT COUNT(*) FROM expenses e WHERE e.category_id = ec.id) AS expense_count
         FROM expense_categories ec
        ORDER BY ec.name COLLATE NOCASE`
    )
    .all()
    .map((row) => ({ id: row.id, name: row.name, expenseCount: row.expense_count }))
}

export function insertExpenseCategory(db: Db, name: string): Id {
  const info = db.prepare('INSERT INTO expense_categories (name) VALUES (?)').run(name)
  return Number(info.lastInsertRowid)
}

/** By name, compared the way a person reads it. See `findCategoryByName`. */
export function findExpenseCategoryByName(db: Db, name: string): ExpenseCategory | null {
  const row = db
    .prepare<[string], { id: number; name: string }>(
      'SELECT id, name FROM expense_categories WHERE name = ? COLLATE NOCASE'
    )
    .get(name.trim())
  return row ? { id: row.id, name: row.name } : null
}

export function findExpenseCategory(db: Db, id: Id): ExpenseCategory | null {
  const row = db
    .prepare<[Id], { id: number; name: string }>(
      'SELECT id, name FROM expense_categories WHERE id = ?'
    )
    .get(id)
  return row ? { id: row.id, name: row.name } : null
}
