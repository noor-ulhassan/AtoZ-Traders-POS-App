import type { UserRole } from '@shared/types'

/**
 * What each role may see in the UI.
 *
 * This is the renderer's convenience copy of the access policy — it decides
 * which nav items and pages show, and which buttons appear. It is NOT the
 * security boundary: the main process re-checks every channel against the same
 * policy (ipc/registry.ts), so hiding a button here is about a clean experience,
 * never about safety. Keep the two in step when the policy changes.
 */
export type Feature =
  | 'dashboard'
  | 'billing'
  | 'sales'
  | 'saleReturns'
  | 'purchaseReturns'
  | 'products'
  | 'stock'
  | 'purchases'
  | 'customers'
  | 'suppliers'
  | 'payments'
  | 'expenses'
  | 'reports'
  | 'settings'
  | 'users'

/** The pages a shopkeeper may open. Everything else is admin-only. */
const SHOPKEEPER_FEATURES: ReadonlySet<Feature> = new Set<Feature>([
  'dashboard',
  'billing',
  'sales',
  'saleReturns',
  'customers',
  'payments'
])

export function canAccess(role: UserRole | null, feature: Feature): boolean {
  if (role === 'admin') return true
  if (role === 'shopkeeper') return SHOPKEEPER_FEATURES.has(feature)
  return false
}
