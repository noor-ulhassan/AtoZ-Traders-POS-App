import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import type { SalesSummaryPoint } from '@shared/types'
import { dayMonth, money, moneyRounded } from '../../lib/format'
import styles from './TrendChart.module.css'

interface TrendChartProps {
  points: SalesSummaryPoint[]
  height?: number
}

const PADDING = { top: 12, right: 12, bottom: 22, left: 48 }
const VIEW_WIDTH = 720

/**
 * Sales over the selected range.
 *
 * Hand-drawn SVG rather than a charting library: this is one series with one
 * interaction, and a library would have shipped 90KB and its own visual
 * opinions to draw it. The y-axis is anchored at zero — a trend line that
 * starts at the minimum makes a quiet week look like a collapse.
 */
export function TrendChart({ points, height = 200 }: TrendChartProps): JSX.Element {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const chart = useMemo(() => {
    const innerWidth = VIEW_WIDTH - PADDING.left - PADDING.right
    const innerHeight = height - PADDING.top - PADDING.bottom
    const maxValue = Math.max(...points.map((point) => point.sales), 0)
    // Round the ceiling up to something a person would choose, so the grid
    // labels read 0 / 2,500 / 5,000 rather than 0 / 2,317 / 4,634.
    const ceiling = niceCeiling(maxValue)

    const x = (index: number): number =>
      points.length <= 1
        ? PADDING.left + innerWidth / 2
        : PADDING.left + (index / (points.length - 1)) * innerWidth

    const y = (value: number): number =>
      PADDING.top + innerHeight - (ceiling === 0 ? 0 : (value / ceiling) * innerHeight)

    const line = points.map((point, index) => `${x(index)},${y(point.sales)}`).join(' ')
    const area =
      points.length > 0
        ? `M${x(0)},${y(0)} L${line.split(' ').join(' L')} L${x(points.length - 1)},${y(0)} Z`
        : ''

    const gridValues = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ceiling * fraction)

    return { innerWidth, innerHeight, ceiling, x, y, line, area, gridValues }
  }, [points, height])

  if (points.length === 0) {
    return <div className={styles.empty}>No sales in this period.</div>
  }

  // Label density: every day on a week, roughly six labels on a long range.
  const labelStep = Math.max(1, Math.ceil(points.length / 7))
  const hovered = hoverIndex === null ? null : points[hoverIndex]

  return (
    <div className={styles.wrap}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Sales trend"
      >
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {chart.gridValues.map((value) => (
          <g key={value}>
            <line
              className={styles.grid}
              x1={PADDING.left}
              x2={VIEW_WIDTH - PADDING.right}
              y1={chart.y(value)}
              y2={chart.y(value)}
            />
            <text
              className={styles.axisLabel}
              x={PADDING.left - 8}
              y={chart.y(value) + 3}
              textAnchor="end"
            >
              {moneyRounded(value)}
            </text>
          </g>
        ))}

        {points.map((point, index) =>
          index % labelStep === 0 || index === points.length - 1 ? (
            <text
              key={point.date}
              className={styles.axisLabel}
              x={chart.x(index)}
              y={height - 6}
              textAnchor="middle"
            >
              {dayMonth(point.date)}
            </text>
          ) : null
        )}

        <path className={styles.area} d={chart.area} />
        <polyline className={styles.line} points={chart.line} />

        {/* The most recent day is the one the owner is actually asking about. */}
        <circle
          className={styles.endpoint}
          cx={chart.x(points.length - 1)}
          cy={chart.y(points[points.length - 1]?.sales ?? 0)}
          r="4"
        />

        {hoverIndex !== null && (
          <g>
            <line
              className={styles.hoverLine}
              x1={chart.x(hoverIndex)}
              x2={chart.x(hoverIndex)}
              y1={PADDING.top}
              y2={PADDING.top + chart.innerHeight}
            />
            <circle
              className={styles.hoverDot}
              cx={chart.x(hoverIndex)}
              cy={chart.y(points[hoverIndex]?.sales ?? 0)}
              r="4"
            />
          </g>
        )}

        <rect
          className={styles.hitArea}
          x={PADDING.left}
          y={PADDING.top}
          width={chart.innerWidth}
          height={chart.innerHeight}
          onMouseLeave={() => setHoverIndex(null)}
          onMouseMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect()
            const ratio = (event.clientX - bounds.left) / bounds.width
            const index = Math.round(ratio * (points.length - 1))
            setHoverIndex(Math.max(0, Math.min(points.length - 1, index)))
          }}
        />
      </svg>

      {hovered && (
        <div
          className={styles.tooltip}
          style={{
            left: `${(chart.x(hoverIndex as number) / VIEW_WIDTH) * 100}%`,
            top: `${(chart.y(hovered.sales) / height) * 100 - 4}%`
          }}
        >
          <div className={styles.tooltipDate}>{dayMonth(hovered.date)}</div>
          <div className={styles.tooltipRow}>
            <span>Sales</span>
            <strong>{money(hovered.sales)}</strong>
          </div>
          <div className={styles.tooltipRow}>
            <span>Profit</span>
            <strong>{money(hovered.profit)}</strong>
          </div>
          <div className={styles.tooltipRow}>
            <span>Bills</span>
            <strong>{hovered.billCount}</strong>
          </div>
        </div>
      )}
    </div>
  )
}

/** Rounds an axis maximum up to 1, 2 or 5 times a power of ten. */
function niceCeiling(value: number): number {
  if (value <= 0) return 1000
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return step * magnitude
}
