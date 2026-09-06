import type { JSX } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { DashboardSummary } from '@shared/types'
import type { DatePresetKey } from '@shared/date'
import { resolvePreset } from '@shared/date'
import * as format from '@renderer/lib/format'
import { useShop } from '../App'
import { useRemote } from '../lib/hooks'
import { CHANNELS } from '../lib/remote'
import {
  Card,
  Empty,
  Loading,
  Note,
  Row,
  Rows,
  Screen,
  Section,
  StaleBanner,
  Tile,
  TopBar
} from '../ui/kit'

/**
 * The first thing the owner sees when he opens the icon on his phone.
 *
 * The same figures the desktop dashboard shows, in the order they get asked
 * about away from the counter: what came in today, what is still owed, and
 * what is running out. Everything is labelled — a bare number on a phone has
 * no column header above it to explain what it is.
 */

const PERIODS: { key: DatePresetKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'last7', label: '7 days' },
  { key: 'thisMonth', label: 'Month' }
]

export function HomeScreen(): JSX.Element {
  const { shop } = useShop()
  const navigate = useNavigate()
  const [period, setPeriod] = useState<DatePresetKey>('today')

  const range = resolvePreset(period)
  const summary = useRemote<DashboardSummary>(CHANNELS.dashboardSummary, range, [period])

  const money = (value: number): string => format.currency(value, shop.currency)
  const data = summary.data

  return (
    <Screen>
      <TopBar title={shop.businessName} subtitle="Phone companion" />
      {summary.isStale && <StaleBanner label={summary.staleLabel} />}

      <div className="flex gap-2 px-4 pt-4">
        {PERIODS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setPeriod(entry.key)}
            className={`flex-1 rounded-xl border px-3 text-sm font-medium ${
              period === entry.key
                ? 'border-accent-border bg-accent-weak text-accent-ink'
                : 'border-line bg-surface-raised text-ink-muted'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {summary.error && (
        <div className="px-4 pt-4">
          <Note tone="bad" title="Could not read the dashboard">
            {summary.error}
          </Note>
        </div>
      )}

      {!data ? (
        summary.isLoading ? (
          <Loading />
        ) : null
      ) : (
        <>
          <Section title="This period">
            <div className="grid grid-cols-2 gap-3">
              <Tile label="Sales" value={money(data.sales)} tone="accent" />
              <Tile label="Profit" value={money(data.profit)} tone="good" />
              <Tile label="Bills" value={String(data.billCount)} />
              <Tile label="Average bill" value={money(data.averageBill)} />
            </div>
          </Section>

          <Section title="Right now">
            <div className="grid grid-cols-2 gap-3">
              <Tile label="Cash in hand" value={money(data.cashInHand)} />
              <Tile label="Expenses (period)" value={money(data.expenses)} />
              <Tile label="Customers owe" value={money(data.receivables)} tone="bad" />
              <Tile label="Owed to suppliers" value={money(data.payables)} tone="bad" />
            </div>
          </Section>

          {data.lowStock.length > 0 && (
            <Section
              title="Running out"
              action={
                <button
                  type="button"
                  className="text-caption font-medium text-accent"
                  onClick={() => navigate('/stock')}
                >
                  All stock
                </button>
              }
            >
              <Card>
                <Rows>
                  {data.lowStock.slice(0, 5).map((item) => (
                    <Row
                      key={item.productId}
                      title={item.productName}
                      subtitle={item.categoryName ?? 'Uncategorised'}
                      value={format.quantity(item.stockQty)}
                      valueNote={`of ${format.quantity(item.reorderLevel)} ${item.baseUnit}`}
                      onClick={() => navigate(`/stock/${item.productId}`)}
                    />
                  ))}
                </Rows>
              </Card>
            </Section>
          )}

          <Section
            title="Latest bills"
            action={
              <button
                type="button"
                className="text-caption font-medium text-accent"
                onClick={() => navigate('/bills')}
              >
                All bills
              </button>
            }
          >
            <Card>
              {data.recentSales.length === 0 ? (
                <Empty title="No bills yet" hint="Bills written here or at the till show up." />
              ) : (
                <Rows>
                  {data.recentSales.map((sale) => (
                    <Row
                      key={sale.id}
                      title={sale.invoiceNo}
                      subtitle={`${sale.customerName ?? 'Walk-in'} · ${format.date(sale.date)}`}
                      value={money(sale.total)}
                      valueNote={sale.paymentType}
                      onClick={() => navigate(`/bills/${sale.id}`)}
                    />
                  ))}
                </Rows>
              )}
            </Card>
          </Section>
        </>
      )}
    </Screen>
  )
}
