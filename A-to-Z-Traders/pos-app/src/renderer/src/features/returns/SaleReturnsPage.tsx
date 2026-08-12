import type { JSX } from 'react'
import { useState } from 'react'
import type { DateRange, SaleReturn } from '@shared/types'
import { resolvePreset } from '@shared/date'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Feedback'
import { Card, CardBody } from '../../components/ui/Surface'
import { Column, DataTable, PrimaryCell } from '../../components/ui/DataTable'
import { DateRangeFilter } from '../../components/ui/DateRangeFilter'
import { StatTile } from '../../components/ui/StatTile'
import { FilterBar, FilterSpacer, PageBody, PageHeader } from '../../components/layout/PageHeader'
import { useQuery } from '../../hooks/useQuery'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useCurrency } from '../../app/SettingsContext'
import { SaleReturnFormModal } from './SaleReturnFormModal'
import styles from './ReturnsPage.module.css'

export function SaleReturnsPage(): JSX.Element {
  const currency = useCurrency()
  const [range, setRange] = useState<DateRange>(() => resolvePreset('last30'))
  const [isFormOpen, setIsFormOpen] = useState(false)

  const returns = useQuery(
    () => unwrap(api.returns.sale.list({ from: range.from, to: range.to, limit: 300 })),
    [range.from, range.to]
  )

  const rows = returns.data?.rows ?? []
  const total = rows.reduce((sum, row) => sum + row.total, 0)
  const cashRefunded = rows
    .filter((row) => row.refundType === 'cash')
    .reduce((sum, row) => sum + row.total, 0)

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

      <PageBody>
        <div className={styles.tiles}>
          <StatTile label="Returned in period" unit={currency} value={format.money(total)} />
          <StatTile label="Cash refunded" unit={currency} value={format.money(cashRefunded)} />
          <StatTile label="Returns recorded" value={rows.length} />
        </div>

        <Card>
          <CardBody flush>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              isLoading={returns.isLoading}
              empty={{
                title: 'No returns in this period',
                description: 'Returned goods go back into stock and adjust profit automatically.'
              }}
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
