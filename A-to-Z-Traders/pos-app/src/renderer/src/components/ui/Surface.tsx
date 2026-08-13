import clsx from 'clsx'
import type { HTMLAttributes, JSX, ReactNode } from 'react'

/* Cards are flat: a hairline border and a white ground. Shadows are reserved
   for things that genuinely float (modals, popovers), so elevation keeps
   meaning something. */

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export function Card({ className, children, ...props }: CardProps): JSX.Element {
  return (
    <div
      className={clsx('overflow-hidden rounded-lg border border-line bg-paper', className)}
      {...props}
    >
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
    <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-base font-semibold">{title}</span>
        {subtitle && <span className="text-caption text-ink-muted">{subtitle}</span>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
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
    <div className={clsx(flush ? 'p-0' : 'p-5', className)} {...props}>
      {children}
    </div>
  )
}

/** A horizontal band of controls above a table. */
export function Toolbar({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line bg-paper px-4 py-3">
      {children}
    </div>
  )
}

export function ToolbarSpacer(): JSX.Element {
  return <div className="min-w-4 flex-1" />
}

/** Uppercase micro-label used above grouped fields and in the sidebar. */
export function SectionLabel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="text-micro font-semibold tracking-[0.07em] text-ink-subtle uppercase">
      {children}
    </div>
  )
}

export function Divider(): JSX.Element {
  return <hr className="h-px border-none bg-line" />
}

type Span = 2 | 3 | 4 | 6 | 8 | 12

interface FormGridProps {
  children: ReactNode
  className?: string
}

/** A 12-column grid so every form in the app shares one rhythm. */
export function FormGrid({ children, className }: FormGridProps): JSX.Element {
  return <div className={clsx('grid grid-cols-12 gap-4', className)}>{children}</div>
}

/**
 * Spans are a fixed set rather than a `col-span-${n}` template, because a
 * class name Tailwind never sees in the source is a class name it never
 * generates.
 */
const SPANS: Record<Span, string> = {
  2: 'col-span-2',
  3: 'col-span-3',
  4: 'col-span-4',
  6: 'col-span-6',
  8: 'col-span-8',
  12: 'col-span-12'
}

export function GridCell({ span, children }: { span: Span; children: ReactNode }): JSX.Element {
  return <div className={SPANS[span]}>{children}</div>
}
