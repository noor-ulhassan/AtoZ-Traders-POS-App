import { dialog } from 'electron'
import { writeFileSync } from 'node:fs'
import type {
  DateRange,
  ExportName,
  ExportRequest,
  ExportResult,
  Id,
  PartyType
} from '@shared/types'
import { today } from '@shared/date'
import { getDb } from '../db/connection'
import type { CsvColumn, ReportField, ReportHeading } from '../utils/csv'
import { csvMoney, csvQty, suggestFileName, toReportCsv } from '../utils/csv'
import { AppError, businessRule } from '../utils/errors'
import { getStatement } from './ledgerService'
import { listExpenses } from './expenseService'
import { listPayments } from './paymentService'
import { listProducts } from './productService'
import { listPurchases } from './purchaseService'
import { listSales } from './salesService'
import { lowStock, profitAndLoss, stockValuation } from './reportService'
import { listMovements } from './inventoryService'
import { listParties } from './partyService'
import { getSettings } from './settingsService'

/** Everything an export can be filtered by. Unknown keys are ignored. */
interface ExportFilters {
  from?: string
  to?: string
  partyId?: Id
  categoryId?: Id
  [key: string]: unknown
}

function range(filters: ExportFilters): DateRange {
  return { from: filters.from ?? '1900-01-01', to: filters.to ?? today() }
}

/**
 * A dataset ready to be written as a report: what it is, whether a date period
 * applies, any report-specific heading facts, its columns and its rows.
 */
interface Dataset {
  title: string
  /** True when a "Period" line belongs in the heading; false for a snapshot. */
  ranged: boolean
  /** Report-specific heading facts, e.g. the party a statement is for. */
  info?: ReportField[]
  columns: CsvColumn<never>[]
  rows: unknown[]
}

function dataset<Row>(
  title: string,
  ranged: boolean,
  columns: CsvColumn<Row>[],
  rows: Row[],
  info?: ReportField[]
): Dataset {
  return { title, ranged, columns: columns as CsvColumn<never>[], rows, info }
}

const LIMIT = 100_000

