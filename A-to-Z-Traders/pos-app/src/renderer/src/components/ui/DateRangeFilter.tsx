import clsx from 'clsx'
import type { JSX } from 'react'
import type { DateRange } from '@shared/types'
import type { DatePresetKey } from '@shared/date'
import { DATE_PRESETS, resolvePreset } from '@shared/date'
import styles from './DateRangeFilter.module.css'

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
    <div className={styles.wrap}>
      <div className={styles.segments} role="group" aria-label="Date range presets">
        {options.map((preset) => (
          <button
            key={preset.key}
            type="button"
            className={clsx(styles.segment, isActive(preset.key) && styles.segmentActive)}
            onClick={() => onChange(resolvePreset(preset.key))}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className={styles.custom}>
        <input
          type="date"
          className={styles.dateInput}
          value={value.from}
          max={value.to}
          aria-label="From date"
          onChange={(event) => onChange({ ...value, from: event.target.value })}
        />
        <span>to</span>
        <input
          type="date"
          className={styles.dateInput}
          value={value.to}
          min={value.from}
          aria-label="To date"
          onChange={(event) => onChange({ ...value, to: event.target.value })}
        />
      </div>
    </div>
  )
}
