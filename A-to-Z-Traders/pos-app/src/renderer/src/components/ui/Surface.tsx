import clsx from 'clsx'
import type { HTMLAttributes, JSX, ReactNode } from 'react'
import styles from './Surface.module.css'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export function Card({ className, children, ...props }: CardProps): JSX.Element {
  return (
    <div className={clsx(styles.card, className)} {...props}>
      {children}
    </div>
  )
}

interface CardHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}

export function CardHeader({ title, subtitle, actions }: CardHeaderProps): JSX.Element {
  return (
    <div className={styles.cardHeader}>
      <div className={styles.cardHeaderText}>
        <span className={styles.cardTitle}>{title}</span>
        {subtitle && <span className={styles.cardSubtitle}>{subtitle}</span>}
      </div>
      {actions && <div className={styles.cardActions}>{actions}</div>}
    </div>
  )
}

interface CardBodyProps extends HTMLAttributes<HTMLDivElement> {
  /** Removes padding — use when the body is a table that should reach the edge. */
  flush?: boolean
  children: ReactNode
}

export function CardBody({ flush, className, children, ...props }: CardBodyProps): JSX.Element {
  return (
    <div className={clsx(styles.cardBody, flush && styles.cardBodyFlush, className)} {...props}>
      {children}
    </div>
  )
}

export function Toolbar({ children }: { children: ReactNode }): JSX.Element {
  return <div className={styles.toolbar}>{children}</div>
}

export function ToolbarSpacer(): JSX.Element {
  return <div className={styles.toolbarSpacer} />
}

export function SectionLabel({ children }: { children: ReactNode }): JSX.Element {
  return <div className={styles.sectionLabel}>{children}</div>
}

export function Divider(): JSX.Element {
  return <hr className={styles.divider} />
}

type Span = 2 | 3 | 4 | 6 | 8 | 12

interface FormGridProps {
  children: ReactNode
  className?: string
}

/** A 12-column grid so every form in the app shares one rhythm. */
export function FormGrid({ children, className }: FormGridProps): JSX.Element {
  return <div className={clsx(styles.formGrid, className)}>{children}</div>
}

export function GridCell({ span, children }: { span: Span; children: ReactNode }): JSX.Element {
  const spanClass = {
    2: styles.span2,
    3: styles.span3,
    4: styles.span4,
    6: styles.span6,
    8: styles.span8,
    12: styles.span12
  }[span]

  return <div className={spanClass}>{children}</div>
}
