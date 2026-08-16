import type { JSX } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { DateRange, LowStockRow, RecentSaleRow } from '@shared/types'
import { resolvePreset } from '@shared/date'
import { Button } from '../../components/ui/Button'
import { Badge, ToneValue } from '../../components/ui/Feedback'
import { Card, CardBody, CardHeader } from '../../components/ui/Surface'
import { Column, DataTable, PrimaryCell } from '../../components/ui/DataTable'
import { DateRangeFilter } from '../../components/ui/DateRangeFilter'
import { StatGrid, StatTile } from '../../components/ui/StatTile'
import { SalesTrendChart } from '../../components/ui/charts/SalesTrendChart'
import { TopProductsChart } from '../../components/ui/charts/TopProductsChart'
import { DailyBillsChart } from '../../components/ui/charts/DailyBillsChart'
import { FinancialPositionChart } from '../../components/ui/charts/FinancialPositionChart'
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
                <SalesTrendChart points={data?.trend ?? []} height={240} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Bills per day" subtitle="How busy the shop was in this period" />
              <CardBody>
                <DailyBillsChart points={data?.trend ?? []} height={200} />
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
                  error={summary.error}
                  onRetry={summary.refetch}
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
              <CardHeader title="Financial position" subtitle="Where your money stands today" />
              <CardBody>
                <FinancialPositionChart
                  cashInHand={data?.cashInHand ?? 0}
                  receivables={data?.receivables ?? 0}
                  payables={data?.payables ?? 0}
                />
              </CardBody>
            </Card>

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
                  isLoading={summary.isLoading}
                  error={summary.error}
                  onRetry={summary.refetch}
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
              <CardBody>
                <TopProductsChart rows={data?.topProducts ?? []} />
              </CardBody>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  )
}
