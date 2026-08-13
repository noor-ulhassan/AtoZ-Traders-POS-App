import type { JSX } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { DateRange, LowStockRow, ProductProfitRow, RecentSaleRow } from '@shared/types'
import { resolvePreset } from '@shared/date'
import { Button } from '../../components/ui/Button'
import { Badge, ToneValue } from '../../components/ui/Feedback'
import { Card, CardBody, CardHeader } from '../../components/ui/Surface'
import { Column, DataTable, PrimaryCell } from '../../components/ui/DataTable'
import { DateRangeFilter } from '../../components/ui/DateRangeFilter'
import { StatGrid, StatTile } from '../../components/ui/StatTile'
import { TrendChart } from '../../components/ui/TrendChart'
import { FilterBar, FilterSpacer, PageBody, PageHeader } from '../../components/layout/PageHeader'
import { useQuery } from '../../hooks/useQuery'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useSettings } from '../../app/SettingsContext'
import { SetupChecklist } from './SetupChecklist'

/**
 * The screen the shop opens on.
 *
 * Ordered by what the owner asks first thing: what did we sell, what did we
 * make, how much cash should be in the drawer, who owes us — then the detail
 * behind each of those.
 */
export function DashboardPage(): JSX.Element {
  const { settings } = useSettings()
  const currency = settings.currency
  const navigate = useNavigate()

  const [range, setRange] = useState<DateRange>(() => resolvePreset('today'))

  const summary = useQuery(() => unwrap(api.dashboard.summary(range)), [range.from, range.to])
  const info = useQuery(() => unwrap(api.backup.info()), [])
  const data = summary.data

  const recentColumns: Column<RecentSaleRow>[] = [
    {
      key: 'invoice',
      header: 'Invoice',
      width: '140px',
      render: (row) => <span className="font-mono text-caption font-semibold">{row.invoiceNo}</span>
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (row) => row.customerName ?? 'Walk-in'
    },
    { key: 'date', header: 'Date', width: '120px', render: (row) => format.date(row.date) },
    {
      key: 'status',
      header: '',
      width: '110px',
      render: (row) =>
        row.paymentType === 'cash' ? (
          <Badge tone="good">Paid</Badge>
        ) : row.paymentType === 'partial' ? (
          <Badge tone="warn">Part paid</Badge>
        ) : (
          <Badge tone="bad">On khata</Badge>
        )
    },
    {
      key: 'total',
      header: `Total (${currency})`,
      numeric: true,
      width: '130px',
      render: (row) => format.money(row.total)
    }
  ]

  const topColumns: Column<ProductProfitRow>[] = [
    { key: 'product', header: 'Product', render: (row) => row.productName },
    {
      key: 'revenue',
      header: `Sales (${currency})`,
      numeric: true,
      width: '130px',
      render: (row) => format.money(row.revenue)
    },
    {
      key: 'profit',
      header: `Profit (${currency})`,
      numeric: true,
      width: '130px',
      render: (row) => (
        <ToneValue tone={row.profit < 0 ? 'bad' : 'good'}>{format.money(row.profit)}</ToneValue>
      )
    }
  ]

  const lowStockColumns: Column<LowStockRow>[] = [
    {
      key: 'product',
      header: 'Product',
      render: (row) => (
        <PrimaryCell
          title={row.productName}
          subtitle={`Reorder at ${format.quantity(row.reorderLevel)} ${row.baseUnit}`}
        />
      )
    },
    {
      key: 'stock',
      header: 'Left',
      numeric: true,
      width: '120px',
      render: (row) => (
        <ToneValue tone={row.stockQty <= 0 ? 'bad' : 'neutral'}>
          {format.quantity(row.stockQty)} {row.baseUnit}
        </ToneValue>
      )
    }
  ]

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={settings.businessName || 'Your shop at a glance'}
        actions={
          <>
            <Button icon="reports" onClick={() => navigate('/reports')}>
              Full reports
            </Button>
            <Button variant="primary" icon="bill" onClick={() => navigate('/billing')}>
              New bill
            </Button>
          </>
        }
      />

      <FilterBar>
        <DateRangeFilter value={range} onChange={setRange} />
        <FilterSpacer />
      </FilterBar>

      <PageBody>
        <StatGrid min={200}>
          <StatTile
            label="Sales"
            unit={currency}
            value={format.money(data?.sales ?? 0)}
            footnote={`${format.pluralize(data?.billCount ?? 0, 'bill')} · average ${format.money(data?.averageBill ?? 0)}`}
          />
          <StatTile
            label="Profit"
            unit={currency}
            value={format.money(data?.profit ?? 0)}
            tone={(data?.profit ?? 0) < 0 ? 'bad' : 'good'}
            footnote="Before expenses"
          />
          <StatTile
            label="Expenses"
            unit={currency}
            value={format.money(data?.expenses ?? 0)}
            tone={(data?.expenses ?? 0) > 0 ? 'bad' : 'default'}
          />
          <StatTile
            label="Cash in hand"
            unit={currency}
            value={format.money(data?.cashInHand ?? 0)}
            footnote="All time, after expenses and payments"
          />
          <StatTile
            label="Customers owe you"
            unit={currency}
            value={format.money(data?.receivables ?? 0)}
            tone={(data?.receivables ?? 0) > 0 ? 'bad' : 'default'}
          />
          <StatTile
            label="You owe suppliers"
            unit={currency}
            value={format.money(data?.payables ?? 0)}
          />
        </StatGrid>

        <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start gap-5">
          <div className="flex flex-col gap-5">
            <Card>
              <CardHeader
                title="Sales trend"
                subtitle={`${format.date(range.from)} to ${format.date(range.to)}`}
              />
              <CardBody>
                <TrendChart points={data?.trend ?? []} height={220} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Recent bills"
                actions={
                  <Button size="sm" onClick={() => navigate('/sales')}>
                    See all
                  </Button>
                }
              />
              <CardBody flush>
                <DataTable
                  columns={recentColumns}
                  rows={data?.recentSales ?? []}
                  rowKey={(row) => row.id}
                  compact
                  isLoading={summary.isLoading}
                  onRowClick={() => navigate('/sales')}
                  empty={{
                    title: 'No bills yet',
                    description: 'Your most recent bills will appear here.'
                  }}
                />
              </CardBody>
            </Card>
          </div>

          <div className="flex flex-col gap-5">
            <SetupChecklist settings={settings} info={info.data} />

            <Card>
              <CardHeader
                title="Needs reordering"
                actions={
                  <Button size="sm" onClick={() => navigate('/reports')}>
                    Full list
                  </Button>
                }
              />
              <CardBody flush>
                <DataTable
                  columns={lowStockColumns}
                  rows={data?.lowStock ?? []}
                  rowKey={(row) => row.productId}
                  compact
                  onRowClick={() => navigate('/products')}
                  empty={{
                    title: 'Stock levels are fine',
                    description: 'Nothing is at or below its reorder level.'
                  }}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Top products" subtitle="By sales in this period" />
              <CardBody flush>
                <DataTable
                  columns={topColumns}
                  rows={data?.topProducts ?? []}
                  rowKey={(row) => row.productId}
                  compact
                  empty={{ title: 'No sales in this period' }}
                />
              </CardBody>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  )
}
