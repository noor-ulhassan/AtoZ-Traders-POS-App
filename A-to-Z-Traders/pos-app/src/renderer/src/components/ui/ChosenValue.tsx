import type { JSX, ReactNode } from 'react'
import { Button } from './Button'

interface ChosenValueProps {
  children: ReactNode
  /** Omit to make the choice fixed — the clear button disappears with it. */
  onClear?: () => void
  /** Accessible name for the clear button, e.g. "Clear supplier". */
  clearLabel?: string
}

/**
 * A record that has been picked, shown in place of the search box that found
 * it. Matches the height of a control exactly so a field does not change
 * height the moment something is chosen.
 */
export function ChosenValue({ children, onClear, clearLabel }: ChosenValueProps): JSX.Element {
  return (
    <div className="flex h-[38px] items-center justify-between gap-2 overflow-hidden rounded-md border border-line bg-surface-sunken pr-2 pl-3 text-sm whitespace-nowrap">
      <span className="truncate">{children}</span>
      {onClear && <Button variant="ghost" icon="close" aria-label={clearLabel} onClick={onClear} />}
    </div>
  )
}
