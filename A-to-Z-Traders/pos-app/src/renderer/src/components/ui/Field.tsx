import clsx from 'clsx'
import type { ComponentPropsWithRef, JSX, ReactNode } from 'react'
import { useId } from 'react'
import { Icon } from '../icons/Icon'
import styles from './Field.module.css'

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
    <div className={clsx(styles.field, className)}>
      {label && (
        <label className={clsx(styles.label, required && styles.required)} htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {error ? (
        <span className={styles.error}>{error}</span>
      ) : (
        hint && <span className={styles.hint}>{hint}</span>
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
      className={clsx(styles.control, size === 'lg' && styles.large, className)}
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
 * The field holds raw text while it is being typed — clearing it, typing "1.",
 * or pasting "1,200" must not fight back — and reports a number to the caller
 * as soon as one can be read. Spinner arrows are hidden: nobody increments a
 * price by 1 at a counter, and the arrows only ever swallow a click.
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
  const control = (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={clsx(
        styles.control,
        styles.numeric,
        size === 'lg' && styles.large,
        prefix && styles.withPrefix,
        className
      )}
      aria-invalid={invalid || undefined}
      value={value === '' ? '' : String(value)}
      onChange={(event) => {
        const raw = event.target.value.replace(/,/g, '').trim()
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
      {...props}
    />
  )

  if (!prefix) return control

  return (
    <div className={styles.prefixWrap}>
      <span className={styles.prefix}>{prefix}</span>
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
    <div className={styles.selectWrap}>
      <select
        className={clsx(styles.control, styles.select, className)}
        aria-invalid={invalid || undefined}
        {...props}
      >
        {children}
      </select>
      <Icon name="chevronDown" size={14} className={styles.selectChevron} />
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
      className={clsx(styles.control, styles.textarea, className)}
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
    <div className={clsx(styles.searchWrap, className)}>
      <Icon name="search" size={15} className={styles.searchIcon} />
      <input
        type="search"
        autoComplete="off"
        className={clsx(styles.control, styles.search)}
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
    <label className={clsx(styles.checkbox, className)} htmlFor={id}>
      <input id={id} type="checkbox" {...props} />
      {label}
    </label>
  )
}
