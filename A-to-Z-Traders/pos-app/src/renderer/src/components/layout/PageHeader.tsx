import type { JSX, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../icons/Icon'

interface PageHeaderProps {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  /** Adds a back link above the title, for detail screens. */
  back?: { to: string; label: string }
}

export function PageHeader({ title, subtitle, actions, back }: PageHeaderProps): JSX.Element {
  return (
    <header className="sticky top-0 z-10 flex min-h-[var(--header-height)] shrink-0 items-start justify-between gap-6 border-b border-line bg-paper px-6 py-5">
      <div className="flex min-w-0 flex-col gap-0.5">
        {back && (
          <div className="flex items-center gap-2">
            <Link
              to={back.to}
              className="-ml-1 inline-flex items-center gap-0.5 rounded-sm px-1 py-0.5 text-caption text-ink-muted hover:bg-surface-hover hover:text-accent"
            >
              <Icon name="chevronLeft" size={13} />
              {back.label}
            </Link>
          </div>
        )}
        <h1 className="text-lg font-semibold tracking-[-0.01em]">{title}</h1>
        {subtitle && <span className="text-sm text-ink-muted">{subtitle}</span>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2 pt-0.5">{actions}</div>}
    </header>
  )
}

/** The padded region a screen's cards and tables live in. */
export function PageBody({ children }: { children: ReactNode }): JSX.Element {
  return <div className="flex min-h-0 flex-1 flex-col gap-5 p-6">{children}</div>
}

/** A full-bleed strip of filters between the header and the body. */
export function FilterBar({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="sticky top-[var(--header-height)] z-9 flex flex-wrap items-center gap-3 border-b border-line bg-paper px-6 py-3">
      {children}
    </div>
  )
}

export function FilterSpacer(): JSX.Element {
  return <div className="min-w-4 flex-1" />
}
