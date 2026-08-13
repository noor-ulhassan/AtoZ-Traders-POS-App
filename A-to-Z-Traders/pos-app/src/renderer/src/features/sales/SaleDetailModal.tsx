import type { JSX } from 'react'
import { useState } from 'react'
import type { SaleItem } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Feedback'
import { Column, DataTable } from '../../components/ui/DataTable'
import { Modal } from '../../components/ui/Modal'
import { SummaryList } from '../../components/ui/SummaryList'
import { useMutation } from '../../hooks/useMutation'
import { useQuery } from '../../hooks/useQuery'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useCurrency } from '../../app/SettingsContext'
import { ReceiptModal } from '../billing/ReceiptModal'

interface SaleDetailModalProps {
  saleId: number | null
  onClose: () => void
}

/** A saved bill, with the profit it actually made at the cost captured then. */
export function SaleDetailModal({ saleId, onClose }: SaleDetailModalProps): JSX.Element | null {
  const currency = useCurrency()
  const [showReceipt, setShowReceipt] = useState(false)

  const sale = useQuery(
    () => (saleId === null ? Promise.resolve(null) : unwrap(api.sales.get(saleId))),
    [saleId]
  )

  const receipt = useQuery(
    () =>
      saleId === null || !showReceipt ? Promise.resolve(null) : unwrap(api.sales.receipt(saleId)),
    [saleId, showReceipt]
  )

  const print = useMutation(async (id: number) => unwrap(api.printing.receipt(id)), {
    successMessage: 'Sent to printer',
    errorTitle: 'Could not print'
  })

  if (saleId === null) return null
  const data = sale.data

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

  return (
    <>
      <Modal
        open={!showReceipt}
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
                data.paymentType === 'cash'
                  ? 'good'
                  : data.paymentType === 'partial'
                    ? 'warn'
                    : 'bad'
              }
            >
              {data.paymentType === 'cash'
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
            <DataTable
              columns={columns}
              rows={data.items}
              rowKey={(item) => item.id}
              compact
              isLoading={sale.isLoading}
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
          </>
        )}
      </Modal>

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
