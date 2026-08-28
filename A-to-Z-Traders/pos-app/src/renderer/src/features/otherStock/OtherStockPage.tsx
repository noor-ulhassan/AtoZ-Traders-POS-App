import type { JSX } from 'react'
import { useState } from 'react'
import type { DateRange, OtherStockOwner, OtherStockRow } from '@shared/types'
import { resolvePreset } from '@shared/date'
import { Button } from '../../components/ui/Button'
import { SearchInput, Select } from '../../components/ui/Field'
import { Callout, ToneValue } from '../../components/ui/Feedback'
import { Card, CardBody, CardHeader } from '../../components/ui/Surface'
import { Column, DataTable, PrimaryCell, RowActions } from '../../components/ui/DataTable'
import { DateRangeFilter } from '../../components/ui/DateRangeFilter'
import { StatGrid, StatTile } from '../../components/ui/StatTile'
import { FilterBar, FilterSpacer, PageBody, PageHeader } from '../../components/layout/PageHeader'
import { useDebounced } from '../../hooks/useDebounced'
import { useQuery } from '../../hooks/useQuery'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useCurrency } from '../../app/SettingsContext'
import { OtherStockMovementModal } from './OtherStockMovementModal'

/**
 * The consignment register.
 *
 * Deliberately not a second dashboard. The main dashboard answers "how is my
 * business doing", and these goods are not the business — the margin on them
 * belongs to somebody else. Putting them behind matching profit tiles would
 * invite exactly the confusion the whole feature exists to prevent.
 *
 * What this is instead is a register: what arrived, what sold, what is left,
 * and what it was billed for, per owner. That is the sheet needed on the day
 * the goods' owner comes to settle up.
 */
