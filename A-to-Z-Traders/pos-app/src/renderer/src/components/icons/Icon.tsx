import type { JSX, SVGProps } from 'react'

/**
 * A small hand-drawn icon set.
 *
 * Every glyph is a 24×24 stroked path on the same 1.6px weight and rounded
 * cap, so they sit together at 16px without one looking heavier than the
 * next. A third-party icon pack would have brought a thousand glyphs and a
 * different visual weight for the twenty this app actually uses.
 */

export type IconName =
  | 'dashboard'
  | 'bill'
  | 'sales'
  | 'returns'
  | 'products'
  | 'purchases'
  | 'stock'
  | 'customers'
  | 'suppliers'
  | 'payments'
  | 'expenses'
  | 'reports'
  | 'settings'
  | 'search'
  | 'plus'
  | 'minus'
  | 'close'
  | 'check'
  | 'chevronDown'
  | 'chevronRight'
  | 'chevronLeft'
  | 'trash'
  | 'edit'
  | 'download'
  | 'print'
  | 'warning'
  | 'info'
  | 'ledger'
  | 'backup'
  | 'restore'
  | 'calendar'

const PATHS: Record<IconName, JSX.Element> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="8" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="11" width="7" height="10" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  bill: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  sales: (
    <>
      <path d="M3 6h18M3 12h18M3 18h12" />
      <circle cx="19" cy="18" r="2" />
    </>
  ),
  returns: (
    <>
      <path d="M4 10h11a5 5 0 0 1 0 10h-6" />
      <path d="M8 6 4 10l4 4" />
    </>
  ),
  products: (
    <>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5 12 12l8-4.5M12 12v9" />
    </>
  ),
  purchases: (
    <>
      <path d="M4 5h2l2.2 10.5a2 2 0 0 0 2 1.5h6.9a2 2 0 0 0 2-1.5L21 8H7" />
      <circle cx="10" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
    </>
  ),
  stock: (
    <>
      <path d="M3 20h18M6 20V9M11 20V4M16 20v-7M21 20v-4" />
    </>
  ),
  customers: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M17 11a3 3 0 1 0 0-6M18 20a6 6 0 0 0-2.5-4.9" />
    </>
  ),
  suppliers: (
    <>
      <path d="M3 8h10v8H3zM13 11h4l3 3v2h-7z" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17" cy="18" r="1.6" />
    </>
  ),
  payments: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M2.5 10h19" />
      <path d="M6 14.5h3" />
    </>
  ),
  expenses: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M14.5 9.5c-.6-.9-1.5-1.2-2.5-1.2-1.4 0-2.5.7-2.5 1.9 0 2.6 5 1.4 5 4 0 1.2-1.1 2-2.5 2-1.1 0-2-.4-2.6-1.3" />
    </>
  ),
  reports: (
    <>
      <path d="M5 3h9l5 5v13H5z" />
      <path d="M14 3v5h5" />
      <path d="M9 17v-4M12 17v-6M15 17v-2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.1a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9 2 2 0 1 1 0 4 1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m4 12.5 5 5L20 6.5" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  trash: (
    <>
      <path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="m14.5 6.5 3 3" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11M7.5 11 12 15.5 16.5 11" />
      <path d="M4 19h16" />
    </>
  ),
  print: (
    <>
      <path d="M7 9V4h10v5" />
      <rect x="4" y="9" width="16" height="7" rx="1.5" />
      <path d="M7 14h10v6H7z" />
    </>
  ),
  warning: (
    <>
      <path d="M12 4 2.5 20h19z" />
      <path d="M12 10v4M12 17.2v.1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.8v.1" />
    </>
  ),
  ledger: (
    <>
      <path d="M5 3h13a1 1 0 0 1 1 1v17H6a1 1 0 0 1-1-1z" />
      <path d="M5 7h14M9 3v18" />
    </>
  ),
  backup: (
    <>
      <path d="M12 3v10M8 9.5l4 4 4-4" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </>
  ),
  restore: (
    <>
      <path d="M12 21V11M8 14.5l4-4 4 4" />
      <path d="M4 8V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  )
}

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
}

export function Icon({ name, size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {PATHS[name]}
    </svg>
  )
}
