import clsx from 'clsx'
import type { JSX } from 'react'
import { NavLink } from 'react-router-dom'
import { Icon } from '../icons/Icon'
import { useSettings } from '../../app/SettingsContext'
import { NAVIGATION } from './navigation'
import styles from './AppShell.module.css'

export function Sidebar(): JSX.Element {
  const { settings } = useSettings()

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.brandName}>{settings.businessName || 'Wholesale POS'}</span>
        <span className={styles.brandMeta}>Point of sale</span>
      </div>

      <nav className={styles.nav} aria-label="Main">
        {NAVIGATION.map((group) => (
          <div key={group.label} className={styles.group}>
            <div className={styles.groupLabel}>{group.label}</div>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => clsx(styles.item, isActive && styles.itemActive)}
              >
                <Icon name={item.icon} size={16} className={styles.itemIcon} />
                <span className={styles.itemLabel}>{item.label}</span>
                {item.hotkey && <span className={styles.itemHint}>{item.hotkey}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className={styles.sidebarFooter}>
        <span>{settings.currency}</span>
        <span>v1.0</span>
      </div>
    </aside>
  )
}
