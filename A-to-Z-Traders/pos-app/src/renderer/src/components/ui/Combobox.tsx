import clsx from 'clsx'
import type { JSX, KeyboardEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Input } from './Field'
import styles from './Combobox.module.css'

export interface ComboOption<T> {
  value: T
  title: string
  subtitle?: string
  /** Right-aligned detail, e.g. stock on hand or an outstanding balance. */
  meta?: ReactNode
}

interface ComboboxProps<T> {
  /** The text in the box. The parent owns it so a barcode scan can set it. */
  query: string
  onQueryChange: (query: string) => void
  options: ComboOption<T>[]
  onSelect: (option: ComboOption<T>) => void
  placeholder?: string
  /** Rendered when the query is non-empty and nothing matched. */
  noResults?: string
  disabled?: boolean
  autoFocus?: boolean
  inputRef?: React.RefObject<HTMLInputElement | null>
  size?: 'md' | 'lg'
  onEscape?: () => void
}

/**
 * A search-and-pick control for products, customers and suppliers.
 *
 * Built for a counter: arrow keys move, Enter picks, Escape closes, and the
 * list opens as soon as there is something to show. A barcode scanner types
 * fast and ends with Enter — which lands on the first (best) match, so
 * scanning an item onto a bill needs no mouse at all.
 */
export function Combobox<T>({
  query,
  onQueryChange,
  options,
  onSelect,
  placeholder,
  noResults = 'No matches',
  disabled,
  autoFocus,
  inputRef,
  size = 'md',
  onEscape
}: ComboboxProps<T>): JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [rawActiveIndex, setActiveIndex] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // The highlight is clamped where it is read rather than reset in an effect:
  // results arrive while the user is still typing, and an effect that fires
  // per result set would fight the arrow keys.
  const activeIndex = Math.min(rawActiveIndex, Math.max(0, options.length - 1))

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  // Keep the highlighted option in view when arrowing through a long list.
  useEffect(() => {
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const choose = (option: ComboOption<T>): void => {
    onSelect(option)
    setIsOpen(false)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setIsOpen(true)
      setActiveIndex((index) => Math.min(index + 1, options.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
      return
    }
    if (event.key === 'Enter' && isOpen && options.length > 0) {
      event.preventDefault()
      const option = options[activeIndex]
      if (option) choose(option)
      return
    }
    if (event.key === 'Escape') {
      if (isOpen) {
        event.preventDefault()
        setIsOpen(false)
      } else {
        onEscape?.()
      }
    }
  }

  const showList = isOpen && query.trim().length > 0

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <Input
        ref={inputRef}
        value={query}
        size={size}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        onChange={(event) => {
          onQueryChange(event.target.value)
          setActiveIndex(0)
          setIsOpen(true)
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={showList}
        aria-controls="combobox-list"
      />

      {showList && (
        <div className={styles.list} id="combobox-list" role="listbox" ref={listRef}>
          {options.length === 0 ? (
            <div className={styles.noResults}>{noResults}</div>
          ) : (
            options.map((option, index) => (
              <button
                key={`${option.title}-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={clsx(styles.option, index === activeIndex && styles.active)}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option)}
              >
                <span className={styles.optionMain}>
                  <span className={styles.optionTitle}>{option.title}</span>
                  {option.subtitle && (
                    <span className={styles.optionSubtitle}>{option.subtitle}</span>
                  )}
                </span>
                {option.meta && <span className={styles.optionMeta}>{option.meta}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
