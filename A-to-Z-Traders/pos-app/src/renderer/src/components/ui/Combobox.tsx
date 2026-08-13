import clsx from 'clsx'
import type { JSX, KeyboardEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Input } from './Field'

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
    <div className="relative w-full" ref={wrapRef}>
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
        <div
          className="absolute top-[calc(100%+4px)] right-0 left-0 z-50 max-h-80 overflow-y-auto rounded-md border border-line-strong bg-paper p-1 shadow-popover"
          id="combobox-list"
          role="listbox"
          ref={listRef}
        >
          {options.length === 0 ? (
            <div className="p-4 text-center text-sm text-ink-subtle">{noResults}</div>
          ) : (
            options.map((option, index) => (
              <button
                key={`${option.title}-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={clsx(
                  'flex w-full cursor-pointer items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm',
                  index === activeIndex ? 'bg-accent-weak' : 'hover:bg-surface-hover'
                )}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option)}
              >
                <span className="flex min-w-0 flex-col gap-px">
                  <span className="truncate font-medium">{option.title}</span>
                  {option.subtitle && (
                    <span className="text-caption text-ink-subtle">{option.subtitle}</span>
                  )}
                </span>
                {option.meta && (
                  <span className="shrink-0 text-right text-caption tabular-nums text-ink-muted">
                    {option.meta}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
