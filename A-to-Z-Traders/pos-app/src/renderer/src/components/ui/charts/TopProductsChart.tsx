import type { JSX } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import type { ProductProfitRow } from '@shared/types'
import * as format from '../../../lib/format'
import { ChartTooltip, ChartTooltipRow } from './ChartTooltip'

interface TopProductsChartProps {
  rows: ProductProfitRow[]
  /** Row height per bar; the chart sizes itself to the number of products. */
  barGap?: number
}

const ROW_HEIGHT = 34
const NAME_WIDTH = 116

/** Long product names get an ellipsis rather than shoving the plot narrower. */
function shortName(name: string): string {
  return name.length > 18 ? `${name.slice(0, 17)}…` : name
}

/**
 * Top products by revenue, as horizontal bars.
 *
 * Magnitude of one measure → a single hue (the accent), bars ordered longest
 * first, each with its value labelled at the end so the axis is a reference not
 * a lookup. Rounded data-ends, thin bars, a recessive vertical grid. Revenue is
 * the bar; profit and quantity live in the tooltip.
 */
export function TopProductsChart({ rows }: TopProductsChartProps): JSX.Element {
  if (rows.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-ink-subtle">
        No sales in this period.
      </div>
    )
  }

  const height = rows.length * ROW_HEIGHT + 24

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart
          layout="vertical"
          data={rows}
          margin={{ top: 4, right: 52, left: 4, bottom: 4 }}
          barCategoryGap="28%"
        >
          <CartesianGrid horizontal={false} stroke="var(--line)" />
          <XAxis
            type="number"
            tickFormatter={(value: number) => format.moneyRounded(value)}
            tick={{ fill: 'var(--ink-subtle)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            hide
          />
          <YAxis
            type="category"
            dataKey="productName"
            tickFormatter={shortName}
            tick={{ fill: 'var(--ink-muted)', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={NAME_WIDTH}
          />
          <Tooltip content={<ProductTooltip />} cursor={{ fill: 'var(--surface-hover)' }} />
          <Bar
            dataKey="revenue"
            fill="var(--accent)"
            radius={[0, 4, 4, 0]}
            barSize={14}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="revenue"
              position="right"
              formatter={(value) => format.moneyRounded(Number(value ?? 0))}
              fill="var(--ink-muted)"
              fontSize={11}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

interface ProductTooltipProps {
  active?: boolean
  payload?: { payload: ProductProfitRow }[]
}

function ProductTooltip({ active, payload }: ProductTooltipProps): JSX.Element | null {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <ChartTooltip title={row.productName}>
      <ChartTooltipRow label="Sales" value={format.money(row.revenue)} />
      <ChartTooltipRow
        label="Profit"
        value={format.money(row.profit)}
        tone={row.profit < 0 ? 'bad' : 'good'}
      />
      <ChartTooltipRow label="Sold" value={format.quantity(row.baseQtySold)} />
    </ChartTooltip>
  )
}
