import type { JSX } from 'react'
import { useState } from 'react'
import type { DateRange, SaleReturn } from '@shared/types'
import { resolvePreset } from '@shared/date'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Feedback'
import { Card, CardBody } from '../../components/ui/Surface'
import { Column, DataTable, PrimaryCell, TablePager } from '../../components/ui/DataTable'
import { DateRangeFilter } from '../../components/ui/DateRangeFilter'
import { StatGrid, StatTile } from '../../components/ui/StatTile'
import { FilterBar, FilterSpacer, PageBody, PageHeader } from '../../components/layout/PageHeader'
import { usePagination, useClampedPage } from '../../hooks/usePagination'
import { useQuery } from '../../hooks/useQuery'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useCurrency } from '../../app/SettingsContext'
import { SaleReturnFormModal } from './SaleReturnFormModal'

export function SaleReturnsPage(): JSX.Element {
  const currency = useCurrency()
  const [range, setRange] = useState<DateRange>(() => resolvePreset('last30'))
  const [isFormOpen, setIsFormOpen] = useState(false)

  const paging = usePagination([range.from, range.to])

  const returns = useQuery(
    () =>
      unwrap(
        api.returns.sale.list({
          from: range.from,
          to: range.to,
          limit: paging.limit,
          offset: paging.offset
        })
      ),
    [range.from, range.to, paging.offset, paging.limit]
  )

  const rows = returns.data?.rows ?? []
  // Server-side, over the whole period rather than the page on screen.
  const matched = returns.data?.total ?? 0
  const total = returns.data?.totals.total ?? 0
  const cashRefunded = returns.data?.totals.cashRefunds ?? 0
  const page = useClampedPage(paging, matched)

  const columns: Column<SaleReturn>[] = [
    { key: 'date', header: 'Date', width: '120px', render: (row) => format.date(row.date) },
    {
      key: 'customer',
      header: 'Customer',
      render: (row) => (
        <PrimaryCell
          title={row.customerName ?? 'Walk-in'}
          subtitle={row.saleInvoiceNo ? `Against ${row.saleInvoiceNo}` : 'No linked bill'}
        />
      )
    },
    {
      key: 'refund',
      header: 'Refund',
      width: '150px',
      render: (row) => (
        <Badge tone={row.refundType === 'cash' ? 'warn' : 'accent'}>
          {row.refundType === 'cash' ? 'Cash back' : 'Khata reduced'}
        </Badge>
      )
    },
    {
      key: 'notes',
      header: 'Notes',
      render: (row) => <span style={{ color: 'var(--ink-muted)' }}>{row.notes ?? '—'}</span>
    },
    {
      key: 'total',
      header: `Amount (${currency})`,
      numeric: true,
      width: '140px',
      render: (row) => format.money(row.total)
    }
  ]

  return (
    <>
      <PageHeader
        title="Sale returns"
        subtitle="Goods coming back from customers, and what was refunded"
        actions={
          <Button variant="primary" icon="plus" onClick={() => setIsFormOpen(true)}>
            Record return
          </Button>
        }
      />

      <FilterBar>
        <DateRangeFilter value={range} onChange={setRange} />
        <FilterSpacer />
      </FilterBar>

      <PageBody fill>
        <StatGrid>
          <StatTile label="Returned in period" unit={currency} value={format.money(total)} />
          <StatTile label="Cash refunded" unit={currency} value={format.money(cashRefunded)} />
          <StatTile label="Returns recorded" value={matched} />
        </StatGrid>

        <Card>
          <CardBody flush>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              isLoading={returns.isLoading}
              error={returns.error}
              onRetry={returns.refetch}
              empty={{
                title: 'No returns in this period',
                description: 'Returned goods go back into stock and adjust profit automatically.'
              }}
            />
            <TablePager
              page={page}
              pageSize={paging.pageSize}
              total={matched}
              onPageChange={paging.setPage}
              noun="returns"
            />
          </CardBody>
        </Card>
      </PageBody>

      {isFormOpen && (
        <SaleReturnFormModal
          onClose={() => setIsFormOpen(false)}
          onSaved={() => returns.refetch()}
        />
      )}
    </>
  )
}
