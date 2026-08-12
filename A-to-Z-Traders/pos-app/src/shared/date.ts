import type { DateRange, IsoDate } from './types/common'

/**
 * All dates are handled as local calendar dates in `YYYY-MM-DD` form, matching
 * SQLite's `date('now', 'localtime')`. We never put a `Date` object in the
 * database and never parse a stored date with `new Date(string)` — that would
 * silently reinterpret it as UTC and shift the day for users east of GMT.
 */

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

export function toIsoDate(date: Date): IsoDate {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Parse `YYYY-MM-DD` into a local-midnight Date. */
export function fromIsoDate(value: IsoDate): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1)
}

export function today(): IsoDate {
  return toIsoDate(new Date())
}

export function addDays(value: IsoDate, days: number): IsoDate {
  const date = fromIsoDate(value)
  date.setDate(date.getDate() + days)
  return toIsoDate(date)
}

export function addMonths(value: IsoDate, months: number): IsoDate {
  const date = fromIsoDate(value)
  date.setMonth(date.getMonth() + months)
  return toIsoDate(date)
}

export function startOfMonth(value: IsoDate = today()): IsoDate {
  return `${value.slice(0, 7)}-01`
}

export function endOfMonth(value: IsoDate = today()): IsoDate {
  const date = fromIsoDate(value)
  return toIsoDate(new Date(date.getFullYear(), date.getMonth() + 1, 0))
}

export function isValidIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = fromIsoDate(value)
  return toIsoDate(date) === value
}

/** Every day from `from` to `to` inclusive. Used to fill gaps in trend charts. */
export function eachDay({ from, to }: DateRange): IsoDate[] {
  const days: IsoDate[] = []
  let cursor = from
  // Hard stop keeps a reversed or malformed range from looping forever.
  for (let guard = 0; cursor <= to && guard < 3660; guard += 1) {
    days.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return days
}

export type DatePresetKey =
  'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'lastMonth' | 'thisYear'

export const DATE_PRESETS: { key: DatePresetKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'thisYear', label: 'This year' }
]

export function resolvePreset(key: DatePresetKey, now: IsoDate = today()): DateRange {
  switch (key) {
    case 'today':
      return { from: now, to: now }
    case 'yesterday': {
      const day = addDays(now, -1)
      return { from: day, to: day }
    }
    case 'last7':
      return { from: addDays(now, -6), to: now }
    case 'last30':
      return { from: addDays(now, -29), to: now }
    case 'thisMonth':
      return { from: startOfMonth(now), to: now }
    case 'lastMonth': {
      const previous = addMonths(startOfMonth(now), -1)
      return { from: startOfMonth(previous), to: endOfMonth(previous) }
    }
    case 'thisYear':
      return { from: `${now.slice(0, 4)}-01-01`, to: now }
  }
}
