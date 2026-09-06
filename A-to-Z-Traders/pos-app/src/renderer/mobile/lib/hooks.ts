import { useCallback, useEffect, useRef, useState } from 'react'
import { MobileApiError, call } from './client'
import { ageLabel, cacheKey, readCache, writeCache } from './offline'

/**
 * Reading and writing from the phone.
 *
 * `useRemote` is the read: it asks the shop computer, keeps the answer, and
 * falls back to the kept one when the Wi-Fi is not there — flagged as stale
 * and dated, never passed off as current.
 *
 * `useAction` is the write, and it deliberately does the opposite: off the
 * network it refuses immediately rather than storing anything for later. See
 * the note at the top of `offline.ts` for why a queued bill is the wrong
 * answer in a shop with one set of shelves.
 */

interface RemoteState<T> {
  data: T | null
  error: string | null
  isLoading: boolean
  /** True when `data` came from the phone's own store, not the shop computer. */
  isStale: boolean
  /** `2 minutes ago`, when `isStale`. */
  staleLabel: string | null
}

export interface RemoteResult<T> extends RemoteState<T> {
  refetch: () => void
}

/**
 * The state a screen starts in: whatever this phone last saw, if anything.
 *
 * Read during render rather than in an effect, so a screen never flashes empty
 * before its remembered figures appear — and so the figures are on screen at
 * once when there is no network to replace them.
 */
function seed<T>(key: string): RemoteState<T> {
  const cached = readCache<T>(key)
  if (!cached) {
    return { data: null, error: null, isLoading: true, isStale: false, staleLabel: null }
  }
  return {
    data: cached.data,
    error: null,
    isLoading: true,
    isStale: true,
    staleLabel: ageLabel(cached.at)
  }
}

export function useRemote<T>(
  channel: string,
  payload?: unknown,
  deps: unknown[] = []
): RemoteResult<T> {
  const key = cacheKey(channel, payload)

  const [state, setState] = useState<RemoteState<T>>(() => seed<T>(key))

  // When the question changes — a different customer, a different period — the
  // answer on screen belongs to the old one. Re-seeding DURING RENDER rather
  // than in an effect is React's own pattern for this, and it matters here for
  // the same reason it matters in the desktop's `usePagination`: an effect
  // would let one screenful of the wrong figures paint first.
  const [seededKey, setSeededKey] = useState(key)
  if (seededKey !== key) {
    setSeededKey(key)
    setState(seed<T>(key))
  }

  const requestId = useRef(0)

  // The payload is a fresh object literal on every render, so `key` — a
  // string — is what the effect below actually depends on.
  const payloadRef = useRef(payload)
  useEffect(() => {
    payloadRef.current = payload
  })

  const load = useCallback(() => {
    const id = ++requestId.current

    call<T>(channel, payloadRef.current)
      .then((data) => {
        if (id !== requestId.current) return
        writeCache(key, data)
        setState({ data, error: null, isLoading: false, isStale: false, staleLabel: null })
      })
      .catch((error: unknown) => {
        if (id !== requestId.current) return
        const message =
          error instanceof MobileApiError ? error.message : 'Something went wrong reading this.'
        const stored = readCache<T>(key)

        // Offline with something remembered is not an error — it is the app
        // doing its job. Offline with nothing remembered is.
        if (error instanceof MobileApiError && error.isOffline && stored) {
          setState({
            data: stored.data,
            error: null,
            isLoading: false,
            isStale: true,
            staleLabel: ageLabel(stored.at)
          })
          return
        }

        setState({
          data: stored?.data ?? null,
          error: message,
          isLoading: false,
          isStale: stored != null,
          staleLabel: stored ? ageLabel(stored.at) : null
        })
      })
    // `key` already encodes the channel and the payload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    // Talking to the shop computer is exactly what an effect is for: this
    // synchronises with an external system and never sets state synchronously
    // — every `setState` above is inside a settled promise.
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps])

  const refetch = useCallback(() => {
    setState((current) => ({ ...current, isLoading: true }))
    load()
  }, [load])

  return { ...state, refetch }
}

export interface ActionResult<Args extends unknown[], T> {
  run: (...args: Args) => Promise<T | undefined>
  isPending: boolean
  error: string | null
  fields: Record<string, string>
  reset: () => void
}

/**
 * Runs a write.
 *
 * A failure is kept on the hook rather than thrown, because on a phone the
 * message has to appear next to the button that was pressed — there is no
 * corner for a toast to live in that a thumb is not already covering.
 */
export function useAction<Args extends unknown[], T>(
  action: (...args: Args) => Promise<T>,
  options: { onSuccess?: (result: T) => void } = {}
): ActionResult<Args, T> {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})

  const run = useCallback(
    async (...args: Args): Promise<T | undefined> => {
      setIsPending(true)
      setError(null)
      setFields({})
      try {
        const result = await action(...args)
        options.onSuccess?.(result)
        return result
      } catch (caught) {
        if (caught instanceof MobileApiError) {
          setError(caught.message)
          setFields(caught.fields)
        } else {
          setError('Something went wrong. Nothing was saved.')
        }
        return undefined
      } finally {
        setIsPending(false)
      }
    },
    // The options object is rebuilt by the caller each render; reading it
    // through the closure is stable enough in practice, as in the desktop's
    // own `useMutation`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [action]
  )

  return { run, isPending, error, fields, reset: () => setError(null) }
}

/** Whether the browser currently believes it has a network at all. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const up = (): void => setOnline(true)
    const down = (): void => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  return online
}

/** Delays a fast-changing value — used by every search box on the phone. */
export function useDebounced<T>(value: T, delay = 250): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return settled
}
