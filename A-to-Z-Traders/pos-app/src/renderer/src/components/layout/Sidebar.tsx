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
  'relative flex h-[34px] items-center gap-3 rounded-md px-3 text-sm text-nav-ink hover:bg-nav-hover hover:text-nav-ink-strong'

const ITEM_ACTIVE =
  'bg-nav-active font-medium text-nav-ink-strong hover:bg-nav-active ' +
  'before:absolute before:top-1.5 before:bottom-1.5 before:-left-3 before:w-[3px] before:rounded-r-[2px] before:bg-accent before:content-[""]'

export function Sidebar(): JSX.Element {
  const { settings } = useSettings()
  const { lock } = useAuth()

  return (
    <aside className="flex flex-col overflow-hidden border-r border-nav-line bg-nav-bg text-nav-ink">
      <div className="flex flex-col gap-px border-b border-nav-line px-5 pt-5 pb-4">
        <span className="truncate font-display text-base font-semibold tracking-[-0.005em] text-nav-ink-strong">
          {settings.businessName || 'Wholesale POS'}
        </span>
        <span className="text-micro tracking-[0.06em] text-nav-ink-muted uppercase">
          Point of sale
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pt-3 pb-5" aria-label="Main">
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

      <div className="border-t border-nav-line px-3 py-2">
        <button
          type="button"
          onClick={() => void lock()}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-nav-ink hover:bg-nav-hover hover:text-nav-ink-strong"
        >
          <Icon name="lock" size={16} className="shrink-0 opacity-85" />
          <span className="flex-1 text-left">Lock app</span>
        </button>
      </div>

      <div className="flex justify-between gap-2 border-t border-nav-line px-4 py-3 text-micro text-nav-ink-muted">
        <span>{settings.currency}</span>
        <span>v1.0</span>
      </div>
    </aside>
  )
}
