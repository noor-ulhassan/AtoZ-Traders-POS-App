import type {
  CategoryProfitRow,
  DateRange,
  LowStockRow,
  NamedAmount,
  ProductProfitRow,
  ProfitLossReport,
  SalesSummaryPoint,
  SalesSummaryReport,
  StockValuationReport,
  StockValuationRow
} from '@shared/types'
import { eachDay } from '@shared/date'
import { money, qty } from '@shared/money'
import { currentRole } from '../auth/session'
import type { Db } from '../db/connection'
import { getDb } from '../db/connection'

type RangeParams = { from: string; to: string }

/**
 * Consignment goods are excluded from every figure in this file.
 *
 * The margin on stock the shop does not own is not the shop's, so counting it
 * as revenue or profit would overstate the business by exactly the amount that
 * belongs to somebody else. The exclusion always reads a column on the row
 * being aggregated — `sale_items.is_other`, `sales.other_subtotal`, and their
 * equivalents on returns — never a join back to `products`. That is what makes
 * it impossible to reclassify a product and silently restate an old month.
 *
 * The one number that deliberately DOES include consignment sales is cash in
 * hand, over in dashboardService: the customer's money really did go into the
 * drawer, whoever the goods belonged to.
 */

function scalar(db: Db, sql: string, params: RangeParams): number {
  const row = db.prepare<RangeParams, { value: number | null }>(sql).get(params)
  return money(row?.value ?? 0)
}

/**
 * Profit & loss (Guide §6.9).
 *
 * Revenue is measured from sale lines, which are already net of line
 * discounts. The bill-level discount is subtracted once, as a flat deduction
 * from gross sales rather than spread across lines — the documented
 * convention from Guide §4. Tax collected is never treated as revenue: it is
 * money held for the government, not earned.
 */
export function profitAndLoss(range: DateRange): ProfitLossReport {
  const db = getDb()
  const params: RangeParams = { from: range.from, to: range.to }

  const grossSales = scalar(
    db,
    'SELECT SUM(subtotal - other_subtotal) AS value FROM sales WHERE date BETWEEN @from AND @to',
    params
  )
  const billDiscounts = scalar(
    db,
    'SELECT SUM(discount) AS value FROM sales WHERE date BETWEEN @from AND @to',
    params
  )
  const taxCollected = scalar(
    db,
    'SELECT SUM(tax) AS value FROM sales WHERE date BETWEEN @from AND @to',
    params
  )
  // Every money figure above sums a zero for a cancelled bill, so none of them
  // needed a filter. A COUNT does not: a void bill would still be counted as a
  // bill, which is the one thing a cancelled bill is not.
  const billCount = Math.round(
    scalar(
      db,
      `SELECT COUNT(*) AS value FROM sales
        WHERE date BETWEEN @from AND @to AND voided_at IS NULL`,
      params
    )
  )
  const cogs = scalar(
    db,
    `SELECT SUM(si.cost_price * si.base_qty) AS value
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
      WHERE s.date BETWEEN @from AND @to AND si.is_other = 0`,
    params
  )
  const salesReturns = scalar(
    db,
    'SELECT SUM(total - other_total) AS value FROM sale_returns WHERE date BETWEEN @from AND @to',
    params
  )
  const returnedCogs = scalar(
    db,
    `SELECT SUM(i.cost_price * i.base_qty) AS value
       FROM sale_return_items i
       JOIN sale_returns r ON r.id = i.sale_return_id
      WHERE r.date BETWEEN @from AND @to AND i.is_other = 0`,
    params
  )
  const expenses = scalar(
    db,
    'SELECT SUM(amount) AS value FROM expenses WHERE date BETWEEN @from AND @to',
    params
  )

  const netSales = money(grossSales - billDiscounts - salesReturns)
  const netCogs = money(cogs - returnedCogs)
  const grossProfit = money(netSales - netCogs)
  const netProfit = money(grossProfit - expenses)

  const expenseBreakdown = db
    .prepare<RangeParams, { name: string | null; amount: number }>(
      `SELECT COALESCE(ec.name, 'Uncategorised') AS name, SUM(e.amount) AS amount
         FROM expenses e
         LEFT JOIN expense_categories ec ON ec.id = e.category_id
        WHERE e.date BETWEEN @from AND @to
        GROUP BY ec.id
        ORDER BY amount DESC`
    )
    .all(params)
    .map<NamedAmount>((row) => ({ name: row.name ?? 'Uncategorised', amount: money(row.amount) }))

  const categoryBreakdown = db
    .prepare<
      RangeParams,
      { category_id: number | null; category_name: string | null; revenue: number; cogs: number }
    >(
      `SELECT c.id AS category_id,
              COALESCE(c.name, 'Uncategorised') AS category_name,
              SUM(si.amount) AS revenue,
              SUM(si.cost_price * si.base_qty) AS cogs
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         JOIN products p ON p.id = si.product_id
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE s.date BETWEEN @from AND @to AND si.is_other = 0
        GROUP BY c.id
        ORDER BY revenue DESC`
    )
    .all(params)
    .map<CategoryProfitRow>((row) => ({
      categoryId: row.category_id,
      categoryName: row.category_name ?? 'Uncategorised',
      revenue: money(row.revenue),
      cogs: money(row.cogs),
      profit: money(row.revenue - row.cogs)
    }))

  return {
    range,
    grossSales,
    billDiscounts,
    salesReturns,
    netSales,
    cogs,
    returnedCogs,
    netCogs,
    grossProfit,
    expenses,
    netProfit,
    taxCollected,
    billCount,
    expenseBreakdown,
    categoryBreakdown
  }
}

