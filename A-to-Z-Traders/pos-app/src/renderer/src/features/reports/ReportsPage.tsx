import type { JSX } from 'react'
import { useState } from 'react'
import type {
  DateRange,
  ExportName,
  LowStockRow,
  ProductProfitRow,
  StockValuationRow
} from '@shared/types'
import { resolvePreset } from '@shared/date'
import { Button } from '../../components/ui/Button'
import { ToneValue } from '../../components/ui/Feedback'
import { Card, CardBody, CardHeader } from '../../components/ui/Surface'
import { Column, DataTable, PrimaryCell } from '../../components/ui/DataTable'
import { DateRangeFilter } from '../../components/ui/DateRangeFilter'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { StatGrid, StatTile } from '../../components/ui/StatTile'
import { TrendChart } from '../../components/ui/TrendChart'
import { FilterBar, FilterSpacer, PageBody, PageHeader } from '../../components/layout/PageHeader'
import { useMutation } from '../../hooks/useMutation'
import { useQuery } from '../../hooks/useQuery'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useCurrency } from '../../app/SettingsContext'
import { ProfitLossReportView } from './ProfitLossReportView'

type TabKey = 'profit-loss' | 'sales' | 'products' | 'stock' | 'reorder'

const TABS: { key: TabKey; label: string; export?: ExportName; needsRange: boolean }[] = [
  { key: 'profit-loss', label: 'Profit & loss', export: 'profit-loss', needsRange: true },
  { key: 'sales', label: 'Sales trend', export: 'sales', needsRange: true },
  { key: 'products', label: 'Product profit', export: 'sale-items', needsRange: true },
  { key: 'stock', label: 'Stock valuation', export: 'stock-valuation', needsRange: false },
  { key: 'reorder', label: 'Reorder list', export: 'inventory', needsRange: false }
]

export function ReportsPage(): JSX.Element {
  const currency = useCurrency()
  const [tab, setTab] = useState<TabKey>('profit-loss')
  const [range, setRange] = useState<DateRange>(() => resolvePreset('thisMonth'))

  const active = TABS.find((entry) => entry.key === tab) as (typeof TABS)[number]

  const exportCsv = useMutation(
    async () =>
      unwrap(
        api.exports.csv({
          report: active.export as ExportName,
          filters: active.needsRange
            ? { from: range.from, to: range.to }
            : tab === 'reorder'
              ? { lowStockOnly: true }
              : {}
        })
      ),
    { successMessage: 'Report exported', errorTitle: 'Export failed' }
  )

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="What the business earned, what it holds, and what needs restocking"
        actions={
          <Button
            icon="download"
            loading={exportCsv.isPending}
            onClick={() => void exportCsv.run()}
          >
            Export this report
          </Button>
        }
      />

      <FilterBar>
        <SegmentedControl
          label="Report"
          tabs
          value={tab}
          onChange={setTab}
          options={TABS.map((entry) => ({ value: entry.key, label: entry.label }))}
        />
        {active.needsRange && <DateRangeFilter value={range} onChange={setRange} />}
        <FilterSpacer />
      </FilterBar>

      <PageBody>
        {tab === 'profit-loss' && <ProfitLossReportView range={range} />}
        {tab === 'sales' && <SalesTrendView range={range} currency={currency} />}
        {tab === 'products' && <ProductProfitView range={range} currency={currency} />}
        {tab === 'stock' && <StockValuationView currency={currency} />}
        {tab === 'reorder' && <ReorderView />}
      </PageBody>
    </>
  )
}

/* ------------------------------------------------------------ sales trend */

function SalesTrendView({ range, currency }: { range: DateRange; currency: string }): JSX.Element {
  const summary = useQuery(() => unwrap(api.reports.salesSummary(range)), [range.from, range.to])
  const data = summary.data

  return (
    <>
      <StatGrid min={200}>
        <StatTile label="Sales" unit={currency} value={format.money(data?.totalSales ?? 0)} />
        <StatTile
          label="Profit"
          unit={currency}
          value={format.money(data?.totalProfit ?? 0)}
          tone={(data?.totalProfit ?? 0) < 0 ? 'bad' : 'good'}
        />
        <StatTile label="Bills" value={data?.billCount ?? 0} />
        <StatTile
          label="Average bill"
          unit={currency}
          value={format.money(data?.averageBill ?? 0)}
        />
      </StatGrid>

      <Card>
        <CardHeader
          title="Sales by day"
          subtitle={`${format.date(range.from)} to ${format.date(range.to)}`}
        />
        <CardBody>
          <TrendChart points={data?.daily ?? []} height={240} />
        </CardBody>
      </Card>
    </>
  )
}

/* --------------------------------------------------------- product profit */

