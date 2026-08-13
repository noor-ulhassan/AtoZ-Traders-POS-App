import clsx from 'clsx'
import type { JSX } from 'react'
import type { DateRange } from '@shared/types'
import type { DatePresetKey } from '@shared/date'
import { DATE_PRESETS, resolvePreset } from '@shared/date'

/** The two date boxes are shorter than a standard control, to sit in a filter bar. */
const DATE_INPUT =
  'h-8 rounded-md border border-line-strong bg-paper px-2 text-caption tabular-nums text-ink ' +
  'focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-weak)] focus:outline-none'

interface DateRangeFilterProps {
  value: DateRange
  onChange: (range: DateRange) => void
  /** Presets to offer, in order. Screens pick the ones that make sense. */
  presets?: DatePresetKey[]
}

/**
 * The date filter used by every screen that reports over a period.
 *
 * Presets first, because "today" and "this month" cover almost every question
 * the owner asks; the two date fields stay visible for the rest rather than
 * hiding behind a "custom" toggle.
 */
export function DateRangeFilter({
  value,
  onChange,
  presets = ['today', 'last7', 'last30', 'thisMonth', 'lastMonth']
}: DateRangeFilterProps): JSX.Element {
  const options = DATE_PRESETS.filter((preset) => presets.includes(preset.key))

  const isActive = (key: DatePresetKey): boolean => {
    const range = resolvePreset(key)
    return range.from === value.from && range.to === value.to
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Segmented control: one bordered group, dividers between segments. */}
      <div
        className="inline-flex overflow-hidden rounded-md border border-line-strong bg-paper"
        role="group"
        aria-label="Date range presets"
      >
        {options.map((preset) => (
          <button
            key={preset.key}
            type="button"
            className={clsx(
              'h-8 border-r border-line px-3 text-caption font-medium whitespace-nowrap last:border-r-0',
              isActive(preset.key)
                ? 'bg-accent text-white'
                : 'text-ink-muted hover:bg-surface-hover hover:text-ink'
            )}
            onClick={() => onChange(resolvePreset(preset.key))}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 text-caption text-ink-muted">
        <input
          type="date"
          className={DATE_INPUT}
          value={value.from}
          max={value.to}
          aria-label="From date"
          onChange={(event) => onChange({ ...value, from: event.target.value })}
        />
        <span>to</span>
        <input
          type="date"
          className={DATE_INPUT}
          value={value.to}
          min={value.from}
          aria-label="To date"
          onChange={(event) => onChange({ ...value, to: event.target.value })}
        />
      </div>
    </div>
  )
}