export function productProfit(range: DateRange, limit = 500): ProductProfitRow[] {
  const db = getDb()
  return db
    .prepare<
      { from: string; to: string; limit: number },
      {
        product_id: number
        product_name: string
        category_name: string | null
        base_qty: number
        revenue: number
        cogs: number
      }
    >(
      `SELECT si.product_id       AS product_id,
              p.name              AS product_name,
              c.name              AS category_name,
              SUM(si.base_qty)    AS base_qty,
              SUM(si.amount)      AS revenue,
              SUM(si.cost_price * si.base_qty) AS cogs
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         JOIN products p ON p.id = si.product_id
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE s.date BETWEEN @from AND @to AND si.is_other = 0
        GROUP BY si.product_id
        ORDER BY revenue DESC
        LIMIT @limit`
    )
    .all({ from: range.from, to: range.to, limit })
    .map((row) => {
      const revenue = money(row.revenue)
      const cogs = money(row.cogs)
      const profit = money(revenue - cogs)
      return {
        productId: row.product_id,
        productName: row.product_name,
        categoryName: row.category_name,
        baseQtySold: qty(row.base_qty),
        revenue,
        cogs,
        profit,
        marginPercent: revenue === 0 ? 0 : money((profit / revenue) * 100)
      }
    })
}

