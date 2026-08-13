import type { JSX, ReactNode } from 'react'
import { Icon } from '../../components/icons/Icon'

/**
 * The full-window frame the setup and lock screens share: a centred card on
 * the app canvas, with the product mark at the top. Keeping it in one place is
 * what makes the two screens read as the same door rather than two pages.
 */
export function AuthScreen({
  title,
  subtitle,
  children,
  footer
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}): JSX.Element {
  return (
    <div className="flex h-full items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-accent text-white">
            <Icon name="lock" size={22} />
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">{title}</h1>
            {subtitle && <p className="text-sm text-ink-muted">{subtitle}</p>}
          </div>
        </div>

        <div className="rounded-lg border border-line bg-paper p-6 shadow-popover">{children}</div>

        {footer && <div className="mt-4 text-center text-caption text-ink-subtle">{footer}</div>}
      </div>
    </div>
  )
}
