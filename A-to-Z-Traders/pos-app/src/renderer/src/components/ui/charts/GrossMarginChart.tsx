import type { JSX } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import * as format from '../../../lib/format'
import { ChartTooltip, ChartTooltipRow } from './ChartTooltip'

interface GrossMarginChartProps {
  /** Net sales for the period (ex-tax), the whole the ring divides. */
  sales: number
  /** Gross profit for the period (net sales − cost of goods). */
  profit: number
  height?: number
}

interface Slice {
  name: string
  /** Geometry: clamped to ≥ 0 so the ring is always drawable. */
  value: number
  /** True signed figure, for the label and tooltip (profit can be negative). */
  amount: number
  color: string
}

/**
 * Where each rupee of sales goes — cost of goods versus gross profit.
 *
 * A part-to-whole, so a ring: the two add up to net sales exactly (cost =
 * sales − profit), and the centre states the margin the two imply. One measure
 * of interest — profit — carries the accent; its complement, cost, sits in a
 * neutral track, so the ring reads as "this accent slice is what you kept"
 * rather than as two competing categories. That keeps it inside the app's
 * single-hue discipline (the accent and a second chromatic hue are too close in
 * lightness to separate by colour alone). Colours are CSS variables and follow
 * the theme.
 */
export function GrossMarginChart({
  sales,
  profit,
  height = 200
}: GrossMarginChartProps): JSX.Element {
  if (sales <= 0) {
    return (
      <div className="flex items-center justify-center text-sm text-ink-subtle" style={{ height }}>
        No sales in this period.
      </div>
    )
  }

  const cost = Math.max(0, sales - profit)
  // A loss (selling below cost) has no positive slice to draw; the ring shows
  // all cost and the centre carries the true, negative margin.
  const profitSlice = Math.max(0, profit)
  const margin = (profit / sales) * 100
  const marginIsLoss = margin < 0

  const slices: Slice[] = [
    { name: 'Gross profit', value: profitSlice, amount: profit, color: 'var(--accent)' },
    { name: 'Cost of goods', value: cost, amount: cost, color: 'var(--line-strong)' }
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="relative" style={{ width: '100%', height }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="64%"
              outerRadius="88%"
              startAngle={90}
              endAngle={-270}
              paddingAngle={2}
              stroke="var(--paper)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {slices.map((slice) => (
                <Cell key={slice.name} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip content={<MarginTooltip sales={sales} />} />
          </PieChart>
        </ResponsiveContainer>

        {/* The headline the ring is really about, read at a glance from the hole. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={`text-xl font-semibold tabular-nums ${marginIsLoss ? 'text-bad' : 'text-ink'}`}
          >
            {margin.toFixed(1)}%
          </span>
          <span className="text-caption text-ink-subtle">margin</span>
        </div>
      </div>

      {/* ≥2 slices, so identity is spelled out, not left to colour. */}
      <div className="flex flex-col gap-1.5">
        {slices.map((slice) => (
          <div key={slice.name} className="flex items-center gap-2 text-caption">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: slice.color }}
            />
            <span className="text-ink-muted">{slice.name}</span>
            <span className="ml-auto tabular-nums text-ink">{format.money(slice.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface MarginTooltipProps {
  active?: boolean
  payload?: { payload: Slice }[]
  sales: number
}

function MarginTooltip({ active, payload, sales }: MarginTooltipProps): JSX.Element | null {
  if (!active || !payload?.length) return null
  const slice = payload[0].payload
  const share = sales > 0 ? (slice.amount / sales) * 100 : 0
  return (
    <ChartTooltip title={slice.name}>
      <ChartTooltipRow
        label="Amount"
        value={format.money(slice.amount)}
        tone={slice.amount < 0 ? 'bad' : undefined}
      />
      <ChartTooltipRow label="Share of sales" value={`${share.toFixed(1)}%`} />
    </ChartTooltip>
  )
}
