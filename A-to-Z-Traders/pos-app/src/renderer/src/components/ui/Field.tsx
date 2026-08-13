import clsx from 'clsx'
import type { ComponentPropsWithRef, JSX, ReactNode } from 'react'
import { useEffect, useId, useState } from 'react'
import { Icon } from '../icons/Icon'

/**
 * The shell every text-entry control shares, so a row of mixed inputs lines up
 * exactly. Exported because a few components outside this file (the combobox,
 * the date filter) render their own input and must match it to the pixel —
 * that is the one thing a copied class string would eventually get wrong.
 */
export const CONTROL =
  'h-[34px] w-full rounded-md border border-line-strong bg-paper px-3 text-sm text-ink ' +
  'transition-[border-color,box-shadow] duration-[120ms] placeholder:text-ink-subtle ' +
  'hover:not-disabled:not-focus:border-ink-subtle ' +
  'focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-weak)] focus:outline-none ' +
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-subtle ' +
  'aria-[invalid=true]:border-bad aria-[invalid=true]:focus:shadow-[0_0_0_3px_var(--bad-weak)]'

/** The taller variant, for the one or two fields a screen is really about. */
const CONTROL_LARGE = 'h-[42px] text-md font-medium'

/* -------------------------------------------------------------- Field shell */

interface FieldProps {
  label?: string
  hint?: string
  error?: string
  required?: boolean
  htmlFor?: string
  children: ReactNode
  className?: string
}

/**
 * Label, control, and the one message that matters underneath.
 *
 * An error replaces the hint rather than stacking below it — two lines of
 * guidance under a single input is how forms start to jump around.
 */
