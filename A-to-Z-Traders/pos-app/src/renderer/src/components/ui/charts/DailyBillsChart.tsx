import type { JSX } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SalesSummaryPoint } from '@shared/types'
import * as format from '../../../lib/format'
import { ChartTooltip, ChartTooltipRow } from './ChartTooltip'

interface DailyBillsChartProps {
  points: SalesSummaryPoint[]
  height?: number
}

/**
 * How busy the shop was, day by day — the count of bills, not their value.
 *
 * The sales trend answers "how much did we take?"; this answers "how many
 * customers came?". A different question, so a different mark: discrete bars,
 * one per day, in the accent hue. One measure, one hue, a recessive horizontal
 * grid — the same single-series discipline as the trend. Value and takings ride
 * in the tooltip. Colours are CSS variables, so it follows the theme with no JS.
 */
export function DailyBillsChart({ points, height = 200 }: DailyBillsChartProps): JSX.Element {
  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-ink-subtle" style={{ height }}>
        No sales in this period.
      </div>
    )
  }

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart data={points} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          {/* Horizontal rules only; a recessive grid the bars sit on top of. */}
          <CartesianGrid vertical={false} stroke="var(--line)" />

          <XAxis
            dataKey="date"
            tickFormatter={format.dayMonth}
            tick={{ fill: 'var(--ink-subtle)', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--line)' }}
            minTickGap={24}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: 'var(--ink-subtle)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={32}
          />

          <Tooltip content={<BillsTooltip />} cursor={{ fill: 'var(--surface-hover)' }} />

          <Bar
            dataKey="billCount"
            fill="var(--accent)"
            radius={[4, 4, 0, 0]}
            maxBarSize={40}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

interface BillsTooltipProps {
  active?: boolean
  payload?: { payload: SalesSummaryPoint }[]
}

function BillsTooltip({ active, payload }: BillsTooltipProps): JSX.Element | null {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  const average = point.billCount > 0 ? point.sales / point.billCount : 0
  return (
    <ChartTooltip title={format.dayMonth(point.date)}>
      <ChartTooltipRow label="Bills" value={point.billCount} />
      <ChartTooltipRow label="Sales" value={format.money(point.sales)} />
      <ChartTooltipRow label="Average bill" value={format.money(average)} />
    </ChartTooltip>
  )
}
