import type { JSX } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SaleItem, SaleRevision } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Badge, Callout } from '../../components/ui/Feedback'
import { Column, DataTable } from '../../components/ui/DataTable'
import { Modal } from '../../components/ui/Modal'
import { SummaryList } from '../../components/ui/SummaryList'
import { useConfirm } from '../../components/ui/Confirm'
import { useMutation } from '../../hooks/useMutation'
import { useQuery } from '../../hooks/useQuery'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useAuth } from '../../app/AuthContext'
import { useCurrency } from '../../app/SettingsContext'
import { ReceiptModal } from '../billing/ReceiptModal'
import { SettleBillModal } from './SettleBillModal'

interface SaleDetailModalProps {
  saleId: number | null
  onClose: () => void
  /** Called after the bill was settled, edited or cancelled, so the list refetches. */
  onChanged?: () => void
}

const REVISION_LABEL: Record<SaleRevision['action'], string> = {
  settle: 'Payment recorded',
  edit: 'Bill edited',
  void: 'Bill cancelled'
}

/** A saved bill, with the profit it actually made at the cost captured then. */
export function SaleDetailModal({
  saleId,
  onClose,
  onChanged
}: SaleDetailModalProps): JSX.Element | null {
  const currency = useCurrency()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const isAdmin = useAuth().role === 'admin'

  const [showReceipt, setShowReceipt] = useState(false)
  const [settling, setSettling] = useState(false)

  const sale = useQuery(
    () => (saleId === null ? Promise.resolve(null) : unwrap(api.sales.get(saleId))),
    [saleId]
  )

  const receipt = useQuery(
    () =>
      saleId === null || !showReceipt ? Promise.resolve(null) : unwrap(api.sales.receipt(saleId)),
    [saleId, showReceipt]
  )

  const history = useQuery(
    () => (saleId === null ? Promise.resolve([]) : unwrap(api.sales.revisions(saleId))),
    [saleId, sale.data]
  )

  const print = useMutation(async (id: number) => unwrap(api.printing.receipt(id)), {
    successMessage: 'Sent to printer',
    errorTitle: 'Could not print'
  })

  /**
   * Cancelling is destructive in the way that matters — it puts goods back on
   * the shelf and takes money off a khata — so it asks first, in the words of
   * what will actually happen rather than "are you sure?".
   */
  const cancelBill = useMutation(
    async (id: number) => {
      const data = sale.data
      const ok = await confirm({
        title: `Cancel invoice ${data?.invoiceNo ?? ''}?`,
        message:
          'The goods go back into stock, the bill is emptied and anything it put on the ' +
          "customer's khata is reversed. The invoice number is kept and never used again.",
        confirmLabel: 'Cancel this bill',
        destructive: true
      })
      if (!ok) return null
      return unwrap(api.sales.void({ id }))
    },
    {
      errorTitle: 'Could not cancel the bill',
      onSuccess: (result) => {
        if (!result) return
        void sale.refetch()
        onChanged?.()
      }
    }
  )

  if (saleId === null) return null
  const data = sale.data
  const isVoid = data?.voidedAt != null

  const columns: Column<SaleItem>[] = [
    { key: 'product', header: 'Item', render: (item) => item.productName },
    {
      key: 'qty',
      header: 'Qty',
      numeric: true,
      width: '120px',
      render: (item) => `${format.quantity(item.qty)} ${item.unitName}`
    },
    {
      key: 'rate',
      header: `Rate (${currency})`,
      numeric: true,
      width: '120px',
      render: (item) => format.money(item.rate)
    },
    {
      key: 'discount',
      header: `Less (${currency})`,
      numeric: true,
      width: '110px',
      render: (item) => (item.lineDiscount ? format.money(item.lineDiscount) : '—')
    },
    {
      key: 'amount',
      header: `Amount (${currency})`,
      numeric: true,
      width: '130px',
      render: (item) => format.money(item.amount)
    },
    {
      key: 'profit',
      header: `Profit (${currency})`,
      numeric: true,
      width: '130px',
      render: (item) => format.money(item.amount - item.costPrice * item.baseQty)
    }
  ]

  const profit = (data?.items ?? []).reduce(
    (sum, item) => sum + item.amount - item.costPrice * item.baseQty,
    0
  )

  const revisions = history.data ?? []

  return (
    <>
      <Modal
        open={!showReceipt && !settling}
        onClose={onClose}
        title={data ? `Invoice ${data.invoiceNo}` : 'Bill'}
        description={
          data
            ? `${format.date(data.date)} · ${data.customerName ?? 'Walk-in customer'}`
            : undefined
        }
        size="lg"
        footerStart={
          data && (
            <Badge
              tone={
                isVoid
                  ? 'bad'
                  : data.paymentType === 'cash'
                    ? 'good'
                    : data.paymentType === 'partial'
                      ? 'warn'
                      : 'bad'
              }
            >
              {isVoid
                ? 'Cancelled'
                : data.paymentType === 'cash'
                  ? 'Paid in full'
                  : data.paymentType === 'partial'
                    ? 'Part paid'
                    : 'On khata'}
            </Badge>
          )
        }
        footer={
          <>
            <Button onClick={onClose}>Close</Button>
            <Button icon="bill" onClick={() => setShowReceipt(true)}>
              View receipt
            </Button>
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
        {data && (
          <>
            {isVoid && (
              <div className="mb-4">
                <Callout tone="bad" title="This bill was cancelled">
                  It was cancelled on {format.dateTime(data.voidedAt)}. The goods went back into
                  stock and nothing on it is owed. Its invoice number is kept and will never be
                  issued again.
                </Callout>
              </div>
            )}

            {!isVoid && (
              <div className="mb-4 flex flex-wrap gap-2">
                <Button
                  icon="payments"
                  onClick={() => setSettling(true)}
                  title="Record what was actually paid on this bill"
                >
                  Settle bill
                </Button>
                {isAdmin && (
                  <Button
                    icon="edit"
                    onClick={() => navigate(`/billing/${saleId}/edit`)}
                    title="Change the goods, rates or customer on this bill"
                  >
                    Edit bill
                  </Button>
                )}
                <Button
                  icon="restore"
                  onClick={() => navigate('/billing', { state: { repeatSaleId: saleId } })}
                  title="Start a new bill with the same items"
                >
                  Repeat this order
                </Button>
                <div className="flex-1" />
                {isAdmin && (
                  <Button
                    icon="trash"
                    loading={cancelBill.isPending}
                    onClick={() => void cancelBill.run(saleId)}
                  >
                    Cancel bill
                  </Button>
                )}
              </div>
            )}

            <DataTable
              columns={columns}
              rows={data.items}
              rowKey={(item) => item.id}
              compact
              isLoading={sale.isLoading}
              empty={{
                title: 'This bill has no items',
                description: 'It was cancelled, so its lines were reversed.'
              }}
            />

            <SummaryList
              rows={[
                { label: 'Subtotal', value: format.money(data.subtotal) },
                ...(data.discount > 0
                  ? [{ label: 'Bill discount', value: `− ${format.money(data.discount)}` }]
                  : []),
                ...(data.tax > 0 ? [{ label: 'Tax', value: format.money(data.tax) }] : []),
                { label: 'Total', value: format.money(data.total), emphasis: true },
                { label: 'Paid', value: format.money(data.paidAmount) },
                {
                  label: 'On khata',
                  value: format.money(Math.max(0, data.total - data.paidAmount)),
                  tone: data.total - data.paidAmount > 0.005 ? 'bad' : undefined
                },
                {
                  label: 'Profit on this bill',
                  value: format.money(profit - data.discount),
                  tone: profit - data.discount < 0 ? 'bad' : 'good'
                }
              ]}
            />

            {data.notes && <p className="mt-4 text-sm text-ink-muted">{data.notes}</p>}

            {revisions.length > 0 && <RevisionHistory revisions={revisions} currency={currency} />}
          </>
        )}
      </Modal>

      {settling && data && (
        <SettleBillModal
          sale={data}
          onClose={() => setSettling(false)}
          onSettled={() => {
            setSettling(false)
            void sale.refetch()
            onChanged?.()
          }}
        />
      )}

      {showReceipt && (
        <ReceiptModal
          receipt={receipt.data}
          saleId={saleId}
          onClose={() => setShowReceipt(false)}
        />
      )}
    </>
  )
}

/**
 * What this bill used to say.
 *
 * Newest first, and each row states the figures as they stood *before* that
 * change — which is the question an owner actually asks ("what was it before I
 * touched it?"). Without this an edit would be invisible after the fact, and a
 * bill that quietly changed is worse than one that cannot be changed at all.
 */
function RevisionHistory({
  revisions,
  currency
}: {
  revisions: SaleRevision[]
  currency: string
}): JSX.Element {
  return (
    <div className="mt-6 border-t border-line pt-4">
      <h3 className="text-micro font-semibold tracking-[0.07em] text-ink-subtle uppercase">
        History
      </h3>
      <ul className="mt-2 flex flex-col gap-2">
        {revisions.map((revision) => (
          <li
            key={revision.id}
            className="rounded-md border border-line bg-surface-sunken px-3 py-2 text-caption"
          >
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold">{REVISION_LABEL[revision.action]}</span>
              <span className="text-ink-muted">
                {format.dateTime(revision.createdAt)} · {revision.changedBy}
              </span>
            </div>
            <div className="mt-1 text-ink-muted">
              Was: {revision.snapshot.items.length}{' '}
              {format.pluralize(revision.snapshot.items.length, 'item')} · {currency}{' '}
              {format.money(revision.snapshot.total)} total,{' '}
              {format.money(revision.snapshot.paidAmount)} paid
            </div>
            {revision.reason && <div className="mt-1 italic">“{revision.reason}”</div>}
          </li>
        ))}
      </ul>
    </div>
  )
}
