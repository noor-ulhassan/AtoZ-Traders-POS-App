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
 * Password recovery via the security question set at first run. A correct
 * answer lets the owner choose a new password and unlocks in the same step
 * (`resetPassword` in the service). The prompt comes from `status`, so the
 * plain answer is only ever sent one way — never read back.
 */
export function ForgotPasswordModal({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): JSX.Element {
  const { status, resetPassword } = useAuth()
  const toast = useToast()

  const [answer, setAnswer] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function reset(): void {
    setAnswer('')
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
    if (answer.trim() === '') next.securityAnswer = 'Enter your answer.'
    if (password.length < 8) next.newPassword = 'Use at least 8 characters.'
    if (confirm !== password) next.confirm = 'The passwords do not match.'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setBusy(true)
    setFormError(null)
    try {
      await resetPassword({ securityAnswer: answer, newPassword: password })
      toast.success('Password reset', 'You are signed in with your new password.')
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
      title="Reset your password"
      description="Answer your security question to set a new password."
      size="sm"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={onSubmit}>
            Reset password
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        {formError && <Callout tone="bad">{formError}</Callout>}

        <Field
          label={status.securityQuestion ?? 'Security question'}
          error={errors.securityAnswer}
          required
        >
          <Input
            autoFocus
            autoComplete="off"
            value={answer}
            invalid={Boolean(errors.securityAnswer)}
            onChange={(event) => setAnswer(event.target.value)}
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

        {/* A hidden submit keeps Enter working while the visible action is in the footer. */}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}
