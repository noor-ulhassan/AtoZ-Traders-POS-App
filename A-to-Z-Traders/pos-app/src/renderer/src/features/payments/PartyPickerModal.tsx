import type { JSX } from 'react'
import { useState } from 'react'
import type { Customer, PartyType } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Combobox } from '../../components/ui/Combobox'
import { Field } from '../../components/ui/Field'
import { Modal } from '../../components/ui/Modal'
import { usePartySearch } from '../../hooks/usePartySearch'

interface PartyPickerModalProps {
  /** Null closes the dialog. */
  partyType: PartyType | null
  onClose: () => void
  onPick: (party: Customer) => void
}

/** Step one of recording a payment: who is it with. */
export function PartyPickerModal({
  partyType,
  onClose,
  onPick
}: PartyPickerModalProps): JSX.Element | null {
  const [query, setQuery] = useState('')
  const search = usePartySearch(partyType ?? 'customer', query)

  if (partyType === null) return null

  return (
    <Modal
      open
      onClose={onClose}
      title={partyType === 'customer' ? 'Receive payment' : 'Pay supplier'}
      description={
        partyType === 'customer'
          ? 'Choose the customer paying you'
          : 'Choose the supplier you are paying'
      }
      size="sm"
      footer={<Button onClick={onClose}>Cancel</Button>}
    >
      <Field label={partyType === 'customer' ? 'Customer' : 'Supplier'}>
        <Combobox
          query={query}
          onQueryChange={setQuery}
          options={search.options}
          onSelect={(option) => onPick(option.value)}
          placeholder="Search by name or phone"
          noResults="No match"
          autoFocus
        />
      </Field>
    </Modal>
  )
}
