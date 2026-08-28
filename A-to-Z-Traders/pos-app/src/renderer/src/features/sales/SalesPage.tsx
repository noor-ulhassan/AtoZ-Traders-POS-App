import type { JSX } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { DateRange, PaymentType, Sale } from '@shared/types'
import { resolvePreset } from '@shared/date'
import { Button } from '../../components/ui/Button'
import { SearchInput, Select } from '../../components/ui/Field'
import { Badge, ToneValue } from '../../components/ui/Feedback'
import { Card, CardBody } from '../../components/ui/Surface'
import { Column, DataTable, PrimaryCell, TablePager } from '../../components/ui/DataTable'
import { DateRangeFilter } from '../../components/ui/DateRangeFilter'
import { StatGrid, StatTile } from '../../components/ui/StatTile'
import { FilterBar, FilterSpacer, PageBody, PageHeader } from '../../components/layout/PageHeader'
import { useDebounced } from '../../hooks/useDebounced'
import { useMutation } from '../../hooks/useMutation'
import { usePagination, useClampedPage } from '../../hooks/usePagination'
import { useQuery } from '../../hooks/useQuery'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useAuth } from '../../app/AuthContext'
import { useCurrency } from '../../app/SettingsContext'
import { SaleDetailModal } from './SaleDetailModal'

const PAYMENT_BADGE: Record<PaymentType, { label: string; tone: 'good' | 'warn' | 'bad' }> = {
  cash: { label: 'Paid', tone: 'good' },
  partial: { label: 'Part paid', tone: 'warn' },
  credit: { label: 'On khata', tone: 'bad' }
}

export function SalesPage(): JSX.Element {
  const currency = useCurrency()
  const navigate = useNavigate()
  const isAdmin = useAuth().role === 'admin'

  const [range, setRange] = useState<DateRange>(() => resolvePreset('today'))
  const [search, setSearch] = useState('')
  const [paymentType, setPaymentType] = useState<PaymentType | 'all'>('all')
  const [openId, setOpenId] = useState<number | null>(null)

  const debouncedSearch = useDebounced(search)

  const paging = usePagination([range.from, range.to, paymentType, debouncedSearch])

  const sales = useQuery(
    () =>
      unwrap(
        api.sales.list({
          from: range.from,
          to: range.to,
          paymentType,
          search: debouncedSearch || undefined,
          limit: paging.limit,
          offset: paging.offset
        })
      ),
    [range.from, range.to, paymentType, debouncedSearch, paging.offset, paging.limit]
  )

  const summary = useQuery(() => unwrap(api.reports.salesSummary(range)), [range.from, range.to])

  const exportCsv = useMutation(
    async (report: 'sales' | 'sale-items') =>
      unwrap(api.exports.csv({ report, filters: { from: range.from, to: range.to } })),
    { successMessage: 'Sales exported', errorTitle: 'Export failed' }
  )

  const rows = sales.data?.rows ?? []
  const total = sales.data?.total ?? 0
  // Summed by the server over every bill the filters match. The tile has to
  // describe the whole period, not whichever page happens to be open.
  const onKhata = sales.data?.totals.onKhata ?? 0
  const page = useClampedPage(paging, total)

  const columns: Column<Sale>[] = [
    {
      key: 'invoice',
      header: 'Invoice',
      width: '150px',
      render: (sale) => (
        <span className="font-mono text-caption font-semibold">{sale.invoiceNo}</span>
      )
    },
    { key: 'date', header: 'Date', width: '120px', render: (sale) => format.date(sale.date) },
    {
      key: 'customer',
      header: 'Customer',
      render: (sale) => (
        <PrimaryCell title={sale.customerName ?? 'Walk-in'} subtitle={sale.notes ?? undefined} />
      )
    },
    {
      key: 'total',
      header: `Total (${currency})`,
      numeric: true,
      width: '140px',
      render: (sale) => format.money(sale.total)
    },
    {
      key: 'paid',
      header: `Paid (${currency})`,
      numeric: true,
      width: '130px',
      render: (sale) => format.money(sale.paidAmount)
    },
    {
      key: 'due',
      header: `On khata (${currency})`,
      numeric: true,
      width: '150px',
      render: (sale) => {
        const due = sale.total - sale.paidAmount
        return due > 0.005 ? (
          <ToneValue tone="bad">{format.money(due)}</ToneValue>
        ) : (
          <span style={{ color: 'var(--ink-subtle)' }}>—</span>
        )
      }
    },
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      render: (sale) => (
        <Badge tone={PAYMENT_BADGE[sale.paymentType].tone}>
          {PAYMENT_BADGE[sale.paymentType].label}
        </Badge>
      )
    }
  ]

  return (
    <>
      <PageHeader
        title="Sales"
        subtitle="Every bill, with what was paid and what is still owed"
        actions={
          <>
            {isAdmin && (
              <Button
                icon="download"
                loading={exportCsv.isPending}
                onClick={() => void exportCsv.run('sales')}
              >
                Export bills
              </Button>
            )}
            {isAdmin && (
              <Button icon="download" onClick={() => void exportCsv.run('sale-items')}>
                Export items
              </Button>
            )}
            <Button variant="primary" icon="bill" onClick={() => navigate('/billing')}>
              New bill
            </Button>
          </>
        }
      />

      <FilterBar>
        <DateRangeFilter value={range} onChange={setRange} />
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search invoice or customer"
        />
        <div style={{ width: 160 }}>
          <Select
            value={paymentType}
            onChange={(event) => setPaymentType(event.target.value as PaymentType | 'all')}
          >
            <option value="all">All payments</option>
            <option value="cash">Paid in full</option>
            <option value="partial">Part paid</option>
            <option value="credit">On khata</option>
          </Select>
        </div>
        <FilterSpacer />
      </FilterBar>

      <PageBody fill>
        <StatGrid min={190}>
          <StatTile
            label="Sales"
            unit={currency}
            value={format.money(summary.data?.totalSales ?? 0)}
          />
          {isAdmin && (
            <StatTile
              label="Profit"
              unit={currency}
              value={format.money(summary.data?.totalProfit ?? 0)}
              tone={(summary.data?.totalProfit ?? 0) < 0 ? 'bad' : 'good'}
            />
          )}
          <StatTile label="Bills" value={summary.data?.billCount ?? 0} />
          <StatTile
            label="Average bill"
            unit={currency}
            value={format.money(summary.data?.averageBill ?? 0)}
          />
          <StatTile
            label="Went on khata"
            unit={currency}
            value={format.money(onKhata)}
            tone={onKhata > 0 ? 'bad' : 'default'}
          />
        </StatGrid>

        <Card>
          <CardBody flush>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(sale) => sale.id}
              isLoading={sales.isLoading}
              error={sales.error}
              onRetry={sales.refetch}
              onRowClick={(sale) => setOpenId(sale.id)}
              empty={{
                title: 'No bills in this period',
                description: 'Change the dates, or start a new bill.',
                action: (
                  <Button variant="primary" icon="bill" onClick={() => navigate('/billing')}>
                    New bill
                  </Button>
                )
              }}
            />
            <TablePager
              page={page}
              pageSize={paging.pageSize}
              total={total}
              onPageChange={paging.setPage}
              noun="bills"
            />
          </CardBody>
        </Card>
      </PageBody>

      <SaleDetailModal saleId={openId} onClose={() => setOpenId(null)} />
    </>
  )
}
