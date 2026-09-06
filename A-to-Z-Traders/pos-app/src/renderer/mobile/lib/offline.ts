/**
 * What the phone remembers when the shop Wi-Fi is not there.
 *
 * The rule this file exists to enforce is a single sentence: **reads survive
 * offline, writes do not**. The last answer to every screen is kept, so the
 * icon on the home screen opens to a khata balance and today's takings rather
 * than an error page — and every one of those figures is labelled with when it
 * was read, because a stale number presented as current is worse than no
 * number at all.
 *
 * Nothing is queued for later. It is tempting — the phone could hold a bill
 * and send it when the Wi-Fi returns — and it would be wrong here. A bill
 * queued on the phone is priced against stock the phone last saw, needs an
 * invoice number only the shop computer can issue, and would be accepted or
 * refused minutes later with nobody watching. Two devices would then disagree
 * about what is on the shelf, which is the one thing this whole application is
 * built to prevent. So a write off the network is refused, out loud, at the
 * moment it is attempted, while the person is still standing there and can do
 * something about it.
 */

const PREFIX = 'pos.mobile.cache.'

/** Roughly how much of localStorage's ~5MB the cache may take. */
const MAX_ENTRIES = 60

interface CacheEntry<T> {
  /** When this answer came back from the shop computer. */
  at: number
  data: T
}

/** A stable key for one question: which channel, with which arguments. */
export function cacheKey(channel: string, payload: unknown): string {
  return `${PREFIX}${channel}|${JSON.stringify(payload ?? null)}`
}

function keys(): string[] {
  const found: string[] = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key?.startsWith(PREFIX)) found.push(key)
  }
  return found
}

/**
 * Drops the oldest entries once there are too many.
 *
 * Called on write rather than on a timer: the only moment the cache can grow
 * is the moment something is put in it, and a shop phone should never be doing
 * housekeeping in the background while somebody is billing on it.
 */
function evictIfFull(): void {
  const all = keys()
  if (all.length <= MAX_ENTRIES) return

  const aged = all
    .map((key) => {
      try {
        return {
          key,
          at: (JSON.parse(localStorage.getItem(key) ?? '{}') as CacheEntry<unknown>).at ?? 0
        }
      } catch {
        return { key, at: 0 }
      }
    })
    .sort((left, right) => left.at - right.at)

  for (const entry of aged.slice(0, aged.length - MAX_ENTRIES)) {
    localStorage.removeItem(entry.key)
  }
}

export function readCache<T>(key: string): CacheEntry<T> | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry<T>
    return typeof entry.at === 'number' ? entry : null
  } catch {
    return null
  }
}

export function writeCache<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), data } satisfies CacheEntry<T>))
    evictIfFull()
  } catch {
    // Out of space, or storage disabled. Caching is a convenience; failing to
    // do it must never fail the read the user actually asked for. Clear what
    // is there so the next write has room, and carry on.
    try {
      for (const key of keys()) localStorage.removeItem(key)
    } catch {
      /* nothing more to try */
    }
  }
}

/** Forgets everything. Called on sign-out — a phone handed over shows nothing. */
export function clearCache(): void {
  try {
    for (const key of keys()) localStorage.removeItem(key)
  } catch {
    /* see writeCache */
  }
}

/** `read 2 minutes ago` — how a stale figure is labelled on screen. */
export function ageLabel(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
