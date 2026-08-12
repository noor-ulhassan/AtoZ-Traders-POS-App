import type { IconName } from '../icons/Icon'

export interface NavItem {
  to: string
  label: string
  icon: IconName
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
      { to: '/', label: 'Dashboard', icon: 'dashboard' },
      { to: '/billing', label: 'New bill', icon: 'bill', hotkey: 'F2' },
      { to: '/sales', label: 'Sales', icon: 'sales' },
      { to: '/returns/sale', label: 'Sale returns', icon: 'returns' }
    ]
  },
  {
    label: 'Stock',
    items: [
      { to: '/products', label: 'Products', icon: 'products' },
      { to: '/purchases', label: 'Purchases', icon: 'purchases' },
      { to: '/returns/purchase', label: 'Purchase returns', icon: 'returns' },
      { to: '/stock', label: 'Stock ledger', icon: 'stock' }
    ]
  },
  {
    label: 'People',
    items: [
      { to: '/customers', label: 'Customers', icon: 'customers' },
      { to: '/suppliers', label: 'Suppliers', icon: 'suppliers' }
    ]
  },
  {
    label: 'Money',
    items: [
      { to: '/payments', label: 'Payments', icon: 'payments' },
      { to: '/expenses', label: 'Expenses', icon: 'expenses' }
    ]
  },
  {
    label: 'Business',
    items: [
      { to: '/reports', label: 'Reports', icon: 'reports' },
      { to: '/settings', label: 'Settings', icon: 'settings' }
    ]
  }
]
