import clsx from 'clsx'
import type { JSX, ReactNode } from 'react'
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../icons/Icon'
import styles from './Toast.module.css'

type ToastKind = 'success' | 'error' | 'info'

interface Toast {
  id: number
  kind: ToastKind
  title: string
  message?: string
}

interface ToastApi {
  success: (title: string, message?: string) => void
  error: (title: string, message?: string) => void
  info: (title: string, message?: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

/** Errors stay long enough to be read and acted on; confirmations do not. */
const DURATION: Record<ToastKind, number> = {
  success: 3000,
  info: 4000,
  error: 7000
}

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback(
    (kind: ToastKind, title: string, message?: string) => {
      const id = nextId.current++
      // Cap the stack: a burst of failures should not bury the screen.
      setToasts((current) => [...current.slice(-3), { id, kind, title, message }])
      setTimeout(() => dismiss(id), DURATION[kind])
    },
    [dismiss]
  )

  const api = useMemo<ToastApi>(
    () => ({
      success: (title, message) => push('success', title, message),
      error: (title, message) => push('error', title, message),
      info: (title, message) => push('info', title, message)
    }),
    [push]
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className={styles.viewport} role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={clsx(styles.toast, styles[toast.kind])}>
              <div className={styles.body}>
                <span className={styles.title}>{toast.title}</span>
                {toast.message && <span className={styles.message}>{toast.message}</span>}
              </div>
              <button
                type="button"
                className={styles.dismiss}
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside <ToastProvider>.')
  return context
}
