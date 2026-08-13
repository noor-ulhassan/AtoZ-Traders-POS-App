import clsx from 'clsx'
import type { ButtonHTMLAttributes, JSX, ReactNode } from 'react'
import { Icon } from '../icons/Icon'
import type { IconName } from '../icons/Icon'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerSolid'
type Size = 'sm' | 'md' | 'lg'

/**
 * Hover states are written as `enabled:hover:` rather than plain `hover:`.
 * A disabled button still receives hover on a desktop pointer, and a control
 * that lights up under the cursor but refuses the click is a small lie.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-white border-accent enabled:hover:bg-accent-strong enabled:hover:border-accent-strong',
  secondary:
    'bg-paper text-ink border-line-strong enabled:hover:bg-surface-hover enabled:hover:border-ink-subtle',
  ghost: 'bg-transparent text-ink-muted enabled:hover:bg-surface-active enabled:hover:text-ink',
  danger: 'bg-paper text-bad border-bad-border enabled:hover:bg-bad-weak enabled:hover:border-bad',
  dangerSolid: 'bg-bad text-white border-bad enabled:hover:brightness-[0.92]'
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-caption',
  md: 'h-[38px] px-4 text-sm',
  lg: 'h-[46px] px-6 text-base'
}

/** Square when there is an icon and no label — width matches the height. */
const ICON_ONLY_SIZES: Record<Size, string> = {
  sm: 'w-8 px-0',
  md: 'w-[38px] px-0',
  lg: 'w-[46px] px-0'
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: IconName
  /** Shows a spinner and blocks further clicks. */
  loading?: boolean
  fullWidth?: boolean
  children?: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  fullWidth = false,
  disabled,
  children,
  className,
  type = 'button',
  ...props
}: ButtonProps): JSX.Element {
  const iconOnly = !children && Boolean(icon)

  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-md border border-transparent font-medium whitespace-nowrap transition-colors duration-[120ms]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        iconOnly && ICON_ONLY_SIZES[size],
        fullWidth && 'w-full',
        className
      )}
      {...props}
    >
      {loading ? (
        // A quiet spinner in place of the label, so the button does not resize.
        <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
      ) : (
        icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />
      )}
      {children}
    </button>
  )
}