function buildDataset(report: ExportName, filters: ExportFilters, currency: string): Dataset {
  const { from, to } = range(filters)
  // Suffix a money column's header with the currency, so every amount is
  // unambiguous even when the file is read far from this app.
  const m = (label: string): string => `${label} (${currency})`

  switch (report) {
    case 'sales':
      return dataset(
        'Sales Report',
        true,
        [
          { header: 'Invoice', value: (r) => r.invoiceNo },
          { header: 'Date', value: (r) => r.date },
          { header: 'Customer', value: (r) => r.customerName ?? 'Walk-in' },
          { header: m('Subtotal'), value: (r) => csvMoney(r.subtotal), sum: (r) => r.subtotal },
          { header: m('Discount'), value: (r) => csvMoney(r.discount), sum: (r) => r.discount },
          { header: m('Tax'), value: (r) => csvMoney(r.tax), sum: (r) => r.tax },
          { header: m('Total'), value: (r) => csvMoney(r.total), sum: (r) => r.total },
          { header: m('Paid'), value: (r) => csvMoney(r.paidAmount), sum: (r) => r.paidAmount },
          {
            header: m('Balance'),
            value: (r) => csvMoney(r.total - r.paidAmount),
            sum: (r) => r.total - r.paidAmount
          },
          { header: 'Payment type', value: (r) => r.paymentType },
          { header: 'Notes', value: (r) => r.notes }
        ],
        listSales({ from, to, customerId: filters.partyId ?? null, limit: LIMIT }).rows
      )

    case 'sale-items': {
      const rows = getDb()
        .prepare<
          { from: string; to: string },
          {
            invoice_no: string
            date: string
            customer_name: string | null
            product_name: string
            unit_name: string
            qty: number
            base_qty: number
            rate: number
            line_discount: number
            cost_price: number
            amount: number
          }
        >(
          `SELECT s.invoice_no, s.date, c.name AS customer_name, p.name AS product_name,
                  si.unit_name, si.qty, si.base_qty, si.rate, si.line_discount,
                  si.cost_price, si.amount
             FROM sale_items si
             JOIN sales s ON s.id = si.sale_id
             JOIN products p ON p.id = si.product_id
             LEFT JOIN customers c ON c.id = s.customer_id
            WHERE s.date BETWEEN @from AND @to
            ORDER BY s.date, s.id, si.id`
        )
        .all({ from, to })

      return dataset(
        'Sale Items Report',
        true,
        [
          { header: 'Invoice', value: (r) => r.invoice_no },
          { header: 'Date', value: (r) => r.date },
          { header: 'Customer', value: (r) => r.customer_name ?? 'Walk-in' },
          { header: 'Product', value: (r) => r.product_name },
          { header: 'Unit', value: (r) => r.unit_name },
          { header: 'Qty', value: (r) => csvQty(r.qty) },
          { header: 'Base qty', value: (r) => csvQty(r.base_qty) },
          { header: m('Rate'), value: (r) => csvMoney(r.rate) },
          {
            header: m('Line discount'),
            value: (r) => csvMoney(r.line_discount),
            sum: (r) => r.line_discount
          },
          { header: m('Amount'), value: (r) => csvMoney(r.amount), sum: (r) => r.amount },
          { header: m('Cost / base unit'), value: (r) => csvMoney(r.cost_price) },
          {
            header: m('Profit'),
            value: (r) => csvMoney(r.amount - r.cost_price * r.base_qty),
            sum: (r) => r.amount - r.cost_price * r.base_qty
          }
        ],
        rows
      )
    }

    case 'purchases':
      return dataset(
        'Purchases Report',
        true,
        [
          { header: 'Invoice', value: (r) => r.invoiceNo },
          { header: 'Date', value: (r) => r.date },
          { header: 'Supplier', value: (r) => r.supplierName ?? '' },
          { header: m('Subtotal'), value: (r) => csvMoney(r.subtotal), sum: (r) => r.subtotal },
          { header: m('Discount'), value: (r) => csvMoney(r.discount), sum: (r) => r.discount },
          { header: m('Total'), value: (r) => csvMoney(r.total), sum: (r) => r.total },
          { header: m('Paid'), value: (r) => csvMoney(r.paidAmount), sum: (r) => r.paidAmount },
          {
            header: m('Balance'),
            value: (r) => csvMoney(r.total - r.paidAmount),
            sum: (r) => r.total - r.paidAmount
          },
          { header: 'Notes', value: (r) => r.notes }
        ],
        listPurchases({ from, to, supplierId: filters.partyId ?? null, limit: LIMIT }).rows
      )

    case 'inventory':
      return dataset(
        'Inventory — Product List',
        false,
        [
          { header: 'Name', value: (r) => r.name },
          { header: 'SKU', value: (r) => r.sku },
          { header: 'Barcode', value: (r) => r.barcode },
          { header: 'Category', value: (r) => r.categoryName },
          { header: 'Base unit', value: (r) => r.baseUnit },
          { header: 'Stock', value: (r) => csvQty(r.stockQty) },
          { header: 'Reorder level', value: (r) => csvQty(r.reorderLevel) },
          { header: m('Cost price'), value: (r) => csvMoney(r.costPrice) },
          { header: m('Sale price'), value: (r) => csvMoney(r.salePrice) },
          { header: 'Status', value: (r) => (r.isActive ? 'Active' : 'Inactive') }
        ],
        listProducts({ status: 'all', limit: LIMIT }).rows
      )

    case 'stock-valuation':
      return dataset(
        'Stock Valuation Report',
        false,
        [
          { header: 'Product', value: (r) => r.productName },
          { header: 'SKU', value: (r) => r.sku },
          { header: 'Category', value: (r) => r.categoryName },
          { header: 'Unit', value: (r) => r.baseUnit },
          { header: 'Stock', value: (r) => csvQty(r.stockQty) },
          { header: m('Cost price'), value: (r) => csvMoney(r.costPrice) },
          {
            header: m('Stock value'),
            value: (r) => csvMoney(r.stockValue),
            sum: (r) => r.stockValue
          },
          { header: m('Sale price'), value: (r) => csvMoney(r.salePrice) },
          {
            header: m('Retail value'),
            value: (r) => csvMoney(r.retailValue),
            sum: (r) => r.retailValue
          }
        ],
        stockValuation().rows
      )

    case 'stock-movements':
      return dataset(
        'Stock Movement Ledger',
        true,
        [
          { header: 'Date', value: (r) => r.date },
          { header: 'Product', value: (r) => r.productName },
          { header: 'Change', value: (r) => csvQty(r.changeQty), sum: (r) => r.changeQty, sumFormat: csvQty },
          { header: 'Reason', value: (r) => r.reason },
          { header: 'Reference', value: (r) => (r.refId ? `${r.refTable}#${r.refId}` : '') },
          { header: m('Cost price'), value: (r) => csvMoney(r.costPrice ?? 0) },
          { header: 'Notes', value: (r) => r.notes }
        ],
        listMovements({ from, to, limit: LIMIT }).rows
      )

    case 'profit-loss': {
      const report = profitAndLoss({ from, to })
      const lines: { label: string; amount: number }[] = [
        { label: 'Gross sales', amount: report.grossSales },
        { label: 'Bill discounts', amount: -report.billDiscounts },
        { label: 'Sales returns', amount: -report.salesReturns },
        { label: 'Net sales', amount: report.netSales },
        { label: 'Cost of goods sold', amount: -report.netCogs },
        { label: 'Gross profit', amount: report.grossProfit },
        ...report.expenseBreakdown.map((item) => ({
          label: `Expense - ${item.name}`,
          amount: -item.amount
        })),
        { label: 'Total expenses', amount: -report.expenses },
        { label: 'Net profit', amount: report.netProfit },
        { label: 'Tax collected (not revenue)', amount: report.taxCollected },
        { label: 'Bills', amount: report.billCount }
      ]

      // A P&L is already a summary, so no TOTAL row — the statement foots itself.
      return dataset(
        'Profit & Loss Statement',
        true,
        [
          { header: 'Line', value: (r) => r.label },
          { header: m('Amount'), value: (r) => csvMoney(r.amount) }
        ],
        lines
      )
    }

    case 'customer-ledger':
    case 'supplier-ledger': {
      if (filters.partyId == null) {
        throw businessRule('Choose a party before exporting a statement.')
      }
      const type: PartyType = report === 'customer-ledger' ? 'customer' : 'supplier'
      const statement = getStatement(type, filters.partyId, { from, to })

      const opening = {
        date: from,
        description: 'Opening balance',
        reference: '',
        debit: 0,
        credit: 0,
        balance: statement.openingBalance
      }

      return dataset(
        type === 'customer' ? 'Customer Statement' : 'Supplier Statement',
        true,
        [
          { header: 'Date', value: (r) => r.date },
          { header: 'Description', value: (r) => r.description },
          { header: 'Reference', value: (r) => r.reference },
          { header: m('Debit'), value: (r) => csvMoney(r.debit), sum: (r) => r.debit },
          { header: m('Credit'), value: (r) => csvMoney(r.credit), sum: (r) => r.credit },
          { header: m('Balance'), value: (r) => csvMoney(r.balance) }
        ],
        [opening, ...statement.entries],
        [
          { label: 'Account', value: statement.partyName },
          { label: `Opening balance (${currency})`, value: csvMoney(statement.openingBalance) },
          { label: `Closing balance (${currency})`, value: csvMoney(statement.closingBalance) }
        ]
      )
    }

    case 'customers':
    case 'suppliers':
      return dataset(
        report === 'customers' ? 'Customers' : 'Suppliers',
        false,
        [
          { header: 'Name', value: (r) => r.name },
          { header: 'Phone', value: (r) => r.phone },
          { header: 'Address', value: (r) => r.address },
          {
            header: m('Opening balance'),
            value: (r) => csvMoney(r.openingBalance),
            sum: (r) => r.openingBalance
          },
          {
            header: m('Current balance'),
            value: (r) => csvMoney(r.currentBalance),
            sum: (r) => r.currentBalance
          },
          { header: 'Added on', value: (r) => r.createdAt }
        ],
        listParties(report === 'customers' ? 'customer' : 'supplier', { limit: LIMIT }).rows
      )

    case 'expenses':
      return dataset(
        'Expenses Report',
        true,
        [
          { header: 'Date', value: (r) => r.date },
          { header: 'Title', value: (r) => r.title },
          { header: 'Category', value: (r) => r.categoryName },
          { header: m('Amount'), value: (r) => csvMoney(r.amount), sum: (r) => r.amount },
          { header: 'Notes', value: (r) => r.notes }
        ],
        listExpenses({ from, to, categoryId: filters.categoryId ?? null, limit: LIMIT }).rows
      )

    case 'payments':
      return dataset(
        'Payments Report',
        true,
        [
          { header: 'Date', value: (r) => r.date },
          { header: 'Party type', value: (r) => r.partyType },
          { header: 'Party', value: (r) => r.partyName },
          { header: 'Direction', value: (r) => (r.direction === 'in' ? 'Received' : 'Paid') },
          { header: 'Method', value: (r) => r.method },
          { header: m('Amount'), value: (r) => csvMoney(r.amount), sum: (r) => r.amount },
          { header: 'Notes', value: (r) => r.notes }
        ],
        listPayments({ from, to, partyId: filters.partyId ?? null, limit: LIMIT }).rows
      )
  }
}

