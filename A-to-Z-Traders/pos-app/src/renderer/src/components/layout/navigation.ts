import type { IconName } from '../icons/Icon'
import type { Feature } from '../../app/permissions'

export interface NavItem {
  to: string
  label: string
  icon: IconName
  /** The access feature this item belongs to, used to hide it per role. */
  feature: Feature
  /** Keyboard shortcut shown beside the item and bound in the shell. */
  hotkey?: string
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

/**
 * The application's information architecture.
 *
 * Grouped by what the owner is doing rather than by database table: selling,
 * buying, the people money moves between, and the view of the business as a
 * whole. Billing carries F2 because it is the screen opened most often, and
 * function keys never collide with typing a product name.
 */
export const NAVIGATION: NavGroup[] = [
  {
    label: 'Sell',
    items: [
      { to: '/', label: 'Dashboard', icon: 'dashboard', feature: 'dashboard' },
      { to: '/billing', label: 'New bill', icon: 'bill', feature: 'billing', hotkey: 'F2' },
      { to: '/sales', label: 'Sales', icon: 'sales', feature: 'sales' },
      { to: '/returns/sale', label: 'Sale returns', icon: 'returns', feature: 'saleReturns' }
    ]
  },
  {
    label: 'Stock',
    items: [
      { to: '/products', label: 'Products', icon: 'products', feature: 'products' },
      { to: '/purchases', label: 'Purchases', icon: 'purchases', feature: 'purchases' },
      {
        to: '/returns/purchase',
        label: 'Purchase returns',
        icon: 'returns',
        feature: 'purchaseReturns'
      },
      { to: '/stock', label: 'Stock ledger', icon: 'stock', feature: 'stock' },
      { to: '/other-stock', label: 'Other stock', icon: 'ledger', feature: 'otherStock' }
    ]
  },
  {
    label: 'People',
    items: [
      { to: '/customers', label: 'Customers', icon: 'customers', feature: 'customers' },
      { to: '/suppliers', label: 'Suppliers', icon: 'suppliers', feature: 'suppliers' }
    ]
  },
  {
    label: 'Money',
    items: [
      { to: '/payments', label: 'Payments', icon: 'payments', feature: 'payments' },
      { to: '/expenses', label: 'Expenses', icon: 'expenses', feature: 'expenses' }
    ]
  },
  {
    label: 'Business',
    items: [
      { to: '/reports', label: 'Reports', icon: 'reports', feature: 'reports' },
      { to: '/users', label: 'Staff & roles', icon: 'lock', feature: 'users' },
      { to: '/settings', label: 'Settings', icon: 'settings', feature: 'settings' }
    ]
  }
]
