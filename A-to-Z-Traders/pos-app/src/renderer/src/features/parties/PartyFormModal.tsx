import type { JSX } from 'react'
import { useState } from 'react'
import type { Customer, PartyType } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Field, Input, NumberInput, Textarea } from '../../components/ui/Field'
import { Callout } from '../../components/ui/Feedback'
import { Modal } from '../../components/ui/Modal'
import { FormGrid, GridCell } from '../../components/ui/Surface'
import { useMutation } from '../../hooks/useMutation'
import { api, unwrap } from '../../lib/api'
import { useCurrency } from '../../app/SettingsContext'

interface PartyFormModalProps {
  onClose: () => void
  onSaved: () => void
  partyType: PartyType
  /** Null means "create". */
  party: Customer | null
}

const COPY: Record<PartyType, { noun: string; openingHint: string; openingLabel: string }> = {
  customer: {
    noun: 'customer',
    openingLabel: 'Opening balance (already owed to you)',
    openingHint: 'What this customer owed you before you started using this app'
  },
  supplier: {
    noun: 'supplier',
    openingLabel: 'Opening balance (already owed to them)',
    openingHint: 'What you owed this supplier before you started using this app'
  }
}

export function PartyFormModal({
  onClose,
  onSaved,
  partyType,
  party
}: PartyFormModalProps): JSX.Element {
  const currency = useCurrency()
  const copy = COPY[partyType]
  const isEditing = party !== null

  // Rendered only while open, so props are the initial state and nothing has
  // to be reset between openings.
  const [name, setName] = useState(party?.name ?? '')
  const [phone, setPhone] = useState(party?.phone ?? '')
  const [address, setAddress] = useState(party?.address ?? '')
  const [openingBalance, setOpeningBalance] = useState(party?.openingBalance ?? 0)

  const save = useMutation(
    async () => {
      const input = { name, phone, address, openingBalance }
      const service = partyType === 'customer' ? api.customers : api.suppliers
      return isEditing ? unwrap(service.update(party.id, input)) : unwrap(service.add(input))
    },
    {
      successMessage: isEditing ? 'Details updated' : `${copy.noun} added`,
      onSuccess: () => {
        onSaved()
        onClose()
      }
    }
  )

  // The opening balance is the starting point every statement is calculated
  // from, so it stops being editable once there is history behind it.
  const openingIsLocked = isEditing && party.currentBalance !== party.openingBalance

  return (
    <Modal
      open
      onClose={onClose}
      title={isEditing ? `Edit ${party.name}` : `New ${copy.noun}`}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!name.trim()}
            onClick={() => void save.run()}
          >
            {isEditing ? 'Save changes' : `Add ${copy.noun}`}
          </Button>
        </>
      }
    >
      <FormGrid>
        <GridCell span={8}>
          <Field label="Name" required error={save.errors['input.name']}>
            <Input
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              invalid={Boolean(save.errors['input.name'])}
            />
          </Field>
        </GridCell>

        <GridCell span={4}>
          <Field label="Phone">
            <Input value={phone} onChange={(event) => setPhone(event.target.value)} />
          </Field>
        </GridCell>

        <GridCell span={12}>
          <Field label="Address">
            <Textarea
              rows={2}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </Field>
        </GridCell>

        <GridCell span={6}>
          <Field
            label={copy.openingLabel}
            hint={
              openingIsLocked ? 'Locked — there are transactions on this account' : copy.openingHint
            }
          >
            <NumberInput
              prefix={currency}
              value={openingBalance}
              onValueChange={setOpeningBalance}
              disabled={openingIsLocked}
            />
          </Field>
        </GridCell>

        {openingIsLocked && (
          <GridCell span={12}>
            <Callout tone="info">
              To correct the balance now, record a payment or a return instead — that keeps the
              statement adding up.
            </Callout>
          </GridCell>
        )}
      </FormGrid>
    </Modal>
  )
}
