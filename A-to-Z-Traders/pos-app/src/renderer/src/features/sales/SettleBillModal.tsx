import type { JSX } from 'react'
import { useState } from 'react'
import type { SaleWithItems } from '@shared/types'
import { money as round } from '@shared/money'
import { Button } from '../../components/ui/Button'
import { Field, Input, NumberInput } from '../../components/ui/Field'
import { Callout } from '../../components/ui/Feedback'
import { Modal } from '../../components/ui/Modal'
import { SummaryList } from '../../components/ui/SummaryList'
import { useMutation } from '../../hooks/useMutation'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useSettings } from '../../app/SettingsContext'

interface SettleBillModalProps {
  sale: SaleWithItems
  onClose: () => void
  onSettled: () => void
}

/**
 * Recording what a delivered bill was actually paid — Phase 4a, and the case
 * the client described: the bill goes out with the goods, and the money comes
 * back afterwards, in full, in part, or not at all.
 *
 * The one thing this screen has to get across is which of two routes to the
 * same money the owner is on. Settling a bill and recording a payment against
 * the khata both reduce what a customer owes; doing both for one delivery
 * counts the money twice. So the callout says it in those words, every time,
 * rather than assuming it was read once in a manual.
 */
export function SettleBillModal({ sale, onClose, onSettled }: SettleBillModalProps): JSX.Element {
  const { settings } = useSettings()
  const [paidAmount, setPaidAmount] = useState(sale.paidAmount)
  const [reason, setReason] = useState('')

  const due = round(sale.total - paidAmount)

  const settle = useMutation(
    async () =>
      unwrap(api.sales.settle({ id: sale.id, paidAmount, reason: reason.trim() || null })),
    {
      successMessage: 'Bill updated',
      errorTitle: 'Could not record the payment',
      onSuccess: onSettled
    }
  )

  return (
    <Modal
      open
      onClose={onClose}
      title={`Settle invoice ${sale.invoiceNo}`}
      description={`${format.date(sale.date)} · ${sale.customerName ?? 'Walk-in customer'}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="check"
            loading={settle.isPending}
            onClick={() => void settle.run()}
          >
            Record payment
          </Button>
        </>
      }
    >
      <Callout tone="info" title="This is the money that came with this bill">
        Settle the <strong>bill</strong> when the money arrives with the delivery. Record a{' '}
        <strong>payment</strong> when collecting against the customer&apos;s khata generally. Doing
        both for the same money counts it twice.
      </Callout>

      <div className="mt-4 flex flex-col gap-3">
        <Field label="Total received against this bill" hint="The full amount, not the extra">
          <NumberInput
            prefix={settings.currency}
            size="lg"
            value={paidAmount}
            onValueChange={setPaidAmount}
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setPaidAmount(sale.total)}>
            Paid in full
          </Button>
          <Button size="sm" onClick={() => setPaidAmount(round(sale.total / 2))}>
            Half
          </Button>
          <Button size="sm" onClick={() => setPaidAmount(0)}>
            Nothing yet
          </Button>
        </div>

        <Field label="Note" hint="Optional — kept with the bill's history">
          <Input
            value={reason}
            placeholder="e.g. Paid cash on delivery"
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>

        <SummaryList
          rows={[
            { label: 'Bill total', value: format.money(sale.total) },
            { label: 'Recorded before', value: format.money(sale.paidAmount) },
            {
              label: due > 0.005 ? 'Stays on khata' : 'Balance',
              value: format.money(Math.max(0, due)),
              tone: due > 0.005 ? 'bad' : undefined,
              emphasis: true
            }
          ]}
        />

        {due > 0.005 && sale.customerId == null && (
          <Callout tone="bad" title="A walk-in bill has no khata">
            There is no customer on this bill to carry a balance, so it has to be recorded as paid
            in full. Edit the bill if it should go on someone&apos;s account.
          </Callout>
        )}
      </div>
    </Modal>
  )
}
