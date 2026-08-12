import clsx from 'clsx'
import type { JSX, ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import styles from './Modal.module.css'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
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
    <div className={styles.overlay} role="presentation">
      <div
        ref={dialogRef}
        className={clsx(styles.dialog, styles[size])}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={styles.header}>
          <div className={styles.headerText}>
            <span className={styles.title}>{title}</span>
            {description && <span className={styles.description}>{description}</span>}
          </div>
          <Button variant="ghost" size="sm" icon="close" onClick={onClose} aria-label="Close" />
        </div>

        <div className={clsx(styles.body, flush && styles.bodyFlush)}>{children}</div>

        {(footer || footerStart) && (
          <div className={styles.footer}>
            {footerStart && <div className={styles.footerStart}>{footerStart}</div>}
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
