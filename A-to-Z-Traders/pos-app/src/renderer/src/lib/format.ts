import type { IsoDate } from '@shared/types'
import { fromIsoDate } from '@shared/date'

/**
 * Display formatting.
 *
 * Grouping is western (1,250,000) rather than lakh-style (12,50,000): both are
 * read in Pakistan, but the app's numbers also land in Excel exports and on
 * printed bills, where the unambiguous form travels better.
 */

const numberFormat = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

const compactNumberFormat = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
})

const quantityFormat = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3
})

/** `1,250.00` — the amount alone, for table cells that carry a currency header. */
export function money(value: number | null | undefined): string {
  return numberFormat.format(value ?? 0)
}

/** `PKR 1,250.00` — for standalone figures. */
export function currency(value: number | null | undefined, code = 'PKR'): string {
  return `${code} ${numberFormat.format(value ?? 0)}`
}

/** `1,250` — for headline stats where the paisa is noise. */
export function moneyRounded(value: number | null | undefined): string {
  return compactNumberFormat.format(Math.round(value ?? 0))
}

/** `12` / `1.5` — trailing zeros dropped, because "12.000 pieces" reads wrong. */
export function quantity(value: number | null | undefined): string {
  return quantityFormat.format(value ?? 0)
}

export function qtyWithUnit(value: number | null | undefined, unit: string): string {
  return `${quantity(value)} ${unit}`
}

/** `06 Aug 2026` — unambiguous, and sorts visually by the year at the end. */
export function date(value: IsoDate | null | undefined): string {
  if (!value) return '—'
  const parsed = fromIsoDate(value)
  const day = String(parsed.getDate()).padStart(2, '0')
  const month = parsed.toLocaleString('en-US', { month: 'short' })
  return `${day} ${month} ${parsed.getFullYear()}`
}

/** `06 Aug 2026, 14:32` for timestamps. */
export function dateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const [datePart, timePart] = value.split(' ')
  const formatted = date(datePart)
  return timePart ? `${formatted}, ${timePart.slice(0, 5)}` : formatted
}

/** `Fri` — used as the axis label on short trends. */
export function weekday(value: IsoDate): string {
  return fromIsoDate(value).toLocaleString('en-US', { weekday: 'short' })
}

/** `06 Aug` — used as the axis label on longer trends. */
export function dayMonth(value: IsoDate): string {
  const parsed = fromIsoDate(value)
  return `${String(parsed.getDate()).padStart(2, '0')} ${parsed.toLocaleString('en-US', { month: 'short' })}`
}

/**
 * A balance, said the way a shopkeeper says it.
 *
 * A bare "-1,500" on a customer row is ambiguous — is that owed or paid? The
 * word carries the meaning and the colour reinforces it.
 */
export function balanceLabel(
  value: number,
  party: 'customer' | 'supplier'
): { text: string; tone: 'good' | 'bad' | 'neutral' } {
  const amount = money(Math.abs(value))
  if (Math.abs(value) < 0.005) return { text: 'Settled', tone: 'neutral' }

  if (party === 'customer') {
    return value > 0
      ? { text: `${amount} due`, tone: 'bad' }
      : { text: `${amount} advance`, tone: 'good' }
  }

  return value > 0
    ? { text: `${amount} payable`, tone: 'bad' }
    : { text: `${amount} advance`, tone: 'good' }
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}
