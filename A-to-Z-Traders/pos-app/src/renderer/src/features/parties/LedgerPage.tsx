import type { JSX } from 'react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import type { DateRange, LedgerEntry, PartyType } from '@shared/types'
import { resolvePreset } from '@shared/date'
import { Button } from '../../components/ui/Button'
import { Card, CardBody } from '../../components/ui/Surface'
import { Column, DataTable } from '../../components/ui/DataTable'
import { DateRangeFilter } from '../../components/ui/DateRangeFilter'
import { StatGrid, StatTile } from '../../components/ui/StatTile'
import { FilterBar, FilterSpacer, PageBody, PageHeader } from '../../components/layout/PageHeader'
import { useMutation } from '../../hooks/useMutation'
import { useQuery } from '../../hooks/useQuery'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useAuth } from '../../app/AuthContext'
import { useCurrency } from '../../app/SettingsContext'
import { PaymentModal } from './PaymentModal'

interface LedgerPageProps {
  partyType: PartyType
}

/**
 * The khata — one party's account, in date order, with a running balance.
 *
 * The balance carried forward is shown as its own row at the top rather than
 * folded into the first entry, because "what did they owe me before this
 * month" is a question on its own.
 */
export function LedgerPage({ partyType }: LedgerPageProps): JSX.Element {
  const currency = useCurrency()
  const isAdmin = useAuth().role === 'admin'
  const { id } = useParams<{ id: string }>()
  const partyId = Number(id)

  const [range, setRange] = useState<DateRange>(() => resolvePreset('thisMonth'))
  const [isPaymentOpen, setIsPaymentOpen] = useState(false)

  const service = partyType === 'customer' ? api.customers : api.suppliers

  const party = useQuery(() => unwrap(service.get(partyId)), [partyId, partyType])
  const statement = useQuery(
    () => unwrap(service.ledger(partyId, range)),
    [partyId, partyType, range.from, range.to]
  )

  const exportCsv = useMutation(
    async () =>
      unwrap(
        api.exports.csv({
          report: partyType === 'customer' ? 'customer-ledger' : 'supplier-ledger',
          filters: { partyId, from: range.from, to: range.to }
        })
      ),
    { successMessage: 'Statement exported', errorTitle: 'Export failed' }
  )

  const refresh = (): void => {
    party.refetch()
    statement.refetch()
  }

  const columns: Column<LedgerEntry>[] = [
    { key: 'date', header: 'Date', width: '120px', render: (row) => format.date(row.date) },
    { key: 'description', header: 'Details', render: (row) => row.description },
    {
      key: 'reference',
      header: 'Reference',
      width: '140px',
      render: (row) => (
        <span className="font-mono text-caption text-ink-muted">{row.reference}</span>
      )
    },
    {
      key: 'debit',
      header: partyType === 'customer' ? `Charged (${currency})` : `Billed (${currency})`,
      numeric: true,
      width: '140px',
      render: (row) => (row.debit ? format.money(row.debit) : '—')
    },
    {
      key: 'credit',
      header: partyType === 'customer' ? `Received (${currency})` : `Paid (${currency})`,
      numeric: true,
      width: '140px',
      render: (row) => (row.credit ? format.money(row.credit) : '—')
    },
    {
      key: 'balance',
      header: `Balance (${currency})`,
      numeric: true,
      width: '150px',
      render: (row) => <strong>{format.money(row.balance)}</strong>
    }
  ]

  const data = statement.data
  const balance = party.data?.currentBalance ?? 0
  const balanceLabel = format.balanceLabel(balance, partyType)

  return (
    <>
      <PageHeader
        back={{
          to: partyType === 'customer' ? '/customers' : '/suppliers',
          label: partyType === 'customer' ? 'Customers' : 'Suppliers'
        }}
        title={party.data?.name ?? 'Statement'}
        subtitle={
          party.data
            ? [party.data.phone, party.data.address].filter(Boolean).join(' · ') ||
              'No contact details'
            : undefined
        }
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
            <Button variant="primary" icon="payments" onClick={() => setIsPaymentOpen(true)}>
              {partyType === 'customer' ? 'Receive payment' : 'Pay supplier'}
            </Button>
          </>
        }
      />

      <FilterBar>
        <DateRangeFilter
          value={range}
          onChange={setRange}
          presets={['thisMonth', 'lastMonth', 'last30', 'thisYear']}
        />
        <FilterSpacer />
      </FilterBar>

      <PageBody fill>
        <StatGrid min={200}>
          <StatTile
            label="Current balance"
            unit={currency}
            value={format.money(Math.abs(balance))}
            tone={balanceLabel.tone === 'neutral' ? 'default' : balanceLabel.tone}
            footnote={balanceLabel.text}
          />
          <StatTile
            label="Brought forward"
            unit={currency}
            value={format.money(data?.openingBalance ?? 0)}
            footnote={`As on ${format.date(range.from)}`}
          />
          <StatTile
            label={partyType === 'customer' ? 'Charged in period' : 'Billed in period'}
            unit={currency}
            value={format.money(data?.totalDebit ?? 0)}
          />
          <StatTile
            label={partyType === 'customer' ? 'Received in period' : 'Paid in period'}
            unit={currency}
            value={format.money(data?.totalCredit ?? 0)}
          />
        </StatGrid>

        <Card>
          <CardBody flush>
            <DataTable
              columns={columns}
              rows={data?.entries ?? []}
              rowKey={(row, index) => `${row.sourceTable}-${row.sourceId}-${index}`}
              isLoading={statement.isLoading}
              error={statement.error}
              onRetry={statement.refetch}
              empty={{
                title: 'Nothing in this period',
                description: 'Credit bills, payments and returns all appear on this statement.'
              }}
              footer={
                data && data.entries.length > 0 ? (
                  <tr>
                    <td colSpan={3}>Closing balance</td>
                    <td className="text-right tabular-nums">{format.money(data.totalDebit)}</td>
                    <td className="text-right tabular-nums">{format.money(data.totalCredit)}</td>
                    <td className="text-right tabular-nums">{format.money(data.closingBalance)}</td>
                  </tr>
                ) : undefined
              }
            />
          </CardBody>
        </Card>
      </PageBody>

      {isPaymentOpen && party.data && (
        <PaymentModal
          onClose={() => setIsPaymentOpen(false)}
          onSaved={refresh}
          partyType={partyType}
          party={party.data}
        />
      )}
    </>
  )
}
