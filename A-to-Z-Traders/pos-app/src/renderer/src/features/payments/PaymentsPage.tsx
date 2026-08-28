import type { JSX } from 'react'
import { useState } from 'react'
import type { Customer, DateRange, PartyType, Payment } from '@shared/types'
import { resolvePreset } from '@shared/date'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Field'
import { Badge, ToneValue } from '../../components/ui/Feedback'
import { Card, CardBody } from '../../components/ui/Surface'
import {
  Column,
  DataTable,
  PrimaryCell,
  RowActions,
  TablePager
} from '../../components/ui/DataTable'
import { DateRangeFilter } from '../../components/ui/DateRangeFilter'
import { StatGrid, StatTile } from '../../components/ui/StatTile'
import { FilterBar, FilterSpacer, PageBody, PageHeader } from '../../components/layout/PageHeader'
import { useConfirm } from '../../components/ui/Confirm'
import { useMutation } from '../../hooks/useMutation'
import { usePagination, useClampedPage } from '../../hooks/usePagination'
import { useQuery } from '../../hooks/useQuery'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useAuth } from '../../app/AuthContext'
import { useCurrency } from '../../app/SettingsContext'
import { PartyPickerModal } from './PartyPickerModal'
import { PaymentModal } from '../parties/PaymentModal'

type Filter = PartyType | 'all'

