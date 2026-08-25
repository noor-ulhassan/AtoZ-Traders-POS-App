import type { FormEvent, JSX } from 'react'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Field, Input } from '../../components/ui/Field'
import { Callout } from '../../components/ui/Feedback'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { errorMessage } from '../../lib/api'
import { useAuth } from '../../app/AuthContext'
import { AuthScreen } from './AuthScreen'
import { ForgotPasswordModal } from './ForgotPasswordModal'

type Mode = 'owner' | 'staff'

/**
 * The gate shown on every launch once an admin password exists. Unlocking flips
 * the main-process session, so a correct sign-in re-renders `AuthGate` straight
 * into the app. Two doors share the screen: the owner (admin password) and
 * staff (username + PIN). The owner's flow is unchanged from before roles
 * existed; the recovery link stays under the owner door.
 */
export function LockScreen(): JSX.Element {
  const { status, login, staffLogin } = useAuth()

  const [mode, setMode] = useState<Mode>('owner')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [forgotOpen, setForgotOpen] = useState(false)

  const lockedUntil = status.locked ? status.lockedUntil?.slice(11, 16) : undefined

  const switchMode = (next: Mode): void => {
    setMode(next)
    setError(null)
    setPassword('')
    setPin('')
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'owner') {
        await login(password)
      } else {
        await staffLogin(username.trim(), pin)
      }
      // On success the gate unmounts this screen; nothing else to do.
    } catch (caught) {
      setError(errorMessage(caught))
      setPassword('')
      setPin('')
      setBusy(false)
    }
  }

  const canSubmit =
    mode === 'owner' ? password.length > 0 && !status.locked : username.trim().length > 0 && pin.length > 0

  return (
    <>
      <AuthScreen
        title={status.securityQuestion ? 'Welcome back' : 'App locked'}
        subtitle="Sign in to continue."
        footer={
          mode === 'owner' ? (
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => setForgotOpen(true)}
            >
              Forgot password?
            </button>
          ) : undefined
        }
      >
        <div className="mb-4">
          <SegmentedControl
            label="Sign in as"
            fullWidth
            value={mode}
            onChange={switchMode}
            options={[
              { value: 'owner', label: 'Owner' },
              { value: 'staff', label: 'Staff' }
            ]}
          />
        </div>

        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          {error && <Callout tone="bad">{error}</Callout>}
          {mode === 'owner' && lockedUntil && (
            <Callout tone="warn" title="Temporarily locked">
              Too many attempts. Try again after {lockedUntil}.
            </Callout>
          )}

          {mode === 'owner' ? (
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
          ) : (
            <>
              <Field label="Username">
                <Input
                  autoFocus
                  autoComplete="username"
                  value={username}
                  invalid={Boolean(error)}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </Field>
              <Field label="4-digit PIN">
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  autoComplete="off"
                  value={pin}
                  invalid={Boolean(error)}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
                />
              </Field>
            </>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            loading={busy}
            disabled={!canSubmit}
          >
            {mode === 'owner' ? 'Unlock' : 'Sign in'}
          </Button>
        </form>
      </AuthScreen>

      <ForgotPasswordModal open={forgotOpen} onClose={() => setForgotOpen(false)} />
    </>
  )
}
