import type { JSX } from 'react'
import type { Receipt } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/icons/Icon'
import { Modal } from '../../components/ui/Modal'
import { useMutation } from '../../hooks/useMutation'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import styles from './ReceiptModal.module.css'

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
        <div className={styles.savedBanner}>
          <Icon name="check" size={16} />
          Bill saved. Stock and balances have been updated.
        </div>
      )}

      <div className={styles.paper} data-selectable>
        <div className={styles.business}>
          {receipt.business.name && (
            <div className={styles.businessName}>{receipt.business.name}</div>
          )}
          {receipt.business.address && (
            <div className={styles.businessLine}>{receipt.business.address}</div>
          )}
          {receipt.business.phone && (
            <div className={styles.businessLine}>{receipt.business.phone}</div>
          )}
          {receipt.business.taxNumber && (
            <div className={styles.businessLine}>NTN {receipt.business.taxNumber}</div>
          )}
        </div>

        <hr className={styles.rule} />

        <div className={styles.meta}>
          <span className={styles.metaLabel}>Invoice</span>
          <span>{receipt.invoiceNo}</span>
        </div>
        <div className={styles.meta}>
          <span className={styles.metaLabel}>Date</span>
          <span>{format.date(receipt.date)}</span>
        </div>
        <div className={styles.meta}>
          <span className={styles.metaLabel}>Customer</span>
          <span>{receipt.customer?.name ?? 'Walk-in'}</span>
        </div>

        <hr className={styles.rule} />

        <table className={styles.items}>
          <thead>
            <tr>
              <th>Item</th>
              <th className={styles.right}>Qty</th>
              <th className={styles.right}>Rate</th>
              <th className={styles.right}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {receipt.lines.map((line, index) => (
              <tr key={index}>
                <td className={styles.itemName}>
                  {line.name}
                  <div style={{ color: 'var(--ink-subtle)', fontSize: 10 }}>{line.unitName}</div>
                </td>
                <td className={styles.right}>{format.quantity(line.qty)}</td>
                <td className={styles.right}>{amount(line.rate)}</td>
                <td className={styles.right}>{amount(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <hr className={styles.rule} />

        <div className={styles.totals}>
          <div className={styles.totalRow}>
            <span className={styles.metaLabel}>Subtotal</span>
            <span>{amount(receipt.totals.subtotal)}</span>
          </div>
          {receipt.totals.discount > 0 && (
            <div className={styles.totalRow}>
              <span className={styles.metaLabel}>Discount</span>
              <span>− {amount(receipt.totals.discount)}</span>
            </div>
          )}
          {receipt.totals.tax > 0 && (
            <div className={styles.totalRow}>
              <span className={styles.metaLabel}>{receipt.totals.taxLabel}</span>
              <span>{amount(receipt.totals.tax)}</span>
            </div>
          )}
          <div className={`${styles.totalRow} ${styles.grand}`}>
            <span>TOTAL {receipt.currency}</span>
            <span>{amount(receipt.totals.total)}</span>
          </div>
          <div className={styles.totalRow}>
            <span className={styles.metaLabel}>Paid</span>
            <span>{amount(receipt.totals.paid)}</span>
          </div>
          {receipt.totals.balance > 0 && (
            <div className={styles.totalRow}>
              <span className={styles.metaLabel}>Balance due</span>
              <span>{amount(receipt.totals.balance)}</span>
            </div>
          )}
          {receipt.customer && receipt.customer.balanceAfter !== null && (
            <div className={styles.totalRow}>
              <span className={styles.metaLabel}>Total outstanding</span>
              <span>{amount(receipt.customer.balanceAfter)}</span>
            </div>
          )}
        </div>

        <div className={styles.words}>{receipt.amountInWords}</div>

        {receipt.footer && <div className={styles.footer}>{receipt.footer}</div>}
      </div>
    </Modal>
  )
}
