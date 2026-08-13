import type { JSX } from 'react'
import type { PurchaseItem } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Column, DataTable } from '../../components/ui/DataTable'
import { Modal } from '../../components/ui/Modal'
import { useQuery } from '../../hooks/useQuery'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useCurrency } from '../../app/SettingsContext'
import { SummaryList } from '../../components/ui/SummaryList'

interface PurchaseDetailModalProps {
  purchaseId: number | null
  onClose: () => void
}

export function PurchaseDetailModal({
  purchaseId,
  onClose
}: PurchaseDetailModalProps): JSX.Element | null {
  const currency = useCurrency()

  const purchase = useQuery(
    () => (purchaseId === null ? Promise.resolve(null) : unwrap(api.purchases.get(purchaseId))),
    [purchaseId]
  )

  const data = purchase.data
  if (purchaseId === null) return null

  const columns: Column<PurchaseItem>[] = [
    { key: 'product', header: 'Item', render: (item) => item.productName },
    {
      key: 'qty',
      header: 'Qty',
      numeric: true,
      width: '120px',
      render: (item) => `${format.quantity(item.qty)} ${item.unitName}`
    },
    {
      key: 'base',
      header: 'Base qty',
      numeric: true,
      width: '110px',
      render: (item) => format.quantity(item.baseQty)
    },
    {
      key: 'cost',
      header: `Cost / base (${currency})`,
      numeric: true,
      width: '150px',
      render: (item) => format.money(item.costPrice)
    },
    {
      key: 'amount',
      header: `Amount (${currency})`,
      numeric: true,
      width: '140px',
      render: (item) => format.money(item.amount)
    }
  ]

  return (
    <Modal
      open
      onClose={onClose}
      title={data ? `Purchase from ${data.supplierName ?? 'unknown supplier'}` : 'Purchase'}
      description={
        data
          ? `${format.date(data.date)}${data.invoiceNo ? ` · Invoice ${data.invoiceNo}` : ''}`
          : undefined
      }
      size="lg"
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {data && (
        <>
          <DataTable
            columns={columns}
            rows={data.items}
            rowKey={(item) => item.id}
            compact
            isLoading={purchase.isLoading}
          />

          <SummaryList
            rows={[
              { label: 'Subtotal', value: format.money(data.subtotal) },
              ...(data.discount > 0
                ? [{ label: 'Discount', value: `− ${format.money(data.discount)}` }]
                : []),
              { label: 'Total', value: format.money(data.total), emphasis: true },
              { label: 'Paid', value: format.money(data.paidAmount) },
              {
                label: 'Owing',
                value: format.money(Math.max(0, data.total - data.paidAmount)),
                tone: data.total - data.paidAmount > 0.005 ? 'bad' : undefined
              }
            ]}
          />

          {data.notes && <p className="mt-4 text-sm text-ink-muted">{data.notes}</p>}
        </>
      )}
    </Modal>
  )
}
