import type { JSX } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ExportName, ProfitLossReport, StockValuationReport } from '@shared/types'
import { resolvePreset } from '@shared/date'
import type { DatePresetKey } from '@shared/date'
import * as format from '@renderer/lib/format'
import { useShop } from '../App'
import { useAction, useOnline, useRemote } from '../lib/hooks'
import { CHANNELS } from '../lib/remote'
import { downloadCsv } from '../lib/client'
import {
  Card,
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
 * The reports, and the CSVs of them.
 *
 * The desktop's export writes a file through a Save dialog, which is exactly
 * the wrong thing to do for a phone — it would open a window on a computer
 * nobody is standing at. So the network builds the identical report and hands
 * it to the phone's browser as a download (`/api/export`), which is where a
 * phone puts a file. The report itself is the same one, from the same builder.
 */

const PERIODS: { key: DatePresetKey; label: string }[] = [
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'last30', label: '30 days' },
  { key: 'thisYear', label: 'This year' }
]

const DOWNLOADS: { report: ExportName; label: string; ranged: boolean }[] = [
  { report: 'sales', label: 'Bills', ranged: true },
  { report: 'sale-items', label: 'Items sold', ranged: true },
  { report: 'profit-loss', label: 'Profit and loss', ranged: true },
  { report: 'payments', label: 'Payments', ranged: true },
  { report: 'expenses', label: 'Expenses', ranged: true },
  { report: 'purchases', label: 'Purchases', ranged: true },
  { report: 'customers', label: 'Customers and balances', ranged: false },
  { report: 'suppliers', label: 'Suppliers and balances', ranged: false },
  { report: 'inventory', label: 'Stock on hand', ranged: false },
  { report: 'stock-valuation', label: 'Stock valuation', ranged: false }
]

export function ReportsScreen(): JSX.Element {
  const { shop } = useShop()
  const navigate = useNavigate()
  const online = useOnline()
  const [period, setPeriod] = useState<DatePresetKey>('thisMonth')

  const range = resolvePreset(period)
  const pl = useRemote<ProfitLossReport>(CHANNELS.reportsProfitLoss, range, [period])
  const valuation = useRemote<StockValuationReport>(CHANNELS.reportsStockValuation)

  const cash = (value: number): string => format.currency(value, shop.currency)

  const download = useAction(async (report: ExportName, ranged: boolean) =>
    downloadCsv(report, ranged ? { from: range.from, to: range.to } : {})
  )

  return (
    <Screen>
      <TopBar title="Reports" onBack={() => navigate('/more')} />
      {pl.isStale && <StaleBanner label={pl.staleLabel} />}

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

      {pl.error && (
        <Section>
          <Note tone="bad">{pl.error}</Note>
        </Section>
      )}

      <Section title="Profit and loss">
        {pl.isLoading && !pl.data ? (
          <Loading />
        ) : pl.data ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Tile label="Net sales" value={cash(pl.data.netSales)} tone="accent" />
              <Tile label="Gross profit" value={cash(pl.data.grossProfit)} tone="good" />
              <Tile label="Expenses" value={cash(pl.data.expenses)} tone="bad" />
              <Tile
                label="Net profit"
                value={cash(pl.data.netProfit)}
                tone={pl.data.netProfit >= 0 ? 'good' : 'bad'}
              />
            </div>

            <Card className="mt-3 p-4">
              <dl className="flex flex-col gap-2 text-sm">
                {[
                  ['Gross sales', pl.data.grossSales],
                  ['Bill discounts', -pl.data.billDiscounts],
                  ['Sales returns', -pl.data.salesReturns],
                  ['Cost of goods sold', -pl.data.netCogs],
                  ['Bills', pl.data.billCount]
                ].map(([label, value]) => (
                  <div key={String(label)} className="flex justify-between">
                    <dt className="text-ink-muted">{label}</dt>
                    <dd className="tabular-nums">
                      {label === 'Bills' ? String(value) : format.money(Number(value))}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          </>
        ) : null}
      </Section>

      {valuation.data && (
        <Section title="Stock on the shelf">
          <div className="grid grid-cols-2 gap-3">
            <Tile label="At cost" value={cash(valuation.data.totalStockValue)} />
            <Tile label="At retail" value={cash(valuation.data.totalRetailValue)} />
          </div>
        </Section>
      )}

      <Section title="Download a spreadsheet">
        {!online && (
          <div className="mb-3">
            <Note tone="warn">
              A report is built on the shop computer when it is asked for, so downloading needs the
              shop Wi-Fi.
            </Note>
          </div>
        )}
        {download.error && (
          <div className="mb-3">
            <Note tone="bad">{download.error}</Note>
          </div>
        )}
        <Card>
          <Rows>
            {DOWNLOADS.map((entry) => (
              <Row
                key={entry.report}
                title={entry.label}
                subtitle={entry.ranged ? 'For the period above' : 'As things stand now'}
                valueNote={download.isPending ? '…' : 'CSV'}
                onClick={() => {
                  if (online) void download.run(entry.report, entry.ranged)
                }}
              />
            ))}
          </Rows>
        </Card>
        <p className="px-1 pt-3 text-caption text-ink-subtle">
          Files open in Excel or Google Sheets. They are built fresh each time from the shop&rsquo;s
          own records.
        </p>
      </Section>
    </Screen>
  )
}