export function salesSummary(range: DateRange): SalesSummaryReport {
  const db = getDb()
  const params: RangeParams = { from: range.from, to: range.to }

  const rows = db
    .prepare<RangeParams, { date: string; sales: number; bill_count: number; cogs: number }>(
      // Sales here is net revenue: subtotal after the bill discount, EXCLUDING
      // tax. Using s.total would fold collected tax into both sales and profit —
      // tax is money held for the government, never earned (see profitAndLoss).
      // When tax is off (the default) this equals s.total exactly.
      `SELECT s.date                                          AS date,
              SUM(s.subtotal - s.other_subtotal - s.discount)  AS sales,
              COUNT(DISTINCT s.id)                             AS bill_count,
              COALESCE(SUM(line.cogs), 0)                      AS cogs
         FROM sales s
         LEFT JOIN (
              SELECT sale_id, SUM(cost_price * base_qty) AS cogs
                FROM sale_items WHERE is_other = 0 GROUP BY sale_id
         ) line ON line.sale_id = s.id
        WHERE s.date BETWEEN @from AND @to AND s.voided_at IS NULL
        GROUP BY s.date
        ORDER BY s.date`
    )
    .all(params)

  const byDate = new Map<string, SalesSummaryPoint>()
  for (const row of rows) {
    byDate.set(row.date, {
      date: row.date,
      sales: money(row.sales),
      // Mirrors the P&L gross profit per bill (net sales − COGS), minus returns
      // and expenses, which are not per-bill figures.
      profit: money(row.sales - row.cogs),
      billCount: row.bill_count
    })
  }

  // Days with no sales still belong on the chart — a flat line is information.
  // `eachDay` stops after ten years, so a very long range draws a truncated
  // chart rather than looping forever.
  const daily = eachDay(range).map<SalesSummaryPoint>(
    (date) => byDate.get(date) ?? { date, sales: 0, profit: 0, billCount: 0 }
  )

  // Totalled from the query, not from `daily`. Reducing over the chart's days
  // tied the headline figures to how many points the chart happened to draw —
  // so a range past that ten-year stop reported a shop with no sales at all,
  // silently and with a straight face. The chart may be clipped; the totals
  // must always describe the period that was asked for.
  const totalSales = money(rows.reduce((sum, row) => sum + row.sales, 0))
  const totalProfit = money(rows.reduce((sum, row) => sum + (row.sales - row.cogs), 0))
  const billCount = rows.reduce((sum, row) => sum + row.bill_count, 0)

  const report: SalesSummaryReport = {
    range,
    totalSales,
    totalProfit,
    billCount,
    averageBill: billCount === 0 ? 0 : money(totalSales / billCount),
    daily,
    topProducts: productProfit(range, 10)
  }

  // A shopkeeper may see sales volume but not profitability — the same line the
  // dashboard draws. Strip profit and the profit-ranked product list here, at
  // the source, so no profit figure reaches the renderer for the Sales page or
  // the dashboard alike. (The other report functions are owner-only channels.)
  if (currentRole() === 'shopkeeper') {
    return {
      ...report,
      totalProfit: 0,
      daily: report.daily.map((point) => ({ ...point, profit: 0 })),
      topProducts: []
    }
  }
  return report
}

export function stockValuation(): StockValuationReport {
  const db = getDb()
  const rows = db
    .prepare<
      [],
      {
        id: number
        name: string
        sku: string | null
        category_name: string | null
        base_unit: string
        stock_qty: number
        cost_price: number
        sale_price: number
      }
    >(
      `SELECT p.id, p.name, p.sku, c.name AS category_name, p.base_unit,
              p.stock_qty, p.cost_price, p.sale_price
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.is_active = 1 AND p.ownership = 'own'
        ORDER BY p.name COLLATE NOCASE`
    )
    .all()
    .map<StockValuationRow>((row) => ({
      productId: row.id,
      productName: row.name,
      sku: row.sku,
      categoryName: row.category_name,
      baseUnit: row.base_unit,
      stockQty: qty(row.stock_qty),
      costPrice: row.cost_price,
      salePrice: row.sale_price,
      stockValue: money(row.stock_qty * row.cost_price),
      retailValue: money(row.stock_qty * row.sale_price)
    }))

  const totalStockValue = money(rows.reduce((sum, row) => sum + row.stockValue, 0))
  const totalRetailValue = money(rows.reduce((sum, row) => sum + row.retailValue, 0))

  return {
    rows,
    totalStockValue,
    totalRetailValue,
    potentialProfit: money(totalRetailValue - totalStockValue)
  }
}

export function lowStock(): LowStockRow[] {
  const db = getDb()
  return db
    .prepare<
      [],
      {
        id: number
        name: string
        sku: string | null
        category_name: string | null
        base_unit: string
        stock_qty: number
        reorder_level: number
      }
    >(
      `SELECT p.id, p.name, p.sku, c.name AS category_name, p.base_unit, p.stock_qty, p.reorder_level
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.is_active = 1 AND p.ownership = 'own'
          AND p.reorder_level > 0 AND p.stock_qty <= p.reorder_level
        ORDER BY (p.stock_qty - p.reorder_level) ASC, p.name COLLATE NOCASE`
    )
    .all()
    .map((row) => ({
      productId: row.id,
      productName: row.name,
      sku: row.sku,
      categoryName: row.category_name,
      baseUnit: row.base_unit,
      stockQty: qty(row.stock_qty),
      reorderLevel: qty(row.reorder_level),
      shortfall: qty(Math.max(0, row.reorder_level - row.stock_qty))
    }))
}
