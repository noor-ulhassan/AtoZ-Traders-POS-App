import type { FormEvent, JSX } from 'react'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Field, Input } from '../../components/ui/Field'
import { Callout } from '../../components/ui/Feedback'
import { errorMessage } from '../../lib/api'
import { useAuth } from '../../app/AuthContext'
import { AuthScreen } from './AuthScreen'
import { ForgotPasswordModal } from './ForgotPasswordModal'

/**
 * The gate shown on every launch once an admin password exists. Unlocking
 * flips the main-process session, so a correct password re-renders `AuthGate`
 * straight into the app. The recovery flow lives behind "Forgot password?".
 */
export function LockScreen(): JSX.Element {
  const { status, login } = useAuth()

  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [forgotOpen, setForgotOpen] = useState(false)

  const lockedUntil = status.locked ? status.lockedUntil?.slice(11, 16) : undefined

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(password)
      // On success the gate unmounts this screen; nothing else to do.
    } catch (caught) {
      setError(errorMessage(caught))
      setPassword('')
      setBusy(false)
    }
  }

  return (
    <>
      <AuthScreen
        title={status.securityQuestion ? 'Welcome back' : 'App locked'}
        subtitle="Enter your admin password to continue."
        footer={
          <button
            type="button"
            className="text-accent hover:underline"
            onClick={() => setForgotOpen(true)}
          >
            Forgot password?
          </button>
        }
      >
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          {error && <Callout tone="bad">{error}</Callout>}
          {lockedUntil && (
            <Callout tone="warn" title="Temporarily locked">
              Too many attempts. Try again after {lockedUntil}.
            </Callout>
          )}

          <Field label="Admin password">
            <Input
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              disabled={status.locked}
              invalid={Boolean(error)}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            loading={busy}
            disabled={status.locked || password.length === 0}
          >
            Unlock
          </Button>
        </form>
      </AuthScreen>

      <ForgotPasswordModal open={forgotOpen} onClose={() => setForgotOpen(false)} />
    </>
  )
}
