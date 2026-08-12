import type { JSX } from 'react'
import { useState } from 'react'
import type { Customer, PartyType, PaymentMethod } from '@shared/types'
import { today } from '@shared/date'
import { money as round } from '@shared/money'
import { Button } from '../../components/ui/Button'
import { Field, Input, NumberInput, Select } from '../../components/ui/Field'
import { Callout } from '../../components/ui/Feedback'
import { Modal } from '../../components/ui/Modal'
import { FormGrid, GridCell } from '../../components/ui/Surface'
import { useMutation } from '../../hooks/useMutation'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useCurrency } from '../../app/SettingsContext'

interface PaymentModalProps {
  onClose: () => void
  onSaved: () => void
  partyType: PartyType
  party: Customer
}

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'online', label: 'Online / mobile' },
  { value: 'other', label: 'Other' }
]

/** Receiving money from a customer, or paying a supplier. */
export function PaymentModal({
  onClose,
  onSaved,
  partyType,
  party
}: PaymentModalProps): JSX.Element {
  const currency = useCurrency()
  // Pre-filled with the full outstanding amount: settling up completely is the
  // common case, and clearing a field is faster than typing a long number.
  const [amount, setAmount] = useState(party.currentBalance > 0 ? party.currentBalance : 0)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [date, setDate] = useState(today())
  const [notes, setNotes] = useState('')

  const save = useMutation(
    async () =>
      unwrap(
        api.payments.create({
          partyType,
          partyId: party.id,
          amount,
          method,
          date,
          notes: notes || null
        })
      ),
    {
      successMessage: partyType === 'customer' ? 'Payment received' : 'Payment made',
      onSuccess: () => {
        onSaved()
        onClose()
      }
    }
  )

  const remaining = round(party.currentBalance - amount)
  const isCustomer = partyType === 'customer'

  return (
    <Modal
      open
      onClose={onClose}
      title={isCustomer ? `Receive payment — ${party.name}` : `Pay supplier — ${party.name}`}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={amount <= 0}
            loading={save.isPending}
            onClick={() => void save.run()}
          >
            {isCustomer ? 'Record receipt' : 'Record payment'}
          </Button>
        </>
      }
    >
      <FormGrid>
        <GridCell span={12}>
          <Callout tone="info">
            {party.name}{' '}
            {party.currentBalance > 0
              ? `${isCustomer ? 'owes' : 'is owed'} ${currency} ${format.money(party.currentBalance)}.`
              : party.currentBalance < 0
                ? `holds an advance of ${currency} ${format.money(-party.currentBalance)}.`
                : 'is fully settled.'}
          </Callout>
        </GridCell>

        <GridCell span={6}>
          <Field label="Amount" required>
            <NumberInput
              prefix={currency}
              size="lg"
              value={amount}
              onValueChange={setAmount}
              autoFocus
            />
          </Field>
        </GridCell>

        <GridCell span={6}>
          <Field label="Method">
            <Select
              value={method}
              onChange={(event) => setMethod(event.target.value as PaymentMethod)}
            >
              {METHODS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </GridCell>

        <GridCell span={6}>
          <Field label="Date">
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
        </GridCell>

        <GridCell span={6}>
          <Field label="Reference / notes">
            <Input
              value={notes}
              placeholder="Cheque number, transfer reference…"
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
        </GridCell>

        {amount > 0 && (
          <GridCell span={12}>
            <Callout tone={remaining < 0 ? 'warn' : 'info'}>
              {remaining > 0.005
                ? `${currency} ${format.money(remaining)} will still be outstanding.`
                : remaining < -0.005
                  ? `This is ${currency} ${format.money(-remaining)} more than owed and will be kept as an advance.`
                  : 'This settles the account in full.'}
            </Callout>
          </GridCell>
        )}
      </FormGrid>
    </Modal>
  )
}
