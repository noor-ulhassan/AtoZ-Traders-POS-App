import type { JSX } from 'react'
import { useState } from 'react'
import type { Product } from '@shared/types'
import { today } from '@shared/date'
import { qty as roundQty } from '@shared/money'
import { Button } from '../../components/ui/Button'
import { Field, Input, NumberInput, Select, Textarea } from '../../components/ui/Field'
import { Callout } from '../../components/ui/Feedback'
import { Modal } from '../../components/ui/Modal'
import { FormGrid, GridCell } from '../../components/ui/Surface'
import { useMutation } from '../../hooks/useMutation'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'

interface StockAdjustModalProps {
  onClose: () => void
  onSaved: () => void
  product: Product
}

type Direction = 'in' | 'out'

/** The reasons stock moves outside a sale or purchase, in a shop's own words. */
const REASONS: Record<Direction, string[]> = {
  in: ['Found extra stock while counting', 'Correction after stock count', 'Returned from display'],
  out: [
    'Damaged or expired',
    'Shortage found while counting',
    'Used in the shop',
    'Given as sample'
  ]
}

/**
 * Manual stock correction.
 *
 * Deliberately asks for direction and quantity separately rather than a signed
 * number: "-12" typed into a hurried form is far easier to get backwards than
 * choosing "Stock out" and typing 12.
 */
export function StockAdjustModal({
  onClose,
  onSaved,
  product
}: StockAdjustModalProps): JSX.Element {
  const [direction, setDirection] = useState<Direction>('in')
  const [amount, setAmount] = useState(0)
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(today())

  const adjust = useMutation(
    async (productId: number, changeQty: number, note: string) =>
      unwrap(api.stock.adjust({ productId, changeQty, date, notes: note })),
    {
      successMessage: 'Stock adjusted',
      onSuccess: () => {
        onSaved()
        onClose()
      }
    }
  )

  const change = direction === 'in' ? amount : -amount
  const resulting = roundQty(product.stockQty + change)
  const isInvalid = amount <= 0 || resulting < 0

  return (
    <Modal
      open
      onClose={onClose}
      title={`Adjust stock — ${product.name}`}
      description="Use this to correct the count. Sales and purchases already move stock on their own."
      size="md"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={isInvalid}
            loading={adjust.isPending}
            onClick={() =>
              void adjust.run(product.id, change, [reason, notes].filter(Boolean).join(' — '))
            }
          >
            Save adjustment
          </Button>
        </>
      }
    >
      <FormGrid>
        <GridCell span={12}>
          <Callout tone="info">
            {product.name} currently shows{' '}
            <strong>{format.qtyWithUnit(product.stockQty, product.baseUnit)}</strong> in stock.
          </Callout>
        </GridCell>

        <GridCell span={4}>
          <Field label="Direction" required>
            <Select
              value={direction}
              onChange={(event) => {
                setDirection(event.target.value as Direction)
                setReason('')
              }}
            >
              <option value="in">Stock in (add)</option>
              <option value="out">Stock out (remove)</option>
            </Select>
          </Field>
        </GridCell>

        <GridCell span={4}>
          <Field label={`Quantity in ${product.baseUnit}`} required>
            <NumberInput value={amount} onValueChange={setAmount} autoFocus />
          </Field>
        </GridCell>

        <GridCell span={4}>
          <Field label="Date">
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
        </GridCell>

        <GridCell span={12}>
          <Field label="Reason" required>
            <Select value={reason} onChange={(event) => setReason(event.target.value)}>
              <option value="">Choose a reason</option>
              {REASONS[direction].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
        </GridCell>

        <GridCell span={12}>
          <Field label="Notes" hint="Anything that will help explain this later">
            <Textarea
              value={notes}
              rows={2}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional"
            />
          </Field>
        </GridCell>

        {amount > 0 && (
          <GridCell span={12}>
            {resulting < 0 ? (
              <Callout tone="bad" title="Stock cannot go below zero">
                Removing {format.quantity(amount)} would leave{' '}
                {format.qtyWithUnit(resulting, product.baseUnit)}.
              </Callout>
            ) : (
              <Callout tone="info">
                After saving, stock will be{' '}
                <strong>{format.qtyWithUnit(resulting, product.baseUnit)}</strong>.
              </Callout>
            )}
          </GridCell>
        )}
      </FormGrid>
    </Modal>
  )
}
