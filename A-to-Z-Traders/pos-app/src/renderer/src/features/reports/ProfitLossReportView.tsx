import clsx from 'clsx'
import type { JSX } from 'react'
import type { CategoryProfitRow, DateRange, NamedAmount } from '@shared/types'
import { Card, CardBody, CardHeader } from '../../components/ui/Surface'
import { Column, DataTable } from '../../components/ui/DataTable'
import { StatGrid, StatTile } from '../../components/ui/StatTile'
import { useQuery } from '../../hooks/useQuery'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useCurrency } from '../../app/SettingsContext'

/**
 * A proportion bar, used in both breakdown tables.
 *
 * The fill is a block: as an inline span it would ignore the width it is given
 * and the bar would read as permanently empty.
 */
function ShareBar({ percent }: { percent: number }): JSX.Element {
  return (
    <span className="flex items-center gap-3">
      <span className="h-1.5 min-w-10 flex-1 overflow-hidden rounded-full bg-surface-sunken">
        <span
          className="block h-full rounded-full bg-accent"
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </span>
      <span className="w-11 text-right text-ink-muted">{percent.toFixed(0)}%</span>
    </span>
  )
}

interface StatementLine {
  label: string
  value: number
  indent?: boolean
  kind?: 'result' | 'net'
  /** Shown as a negative even though the stored figure is positive. */
  subtract?: boolean
}

export function ProfitLossReportView({ range }: { range: DateRange }): JSX.Element {
  const currency = useCurrency()
  const report = useQuery(() => unwrap(api.reports.profitLoss(range)), [range.from, range.to])
  const data = report.data

  if (!data) {
    return (
      <Card>
        <CardBody>Loading…</CardBody>
      </Card>
    )
  }

  const lines: StatementLine[] = [
    { label: 'Gross sales', value: data.grossSales },
    { label: 'Less bill discounts', value: data.billDiscounts, indent: true, subtract: true },
    { label: 'Less sales returns', value: data.salesReturns, indent: true, subtract: true },
    { label: 'Net sales', value: data.netSales, kind: 'result' },
    { label: 'Cost of goods sold', value: data.cogs, indent: true, subtract: true },
    { label: 'Cost of returned goods', value: data.returnedCogs, indent: true },
    { label: 'Gross profit', value: data.grossProfit, kind: 'result' },
    ...data.expenseBreakdown.map<StatementLine>((expense) => ({
      label: expense.name,
      value: expense.amount,
      indent: true,
      subtract: true
    })),
    { label: 'Total expenses', value: data.expenses, subtract: true },
    { label: 'Net profit', value: data.netProfit, kind: 'net' }
  ]

  const margin = data.netSales === 0 ? 0 : (data.netProfit / data.netSales) * 100

  const categoryColumns: Column<CategoryProfitRow>[] = [
    { key: 'name', header: 'Category', render: (row) => row.categoryName },
    {
      key: 'revenue',
      header: `Revenue (${currency})`,
      numeric: true,
      width: '140px',
      render: (row) => format.money(row.revenue)
    },
    {
      key: 'profit',
      header: `Profit (${currency})`,
      numeric: true,
      width: '140px',
      render: (row) => (
        <span className={row.profit < 0 ? 'text-bad' : 'text-good'}>
          {format.money(row.profit)}
        </span>
      )
    },
    {
      key: 'share',
      header: 'Share of revenue',
      width: '180px',
      render: (row) => {
        const share = data.netSales === 0 ? 0 : (row.revenue / data.grossSales) * 100
        return <ShareBar percent={share} />
      }
    }
  ]

  const expenseColumns: Column<NamedAmount>[] = [
    { key: 'name', header: 'Expense category', render: (row) => row.name },
    {
      key: 'amount',
      header: `Amount (${currency})`,
      numeric: true,
      width: '150px',
      render: (row) => format.money(row.amount)
    },
    {
      key: 'share',
      header: 'Share',
      width: '160px',
      render: (row) => {
        const share = data.expenses === 0 ? 0 : (row.amount / data.expenses) * 100
        return <ShareBar percent={share} />
      }
    }
  ]

  return (
    <>
      <StatGrid min={200}>
        <StatTile label="Net sales" unit={currency} value={format.money(data.netSales)} />
        <StatTile label="Gross profit" unit={currency} value={format.money(data.grossProfit)} />
        <StatTile label="Expenses" unit={currency} value={format.money(data.expenses)} tone="bad" />
        <StatTile
          label="Net profit"
          unit={currency}
          value={format.money(data.netProfit)}
          tone={data.netProfit < 0 ? 'bad' : 'good'}
          footnote={`${margin.toFixed(1)}% of net sales`}
        />
        <StatTile label="Bills" value={data.billCount} />
      </StatGrid>

      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-start gap-5">
        <Card>
          <CardHeader
            title="Profit and loss"
            subtitle={`${format.date(range.from)} to ${format.date(range.to)}`}
          />
          <div className="flex flex-col">
            {lines.map((line, index) => (
              <div
                key={index}
                className={clsx(
                  'flex items-baseline justify-between gap-4 border-t border-line px-5 py-2 text-sm first:border-t-0',
                  line.kind === 'result' && 'border-line-strong bg-surface-sunken py-3',
                  line.kind === 'net' && 'border-b border-accent-border bg-accent-weak'
                )}
              >
                <span
                  className={clsx(
                    'text-ink-muted',
                    line.indent && 'pl-4 text-caption text-ink-subtle',
                    line.kind === 'result' && 'font-semibold text-ink',
                    line.kind === 'net' && 'text-accent-ink'
                  )}
                >
                  {line.label}
                </span>
                <span
                  className={clsx(
                    'font-medium tabular-nums',
                    line.kind === 'result' && 'text-md font-semibold',
                    line.kind === 'net' && 'font-display text-lg text-accent-ink',
                    line.kind === 'net' && line.value < 0 && 'text-bad'
                  )}
                >
                  {line.subtract && line.value > 0 ? '− ' : ''}
                  {format.money(line.value)}
                </span>
              </div>
            ))}
          </div>
          <div className="border-t border-line px-5 py-3 text-caption leading-normal text-ink-subtle">
            Bill-level discounts are deducted once from gross sales rather than spread across lines.
            Tax collected ({currency} {format.money(data.taxCollected)}) is held for the government
            and is not counted as revenue.
          </div>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Where the profit came from" subtitle="By product category" />
            <CardBody flush>
              <DataTable
                columns={categoryColumns}
                rows={data.categoryBreakdown}
                rowKey={(row) => String(row.categoryId ?? 'none')}
                compact
                empty={{ title: 'No sales in this period' }}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Where the money went" subtitle="By expense category" />
            <CardBody flush>
              <DataTable
                columns={expenseColumns}
                rows={data.expenseBreakdown}
                rowKey={(row) => row.name}
                compact
                empty={{
                  title: 'No expenses recorded',
                  description: 'Without expenses, net profit is the same as gross profit.'
                }}
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}
