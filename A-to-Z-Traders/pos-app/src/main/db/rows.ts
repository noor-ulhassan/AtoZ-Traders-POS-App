/**
 * Helpers for translating SQLite's storage classes into domain values.
 *
 * SQLite has no boolean type and returns 0/1 integers; it also returns NULL
 * for absent text. Every repository funnels rows through these so no
 * `row.is_active === 1` check leaks into a service or a React component.
 */

export const toBool = (value: number | null | undefined): boolean => value === 1

export const fromBool = (value: boolean | undefined): number => (value ? 1 : 0)

export const toText = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export const toNumber = (value: number | null | undefined): number => value ?? 0

export const toNullableNumber = (value: number | null | undefined): number | null =>
  value === null || value === undefined ? null : value

/** Builds `IN (?, ?, ?)` placeholders for a variable-length list. */
export const placeholders = (count: number): string =>
  Array.from({ length: count }, () => '?').join(', ')
