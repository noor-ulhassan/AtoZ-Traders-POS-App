import clsx from 'clsx'
import type { JSX } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useHotkey } from '../../hooks/useHotkey'
import { NAVIGATION } from './navigation'
import { Sidebar } from './Sidebar'
import styles from './AppShell.module.css'

/** Screens that manage their own scroll region, so the shell must not pad them. */
const FLUSH_ROUTES = ['/billing']

/**
 * The frame every screen renders inside: a fixed sidebar, and one scrolling
 * work area. Global shortcuts are bound here so they work from any screen.
 */
export function AppShell(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()

  const shortcuts = NAVIGATION.flatMap((group) => group.items).filter((item) => item.hotkey)
  const flush = FLUSH_ROUTES.some((route) => location.pathname.startsWith(route))

  // Registering per item keeps the shortcut next to its nav entry, which is
  // where anyone looking for it will check first.
  useHotkey(shortcuts[0]?.hotkey ?? 'F2', () => navigate(shortcuts[0]?.to ?? '/billing'), {
    allowInInput: true
  })

  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        <div className={clsx(styles.content, flush && styles.contentFlush)}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
