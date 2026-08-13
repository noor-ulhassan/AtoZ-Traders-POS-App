import type { FormEvent, JSX } from 'react'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Field, Input } from '../../components/ui/Field'
import { Callout } from '../../components/ui/Feedback'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { errorMessage, fieldErrors } from '../../lib/api'
import { useAuth } from '../../app/AuthContext'

/**
 * Change the admin password from Settings. Requires the current password (the
 * service also insists the session is unlocked), so a walk-up at an already
 * open till cannot silently swap the credential.
 */
export function ChangePasswordModal({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): JSX.Element {
  const { changePassword } = useAuth()
  const toast = useToast()

  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function reset(): void {
    setCurrent('')
    setPassword('')
    setConfirm('')
    setErrors({})
    setFormError(null)
    setBusy(false)
  }

  function close(): void {
    reset()
    onClose()
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()

    const next: Record<string, string> = {}
    if (current === '') next.currentPassword = 'Enter your current password.'
    if (password.length < 8) next.newPassword = 'Use at least 8 characters.'
    if (confirm !== password) next.confirm = 'The passwords do not match.'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setBusy(true)
    setFormError(null)
    try {
      await changePassword({ currentPassword: current, newPassword: password })
      toast.success('Password changed')
      close()
    } catch (error) {
      setErrors(fieldErrors(error))
      setFormError(errorMessage(error))
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Change admin password"
      size="sm"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={onSubmit}>
            Change password
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        {formError && <Callout tone="bad">{formError}</Callout>}

        <Field label="Current password" error={errors.currentPassword} required>
          <Input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={current}
            invalid={Boolean(errors.currentPassword)}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </Field>

        <Field
          label="New password"
          error={errors.newPassword}
          hint="At least 8 characters."
          required
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            invalid={Boolean(errors.newPassword)}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        <Field label="Confirm new password" error={errors.confirm} required>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            invalid={Boolean(errors.confirm)}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </Field>

        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}
