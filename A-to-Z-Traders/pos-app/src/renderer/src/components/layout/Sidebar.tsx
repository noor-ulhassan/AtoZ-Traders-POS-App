import clsx from 'clsx'
import type { JSX } from 'react'
import { NavLink } from 'react-router-dom'
import { Icon } from '../icons/Icon'
import { useAuth } from '../../app/AuthContext'
import { useSettings } from '../../app/SettingsContext'
import { NAVIGATION } from './navigation'

/**
 * The rail on the active item is a `before` pseudo-element rather than a
 * border, so it can bleed past the item's rounded corners into the nav's
 * padding and read as a marker on the edge of the sidebar.
 */
const ITEM =
  'relative flex h-[38px] items-center gap-3 rounded-md px-3 text-sm text-nav-ink hover:bg-nav-hover hover:text-nav-ink-strong'

const ITEM_ACTIVE =
  'bg-nav-active font-medium text-nav-ink-strong hover:bg-nav-active ' +
  'before:absolute before:top-1.5 before:bottom-1.5 before:-left-3 before:w-[3px] before:rounded-r-[2px] before:bg-accent before:content-[""]'

export function Sidebar(): JSX.Element {
  const { settings } = useSettings()
  const { lock } = useAuth()

  const brandName = settings.businessName?.trim() || 'A to Z Traders'
  const monogram = brandName.charAt(0).toUpperCase()

  return (
    <aside className="flex flex-col overflow-hidden border-r border-nav-line bg-nav-bg text-nav-ink">
      {/* Brand: a monogram tile beside the business name, which is the most
          prominent piece of type in the whole chrome. */}
      <div className="flex items-center gap-3 border-b border-nav-line px-5 py-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent shadow-[0_2px_10px_rgb(0_0_0/30%)]">
          <span className="font-display text-lg font-bold text-white">{monogram}</span>
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-display text-md font-bold tracking-[-0.01em] text-nav-ink-strong">
            {brandName}
          </span>
          <span className="text-micro font-medium tracking-[0.12em] text-nav-ink-muted uppercase">
            Point of sale
          </span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pt-4 pb-4" aria-label="Main">
        {NAVIGATION.map((group) => (
          <div key={group.label} className="mt-4 first:mt-0">
            <div className="px-3 pb-2 text-micro font-semibold tracking-[0.08em] text-nav-ink-muted uppercase">
              {group.label}
            </div>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => clsx(ITEM, isActive && ITEM_ACTIVE)}
              >
                <Icon name={item.icon} size={16} className="shrink-0 opacity-85" />
                <span className="flex-1 truncate">{item.label}</span>
                {item.hotkey && (
                  <span className="font-mono text-micro text-nav-ink-muted">{item.hotkey}</span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer: the one lock action, then the maker's credit. Business info
          for Noor will sit in the reserved block beneath the credit line. */}
      <div className="flex flex-col gap-3 border-t border-nav-line px-3 pt-3 pb-4">
        <button
          type="button"
          onClick={() => void lock()}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-nav-ink hover:bg-nav-hover hover:text-nav-ink-strong"
        >
          <Icon name="lock" size={16} className="shrink-0 opacity-85" />
          <span className="flex-1 text-left">Lock app</span>
        </button>

        <div className="rounded-lg bg-nav-hover px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-micro text-nav-ink-muted">
              Developed by <span className="font-semibold text-nav-ink-strong">Noor</span>
            </span>
            <span className="text-micro tabular-nums text-nav-ink-muted">
              {settings.currency} · v1.0
            </span>
          </div>
          {/* Reserved for Noor's business details (phone · email · website),
              added later — this block is sized to grow into them. */}
        </div>
      </div>
    </aside>
  )
}
