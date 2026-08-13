import clsx from 'clsx'
import type { JSX, ReactNode } from 'react'

/**
 * The shared surface for every chart tooltip, so a hover on the trend and a
 * hover on the bars read as the same object. Text wears ink tokens, never the
 * series colour — the coloured mark beside the row carries identity, the
 * numbers stay at full reading contrast (dataviz: text wears text tokens).
 */
export function ChartTooltip({
  title,
  children
}: {
  title: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="pointer-events-none min-w-35 rounded-md border border-line-strong bg-paper px-3 py-2 text-caption shadow-popover">
      <div className="mb-1 font-semibold text-ink">{title}</div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  )
}

export function ChartTooltipRow({
  label,
  value,
  tone
}: {
  label: string
  value: string | number
  tone?: 'good' | 'bad'
}): JSX.Element {
  return (
    <div className="flex justify-between gap-4 tabular-nums">
      <span className="text-ink-muted">{label}</span>
      <strong
        className={clsx(
          'font-medium',
          tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : 'text-ink'
        )}
      >
        {value}
      </strong>
    </div>
  )
}
