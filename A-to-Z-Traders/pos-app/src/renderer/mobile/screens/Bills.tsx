import type { JSX } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PageWithTotals, Sale, SalePageTotals } from '@shared/types'
import { resolvePreset } from '@shared/date'
import type { DatePresetKey } from '@shared/date'
import * as format from '@renderer/lib/format'
import { useShop } from '../App'
import { useDebounced, useRemote } from '../lib/hooks'
import { CHANNELS } from '../lib/remote'
import {
  Badge,
  Card,
  Empty,
  Loading,
  Note,
  Row,
  Rows,
  Screen,
  SearchInput,
  Section,
  StaleBanner,
  Tile,
  TopBar
} from '../ui/kit'

/**
 * Every bill, newest first.
 *
 * The tiles come from the server's own aggregates over the whole filtered set,
 * never from adding up the rows on screen — the same rule the desktop list
 * screens follow, and it matters more here because a phone shows fewer rows.
 */

const PERIODS: { key: DatePresetKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'last7', label: '7 days' },
  { key: 'thisMonth', label: 'Month' },
  { key: 'last30', label: '30 days' }
]

export function BillsScreen(): JSX.Element {
  const { shop } = useShop()
  const navigate = useNavigate()
  const [period, setPeriod] = useState<DatePresetKey>('last7')
  const [search, setSearch] = useState('')
  const query = useDebounced(search, 250)

  const range = resolvePreset(period)
  const sales = useRemote<PageWithTotals<Sale, SalePageTotals>>(
    CHANNELS.salesList,
    { from: range.from, to: range.to, search: query, limit: 50 },
    [period, query]
  )

  const cash = (value: number): string => format.currency(value, shop.currency)
  const rows = sales.data?.rows ?? []

  return (
    <Screen>
      <TopBar title="Bills" />
      {sales.isStale && <StaleBanner label={sales.staleLabel} />}

      <div className="flex gap-2 overflow-x-auto px-4 pt-4 pb-1">
        {PERIODS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setPeriod(entry.key)}
            className={`shrink-0 rounded-xl border px-4 text-sm font-medium ${
              period === entry.key
                ? 'border-accent-border bg-accent-weak text-accent-ink'
                : 'border-line bg-surface-raised text-ink-muted'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <Section>
        <SearchInput
          value={search}
          placeholder="Invoice number or customer"
          onChange={(event) => setSearch(event.target.value)}
        />
      </Section>

      {sales.data && (
        <Section>
          <div className="grid grid-cols-3 gap-3">
            <Tile label="Billed" value={cash(sales.data.totals.total)} />
            <Tile label="Received" value={cash(sales.data.totals.paid)} tone="good" />
            <Tile label="On khata" value={cash(sales.data.totals.onKhata)} tone="bad" />
          </div>
        </Section>
      )}

      {sales.error && (
        <Section>
          <Note tone="bad">{sales.error}</Note>
        </Section>
      )}

      <Section title={`${sales.data?.total ?? 0} bills`}>
        <Card>
          {sales.isLoading && !sales.data ? (
            <Loading />
          ) : rows.length === 0 ? (
            <Empty title="No bills in this period" />
          ) : (
            <Rows>
              {rows.map((sale) => {
                const due = Math.max(0, sale.total - sale.paidAmount)
                return (
                  <Row
                    key={sale.id}
                    title={
                      <span className="flex items-center gap-2">
                        {sale.invoiceNo}
                        {sale.voidedAt && <Badge tone="bad">Cancelled</Badge>}
                        {!sale.voidedAt && due > 0 && <Badge tone="warn">Due</Badge>}
                      </span>
                    }
                    subtitle={`${sale.customerName ?? 'Walk-in'} · ${format.date(sale.date)}`}
                    value={cash(sale.total)}
                    valueNote={due > 0 ? `${format.money(due)} due` : 'paid'}
                    onClick={() => navigate(`/bills/${sale.id}`)}
                  />
                )
              })}
            </Rows>
          )}
        </Card>

        {sales.data && sales.data.total > rows.length && (
          <p className="px-1 pt-3 text-caption text-ink-subtle">
            Showing the newest {rows.length} of {sales.data.total}. Narrow the period or search to
            find an older one.
          </p>
        )}
      </Section>
    </Screen>
  )
}
