import type { JSX } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import type { SalesSummaryPoint } from '@shared/types'
import * as format from '../../../lib/format'
import { ChartTooltip, ChartTooltipRow } from './ChartTooltip'

interface SalesTrendChartProps {
  points: SalesSummaryPoint[]
  height?: number
}

/**
 * Sales over the selected range, as a filled area.
 *
 * One series, one hue — the accent. Profit rides along in the tooltip rather
 * than as a second line: the app's blue and green sit too close in lightness
 * to separate two overlapping series by colour alone (verified against the
 * dataviz palette validator), so profit gets the hover, not its own mark.
 * Colours are CSS variables, so the whole chart follows the light/dark theme
 * with no JS.
 */
export function SalesTrendChart({ points, height = 240 }: SalesTrendChartProps): JSX.Element {
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
        <AreaChart data={points} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="salesTrendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.01} />
            </linearGradient>
          </defs>

          {/* Horizontal rules only; a recessive grid the marks sit on top of. */}
          <CartesianGrid vertical={false} stroke="var(--line)" />

          <XAxis
            dataKey="date"
            tickFormatter={format.dayMonth}
            tick={{ fill: 'var(--ink-subtle)', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--line)' }}
            minTickGap={24}
            padding={{ left: 6, right: 6 }}
          />
          <YAxis
            tickFormatter={(value: number) => format.moneyRounded(value)}
            tick={{ fill: 'var(--ink-subtle)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={56}
          />

          <Tooltip
            content={<TrendTooltip />}
            cursor={{ stroke: 'var(--ink-subtle)', strokeDasharray: '3 3' }}
          />

          <Area
            type="monotone"
            dataKey="sales"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="url(#salesTrendFill)"
            dot={false}
            activeDot={{ r: 4, fill: 'var(--accent)', stroke: 'var(--paper)', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

interface TrendTooltipProps {
  active?: boolean
  payload?: { payload: SalesSummaryPoint }[]
}

function TrendTooltip({ active, payload }: TrendTooltipProps): JSX.Element | null {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  return (
    <ChartTooltip title={format.dayMonth(point.date)}>
      <ChartTooltipRow label="Sales" value={format.money(point.sales)} />
      <ChartTooltipRow
        label="Profit"
        value={format.money(point.profit)}
        tone={point.profit < 0 ? 'bad' : 'good'}
      />
      <ChartTooltipRow label="Bills" value={point.billCount} />
    </ChartTooltip>
  )
}
