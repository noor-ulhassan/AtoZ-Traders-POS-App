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

interface ParsedCombo {
  key: string
  ctrl: boolean
  shift: boolean
  alt: boolean
}

function parseCombo(combo: string): ParsedCombo {
  const parts = combo.toLowerCase().split('+')
  return {
    key: parts[parts.length - 1] ?? '',
    ctrl: parts.includes('ctrl'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt')
  }
}

function matchesCombo(event: KeyboardEvent, combo: ParsedCombo): boolean {
  return (
    event.key.toLowerCase() === combo.key &&
    event.ctrlKey === combo.ctrl &&
    event.altKey === combo.alt &&
    event.shiftKey === combo.shift
  )
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

    const parsed = parseCombo(combo)

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!matchesCombo(event, parsed)) return
      if (!allowInInput && isTypingTarget(event.target)) return

      event.preventDefault()
      handlerRef.current(event)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [combo, allowInInput, enabled])
}

export interface HotkeyBinding {
  combo: string
  handler: Handler
}

/**
 * Binds several keyboard shortcuts at once, e.g. one per sidebar nav item.
 *
 * A plain loop of `useHotkey()` calls would break the Rules of Hooks (the
 * list length isn't fixed at compile time), so this registers one listener
 * that checks each binding in turn instead.
 */
export function useHotkeys(bindings: HotkeyBinding[], options: Options = {}): void {
  const { allowInInput = false, enabled = true } = options
  const bindingsRef = useRef(bindings)

  useEffect(() => {
    bindingsRef.current = bindings
  })

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!allowInInput && isTypingTarget(event.target)) return
      const match = bindingsRef.current.find((binding) =>
        matchesCombo(event, parseCombo(binding.combo))
      )
      if (!match) return

      event.preventDefault()
      match.handler(event)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [allowInInput, enabled])
}
