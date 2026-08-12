import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, errorMessage } from '../lib/api'

interface QueryState<T> {
  data: T | null
  error: string | null
  isLoading: boolean
}

export interface QueryResult<T> extends QueryState<T> {
  /** Re-runs the fetch, keeping the current data on screen while it loads. */
  refetch: () => void
}

/**
 * Reads data from the main process.
 *
 * Deliberately small: this app talks to a local SQLite file over IPC, where a
 * call costs under a millisecond. A cache layer would add invalidation bugs
 * and buy nothing — so a screen re-reads what it needs after every write.
 *
 * `deps` behaves like a `useEffect` dependency list; the fetch re-runs when it
 * changes, and a response that arrives after a newer one is discarded.
 */
export function useQuery<T>(fetcher: () => Promise<T>, deps: unknown[] = []): QueryResult<T> {
  const [state, setState] = useState<QueryState<T>>({
    data: null,
    error: null,
    isLoading: true
  })

  const requestId = useRef(0)
  const fetcherRef = useRef(fetcher)

  // Kept current in an effect rather than during render: a ref written while
  // rendering is not safe under concurrent React, and the listener below only
  // reads it after effects have run.
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  const start = useCallback((request: () => Promise<T>) => {
    const id = ++requestId.current

    request()
      .then((data) => {
        if (id !== requestId.current) return
        setState({ data, error: null, isLoading: false })
      })
      .catch((error: unknown) => {
        if (id !== requestId.current) return
        if (error instanceof ApiError && error.isCancelled) {
          setState((previous) => ({ ...previous, isLoading: false }))
          return
        }
        setState((previous) => ({ ...previous, error: errorMessage(error), isLoading: false }))
      })
  }, [])

  useEffect(() => {
    // Synchronising with an external system — the main process — is exactly
    // what an effect is for. The fetcher lives in a ref so an inline arrow
    // function in the caller does not re-trigger this on every render; the
    // caller's `deps` are the real trigger.
    start(fetcherRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  /** Refetch is called from event handlers, so it may flag loading directly. */
  const refetch = useCallback(() => {
    setState((previous) => ({ ...previous, isLoading: true }))
    start(fetcherRef.current)
  }, [start])

  return { ...state, refetch }
}