export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  className
}: FieldProps): JSX.Element {
  return (
    <div className={clsx('flex min-w-0 flex-col gap-1', className)}>
      {label && (
        <label
          className={clsx(
            'text-caption font-medium text-ink-muted',
            required && 'after:ml-0.5 after:text-bad after:content-["*"]'
          )}
          htmlFor={htmlFor}
        >
          {label}
        </label>
      )}
      {children}
      {error ? (
        <span className="text-caption text-bad">{error}</span>
      ) : (
        hint && <span className="text-caption text-ink-subtle">{hint}</span>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------- Input */

interface InputProps extends Omit<ComponentPropsWithRef<'input'>, 'size'> {
  invalid?: boolean
  size?: 'md' | 'lg'
}

export function Input({ invalid, size = 'md', className, ...props }: InputProps): JSX.Element {
  return (
    <input
      className={clsx(CONTROL, size === 'lg' && CONTROL_LARGE, className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  )
}

/* ------------------------------------------------------------ NumberInput */

interface NumberInputProps extends Omit<
  ComponentPropsWithRef<'input'>,
  'onChange' | 'value' | 'size'
> {
  value: number | ''
  onValueChange: (value: number) => void
  invalid?: boolean
  size?: 'md' | 'lg'
  /** Shown inside the control, e.g. a currency code. */
  prefix?: string
}

/**
 * A numeric entry that behaves the way a till operator expects.
 *
 * The field holds its own draft string while it is being typed — so a decimal
 * mid-entry ("0.", ".5", "1.") or a grouped paste ("1,200") survives the next
 * re-render instead of being snapped back to the parsed whole number. Without
 * that draft a decimal point is impossible to type at all: half a litre of
 * petrol or a quarter kilo of ghee could never be billed. Spinner arrows never
 * appear because the control is a text input — nobody increments a price by 1
 * at a counter, and the arrows only ever swallow a click.
 */
export function NumberInput({
  value,
  onValueChange,
  invalid,
  size = 'md',
  prefix,
  className,
  ...props
}: NumberInputProps): JSX.Element {
  const [draft, setDraft] = useState<string>(value === '' ? '' : String(value))

  // Adopt a value set from outside (a reset, a suggested rate, a unit change)
  // but never rewrite what the user is mid-way through typing: compared as
  // numbers, so "0.50" is left alone while an external change to a different
  // amount still lands. A transient like "." leaves `value` untouched, so this
  // effect does not run and the half-typed decimal is kept.
  useEffect(() => {
    const shown = draft.trim() === '' ? NaN : Number(draft.replace(/,/g, ''))
    const target = value === '' ? NaN : value
    if (Number.isNaN(shown) && Number.isNaN(target)) return
    // Syncing a draft to an external value is the intended use of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (shown !== target) setDraft(value === '' ? '' : String(value))
    // Only external `value` changes should sync the field; `draft` is owned here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const control = (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={clsx(
        CONTROL,
        'text-right tabular-nums',
        size === 'lg' && CONTROL_LARGE,
        prefix && 'pl-[42px]',
        className
      )}
      aria-invalid={invalid || undefined}
      value={draft}
      onChange={(event) => {
        const next = event.target.value
        setDraft(next)
        const raw = next.replace(/,/g, '').trim()
        if (raw === '') {
          onValueChange(0)
          return
        }
        const parsed = Number(raw)
        if (!Number.isNaN(parsed)) onValueChange(parsed)
      }}
      onFocus={(event) => {
        // Typing over a pre-filled rate is the common case, so select it all.
        event.target.select()
        props.onFocus?.(event)
      }}
      onBlur={(event) => {
        // Settle the field on the canonical number once editing ends: "1." -> "1",
        // an empty field -> "0" (matching the 0 already reported on clear).
        setDraft(value === '' ? '' : String(value))
        props.onBlur?.(event)
      }}
    />
  )

  if (!prefix) return control

  return (
    <div className="relative flex">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-caption text-ink-subtle">
        {prefix}
      </span>
      {control}
    </div>
  )
}

/* ------------------------------------------------------------------ Select */

interface SelectProps extends ComponentPropsWithRef<'select'> {
  invalid?: boolean
  children: ReactNode
}

export function Select({ invalid, className, children, ...props }: SelectProps): JSX.Element {
  return (
    <div className="relative flex">
      <select
        className={clsx(CONTROL, 'cursor-pointer appearance-none pr-8', className)}
        aria-invalid={invalid || undefined}
        {...props}
      >
        {children}
      </select>
      <Icon
        name="chevronDown"
        size={14}
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-subtle"
      />
    </div>
  )
}

/* ---------------------------------------------------------------- Textarea */

interface TextareaProps extends ComponentPropsWithRef<'textarea'> {
  invalid?: boolean
}

export function Textarea({ invalid, className, ...props }: TextareaProps): JSX.Element {
  return (
    <textarea
      className={clsx(CONTROL, 'h-auto min-h-[72px] resize-y px-3 py-2 leading-normal', className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  )
}

/* -------------------------------------------------------------- SearchInput */

interface SearchInputProps extends Omit<
  ComponentPropsWithRef<'input'>,
  'onChange' | 'value' | 'size'
> {
  value: string
  onValueChange: (value: string) => void
}

export function SearchInput({
  value,
  onValueChange,
  className,
  placeholder = 'Search',
  ...props
}: SearchInputProps): JSX.Element {
  return (
    <div className={clsx('relative flex min-w-0 flex-1', className)}>
      <Icon
        name="search"
        size={15}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-subtle"
      />
      <input
        type="search"
        autoComplete="off"
        className={clsx(CONTROL, 'pl-8')}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        {...props}
      />
    </div>
  )
}

/* ---------------------------------------------------------------- Checkbox */

interface CheckboxProps extends Omit<ComponentPropsWithRef<'input'>, 'type'> {
  label: string
}

export function Checkbox({ label, className, ...props }: CheckboxProps): JSX.Element {
  const id = useId()
  return (
    <label
      className={clsx('inline-flex cursor-pointer items-center gap-2 text-sm', className)}
      htmlFor={id}
    >
      <input
        id={id}
        type="checkbox"
        className="size-4 cursor-pointer accent-[var(--accent)]"
        {...props}
      />
      {label}
    </label>
  )
}
