import type { JSX, ReactNode } from 'react'
import { useAuth } from '../../app/AuthContext'
import { LockScreen } from './LockScreen'
import { SetupScreen } from './SetupScreen'

/**
 * Decides what the whole app shows: the first-run setup, the lock screen, or
 * the app itself. It gates *mounting* — children (and the SettingsProvider
 * inside them) never mount until the session is unlocked, so no business
 * channel is called against a locked main process.
 */
export function AuthGate({ children }: { children: ReactNode }): JSX.Element {
  const { status } = useAuth()

  if (!status.configured) return <SetupScreen />
  if (!status.unlocked) return <LockScreen />
  return <>{children}</>
}
