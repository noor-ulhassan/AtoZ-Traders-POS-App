import clsx from 'clsx'
import type { JSX, KeyboardEvent } from 'react'
import { useRef } from 'react'

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
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  // Left/Right (or Up/Down) move to the adjacent enabled segment and take focus
  // with them, so the whole control is operable from the keyboard — no mouse to
  // switch a payment type mid-sale. Roving tabindex keeps it a single Tab stop.
  const enabled = options
    .map((option, index) => (option.disabled ? -1 : index))
    .filter((i) => i >= 0)

  const move = (from: number, direction: 1 | -1): void => {
    if (enabled.length === 0) return
    const position = enabled.indexOf(from)
    const next = enabled[(position + direction + enabled.length) % enabled.length]
    if (next == null) return
    onChange(options[next].value)
    buttons.current[next]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      move(index, 1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(index, -1)
    }
  }

  return (
    <div
      role={tabs ? 'tablist' : 'group'}
      aria-label={label}
      className={clsx(
        'overflow-hidden rounded-md border border-line-strong bg-paper',
        fullWidth ? 'flex w-full' : 'inline-flex'
      )}
    >
      {options.map((option, index) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttons.current[index] = element
            }}
            type="button"
            role={tabs ? 'tab' : undefined}
            aria-selected={tabs ? active : undefined}
            aria-pressed={tabs ? undefined : active}
            tabIndex={active ? 0 : -1}
            disabled={option.disabled}
            title={option.title}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={clsx(
              'border-r border-line text-caption font-medium whitespace-nowrap last:border-r-0',
              'disabled:cursor-not-allowed disabled:opacity-45',
              fullWidth ? 'h-[38px] flex-1 px-2' : 'h-8 px-4',
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