function ProductProfitView({
  range,
  currency
}: {
  range: DateRange
  currency: string
}): JSX.Element {
  const rows = useQuery(() => unwrap(api.reports.productProfit(range)), [range.from, range.to])

  const columns: Column<ProductProfitRow>[] = [
    {
      key: 'product',
      header: 'Product',
      render: (row) => (
        <PrimaryCell title={row.productName} subtitle={row.categoryName ?? undefined} />
      )
    },
    {
      key: 'qty',
      header: 'Sold',
      numeric: true,
      width: '110px',
      render: (row) => format.quantity(row.baseQtySold)
    },
    {
      key: 'revenue',
      header: `Revenue (${currency})`,
      numeric: true,
      width: '150px',
      render: (row) => format.money(row.revenue)
    },
    {
      key: 'cogs',
      header: `Cost (${currency})`,
      numeric: true,
      width: '150px',
      render: (row) => format.money(row.cogs)
    },
    {
      key: 'profit',
      header: `Profit (${currency})`,
      numeric: true,
      width: '150px',
      render: (row) => (
        <ToneValue tone={row.profit < 0 ? 'bad' : 'good'}>{format.money(row.profit)}</ToneValue>
      )
    },
    {
      key: 'margin',
      header: 'Margin',
      numeric: true,
      width: '110px',
      render: (row) => `${row.marginPercent.toFixed(1)}%`
    }
  ]

  return (
    <Card>
      <CardHeader title="Profit by product" subtitle="Sorted by revenue" />
      <CardBody flush>
        <DataTable
          columns={columns}
          rows={rows.data ?? []}
          rowKey={(row) => row.productId}
          isLoading={rows.isLoading}
          error={rows.error}
          onRetry={rows.refetch}
          empty={{ title: 'No sales in this period' }}
        />
      </CardBody>
    </Card>
  )
}

/* -------------------------------------------------------- stock valuation */

function StockValuationView({ currency }: { currency: string }): JSX.Element {
  const report = useQuery(() => unwrap(api.reports.stockValuation()), [])
  const data = report.data

  const columns: Column<StockValuationRow>[] = [
    {
      key: 'product',
      header: 'Product',
      render: (row) => (
        <PrimaryCell
          title={row.productName}
          subtitle={[row.sku, row.categoryName].filter(Boolean).join(' · ') || undefined}
        />
      )
    },
    {
      key: 'stock',
      header: 'In stock',
      numeric: true,
      width: '120px',
      render: (row) => `${format.quantity(row.stockQty)} ${row.baseUnit}`
    },
    {
      key: 'cost',
      header: `Cost (${currency})`,
      numeric: true,
      width: '130px',
      render: (row) => format.money(row.costPrice)
    },
    {
      key: 'value',
      header: `Stock value (${currency})`,
      numeric: true,
      width: '160px',
      render: (row) => <strong>{format.money(row.stockValue)}</strong>
    },
    {
      key: 'retail',
      header: `If sold (${currency})`,
      numeric: true,
      width: '150px',
      render: (row) => format.money(row.retailValue)
    }
  ]

  return (
    <>
      <StatGrid min={200}>
        <StatTile
          label="Stock at cost"
          unit={currency}
          value={format.money(data?.totalStockValue ?? 0)}
          footnote="What the shelves cost you"
        />
        <StatTile
          label="Stock at sale price"
          unit={currency}
          value={format.money(data?.totalRetailValue ?? 0)}
        />
        <StatTile
          label="Profit if all sold"
          unit={currency}
          value={format.money(data?.potentialProfit ?? 0)}
          tone="good"
          footnote="At today's list prices"
        />
      </StatGrid>

      <Card>
        <CardHeader
          title="Stock valuation"
          subtitle="Active products, valued at weighted-average cost"
        />
        <CardBody flush>
          <DataTable
            columns={columns}
            rows={data?.rows ?? []}
            rowKey={(row) => row.productId}
            isLoading={report.isLoading}
            error={report.error}
            onRetry={report.refetch}
            empty={{ title: 'No active products' }}
          />
        </CardBody>
      </Card>
    </>
  )
}

/* ------------------------------------------------------------- reorder */

function ReorderView(): JSX.Element {
  const rows = useQuery(() => unwrap(api.reports.lowStock()), [])

  const columns: Column<LowStockRow>[] = [
    {
      key: 'product',
      header: 'Product',
      render: (row) => (
        <PrimaryCell
          title={row.productName}
          subtitle={[row.sku, row.categoryName].filter(Boolean).join(' · ') || undefined}
        />
      )
    },
    {
      key: 'stock',
      header: 'In stock',
      numeric: true,
      width: '130px',
      render: (row) => (
        <ToneValue tone={row.stockQty <= 0 ? 'bad' : 'neutral'}>
          {format.quantity(row.stockQty)} {row.baseUnit}
        </ToneValue>
      )
    },
    {
      key: 'level',
      header: 'Reorder at',
      numeric: true,
      width: '130px',
      render: (row) => format.quantity(row.reorderLevel)
    },
    {
      key: 'short',
      header: 'Order at least',
      numeric: true,
      width: '150px',
      render: (row) => <strong>{format.quantity(row.shortfall)}</strong>
    }
  ]

  return (
    <Card>
      <CardHeader
        title="Needs reordering"
        subtitle="Products at or below the level you set for them"
      />
      <CardBody flush>
        <DataTable
          columns={columns}
          rows={rows.data ?? []}
          rowKey={(row) => row.productId}
          isLoading={rows.isLoading}
          error={rows.error}
          onRetry={rows.refetch}
          empty={{
            title: 'Nothing needs reordering',
            description: 'Every product with a reorder level is above it.'
          }}
        />
      </CardBody>
    </Card>
  )
}
