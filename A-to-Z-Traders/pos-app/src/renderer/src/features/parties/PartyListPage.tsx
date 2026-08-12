import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Customer, PartyType } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Checkbox, SearchInput } from '../../components/ui/Field'
import { ToneValue } from '../../components/ui/Feedback'
import { Card, CardBody } from '../../components/ui/Surface'
import { Column, DataTable, PrimaryCell, RowActions } from '../../components/ui/DataTable'
import { FilterBar, FilterSpacer, PageBody, PageHeader } from '../../components/layout/PageHeader'
import { useDebounced } from '../../hooks/useDebounced'
import { useMutation } from '../../hooks/useMutation'
import { useQuery } from '../../hooks/useQuery'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useCurrency } from '../../app/SettingsContext'
import { PartyFormModal } from './PartyFormModal'
import { PaymentModal } from './PaymentModal'

interface PartyListPageProps {
  partyType: PartyType
}

const COPY = {
  customer: {
    title: 'Customers',
    subtitleNoun: 'customer',
    newLabel: 'New customer',
    balanceHeader: 'Balance',
    totalLabel: 'Total receivable',
    payLabel: 'Receive payment',
    exportReport: 'customers' as const,
    emptyTitle: 'No customers yet',
    emptyDescription:
      'Add the shops and people you sell to on credit. Walk-in cash sales do not need a customer.'
  },
  supplier: {
    title: 'Suppliers',
    subtitleNoun: 'supplier',
    newLabel: 'New supplier',
    balanceHeader: 'Balance',
    totalLabel: 'Total payable',
    payLabel: 'Pay supplier',
    exportReport: 'suppliers' as const,
    emptyTitle: 'No suppliers yet',
    emptyDescription:
      'Add the businesses you buy stock from so purchases can be tracked against them.'
  }
} satisfies Record<PartyType, unknown>

/**
 * Customers and suppliers are the same screen with mirrored language, so they
 * share one implementation. Only the words and the balance's meaning differ.
 */
export function PartyListPage({ partyType }: PartyListPageProps): JSX.Element {
  const currency = useCurrency()
  const navigate = useNavigate()
  const copy = COPY[partyType]

  const [search, setSearch] = useState('')
  const [withBalanceOnly, setWithBalanceOnly] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [payingParty, setPayingParty] = useState<Customer | null>(null)

  const debouncedSearch = useDebounced(search)
  const service = partyType === 'customer' ? api.customers : api.suppliers

  const parties = useQuery(
    () => unwrap(service.list({ search: debouncedSearch || undefined, withBalanceOnly })),
    [debouncedSearch, withBalanceOnly, partyType]
  )

  const refresh = useCallback(() => parties.refetch(), [parties])

  const exportCsv = useMutation(
    async () => unwrap(api.exports.csv({ report: copy.exportReport })),
    { successMessage: `${copy.title} exported`, errorTitle: 'Export failed' }
  )

  const rows = parties.data?.rows ?? []
  const outstanding = rows.reduce((sum, party) => sum + Math.max(0, party.currentBalance), 0)

  const columns: Column<Customer>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (party) => <PrimaryCell title={party.name} subtitle={party.phone ?? undefined} />
    },
    {
      key: 'address',
      header: 'Address',
      render: (party) => <span style={{ color: 'var(--ink-muted)' }}>{party.address ?? '—'}</span>
    },
    {
      key: 'balance',
      header: `${copy.balanceHeader} (${currency})`,
      numeric: true,
      width: '190px',
      render: (party) => {
        const { text, tone } = format.balanceLabel(party.currentBalance, partyType)
        return <ToneValue tone={tone}>{text}</ToneValue>
      }
    },
    {
      key: 'actions',
      header: '',
      width: '130px',
      render: (party) => (
        <RowActions>
          <Button
            size="sm"
            variant="ghost"
            icon="payments"
            title={copy.payLabel}
            aria-label={`${copy.payLabel} for ${party.name}`}
            onClick={(event) => {
              event.stopPropagation()
              setPayingParty(party)
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            icon="ledger"
            title="Statement"
            aria-label={`Statement for ${party.name}`}
            onClick={(event) => {
              event.stopPropagation()
              navigate(`/${partyType}s/${party.id}`)
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            icon="edit"
            title="Edit"
            aria-label={`Edit ${party.name}`}
            onClick={(event) => {
              event.stopPropagation()
              setEditing(party)
              setIsFormOpen(true)
            }}
          />
        </RowActions>
      )
    }
  ]

  return (
    <>
      <PageHeader
        title={copy.title}
        subtitle={
          parties.data
            ? `${format.pluralize(parties.data.total, copy.subtitleNoun)} · ${copy.totalLabel} ${currency} ${format.money(outstanding)}`
            : 'Loading'
        }
        actions={
          <>
            <Button
              icon="download"
              loading={exportCsv.isPending}
              onClick={() => void exportCsv.run()}
            >
              Export
            </Button>
            <Button
              variant="primary"
              icon="plus"
              onClick={() => {
                setEditing(null)
                setIsFormOpen(true)
              }}
            >
              {copy.newLabel}
            </Button>
          </>
        }
      />

      <FilterBar>
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search by name or phone"
        />
        <Checkbox
          label="Only with a balance"
          checked={withBalanceOnly}
          onChange={(event) => setWithBalanceOnly(event.target.checked)}
        />
        <FilterSpacer />
      </FilterBar>

      <PageBody>
        <Card>
          <CardBody flush>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(party) => party.id}
              isLoading={parties.isLoading}
              onRowClick={(party) => navigate(`/${partyType}s/${party.id}`)}
              empty={{
                title: search ? 'No matches' : copy.emptyTitle,
                description: search
                  ? 'Try a different name or phone number.'
                  : copy.emptyDescription,
                action: !search && (
                  <Button
                    variant="primary"
                    icon="plus"
                    onClick={() => {
                      setEditing(null)
                      setIsFormOpen(true)
                    }}
                  >
                    {copy.newLabel}
                  </Button>
                )
              }}
            />
          </CardBody>
        </Card>
      </PageBody>

      {isFormOpen && (
        <PartyFormModal
          onClose={() => setIsFormOpen(false)}
          onSaved={refresh}
          partyType={partyType}
          party={editing}
        />
      )}

      {payingParty && (
        <PaymentModal
          onClose={() => setPayingParty(null)}
          onSaved={refresh}
          partyType={partyType}
          party={payingParty}
        />
      )}
    </>
  )
}
