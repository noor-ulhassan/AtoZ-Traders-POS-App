import type { Id, IsoDate } from './common'

/**
 * Profit & loss for a date range.
 *
 * Convention: bill-level discount is a flat deduction from gross sales (it is
 * not spread across lines), and tax collected is never counted as revenue.
 *
 *   netSales    = grossSales - billDiscounts - salesReturns
 *   netCogs     = cogs - returnedCogs
 *   grossProfit = netSales - netCogs
 *   netProfit   = grossProfit - expenses
 */
export interface ProfitLossReport {
  range: { from: IsoDate; to: IsoDate }
  /** Sum of sale line amounts (already net of line discounts). */
  grossSales: number
  billDiscounts: number
  salesReturns: number
  netSales: number
  cogs: number
  returnedCogs: number
  netCogs: number
  grossProfit: number
  expenses: number
  netProfit: number
  /** Tax collected in the period — informational, excluded from profit. */
  taxCollected: number
  billCount: number
  expenseBreakdown: NamedAmount[]
  categoryBreakdown: CategoryProfitRow[]
}

export interface NamedAmount {
  name: string
  amount: number
}

export interface CategoryProfitRow {
  categoryId: Id | null
  categoryName: string
  revenue: number
  cogs: number
  profit: number
}

export interface ProductProfitRow {
  productId: Id
  productName: string
  categoryName: string | null
  baseQtySold: number
  revenue: number
  cogs: number
  profit: number
  /** profit / revenue as a percentage; 0 when revenue is 0. */
  marginPercent: number
}

export interface StockValuationRow {
  productId: Id
  productName: string
  sku: string | null
  categoryName: string | null
  baseUnit: string
  stockQty: number
  costPrice: number
  salePrice: number
  /** stockQty * costPrice */
  stockValue: number
  /** stockQty * salePrice */
  retailValue: number
}

export interface StockValuationReport {
  rows: StockValuationRow[]
  totalStockValue: number
  totalRetailValue: number
  /** Potential profit if all stock sold at the default sale price. */
  potentialProfit: number
}

export interface LowStockRow {
  productId: Id
  productName: string
  sku: string | null
  categoryName: string | null
  baseUnit: string
  stockQty: number
  reorderLevel: number
  shortfall: number
}

export interface SalesSummaryPoint {
  date: IsoDate
  sales: number
  profit: number
  billCount: number
}

export interface SalesSummaryReport {
  range: { from: IsoDate; to: IsoDate }
  totalSales: number
  totalProfit: number
  billCount: number
  averageBill: number
  daily: SalesSummaryPoint[]
  topProducts: ProductProfitRow[]
}

export interface DashboardSummary {
  range: { from: IsoDate; to: IsoDate }
  sales: number
  profit: number
  billCount: number
  averageBill: number
  expenses: number
  /**
   * Running cash position: money received (cash/partial sale payments and
   * payments in) minus money paid out (purchase payments, payments out,
   * expenses, cash refunds). Computed over all time, not the range.
   */
  cashInHand: number
  /** Total owed to the shop by customers, all time. */
  receivables: number
  /** Total the shop owes suppliers, all time. */
  payables: number
  trend: SalesSummaryPoint[]
  topProducts: ProductProfitRow[]
  lowStock: LowStockRow[]
  recentSales: RecentSaleRow[]
}

export interface RecentSaleRow {
  id: Id
  invoiceNo: string
  customerName: string | null
  date: IsoDate
  total: number
  paymentType: string
}

export type ExportName =
  | 'sales'
  | 'sale-items'
  | 'purchases'
  | 'inventory'
  | 'stock-valuation'
  | 'stock-movements'
  | 'profit-loss'
  | 'customer-ledger'
  | 'supplier-ledger'
  | 'customers'
  | 'suppliers'
  | 'expenses'
  | 'payments'

export interface ExportRequest {
  report: ExportName
  filters?: Record<string, unknown>
}

export interface ExportResult {
  /** Absolute path of the written file. */
  path: string
  rowCount: number
}