export function OtherStockPage(): JSX.Element {
  const currency = useCurrency()

  const [range, setRange] = useState<DateRange>(() => resolvePreset('last30'))
  const [ownerName, setOwnerName] = useState('')
  const [search, setSearch] = useState('')
  const [movement, setMovement] = useState<{ product: OtherStockRow; direction: 'in' | 'out' } | null>(
    null
  )

  const debouncedSearch = useDebounced(search)

  const owners = useQuery(() => unwrap(api.otherStock.owners()), [])
  const report = useQuery(
    () =>
      unwrap(
        api.otherStock.report({
          from: range.from,
          to: range.to,
          ownerName: ownerName || undefined,
          search: debouncedSearch || undefined
        })
      ),
    [range.from, range.to, ownerName, debouncedSearch]
  )

  const refresh = (): void => {
    report.refetch()
    owners.refetch()
  }

  const data = report.data
  const rows = data?.rows ?? []

  const productColumns: Column<OtherStockRow>[] = [
    {
      key: 'product',
      header: 'Item',
      render: (row) => (
        <PrimaryCell
          title={row.productName}
          subtitle={[row.sku, row.ownerName].filter(Boolean).join(' · ')}
        />
      )
    },
    {
      key: 'received',
      header: 'Received',
      numeric: true,
      width: '110px',
      render: (row) => format.quantity(row.received)
    },
    {
      key: 'sold',
      header: 'Sold',
      numeric: true,
      width: '100px',
      render: (row) => format.quantity(row.sold)
    },
    {
      key: 'back',
      header: 'Sent back',
      numeric: true,
      width: '110px',
      render: (row) =>
        row.returnedToOwner > 0 ? (
          format.quantity(row.returnedToOwner)
        ) : (
          <span className="text-ink-subtle">—</span>
        )
    },
    {
      key: 'onHand',
      header: 'On the shelf',
      numeric: true,
      width: '130px',
      render: (row) => (
        <ToneValue tone={row.onHand <= 0 ? 'neutral' : 'good'}>
          {format.quantity(row.onHand)} {row.baseUnit}
        </ToneValue>
      )
    },
    {
      key: 'billed',
      header: `Billed (${currency})`,
      numeric: true,
      width: '140px',
      render: (row) => format.money(row.billedAmount)
    },
    {
      key: 'actions',
      header: '',
      width: '150px',
      render: (row) => (
        <RowActions>
          <Button size="sm" onClick={() => setMovement({ product: row, direction: 'in' })}>
            Receive
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={row.onHand <= 0}
            onClick={() => setMovement({ product: row, direction: 'out' })}
          >
            Send back
          </Button>
        </RowActions>
      )
    }
  ]

  const ownerColumns: Column<OtherStockOwner>[] = [
    {
      key: 'owner',
      header: 'Owner',
      render: (owner) => (
        <PrimaryCell
          title={owner.ownerName}
          subtitle={format.pluralize(owner.productCount, 'item')}
        />
      )
    },
    {
      key: 'received',
      header: 'Received',
      numeric: true,
      width: '110px',
      render: (owner) => format.quantity(owner.received)
    },
    {
      key: 'sold',
      header: 'Sold',
      numeric: true,
      width: '100px',
      render: (owner) => format.quantity(owner.sold)
    },
    {
      key: 'onHand',
      header: 'Still holding',
      numeric: true,
      width: '130px',
      render: (owner) => format.quantity(owner.onHand)
    },
    {
      key: 'billed',
      header: `Billed (${currency})`,
      numeric: true,
      width: '140px',
      render: (owner) => <strong>{format.money(owner.billedAmount)}</strong>
    }
  ]

  return (
    <>
      <PageHeader
        title="Other stock"
        subtitle="Goods you sell that belong to someone else"
      />

      <FilterBar>
        <DateRangeFilter value={range} onChange={setRange} />
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search item or owner"
        />
        <div style={{ width: 200 }}>
          <Select value={ownerName} onChange={(event) => setOwnerName(event.target.value)}>
            <option value="">All owners</option>
            {(owners.data ?? []).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </div>
        <FilterSpacer />
      </FilterBar>

      <PageBody>
        <StatGrid min={190}>
          <StatTile label="Owners" value={data?.totals.ownerCount ?? 0} />
          <StatTile label="Items" value={data?.totals.productCount ?? 0} />
          <StatTile label="On the shelf" value={format.quantity(data?.totals.onHand ?? 0)} />
          <StatTile
            label="Billed in period"
            unit={currency}
            value={format.money(data?.totals.billedAmount ?? 0)}
          />
        </StatGrid>

        {rows.length === 0 && !report.isLoading && (
          <Callout tone="info" title="Nothing recorded here yet">
            Add a product on the Products screen, set it to &ldquo;Other stock&rdquo; and name whose
            goods it is. It will then bill like anything else — and stay out of your cost, profit
            and stock value, because the margin on it is not yours.
          </Callout>
        )}

        {data && data.owners.length > 0 && (
          <Card>
            <CardHeader
              title="By owner"
              subtitle="What to settle, and with whom. Billed amounts are net of anything customers brought back."
            />
            <CardBody flush>
              <DataTable
                columns={ownerColumns}
                rows={data.owners}
                rowKey={(owner) => owner.ownerName}
                isLoading={report.isLoading}
              />
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader
            title="Item by item"
            subtitle="Quantities come from the stock ledger, so this can never disagree with the shelf."
          />
          <CardBody flush>
            <DataTable
              columns={productColumns}
              rows={rows}
              rowKey={(row) => row.productId}
              isLoading={report.isLoading}
              error={report.error}
              onRetry={report.refetch}
              empty={{
                title: 'No other stock in this period',
                description: 'Change the dates, or add a product that belongs to someone else.'
              }}
            />
          </CardBody>
        </Card>
      </PageBody>

      {movement && (
        <OtherStockMovementModal
          product={movement.product}
          direction={movement.direction}
          onClose={() => setMovement(null)}
          onSaved={refresh}
        />
      )}
    </>
  )
}
