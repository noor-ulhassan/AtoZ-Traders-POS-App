import clsx from 'clsx'
import type { JSX } from 'react'
import type { CategoryProfitRow, DateRange, NamedAmount } from '@shared/types'
import { Card, CardBody, CardHeader } from '../../components/ui/Surface'
import { Column, DataTable } from '../../components/ui/DataTable'
import { StatTile } from '../../components/ui/StatTile'
import { useQuery } from '../../hooks/useQuery'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useCurrency } from '../../app/SettingsContext'
import styles from './ReportsPage.module.css'

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
        <span className={row.profit < 0 ? styles.negative : styles.positive}>
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
        return (
          <span className={styles.barCell}>
            <span className={styles.barTrack}>
              <span className={styles.barFill} style={{ width: `${Math.min(100, share)}%` }} />
            </span>
            <span style={{ width: 44, textAlign: 'right', color: 'var(--ink-muted)' }}>
              {share.toFixed(0)}%
            </span>
          </span>
        )
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
        return (
          <span className={styles.barCell}>
            <span className={styles.barTrack}>
              <span className={styles.barFill} style={{ width: `${Math.min(100, share)}%` }} />
            </span>
            <span style={{ width: 44, textAlign: 'right', color: 'var(--ink-muted)' }}>
              {share.toFixed(0)}%
            </span>
          </span>
        )
      }
    }
  ]

  return (
    <>
      <div className={styles.tiles}>
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
      </div>

      <div className={styles.split}>
        <Card>
          <CardHeader
            title="Profit and loss"
            subtitle={`${format.date(range.from)} to ${format.date(range.to)}`}
          />
          <div className={styles.statement}>
            {lines.map((line, index) => (
              <div
                key={index}
                className={clsx(
                  styles.line,
                  line.indent && styles.indent,
                  line.kind === 'result' && styles.result,
                  line.kind === 'net' && styles.netProfit
                )}
              >
                <span className={styles.lineLabel}>{line.label}</span>
                <span
                  className={clsx(
                    styles.lineValue,
                    line.kind === 'net' && line.value < 0 && styles.negative
                  )}
                >
                  {line.subtract && line.value > 0 ? '− ' : ''}
                  {format.money(line.value)}
                </span>
              </div>
            ))}
          </div>
          <div className={styles.note}>
            Bill-level discounts are deducted once from gross sales rather than spread across lines.
            Tax collected ({currency} {format.money(data.taxCollected)}) is held for the government
            and is not counted as revenue.
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
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
