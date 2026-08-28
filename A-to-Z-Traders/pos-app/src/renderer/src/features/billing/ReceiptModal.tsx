import clsx from 'clsx'
import type { JSX } from 'react'
import type { Receipt } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/icons/Icon'
import { Modal } from '../../components/ui/Modal'
import { useMutation } from '../../hooks/useMutation'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'

/* The receipt preview mirrors a printed roll: a narrow, centred column with
   monospaced figures, so what is on screen is what comes out of the printer.
   The repeated row and cell classes are named here rather than written inline
   at each use — a receipt is a stack of near-identical rows, and a single
   drifting copy is immediately visible. */

const RULE = 'my-3 border-t border-dashed border-line-strong'
const ROW = 'flex justify-between gap-3'
const LABEL = 'text-ink-muted'
const HEAD = 'pb-[2px] text-[10px] font-semibold tracking-[0.05em] text-ink-subtle uppercase'
const CELL = 'py-[2px] align-top'

interface ReceiptModalProps {
  receipt: Receipt | null
  saleId: number | null
  onClose: () => void
  /** True right after saving, which changes the banner and the close label. */
  justSaved?: boolean
}

/**
 * The receipt as it will print.
 *
 * Printing is still a stub (Guide §6.10) — the button sends the sale to the
 * main process, which renders the same structured receipt to the log. When a
 * real thermal printer is wired in, nothing on this screen changes.
 */
export function ReceiptModal({
  receipt,
  saleId,
  onClose,
  justSaved = false
}: ReceiptModalProps): JSX.Element | null {
  const print = useMutation(async (id: number) => unwrap(api.printing.receipt(id)), {
    successMessage: 'Sent to printer',
    errorTitle: 'Could not print'
  })

  if (!receipt || saleId === null) return null

  const amount = (value: number): string => format.money(value)

  return (
    <Modal
      open
      onClose={onClose}
      title={`Invoice ${receipt.invoiceNo}`}
      description={format.date(receipt.date)}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>{justSaved ? 'Start next bill' : 'Close'}</Button>
          <Button
            variant="primary"
            icon="print"
            loading={print.isPending}
            onClick={() => void print.run(saleId)}
          >
            Print
          </Button>
        </>
      }
    >
      {justSaved && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-good-border bg-good-weak px-4 py-3 font-ui text-sm font-medium text-good">
          <Icon name="check" size={16} />
          Bill saved. Stock and balances have been updated.
        </div>
      )}

      <div
        className="mx-auto w-full max-w-[380px] rounded-md border border-line bg-paper p-5 font-mono text-[12px] leading-[1.5] text-ink"
        data-selectable
      >
        <div className="mb-3 text-center">
          {receipt.business.name && (
            <div className="font-display text-md font-semibold tracking-[-0.01em]">
              {receipt.business.name}
            </div>
          )}
          {receipt.business.address && (
            <div className="text-[11px] text-ink-muted">{receipt.business.address}</div>
          )}
          {receipt.business.phone && (
            <div className="text-[11px] text-ink-muted">{receipt.business.phone}</div>
          )}
          {receipt.business.taxNumber && (
            <div className="text-[11px] text-ink-muted">NTN {receipt.business.taxNumber}</div>
          )}
        </div>

        <hr className={RULE} />

        <div className={ROW}>
          <span className={LABEL}>Invoice</span>
          <span>{receipt.invoiceNo}</span>
        </div>
        <div className={ROW}>
          <span className={LABEL}>Date</span>
          <span>{format.date(receipt.date)}</span>
        </div>
        <div className={ROW}>
          <span className={LABEL}>Customer</span>
          <span>{receipt.customer?.name ?? 'Walk-in'}</span>
        </div>

        <hr className={RULE} />

        <table className="my-2 w-full">
          <thead>
            <tr>
              <th className={clsx(HEAD, 'text-left')}>Item</th>
              <th className={clsx(HEAD, 'text-right')}>Qty</th>
              <th className={clsx(HEAD, 'text-right')}>Rate</th>
              <th className={clsx(HEAD, 'text-right')}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {receipt.lines.map((line, index) => (
              <tr key={index}>
                <td className={clsx(CELL, 'pr-2')}>
                  {/* The asterisk ties the line to the "of which other stock"
                      figure below, on paper as well as on screen. */}
                  {line.isOther ? `${line.name} *` : line.name}
                  <div className="text-[10px] text-ink-subtle">{line.unitName}</div>
                </td>
                <td className={clsx(CELL, 'text-right')}>{format.quantity(line.qty)}</td>
                <td className={clsx(CELL, 'text-right')}>{amount(line.rate)}</td>
                <td className={clsx(CELL, 'text-right')}>{amount(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <hr className={RULE} />

        <div className="flex flex-col gap-[2px]">
          <div className={ROW}>
            <span className={LABEL}>Subtotal</span>
            <span>{amount(receipt.totals.subtotal)}</span>
          </div>
          {receipt.totals.otherSubtotal > 0 && (
            <div className={ROW}>
              <span className={LABEL}>* of which other stock</span>
              <span>{amount(receipt.totals.otherSubtotal)}</span>
            </div>
          )}
          {receipt.totals.discount > 0 && (
            <div className={ROW}>
              <span className={LABEL}>Discount</span>
              <span>− {amount(receipt.totals.discount)}</span>
            </div>
          )}
          {receipt.totals.tax > 0 && (
            <div className={ROW}>
              <span className={LABEL}>{receipt.totals.taxLabel}</span>
              <span>{amount(receipt.totals.tax)}</span>
            </div>
          )}
          <div className={clsx(ROW, 'mt-2 border-t border-ink pt-2 text-[14px] font-bold')}>
            <span>TOTAL {receipt.currency}</span>
            <span>{amount(receipt.totals.total)}</span>
          </div>
          <div className={ROW}>
            <span className={LABEL}>Paid</span>
            <span>{amount(receipt.totals.paid)}</span>
          </div>
          {receipt.totals.balance > 0 && (
            <div className={ROW}>
              <span className={LABEL}>Balance due</span>
              <span>{amount(receipt.totals.balance)}</span>
            </div>
          )}
          {receipt.customer && receipt.customer.balanceAfter !== null && (
            <div className={ROW}>
              <span className={LABEL}>Total outstanding</span>
              <span>{amount(receipt.customer.balanceAfter)}</span>
            </div>
          )}
        </div>

        <div className="mt-3 text-center text-[11px] text-ink-muted">{receipt.amountInWords}</div>

        {receipt.footer && (
          <div className="mt-3 text-center text-[11px] text-ink-muted">{receipt.footer}</div>
        )}
      </div>
    </Modal>
  )
}
