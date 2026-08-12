import clsx from 'clsx'
import type { ButtonHTMLAttributes, JSX, ReactNode } from 'react'
import { Icon } from '../icons/Icon'
import type { IconName } from '../icons/Icon'
import styles from './Button.module.css'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerSolid'
type Size = 'sm' | 'md' | 'lg'

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
        styles.button,
        styles[variant],
        styles[size],
        iconOnly && styles.iconOnly,
        fullWidth && styles.full,
        className
      )}
      {...props}
    >
      {loading ? (
        <span className={styles.spinner} />
      ) : (
        icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />
      )}
      {children}
    </button>
  )
}
