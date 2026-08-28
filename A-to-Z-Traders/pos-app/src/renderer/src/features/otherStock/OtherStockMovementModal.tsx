import type { JSX } from 'react'
import { useState } from 'react'
import type { OtherStockRow } from '@shared/types'
import { today } from '@shared/date'
import { Button } from '../../components/ui/Button'
import { Field, Input, NumberInput, Textarea } from '../../components/ui/Field'
import { Callout } from '../../components/ui/Feedback'
import { Modal } from '../../components/ui/Modal'
import { SummaryList } from '../../components/ui/SummaryList'
import { useMutation } from '../../hooks/useMutation'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'

interface OtherStockMovementModalProps {
  product: OtherStockRow
  /** 'in' = goods arriving from their owner, 'out' = unsold goods going back. */
  direction: 'in' | 'out'
  onClose: () => void
  onSaved: () => void
}

/**
 * Recording consignment goods arriving or going back.
 *
 * Neither is a purchase and neither is a sale: no money moves, no supplier
 * balance is touched and no cost is set. All that changes is the count on the
 * shelf and the ledger row explaining it — which is exactly what the client
 * asked for when he said he wanted the record without the calculations.
 */
export function OtherStockMovementModal({
  product,
  direction,
  onClose,
  onSaved
}: OtherStockMovementModalProps): JSX.Element {
  const isReceiving = direction === 'in'
  const [qty, setQty] = useState(0)
  const [date, setDate] = useState(today())
  const [notes, setNotes] = useState('')

  const save = useMutation(
    async () => {
      const input = { productId: product.productId, qty, date, notes: notes || null }
      return isReceiving
        ? unwrap(api.otherStock.receive(input))
        : unwrap(api.otherStock.sendBack(input))
    },
    {
      successMessage: isReceiving ? 'Goods received' : 'Goods sent back',
      errorTitle: isReceiving ? 'Could not record the delivery' : 'Could not record the return',
      onSuccess: () => {
        onSaved()
        onClose()
      }
    }
  )

  const resulting = isReceiving ? product.onHand + qty : product.onHand - qty
  const tooMany = !isReceiving && qty > product.onHand

  return (
    <Modal
      open
      onClose={onClose}
      title={isReceiving ? `Receive ${product.productName}` : `Send back ${product.productName}`}
      description={
        isReceiving
          ? `Goods arriving from ${product.ownerName}. No money changes hands.`
          : `Unsold goods going back to ${product.ownerName}.`
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={qty <= 0 || tooMany}
            onClick={() => void save.run()}
          >
            {isReceiving ? 'Record delivery' : 'Record return'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label={isReceiving ? 'How many came in' : 'How many are going back'}
          required
          hint={`In ${product.baseUnit}`}
        >
          <NumberInput value={qty} onValueChange={setQty} size="lg" autoFocus />
        </Field>

        <Field label="Date">
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>

        <Field label="Note" hint="Optional — a delivery note number, say">
          <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>

        <SummaryList
          rows={[
            { label: 'On the shelf now', value: format.qtyWithUnit(product.onHand, product.baseUnit) },
            {
              label: 'After this',
              value: format.qtyWithUnit(Math.max(0, resulting), product.baseUnit),
              emphasis: true
            }
          ]}
        />

        {tooMany && (
          <Callout tone="bad" title="More than is on the shelf">
            Only {format.qtyWithUnit(product.onHand, product.baseUnit)} of {product.productName} are
            here. Check the count before recording this.
          </Callout>
        )}
      </div>
    </Modal>
  )
}
