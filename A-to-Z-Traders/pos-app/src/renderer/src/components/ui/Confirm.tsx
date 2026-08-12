import type { JSX, ReactNode } from 'react'
import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { Button } from './Button'
import { Modal } from './Modal'

interface ConfirmOptions {
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Styles the confirm button as destructive. */
  destructive?: boolean
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Confirm | null>(null)

/**
 * Confirmation for anything that cannot be undone.
 *
 * `window.confirm` is blocked in Electron renderers by design and looks like a
 * browser dialog anyway. This keeps the app's own voice on the question the
 * owner is actually being asked.
 */
export function ConfirmProvider({ children }: { children: ReactNode }): JSX.Element {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback<Confirm>((next) => {
    setOptions(next)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value)
    resolver.current = null
    setOptions(null)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={options !== null}
        onClose={() => settle(false)}
        title={options?.title ?? ''}
        size="sm"
        footer={
          <>
            <Button onClick={() => settle(false)}>{options?.cancelLabel ?? 'Cancel'}</Button>
            <Button
              variant={options?.destructive ? 'dangerSolid' : 'primary'}
              onClick={() => settle(true)}
            >
              {options?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      >
        {options?.message}
      </Modal>
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): Confirm {
  const context = useContext(ConfirmContext)
  if (!context) throw new Error('useConfirm must be used inside <ConfirmProvider>.')
  return context
}
