import type { JSX } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Customer, PageWithTotals, PartyPageTotals, PartyType, Supplier } from '@shared/types'
import * as format from '@renderer/lib/format'
import { useShop } from '../App'
import { useAction, useDebounced, useOnline, useRemote } from '../lib/hooks'
import { CHANNELS, remote } from '../lib/remote'
import {
  Button,
  Card,
  Empty,
  Field,
  Input,
  Loading,
  Note,
  Row,
  Rows,
  Screen,
  SearchInput,
  Section,
  Sheet,
  StaleBanner,
  Tile,
  TopBar
} from '../ui/kit'

/**
 * The khata — who owes the shop, and who the shop owes.
 *
 * One screen for both sides rather than two, because on a phone the question
 * is almost always "what is X's balance", and which kind of party X is is
 * something the owner already knows.
 */

export function PartiesScreen(): JSX.Element {
  const { shop } = useShop()
  const navigate = useNavigate()
  const online = useOnline()

  const [type, setType] = useState<PartyType>('customer')
  const [search, setSearch] = useState('')
  const [dueOnly, setDueOnly] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const query = useDebounced(search, 250)

  const channel = type === 'customer' ? CHANNELS.customersList : CHANNELS.suppliersList
  const list = useRemote<PageWithTotals<Customer | Supplier, PartyPageTotals>>(
    channel,
    { search: query, withBalanceOnly: dueOnly, limit: 50 },
    [type, query, dueOnly]
  )

  const cash = (value: number): string => format.currency(value, shop.currency)
  const rows = list.data?.rows ?? []

  return (
    <Screen>
      <TopBar
        title="Khata"
        action={
          type === 'customer' ? (
            <Button variant="ghost" disabled={!online} onClick={() => setAddOpen(true)}>
              Add
            </Button>
          ) : undefined
        }
      />
      {list.isStale && <StaleBanner label={list.staleLabel} />}

      <div className="flex gap-2 px-4 pt-4">
        {(['customer', 'supplier'] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setType(entry)}
            className={`flex-1 rounded-xl border px-3 text-sm font-medium ${
              type === entry
                ? 'border-accent-border bg-accent-weak text-accent-ink'
                : 'border-line bg-surface-raised text-ink-muted'
            }`}
          >
            {entry === 'customer' ? 'Customers' : 'Suppliers'}
          </button>
        ))}
      </div>

      <Section>
        <SearchInput
          value={search}
          placeholder={type === 'customer' ? 'Search customers' : 'Search suppliers'}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Section>

      <Section>
        <div className="grid grid-cols-2 gap-3">
          <Tile
            label={type === 'customer' ? 'Customers owe' : 'Owed to suppliers'}
            value={cash(list.data?.totals.outstanding ?? 0)}
            tone="bad"
          />
          <button
            type="button"
            onClick={() => setDueOnly((current) => !current)}
            className={`rounded-xl border p-3 text-left ${
              dueOnly
                ? 'border-accent-border bg-accent-weak text-accent-ink'
                : 'border-line bg-surface-raised text-ink-muted'
            }`}
          >
            <div className="text-caption">Filter</div>
            <div className="mt-1 text-md font-semibold">
              {dueOnly ? 'With a balance' : 'Everyone'}
            </div>
          </button>
        </div>
      </Section>

      {list.error && (
        <Section>
          <Note tone="bad">{list.error}</Note>
        </Section>
      )}

      <Section
        title={`${list.data?.total ?? 0} ${type === 'customer' ? 'customers' : 'suppliers'}`}
      >
        <Card>
          {list.isLoading && !list.data ? (
            <Loading />
          ) : rows.length === 0 ? (
            <Empty
              title="Nobody here"
              hint={dueOnly ? 'Nobody has an outstanding balance.' : undefined}
            />
          ) : (
            <Rows>
              {rows.map((party) => {
                const balance = format.balanceLabel(party.currentBalance, type)
                return (
                  <Row
                    key={party.id}
                    title={party.name}
                    subtitle={party.phone ?? '—'}
                    value={
                      <span
                        className={
                          balance.tone === 'bad'
                            ? 'text-bad'
                            : balance.tone === 'good'
                              ? 'text-good'
                              : 'text-ink-muted'
                        }
                      >
                        {balance.text}
                      </span>
                    }
                    onClick={() => navigate(`/parties/${type}/${party.id}`)}
                  />
                )
              })}
            </Rows>
          )}
        </Card>
      </Section>

      <AddCustomerSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={() => list.refetch()}
      />
    </Screen>
  )
}

function AddCustomerSheet({
  open,
  onClose,
  onAdded
}: {
  open: boolean
  onClose: () => void
  onAdded: () => void
}): JSX.Element {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')

  const add = useAction(
    async () =>
      remote.addCustomer({
        name: name.trim(),
        phone: phone.trim() || null,
        address: address.trim() || null
      }),
    {
      onSuccess: () => {
        setName('')
        setPhone('')
        setAddress('')
        onAdded()
        onClose()
      }
    }
  )

  return (
    <Sheet open={open} title="New customer" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Field label="Name" error={add.fields.name}>
          <Input value={name} autoFocus onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Phone" hint="Optional">
          <Input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
        </Field>
        <Field label="Address" hint="Optional">
          <Input value={address} onChange={(event) => setAddress(event.target.value)} />
        </Field>

        <Note tone="info">
          An opening balance can only be set on the shop computer. Setting one later would rewrite
          history that the statements are already built from.
        </Note>

        {add.error && <Note tone="bad">{add.error}</Note>}

        <Button
          variant="primary"
          block
          loading={add.isPending}
          disabled={name.trim().length === 0}
          onClick={() => void add.run()}
        >
          Add customer
        </Button>
      </div>
    </Sheet>
  )
}
