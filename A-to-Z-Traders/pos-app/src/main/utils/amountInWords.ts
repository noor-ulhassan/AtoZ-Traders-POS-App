/**
 * Renders an amount as English words using the South Asian numbering system
 * (thousand → lakh → crore → arab), which is what a bill in Pakistan is
 * expected to read like: "Rupees One Lakh Twenty Thousand Only".
 */

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen'
]

const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

/** 0–99. */
function underHundred(value: number): string {
  if (value < 20) return ONES[value] ?? ''
  const tens = TENS[Math.floor(value / 10)] ?? ''
  const ones = ONES[value % 10] ?? ''
  return ones ? `${tens} ${ones}` : tens
}

/** 0–999. */
function underThousand(value: number): string {
  const hundreds = Math.floor(value / 100)
  const rest = value % 100
  const parts: string[] = []
  if (hundreds > 0) parts.push(`${ONES[hundreds]} Hundred`)
  if (rest > 0) parts.push(underHundred(rest))
  return parts.join(' ')
}

/** Groups after the first three digits are two digits wide: 1,23,45,678. */
const GROUPS: { divisor: number; label: string }[] = [
  { divisor: 1_00_00_00_000, label: 'Arab' },
  { divisor: 1_00_00_000, label: 'Crore' },
  { divisor: 1_00_000, label: 'Lakh' },
  { divisor: 1_000, label: 'Thousand' }
]

function wholeNumberInWords(value: number): string {
  if (value === 0) return 'Zero'

  const parts: string[] = []
  let remaining = value

  for (const group of GROUPS) {
    const count = Math.floor(remaining / group.divisor)
    if (count > 0) {
      parts.push(`${underThousand(count)} ${group.label}`)
      remaining %= group.divisor
    }
  }

  if (remaining > 0) parts.push(underThousand(remaining))
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * @param amount   monetary value, e.g. 1250.75
 * @param currency currency label used in the sentence, e.g. 'PKR'
 */
export function amountInWords(amount: number, currency = 'PKR'): string {
  const negative = amount < 0
  const absolute = Math.abs(amount)
  const rupees = Math.floor(absolute)
  const paisa = Math.round((absolute - rupees) * 100)

  const unit = currency.toUpperCase() === 'PKR' ? 'Rupees' : currency
  const fraction = currency.toUpperCase() === 'PKR' ? 'Paisa' : 'Cents'

  let words = `${unit} ${wholeNumberInWords(rupees)}`
  if (paisa > 0) words += ` and ${wholeNumberInWords(paisa)} ${fraction}`
  words += ' Only'

  return negative ? `Minus ${words}` : words
}
