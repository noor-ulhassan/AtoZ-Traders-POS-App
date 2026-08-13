import clsx from 'clsx'
import type { JSX } from 'react'

export interface Segment<T extends string> {
  value: T
  label: string
  disabled?: boolean
  /** Shown on hover — usually the reason a segment is disabled. */
  title?: string
}

interface SegmentedControlProps<T extends string> {
  options: readonly Segment<T>[]
  value: T
  onChange: (value: T) => void
  /** Accessible name for the group, e.g. "Payment type". */
  label: string
  /** Splits the available width evenly, for a control that fills a panel. */
  fullWidth?: boolean
  /** Marks the segments as tabs that swap the panel below them. */
  tabs?: boolean
}

/**
 * One choice out of a short, fixed set, shown as a joined row of buttons.
 *
 * Two screens grew their own copy of this — the payment type on a bill and the
 * report picker — and they had drifted a pixel apart. `tabs` is the one real
 * difference: report segments swap the panel underneath them and are announced
 * as tabs, while a payment type is a plain choice within a form.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  fullWidth = false,
  tabs = false
}: SegmentedControlProps<T>): JSX.Element {
  return (
    <div
      role={tabs ? 'tablist' : 'group'}
      aria-label={label}
      className={clsx(
        'overflow-hidden rounded-md border border-line-strong bg-paper',
        fullWidth ? 'flex w-full' : 'inline-flex'
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role={tabs ? 'tab' : undefined}
            aria-selected={tabs ? active : undefined}
            aria-pressed={tabs ? undefined : active}
            disabled={option.disabled}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={clsx(
              'border-r border-line text-caption font-medium whitespace-nowrap last:border-r-0',
              'disabled:cursor-not-allowed disabled:opacity-45',
              fullWidth ? 'h-[34px] flex-1 px-2' : 'h-8 px-4',
              active
                ? 'bg-accent text-white'
                : 'text-ink-muted hover:not-disabled:bg-surface-hover hover:not-disabled:text-ink'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
