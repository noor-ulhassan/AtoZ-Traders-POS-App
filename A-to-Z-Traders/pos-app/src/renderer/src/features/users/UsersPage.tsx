import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import type { StaffUser } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Field, Input } from '../../components/ui/Field'
import { Badge, Callout } from '../../components/ui/Feedback'
import { Modal } from '../../components/ui/Modal'
import { Card, CardBody } from '../../components/ui/Surface'
import { Column, DataTable, PrimaryCell, RowActions } from '../../components/ui/DataTable'
import { PageBody, PageHeader } from '../../components/layout/PageHeader'
import { useConfirm } from '../../components/ui/Confirm'
import { useMutation } from '../../hooks/useMutation'
import { useQuery } from '../../hooks/useQuery'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'

/**
 * Staff & roles — the owner's screen for the people who work the counter.
 *
 * A staff member gets a username and a 4-digit PIN and signs in as a
 * "shopkeeper": billing, sales, sale returns, customer receipts, adding
 * customers and the dashboard. Everything else — purchases, stock, reports,
 * settings, this screen — stays with the owner. Access is enforced in the main
 * process, not here; this screen only manages the accounts.
 */
export function UsersPage(): JSX.Element {
  const users = useQuery(() => unwrap(api.users.list()), [])
  const [isAdding, setIsAdding] = useState(false)
  const [resetting, setResetting] = useState<StaffUser | null>(null)
  const confirm = useConfirm()

  const refresh = useCallback(() => users.refetch(), [users])

  const toggleActive = useMutation(
    async (user: StaffUser) =>
      unwrap(api.users.setActive({ id: user.id, isActive: !user.isActive })),
    { onSuccess: refresh, errorTitle: 'Could not update the account' }
  )

  const askToggle = async (user: StaffUser): Promise<void> => {
    const turningOff = user.isActive
    const ok = await confirm({
      title: turningOff ? `Turn off ${user.username}?` : `Turn on ${user.username}?`,
      message: turningOff
        ? 'They will not be able to sign in until you turn the account back on.'
        : 'They will be able to sign in again with their PIN.',
      confirmLabel: turningOff ? 'Turn off' : 'Turn on',
      destructive: turningOff
    })
    if (ok) void toggleActive.run(user)
  }

  const rows = users.data ?? []

  const columns: Column<StaffUser>[] = [
    {
      key: 'username',
      header: 'Username',
      render: (user) => <PrimaryCell title={user.username} subtitle="Shopkeeper" />
    },
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      render: (user) =>
        user.isActive ? <Badge tone="good">Active</Badge> : <Badge tone="neutral">Off</Badge>
    },
    {
      key: 'lastLogin',
      header: 'Last signed in',
      width: '180px',
      render: (user) => (
        <span style={{ color: 'var(--ink-muted)' }}>
          {user.lastLoginAt ? format.dateTime(user.lastLoginAt) : 'Never'}
        </span>
      )
    },
    {
      key: 'created',
      header: 'Added',
      width: '140px',
      render: (user) => (
        <span style={{ color: 'var(--ink-muted)' }}>{format.date(user.createdAt.slice(0, 10))}</span>
      )
    },
    {
      key: 'actions',
      header: '',
      width: '190px',
      render: (user) => (
        <RowActions>
          <Button
            size="sm"
            variant="ghost"
            icon="lock"
            title="Reset PIN"
            onClick={(event) => {
              event.stopPropagation()
              setResetting(user)
            }}
          >
            Reset PIN
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title={user.isActive ? 'Turn off' : 'Turn on'}
            onClick={(event) => {
              event.stopPropagation()
              void askToggle(user)
            }}
          >
            {user.isActive ? 'Turn off' : 'Turn on'}
          </Button>
        </RowActions>
      )
    }
  ]

  return (
    <>
      <PageHeader
        title="Staff & roles"
        subtitle={
          users.data ? `${format.pluralize(rows.length, 'staff account')}` : 'Loading'
        }
        actions={
          <Button variant="primary" icon="plus" onClick={() => setIsAdding(true)}>
            Add staff
          </Button>
        }
      />

      <PageBody>
        <Card>
          <CardBody flush>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(user) => user.id}
              isLoading={users.isLoading}
              error={users.error}
              onRetry={users.refetch}
              empty={{
                title: 'No staff accounts yet',
                description:
                  'Add a shopkeeper so counter staff can bill and take payments without the owner’s full access.',
                action: (
                  <Button variant="primary" icon="plus" onClick={() => setIsAdding(true)}>
                    Add staff
                  </Button>
                )
              }}
            />
          </CardBody>
        </Card>
      </PageBody>

      {isAdding && <StaffFormModal onClose={() => setIsAdding(false)} onSaved={refresh} />}
      {resetting && (
        <ResetPinModal user={resetting} onClose={() => setResetting(null)} onSaved={refresh} />
      )}
    </>
  )
}

