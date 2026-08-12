import type { JSX, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../icons/Icon'
import styles from './PageHeader.module.css'

interface PageHeaderProps {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  /** Adds a back link above the title, for detail screens. */
  back?: { to: string; label: string }
}

export function PageHeader({ title, subtitle, actions, back }: PageHeaderProps): JSX.Element {
  return (
    <header className={styles.header}>
      <div className={styles.text}>
        {back && (
          <div className={styles.backRow}>
            <Link to={back.to} className={styles.back}>
              <Icon name="chevronLeft" size={13} />
              {back.label}
            </Link>
          </div>
        )}
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  )
}

/** The padded region a screen's cards and tables live in. */
export function PageBody({ children }: { children: ReactNode }): JSX.Element {
  return <div className={styles.body}>{children}</div>
}

/** A full-bleed strip of filters between the header and the body. */
export function FilterBar({ children }: { children: ReactNode }): JSX.Element {
  return <div className={styles.filters}>{children}</div>
}

export function FilterSpacer(): JSX.Element {
  return <div className={styles.filtersSpacer} />
}