/** Money in and out, outside of bills themselves. */
export function PaymentsPage(): JSX.Element {
  const currency = useCurrency()
  const confirm = useConfirm()
  // A shopkeeper only handles customer receipts: no supplier payouts, no
  // removing a recorded payment, no export. The main process enforces the same.
  const isAdmin = useAuth().role === 'admin'

  const [range, setRange] = useState<DateRange>(() => resolvePreset('thisMonth'))
  const [partyType, setPartyType] = useState<Filter>('all')
  const [pickerFor, setPickerFor] = useState<PartyType | null>(null)
  const [payingParty, setPayingParty] = useState<{ party: Customer; type: PartyType } | null>(null)

  const effectivePartyType: Filter = isAdmin ? partyType : 'customer'

  const paging = usePagination([range.from, range.to, effectivePartyType])

  const payments = useQuery(
    () =>
      unwrap(
        api.payments.list({
          from: range.from,
          to: range.to,
          partyType: effectivePartyType,
          limit: paging.limit,
          offset: paging.offset
        })
      ),
    [range.from, range.to, effectivePartyType, paging.offset, paging.limit]
  )

  const exportCsv = useMutation(
    async () =>
      unwrap(api.exports.csv({ report: 'payments', filters: { from: range.from, to: range.to } })),
    { successMessage: 'Payments exported', errorTitle: 'Export failed' }
  )

  const remove = useMutation(async (id: number) => unwrap(api.payments.remove(id)), {
    successMessage: 'Payment removed and the balance restored',
    errorTitle: 'Could not remove the payment',
    onSuccess: () => payments.refetch()
  })

  const askRemove = async (payment: Payment): Promise<void> => {
    const ok = await confirm({
      title: 'Remove this payment?',
      message: `${currency} ${format.money(payment.amount)} ${
        payment.direction === 'in' ? 'received from' : 'paid to'
      } ${payment.partyName} will be reversed, and their balance put back.`,
      confirmLabel: 'Remove payment',
      destructive: true
    })
    if (ok) await remove.run(payment.id)
  }

  const rows = payments.data?.rows ?? []
  const matched = payments.data?.total ?? 0
  const received = payments.data?.totals.received ?? 0
  const paid = payments.data?.totals.paid ?? 0
  const page = useClampedPage(paging, matched)

  const columns: Column<Payment>[] = [
    { key: 'date', header: 'Date', width: '120px', render: (row) => format.date(row.date) },
    {
      key: 'party',
      header: 'Party',
      render: (row) => (
        <PrimaryCell
          title={row.partyName}
          subtitle={row.partyType === 'customer' ? 'Customer' : 'Supplier'}
        />
      )
    },
    {
      key: 'direction',
      header: 'Direction',
      width: '140px',
      render: (row) => (
        <Badge tone={row.direction === 'in' ? 'good' : 'warn'}>
          {row.direction === 'in' ? 'Received' : 'Paid out'}
        </Badge>
      )
    },
    {
      key: 'method',
      header: 'Method',
      width: '120px',
      render: (row) => <span style={{ color: 'var(--ink-muted)' }}>{row.method}</span>
    },
    {
      key: 'notes',
      header: 'Reference',
      render: (row) => <span style={{ color: 'var(--ink-muted)' }}>{row.notes ?? '—'}</span>
    },
    {
      key: 'amount',
      header: `Amount (${currency})`,
      numeric: true,
      width: '140px',
      render: (row) => (
        <ToneValue tone={row.direction === 'in' ? 'good' : 'bad'}>
          {row.direction === 'in' ? '+' : '−'}
          {format.money(row.amount)}
        </ToneValue>
      )
    },
    // Reversing a payment is a correction only the owner may make.
    ...(isAdmin
      ? [
          {
            key: 'actions',
            header: '',
            width: '60px',
            render: (row: Payment) => (
              <RowActions>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  aria-label="Remove payment"
                  title="Remove"
                  onClick={() => void askRemove(row)}
                />
              </RowActions>
            )
          }
        ]
      : [])
  ]

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Money received from customers and paid to suppliers"
        actions={
          <>
            {isAdmin && (
              <Button
                icon="download"
                loading={exportCsv.isPending}
                onClick={() => void exportCsv.run()}
              >
                Export
              </Button>
            )}
            {isAdmin && (
              <Button icon="plus" onClick={() => setPickerFor('supplier')}>
                Pay supplier
              </Button>
            )}
            <Button variant="primary" icon="plus" onClick={() => setPickerFor('customer')}>
              Receive payment
            </Button>
          </>
        }
      />

      <FilterBar>
        <DateRangeFilter value={range} onChange={setRange} />
        {isAdmin && (
          <div style={{ width: 170 }}>
            <Select
              value={partyType}
              onChange={(event) => setPartyType(event.target.value as Filter)}
            >
              <option value="all">Everyone</option>
              <option value="customer">Customers only</option>
              <option value="supplier">Suppliers only</option>
            </Select>
          </div>
        )}
        <FilterSpacer />
      </FilterBar>

      <PageBody fill>
        <StatGrid>
          <StatTile label="Received" unit={currency} value={format.money(received)} tone="good" />
          <StatTile label="Paid out" unit={currency} value={format.money(paid)} tone="bad" />
          <StatTile
            label="Net movement"
            unit={currency}
            value={format.money(received - paid)}
            tone={received - paid < 0 ? 'bad' : 'good'}
          />
        </StatGrid>

        <Card>
          <CardBody flush>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              isLoading={payments.isLoading}
              error={payments.error}
              onRetry={payments.refetch}
              empty={{
                title: 'No payments in this period',
                description:
                  'Record money received against a khata, or a payment made to a supplier.'
              }}
            />
            <TablePager
              page={page}
              pageSize={paging.pageSize}
              total={matched}
              onPageChange={paging.setPage}
              noun="payments"
            />
          </CardBody>
        </Card>
      </PageBody>

      <PartyPickerModal
        partyType={pickerFor}
        onClose={() => setPickerFor(null)}
        onPick={(party) => {
          const type = pickerFor as PartyType
          setPickerFor(null)
          setPayingParty({ party, type })
        }}
      />

      {payingParty && (
        <PaymentModal
          onClose={() => setPayingParty(null)}
          onSaved={() => payments.refetch()}
          partyType={payingParty.type}
          party={payingParty.party}
        />
      )}
    </>
  )
}