/** Client-side PIN check, mirrored by the schema and service on the main side. */
function pinProblem(pin: string, confirmPin: string): string | null {
  if (!/^\d{4}$/.test(pin)) return 'The PIN must be exactly four digits.'
  if (pin !== confirmPin) return 'The two PINs do not match.'
  return null
}

function StaffFormModal({
  onClose,
  onSaved
}: {
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [touched, setTouched] = useState(false)

  const save = useMutation(async () => unwrap(api.users.create({ username: username.trim(), pin })), {
    successMessage: 'Staff account created',
    errorTitle: 'Could not create the account',
    onSuccess: () => {
      onSaved()
      onClose()
    }
  })

  const localPinError = touched ? pinProblem(pin, confirmPin) : null
  const canSave =
    username.trim().length >= 3 && pinProblem(pin, confirmPin) === null && !save.isPending

  const submit = (): void => {
    setTouched(true)
    if (canSave) void save.run()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add staff"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!canSave} onClick={submit}>
            Create account
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Callout tone="info">
          The shopkeeper signs in with this username and PIN. They can bill, take customer payments,
          handle sale returns and see the dashboard — nothing else.
        </Callout>

        <Field label="Username" required error={save.errors['username']}>
          <Input
            value={username}
            autoFocus
            autoComplete="off"
            placeholder="e.g. ali"
            onChange={(event) => setUsername(event.target.value)}
            invalid={Boolean(save.errors['username'])}
          />
        </Field>

        <Field label="4-digit PIN" required>
          <Input
            value={pin}
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
            placeholder="0000"
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
            invalid={Boolean(localPinError)}
          />
        </Field>

        <Field label="Confirm PIN" required error={localPinError ?? undefined}>
          <Input
            value={confirmPin}
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
            placeholder="0000"
            onBlur={() => setTouched(true)}
            onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, ''))}
            invalid={Boolean(localPinError)}
          />
        </Field>

        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}

function ResetPinModal({
  user,
  onClose,
  onSaved
}: {
  user: StaffUser
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [touched, setTouched] = useState(false)

  const save = useMutation(async () => unwrap(api.users.resetPin({ id: user.id, pin })), {
    successMessage: `PIN reset for ${user.username}`,
    errorTitle: 'Could not reset the PIN',
    onSuccess: () => {
      onSaved()
      onClose()
    }
  })

  const localPinError = touched ? pinProblem(pin, confirmPin) : null
  const canSave = pinProblem(pin, confirmPin) === null && !save.isPending

  const submit = (): void => {
    setTouched(true)
    if (canSave) void save.run()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Reset PIN — ${user.username}`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!canSave} onClick={submit}>
            Set new PIN
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Field label="New 4-digit PIN" required>
          <Input
            value={pin}
            autoFocus
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
            placeholder="0000"
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
            invalid={Boolean(localPinError)}
          />
        </Field>

        <Field label="Confirm PIN" required error={localPinError ?? undefined}>
          <Input
            value={confirmPin}
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
            placeholder="0000"
            onBlur={() => setTouched(true)}
            onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, ''))}
            invalid={Boolean(localPinError)}
          />
        </Field>

        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}
