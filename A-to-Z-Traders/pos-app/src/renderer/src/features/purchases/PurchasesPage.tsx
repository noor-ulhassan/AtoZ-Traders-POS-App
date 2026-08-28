import type { JSX } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { DateRange, Purchase } from '@shared/types'
import { resolvePreset } from '@shared/date'
import { Button } from '../../components/ui/Button'
import { SearchInput } from '../../components/ui/Field'
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
import { useCurrency } from '../../app/SettingsContext'
import { PurchaseDetailModal } from './PurchaseDetailModal'

export function PurchasesPage(): JSX.Element {
  const currency = useCurrency()
  const navigate = useNavigate()

  const [range, setRange] = useState<DateRange>(() => resolvePreset('last30'))
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)

  const debouncedSearch = useDebounced(search)

  const paging = usePagination([range.from, range.to, debouncedSearch])

  const purchases = useQuery(
    () =>
      unwrap(
        api.purchases.list({
          from: range.from,
          to: range.to,
          search: debouncedSearch || undefined,
          limit: paging.limit,
          offset: paging.offset
        })
      ),
    [range.from, range.to, debouncedSearch, paging.offset, paging.limit]
  )

  const exportCsv = useMutation(
    async () =>
      unwrap(api.exports.csv({ report: 'purchases', filters: { from: range.from, to: range.to } })),
    { successMessage: 'Purchases exported', errorTitle: 'Export failed' }
  )

  const rows = purchases.data?.rows ?? []
  // Server-side, over every purchase in the period rather than the open page.
  const matched = purchases.data?.total ?? 0
  const total = purchases.data?.totals.total ?? 0
  const unpaid = purchases.data?.totals.unpaid ?? 0
  const page = useClampedPage(paging, matched)

  const columns: Column<Purchase>[] = [
    { key: 'date', header: 'Date', width: '120px', render: (row) => format.date(row.date) },
    {
      key: 'supplier',
      header: 'Supplier',
      render: (row) => (
        <PrimaryCell
          title={row.supplierName ?? 'No supplier'}
          subtitle={row.invoiceNo ? `Invoice ${row.invoiceNo}` : undefined}
        />
      )
    },
    {
      key: 'total',
      header: `Total (${currency})`,
      numeric: true,
      width: '140px',
      render: (row) => format.money(row.total)
    },
    {
      key: 'paid',
      header: `Paid (${currency})`,
      numeric: true,
      width: '140px',
      render: (row) => format.money(row.paidAmount)
    },
    {
      key: 'balance',
      header: `Owing (${currency})`,
      numeric: true,
      width: '140px',
      render: (row) => {
        const balance = row.total - row.paidAmount
        return balance > 0.005 ? (
          <ToneValue tone="bad">{format.money(balance)}</ToneValue>
        ) : (
          <span style={{ color: 'var(--ink-subtle)' }}>—</span>
        )
      }
    },
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      render: (row) => {
        const balance = row.total - row.paidAmount
        if (balance <= 0.005) return <Badge tone="good">Paid</Badge>
        if (row.paidAmount > 0) return <Badge tone="warn">Part paid</Badge>
        return <Badge tone="bad">Unpaid</Badge>
      }
    }
  ]

  return (
    <>
      <PageHeader
        title="Purchases"
        subtitle="Stock coming in, and what is still owed for it"
        actions={
          <>
            <Button
              icon="download"
              loading={exportCsv.isPending}
              onClick={() => void exportCsv.run()}
            >
              Export
            </Button>
            <Button variant="primary" icon="plus" onClick={() => navigate('/purchases/new')}>
              Record purchase
            </Button>
          </>
        }
      />

      <FilterBar>
        <DateRangeFilter value={range} onChange={setRange} />
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search by supplier or invoice number"
        />
        <FilterSpacer />
      </FilterBar>

      <PageBody>
        <StatGrid>
          <StatTile label="Purchases in period" unit={currency} value={format.money(total)} />
          <StatTile
            label="Still owed on these"
            unit={currency}
            value={format.money(unpaid)}
            tone={unpaid > 0 ? 'bad' : 'default'}
          />
          <StatTile label="Bills recorded" value={matched} />
        </StatGrid>

        <Card>
          <CardBody flush>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              isLoading={purchases.isLoading}
              error={purchases.error}
              onRetry={purchases.refetch}
              onRowClick={(row) => setOpenId(row.id)}
              empty={{
                title: 'No purchases in this period',
                description: 'Record a purchase to bring stock in and update your average cost.',
                action: (
                  <Button variant="primary" icon="plus" onClick={() => navigate('/purchases/new')}>
                    Record purchase
                  </Button>
                )
              }}
            />
            <TablePager
              page={page}
              pageSize={paging.pageSize}
              total={matched}
              onPageChange={paging.setPage}
              noun="purchases"
            />
          </CardBody>
        </Card>
      </PageBody>

      <PurchaseDetailModal purchaseId={openId} onClose={() => setOpenId(null)} />
    </>
  )
}