/** Also used by low-stock exports triggered from the dashboard. */
function lowStockDataset(): Dataset {
  return dataset(
    'Low Stock — Reorder Report',
    false,
    [
      { header: 'Product', value: (r) => r.productName },
      { header: 'SKU', value: (r) => r.sku },
      { header: 'Category', value: (r) => r.categoryName },
      { header: 'Unit', value: (r) => r.baseUnit },
      { header: 'In stock', value: (r) => csvQty(r.stockQty) },
      { header: 'Reorder level', value: (r) => csvQty(r.reorderLevel) },
      { header: 'Short by', value: (r) => csvQty(r.shortfall), sum: (r) => r.shortfall, sumFormat: csvQty }
    ],
    lowStock()
  )
}

/** The report's period line, worded for whatever the filters actually cover. */
function periodLabel(filters: ExportFilters): string {
  const to = filters.to ?? today()
  return filters.from ? `${filters.from} to ${to}` : `Up to ${to}`
}

/** Local wall-clock stamp for the "Generated" line — matches the app's dates. */
function generatedStamp(): string {
  const row = getDb().prepare<[], { t: string }>(`SELECT datetime('now','localtime') AS t`).get()
  return row?.t ?? today()
}

export async function exportCsv(request: ExportRequest): Promise<ExportResult> {
  const filters = (request.filters ?? {}) as ExportFilters
  const settings = getSettings()
  const currency = settings.currency

  const data =
    request.report === 'inventory' && filters.lowStockOnly === true
      ? lowStockDataset()
      : buildDataset(request.report, filters, currency)

  const heading: ReportHeading = {
    businessName: settings.businessName?.trim() || 'A to Z Traders',
    title: data.title,
    fields: [
      ...(data.info ?? []),
      data.ranged
        ? { label: 'Period', value: periodLabel(filters) }
        : { label: 'As on', value: today() },
      { label: 'Currency', value: currency },
      { label: 'Generated', value: generatedStamp() }
    ]
  }

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save export',
    defaultPath: suggestFileName(request.report, filters.from, filters.to),
    filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }]
  })

  if (canceled || !filePath) {
    throw new AppError('CANCELLED', 'Export cancelled.')
  }

  writeFileSync(filePath, toReportCsv(heading, data.columns, data.rows as never[]), 'utf8')
  return { path: filePath, rowCount: data.rows.length }
}
