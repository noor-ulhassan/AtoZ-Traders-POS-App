import type { JSX } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import * as format from '../../../lib/format'
import { ChartTooltip, ChartTooltipRow } from './ChartTooltip'

interface FinancialPositionChartProps {
  /** Running cash position, all time. May be negative when the drawer is overdrawn. */
  cashInHand: number
  /** Total customers owe the shop, all time. Always ≥ 0. */
  receivables: number
  /** Total the shop owes suppliers, all time. Always ≥ 0. */
  payables: number
}

interface PositionRow {
  label: string
  value: number
  /** Reinforcing status colour; the row label carries identity, not the hue. */
  color: string
  hint: string
}

const ROW_HEIGHT = 46
const LABEL_WIDTH = 128

/**
 * Where the money stands right now — three all-time balances side by side.
 *
 * Cash in the drawer, what customers still owe, and what the shop owes
 * suppliers. Three positions on one money axis, ordered as the owner reads them.
 * Each bar sits on its own labelled row, so identity comes from the label, not
 * the colour — the tint only reinforces the meaning already in the words (cash
 * is the accent; a positive receivable is money still out, so it wears the
 * caution hue; a payable is a debt, so it wears the serious hue). Colours are
 * CSS variables and follow the theme.
 */
export function FinancialPositionChart({
  cashInHand,
  receivables,
  payables
}: FinancialPositionChartProps): JSX.Element {
  const rows: PositionRow[] = [
    {
      label: 'Cash in hand',
      value: cashInHand,
      color: cashInHand < 0 ? 'var(--bad)' : 'var(--accent)',
      hint: 'After expenses and payments'
    },
    {
      label: 'Customers owe you',
      value: receivables,
      color: receivables > 0 ? 'var(--warn)' : 'var(--good)',
      hint: 'Outstanding receivables'
    },
    {
      label: 'You owe suppliers',
      value: payables,
      color: payables > 0 ? 'var(--bad)' : 'var(--good)',
      hint: 'Outstanding payables'
    }
  ]

  const height = rows.length * ROW_HEIGHT + 16
  // Only cash can be negative (an overdrawn drawer); anchor the axis at zero
  // otherwise, so a lone small balance still reads against a full-width track.
  const axisMin = Math.min(0, cashInHand)

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart
          layout="vertical"
          data={rows}
          margin={{ top: 4, right: 64, left: 4, bottom: 4 }}
          barCategoryGap="30%"
        >
          <XAxis type="number" hide domain={[axisMin, 'dataMax']} />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fill: 'var(--ink-muted)', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={LABEL_WIDTH}
          />
          <ReferenceLine x={0} stroke="var(--line-strong)" />
          <Tooltip content={<PositionTooltip />} cursor={{ fill: 'var(--surface-hover)' }} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16} isAnimationActive={false}>
            {rows.map((row) => (
              <Cell key={row.label} fill={row.color} />
            ))}
            <LabelList
              dataKey="value"
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

interface PositionTooltipProps {
  active?: boolean
  payload?: { payload: PositionRow }[]
}

function PositionTooltip({ active, payload }: PositionTooltipProps): JSX.Element | null {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <ChartTooltip title={row.label}>
      <ChartTooltipRow
        label={row.hint}
        value={format.money(row.value)}
        tone={row.value < 0 ? 'bad' : undefined}
      />
    </ChartTooltip>
  )
}
