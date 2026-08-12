import { useEffect, useState } from 'react'

/**
 * Delays a fast-changing value so a search box does not hit the database on
 * every keystroke. 200ms is short enough to feel immediate at counter speed.
 */
export function useDebounced<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
