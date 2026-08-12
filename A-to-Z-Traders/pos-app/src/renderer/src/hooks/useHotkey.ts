import { useEffect, useRef } from 'react'

type Handler = (event: KeyboardEvent) => void

interface Options {
  /** Fire even while the cursor is in a text field. Default: false. */
  allowInInput?: boolean
  enabled?: boolean
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/**
 * Binds a single keyboard shortcut.
 *
 * Billing is keyboard-first: the owner should be able to run a whole bill
 * without reaching for the mouse. Function keys are used for actions because
 * they never collide with typing a product name.
 *
 * @param combo e.g. `F2`, `Escape`, `ctrl+s`, `ctrl+shift+p`
 */
export function useHotkey(combo: string, handler: Handler, options: Options = {}): void {
  const { allowInInput = false, enabled = true } = options
  const handlerRef = useRef(handler)

  // Written in an effect, not during render: the key listener only reads this
  // when a key is actually pressed, which is always after effects have run.
  useEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => {
    if (!enabled) return

    const parts = combo.toLowerCase().split('+')
    const key = parts[parts.length - 1] ?? ''
    const needsCtrl = parts.includes('ctrl')
    const needsShift = parts.includes('shift')
    const needsAlt = parts.includes('alt')

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== key) return
      if (event.ctrlKey !== needsCtrl || event.altKey !== needsAlt) return
      if (event.shiftKey !== needsShift) return
      if (!allowInInput && isTypingTarget(event.target)) return

      event.preventDefault()
      handlerRef.current(event)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [combo, allowInInput, enabled])
}
