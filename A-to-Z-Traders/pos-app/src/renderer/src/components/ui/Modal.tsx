import clsx from 'clsx'
import type { JSX, ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'

type Size = 'sm' | 'md' | 'lg' | 'xl'

const SIZES: Record<Size, string> = {
  sm: 'max-w-[420px]',
  md: 'max-w-[620px]',
  lg: 'max-w-[880px]',
  xl: 'max-w-[1120px]'
}

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  size?: Size
  /** Rendered in the footer bar. Put the primary action last. */
  footer?: ReactNode
  /** Rendered on the left of the footer, e.g. a destructive action. */
  footerStart?: ReactNode
  flush?: boolean
  children: ReactNode
}

/**
 * A modal dialog.
 *
 * Escape closes it and focus moves inside on open, because a form the owner
 * cannot dismiss from the keyboard is a form that gets abandoned with the
 * mouse. Clicking the backdrop does *not* close it: these dialogs hold typed
 * work, and a stray click outside should never discard a half-entered bill.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  footerStart,
  flush = false,
  children
}: ModalProps): JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const first = dialogRef.current?.querySelector<HTMLElement>(
      'input:not([type="hidden"]), select, textarea, button'
    )
    first?.focus()
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-100 flex animate-fade-in items-start justify-center overflow-y-auto bg-[rgb(16_24_32/42%)] px-6 pt-[6vh] pb-6"
      role="presentation"
    >
      <div
        ref={dialogRef}
        className={clsx(
          'flex max-h-[88vh] w-full animate-rise-in flex-col rounded-lg border border-line bg-paper shadow-modal',
          SIZES[size]
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 pt-5 pb-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-md font-semibold">{title}</span>
            {description && <span className="text-caption text-ink-muted">{description}</span>}
          </div>
          <Button variant="ghost" size="sm" icon="close" onClick={onClose} aria-label="Close" />
        </div>

        <div className={clsx('flex-1 overflow-y-auto', flush ? 'p-0' : 'p-5')}>{children}</div>

        {(footer || footerStart) && (
          <div className="flex items-center justify-end gap-2 rounded-b-lg border-t border-line bg-surface-sunken px-5 py-4">
            {footerStart && <div className="mr-auto">{footerStart}</div>}
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
