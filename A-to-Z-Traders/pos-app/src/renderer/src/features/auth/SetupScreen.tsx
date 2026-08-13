import type { FormEvent, JSX } from 'react'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Field, Input, Select } from '../../components/ui/Field'
import { Callout } from '../../components/ui/Feedback'
import { useToast } from '../../components/ui/Toast'
import { fieldErrors, errorMessage } from '../../lib/api'
import { useAuth } from '../../app/AuthContext'
import { AuthScreen } from './AuthScreen'
import { CUSTOM_QUESTION, PRESET_QUESTIONS } from './authQuestions'

/**
 * First run: the owner sets the one admin password and a recovery question.
 * Shown by `AuthGate` while `status.configured` is false; on success the gate
 * re-renders straight into the app, because setup also unlocks the session.
 */
export function SetupScreen(): JSX.Element {
  const { setup } = useAuth()
  const toast = useToast()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [questionChoice, setQuestionChoice] = useState<string>(PRESET_QUESTIONS[0])
  const [customQuestion, setCustomQuestion] = useState('')
  const [answer, setAnswer] = useState('')

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const question = questionChoice === CUSTOM_QUESTION ? customQuestion : questionChoice

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()

    const next: Record<string, string> = {}
    if (password.length < 8) next.password = 'Use at least 8 characters.'
    if (confirm !== password) next.confirm = 'The passwords do not match.'
    if (question.trim() === '') next.securityQuestion = 'Choose or write a security question.'
    if (answer.trim() === '') next.securityAnswer = 'Enter an answer.'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setBusy(true)
    setFormError(null)
    try {
      await setup({ password, securityQuestion: question.trim(), securityAnswer: answer })
      toast.success('Admin password set', 'The app is now protected.')
    } catch (error) {
      setErrors(fieldErrors(error))
      setFormError(errorMessage(error))
      setBusy(false)
    }
  }

  return (
    <AuthScreen
      title="Protect this app"
      subtitle="Set an admin password. You will enter it each time the app starts."
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        {formError && <Callout tone="bad">{formError}</Callout>}

        <Field
          label="Admin password"
          error={errors.password}
          hint="At least 8 characters."
          required
        >
          <Input
            type="password"
            autoFocus
            autoComplete="new-password"
            value={password}
            invalid={Boolean(errors.password)}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        <Field label="Confirm password" error={errors.confirm} required>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            invalid={Boolean(errors.confirm)}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </Field>

        <Field
          label="Security question"
          error={errors.securityQuestion}
          hint="Used to reset the password if it is ever forgotten."
          required
        >
          <Select
            value={questionChoice}
            invalid={Boolean(errors.securityQuestion)}
            onChange={(event) => setQuestionChoice(event.target.value)}
          >
            {PRESET_QUESTIONS.map((preset) => (
              <option key={preset} value={preset}>
                {preset}
              </option>
            ))}
            <option value={CUSTOM_QUESTION}>Write my own question…</option>
          </Select>
        </Field>

        {questionChoice === CUSTOM_QUESTION && (
          <Field label="Your question" error={errors.securityQuestion} required>
            <Input
              value={customQuestion}
              placeholder="Type a question only you can answer"
              invalid={Boolean(errors.securityQuestion)}
              onChange={(event) => setCustomQuestion(event.target.value)}
            />
          </Field>
        )}

        <Field label="Answer" error={errors.securityAnswer} required>
          <Input
            autoComplete="off"
            value={answer}
            invalid={Boolean(errors.securityAnswer)}
            onChange={(event) => setAnswer(event.target.value)}
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
          Set password &amp; continue
        </Button>
      </form>
    </AuthScreen>
  )
}
