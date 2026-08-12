import type { JSX } from 'react'
import { useState } from 'react'
import type { DateRange, PurchaseReturn } from '@shared/types'
import { resolvePreset } from '@shared/date'
import { Button } from '../../components/ui/Button'
import { Card, CardBody } from '../../components/ui/Surface'
import { Column, DataTable, PrimaryCell } from '../../components/ui/DataTable'
import { DateRangeFilter } from '../../components/ui/DateRangeFilter'
import { StatTile } from '../../components/ui/StatTile'
import { FilterBar, FilterSpacer, PageBody, PageHeader } from '../../components/layout/PageHeader'
import { useQuery } from '../../hooks/useQuery'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useCurrency } from '../../app/SettingsContext'
import { PurchaseReturnFormModal } from './PurchaseReturnFormModal'
import styles from './ReturnsPage.module.css'

export function PurchaseReturnsPage(): JSX.Element {
  const currency = useCurrency()
  const [range, setRange] = useState<DateRange>(() => resolvePreset('last30'))
  const [isFormOpen, setIsFormOpen] = useState(false)

  const returns = useQuery(
    () => unwrap(api.returns.purchase.list({ from: range.from, to: range.to, limit: 300 })),
    [range.from, range.to]
  )

  const rows = returns.data?.rows ?? []
  const total = rows.reduce((sum, row) => sum + row.total, 0)

  const columns: Column<PurchaseReturn>[] = [
    { key: 'date', header: 'Date', width: '120px', render: (row) => format.date(row.date) },
    {
      key: 'supplier',
      header: 'Supplier',
      render: (row) => (
        <PrimaryCell
          title={row.supplierName ?? 'No supplier'}
          subtitle={row.purchaseInvoiceNo ? `Against ${row.purchaseInvoiceNo}` : undefined}
        />
      )
    },
    {
      key: 'notes',
      header: 'Notes',
      render: (row) => <span style={{ color: 'var(--ink-muted)' }}>{row.notes ?? '—'}</span>
    },
    {
      key: 'total',
      header: `Credit (${currency})`,
      numeric: true,
      width: '150px',
      render: (row) => format.money(row.total)
    }
  ]

  return (
    <>
      <PageHeader
        title="Purchase returns"
        subtitle="Goods sent back to suppliers, reducing what you owe them"
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
                title: 'No purchase returns in this period',
                description:
                  'Returning goods takes them out of stock and reduces the supplier balance.'
              }}
            />
          </CardBody>
        </Card>
      </PageBody>

      {isFormOpen && (
        <PurchaseReturnFormModal
          onClose={() => setIsFormOpen(false)}
          onSaved={() => returns.refetch()}
        />
      )}
    </>
  )
}
