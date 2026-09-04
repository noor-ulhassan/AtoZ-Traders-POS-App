import type { DashboardSummary, DateRange, RecentSaleRow } from '@shared/types'
import { money } from '@shared/money'
import { currentRole } from '../auth/session'
import { getDb } from '../db/connection'
import { totalOutstanding } from '../repositories/partyRepository'
import { lowStock, productProfit, salesSummary } from './reportService'

/**
 * Cash actually in the drawer, all time.
 *
 * In:  the paid portion of every sale, plus payments received from customers.
 * Out: what was paid on purchases, payments made to suppliers, expenses, and
 *      cash refunds on returns.
 *
 * This is a cash-book figure, not a bank reconciliation: it assumes money that
 * came in stayed in until it was recorded going out. That is exactly how the
 * shop's drawer works, and it is the number the owner counts at closing.
 */
function cashInHand(): number {
  const db = getDb()
  const row = db
    .prepare<[], { value: number | null }>(
      `SELECT
         (SELECT COALESCE(SUM(paid_amount), 0) FROM sales)
       + (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE direction = 'in')
       - (SELECT COALESCE(SUM(paid_amount), 0) FROM purchases)
       - (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE direction = 'out')
       - (SELECT COALESCE(SUM(amount), 0) FROM expenses)
       - (SELECT COALESCE(SUM(total), 0) FROM sale_returns WHERE refund_type = 'cash')
       AS value`
    )
    .get()
  return money(row?.value ?? 0)
}

function recentSales(limit = 8): RecentSaleRow[] {
  return getDb()
    .prepare<
      [number],
      {
        id: number
        invoice_no: string
        customer_name: string | null
        date: string
        total: number
        payment_type: string
      }
    >(
      // Cancelled bills are left out: they carry nothing, and a row of zeroes
      // in "recent sales" reads as a bug rather than as history.
      `SELECT s.id, s.invoice_no, c.name AS customer_name, s.date, s.total, s.payment_type
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
        WHERE s.voided_at IS NULL
        ORDER BY s.id DESC
        LIMIT ?`
    )
    .all(limit)
    .map((row) => ({
      id: row.id,
      invoiceNo: row.invoice_no,
      customerName: row.customer_name,
      date: row.date,
      total: row.total,
      paymentType: row.payment_type
    }))
}

function expensesInRange(range: DateRange): number {
  const row = getDb()
    .prepare<{ from: string; to: string }, { value: number | null }>(
      'SELECT SUM(amount) AS value FROM expenses WHERE date BETWEEN @from AND @to'
    )
    .get({ from: range.from, to: range.to })
  return money(row?.value ?? 0)
}

export function getSummary(range: DateRange): DashboardSummary {
  const db = getDb()
  const summary = salesSummary(range)

  const full: DashboardSummary = {
    range,
    sales: summary.totalSales,
    profit: summary.totalProfit,
    billCount: summary.billCount,
    averageBill: summary.averageBill,
    expenses: expensesInRange(range),
    cashInHand: cashInHand(),
    receivables: totalOutstanding(db, 'customer'),
    payables: totalOutstanding(db, 'supplier'),
    trend: summary.daily,
    topProducts: summary.topProducts.slice(0, 5),
    lowStock: lowStock().slice(0, 8),
    recentSales: recentSales()
  }

  return currentRole() === 'shopkeeper' ? redactForShopkeeper(full) : full
}

/**
 * A shopkeeper sees the shop's *activity*, not its *profitability*.
 *
 * The owner's financial figures — profit, product margins, the cost side of
 * sales, expenses, the cash position and what the shop owes — are stripped here,
 * before the summary crosses to the renderer. That keeps them out of the IPC
 * payload itself, not merely hidden on screen: a shopkeeper cannot read them
 * from devtools either. Sales volume, bill counts, what customers owe, low
 * stock and recent bills stay — that is what counter work needs.
 */
function redactForShopkeeper(full: DashboardSummary): DashboardSummary {
  return {
    ...full,
    profit: 0,
    expenses: 0,
    cashInHand: 0,
    payables: 0,
    topProducts: [],
    trend: full.trend.map((point) => ({ ...point, profit: 0 }))
  }
}

export { productProfit }
