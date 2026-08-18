import clsx from 'clsx'
import type { JSX } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useHotkeys } from '../../hooks/useHotkey'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { NAVIGATION } from './navigation'
import type { NavItem } from './navigation'
import { Sidebar } from './Sidebar'

/** Screens that manage their own scroll region, so the shell must not pad them. */
const FLUSH_ROUTES = ['/billing']

/**
 * The frame every screen renders inside: a fixed sidebar, and one scrolling
 * work area. Global shortcuts are bound here so they work from any screen.
 */
export function AppShell(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()

  const shortcuts = NAVIGATION.flatMap((group) => group.items).filter(
    (item): item is NavItem & { hotkey: string } => Boolean(item.hotkey)
  )
  const flush = FLUSH_ROUTES.some((route) => location.pathname.startsWith(route))

  // Registering per item keeps the shortcut next to its nav entry, which is
  // where anyone looking for it will check first.
  useHotkeys(
    shortcuts.map((item) => ({ combo: item.hotkey, handler: () => navigate(item.to) })),
    { allowInInput: true }
  )

  return (
    <div className="grid h-screen grid-cols-[var(--sidebar-width)_minmax(0,1fr)] overflow-hidden">
      <Sidebar />
      <main className="flex min-w-0 flex-col overflow-hidden bg-canvas">
        {/* The page header is full-bleed and sticks to the top of the work
            area, so the scroll region starts below it rather than around it. */}
        <div
          className={clsx(
            'flex min-h-0 flex-1 flex-col',
            flush ? 'overflow-hidden' : 'overflow-y-auto'
          )}
        >
          {/* A per-screen boundary so one broken page keeps the sidebar usable;
              keyed to the route so navigating away clears a crashed screen. */}
          <ErrorBoundary context={location.pathname} resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>
    </div>
  )
}
