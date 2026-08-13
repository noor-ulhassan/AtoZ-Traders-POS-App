import type { JSX } from 'react'
import { useState } from 'react'
import type { DateRange, StockMovement, StockMovementReason } from '@shared/types'
import { resolvePreset } from '@shared/date'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Field'
import { Badge, ToneValue } from '../../components/ui/Feedback'
import { Card, CardBody } from '../../components/ui/Surface'
import { Column, DataTable, PrimaryCell } from '../../components/ui/DataTable'
import { DateRangeFilter } from '../../components/ui/DateRangeFilter'
import { FilterBar, FilterSpacer, PageBody, PageHeader } from '../../components/layout/PageHeader'
import { useMutation } from '../../hooks/useMutation'
import { useQuery } from '../../hooks/useQuery'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'

type ReasonFilter = StockMovementReason | 'all'

/** How each movement reason should read and feel in the ledger. */
const REASON_META: Record<
  StockMovementReason,
  { label: string; tone: 'good' | 'bad' | 'neutral' | 'accent' | 'warn' }
> = {
  opening: { label: 'Opening', tone: 'neutral' },
  purchase: { label: 'Purchase', tone: 'good' },
  sale: { label: 'Sale', tone: 'accent' },
  sale_return: { label: 'Sale return', tone: 'good' },
  purchase_return: { label: 'Purchase return', tone: 'bad' },
  adjustment: { label: 'Adjustment', tone: 'warn' }
}

/**
 * Every movement of every item, in order.
 *
 * This is the record `products.stock_qty` is derived from, so it is also the
 * screen to open when a shelf count and the app disagree.
 */
export function StockLedgerPage(): JSX.Element {
  const [range, setRange] = useState<DateRange>(() => resolvePreset('last30'))
  const [reason, setReason] = useState<ReasonFilter>('all')

  const movements = useQuery(
    () => unwrap(api.stock.movements({ from: range.from, to: range.to, reason, limit: 500 })),
    [range.from, range.to, reason]
  )

  const exportCsv = useMutation(
    async () =>
      unwrap(
        api.exports.csv({ report: 'stock-movements', filters: { from: range.from, to: range.to } })
      ),
    { successMessage: 'Stock movements exported', errorTitle: 'Export failed' }
  )

  const columns: Column<StockMovement>[] = [
    { key: 'date', header: 'Date', width: '120px', render: (row) => format.date(row.date) },
    {
      key: 'product',
      header: 'Product',
      render: (row) => <PrimaryCell title={row.productName} subtitle={row.notes ?? undefined} />
    },
    {
      key: 'reason',
      header: 'Reason',
      width: '150px',
      render: (row) => (
        <Badge tone={REASON_META[row.reason].tone}>{REASON_META[row.reason].label}</Badge>
      )
    },
    {
      key: 'reference',
      header: 'Reference',
      width: '140px',
      render: (row) =>
        row.refId ? (
          <span className="font-mono text-caption text-ink-muted">
            {row.refTable}#{row.refId}
          </span>
        ) : (
          '—'
        )
    },
    {
      key: 'change',
      header: 'Change',
      numeric: true,
      width: '120px',
      render: (row) => (
        <ToneValue tone={row.changeQty >= 0 ? 'good' : 'bad'}>
          {row.changeQty >= 0 ? '+' : '−'}
          {format.quantity(Math.abs(row.changeQty))}
        </ToneValue>
      )
    }
  ]

  return (
    <>
      <PageHeader
        title="Stock ledger"
        subtitle="Every movement in and out, in the order it happened"
        actions={
          <Button
            icon="download"
            loading={exportCsv.isPending}
            onClick={() => void exportCsv.run()}
          >
            Export
          </Button>
        }
      />

      <FilterBar>
        <DateRangeFilter value={range} onChange={setRange} />
        <div style={{ width: 180 }}>
          <Select
            value={reason}
            onChange={(event) => setReason(event.target.value as ReasonFilter)}
          >
            <option value="all">All reasons</option>
            {Object.entries(REASON_META).map(([key, meta]) => (
              <option key={key} value={key}>
                {meta.label}
              </option>
            ))}
          </Select>
        </div>
        <FilterSpacer />
      </FilterBar>

      <PageBody>
        <Card>
          <CardBody flush>
            <DataTable
              columns={columns}
              rows={movements.data?.rows ?? []}
              rowKey={(row) => row.id}
              isLoading={movements.isLoading}
              empty={{
                title: 'No stock movements in this period',
                description: 'Purchases, sales, returns and adjustments all appear here.'
              }}
            />
          </CardBody>
        </Card>
      </PageBody>
    </>
  )
}
