import type { JSX, ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type {
  AuthChangePasswordInput,
  AuthResetInput,
  AuthSetupInput,
  AuthStatus,
  UserRole
} from '@shared/types'
import { api, errorMessage, unwrap } from '../lib/api'

interface AuthContextValue {
  status: AuthStatus
  /** The signed-in role, or null when locked. Convenience over `status.role`. */
  role: UserRole | null
  /** Re-read the gate state from the main process. */
  refresh: () => Promise<void>
  setup: (input: AuthSetupInput) => Promise<void>
  login: (password: string) => Promise<void>
  staffLogin: (username: string, pin: string) => Promise<void>
  lock: () => Promise<void>
  changePassword: (input: AuthChangePasswordInput) => Promise<void>
  resetPassword: (input: AuthResetInput) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const UNKNOWN: AuthStatus = { configured: false, unlocked: false, locked: false }

/**
 * The admin gate, mirrored into the renderer.
 *
 * This provider sits *outside* `SettingsProvider` in `App.tsx`: every business
 * channel (settings included) is blocked by the main process until the session
 * is unlocked, so nothing that reads business data may mount until `status`
 * says `unlocked`. Each action returns the fresh `AuthStatus` from main and we
 * store it, so unlocking re-renders the gate straight into the app.
 */
export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<AuthStatus>(UNKNOWN)
  const [isReady, setIsReady] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await unwrap(api.auth.status()))
      setFailure(null)
    } catch (error) {
      setFailure(errorMessage(error))
    } finally {
      setIsReady(true)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  const setup = useCallback(async (input: AuthSetupInput) => {
    setStatus(await unwrap(api.auth.setup(input)))
  }, [])

  const login = useCallback(async (password: string) => {
    setStatus(await unwrap(api.auth.login({ password })))
  }, [])

  const staffLogin = useCallback(async (username: string, pin: string) => {
    setStatus(await unwrap(api.auth.staffLogin({ username, pin })))
  }, [])

  const lock = useCallback(async () => {
    setStatus(await unwrap(api.auth.lock()))
  }, [])

  const changePassword = useCallback(async (input: AuthChangePasswordInput) => {
    setStatus(await unwrap(api.auth.changePassword(input)))
  }, [])

  const resetPassword = useCallback(async (input: AuthResetInput) => {
    setStatus(await unwrap(api.auth.resetPassword(input)))
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      role: status.role ?? null,
      refresh,
      setup,
      login,
      staffLogin,
      lock,
      changePassword,
      resetPassword
    }),
    [status, refresh, setup, login, staffLogin, lock, changePassword, resetPassword]
  )

  // A local IPC read; the wait is a frame. Rendering the gate before the answer
  // arrives would flash the setup screen at an owner who already has an account.
  if (!isReady) return <></>

  if (failure) {
    return (
      <div role="alert" className="p-8 text-sm">
        <strong>The app could not check its lock state.</strong>
        <p className="mt-2 text-ink-muted">{failure}</p>
      </div>
    )
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>.')
  return context
}
