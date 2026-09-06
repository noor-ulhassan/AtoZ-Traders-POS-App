import type { JSX } from 'react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Customer, LedgerStatement, PartyType, PaymentMethod, Supplier } from '@shared/types'
import { resolvePreset } from '@shared/date'
import type { DatePresetKey } from '@shared/date'
import * as format from '@renderer/lib/format'
import { useShop } from '../App'
import { useAction, useOnline, useRemote } from '../lib/hooks'
import { CHANNELS, remote } from '../lib/remote'
import { downloadCsv } from '../lib/client'
import {
  AmountInput,
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
  Section,
  Select,
  Sheet,
  StaleBanner,
  Tile,
  TopBar
} from '../ui/kit'

/**
 * One party's statement, and the button that takes money against it.
 *
 * This is the client's "customer statement" and "credit/debit record" in one
 * screen: the running khata, and the receipt that changes it. The statement is
 * derived on the shop computer from the sales, payments and returns behind it
 * — there is no stored balance to disagree with what is shown here.
 */

const PERIODS: { key: DatePresetKey; label: string }[] = [
  { key: 'thisMonth', label: 'Month' },
  { key: 'last30', label: '30 days' },
  { key: 'thisYear', label: 'Year' }
]

const METHODS: PaymentMethod[] = ['cash', 'bank', 'cheque', 'online', 'other']

export function PartyDetailScreen(): JSX.Element {
  const { shop } = useShop()
  const navigate = useNavigate()
  const { type, id: idParam } = useParams<{ type: string; id: string }>()
  const online = useOnline()

  const partyType: PartyType = type === 'supplier' ? 'supplier' : 'customer'
  const id = Number(idParam)

  const [period, setPeriod] = useState<DatePresetKey>('thisMonth')
  const [payOpen, setPayOpen] = useState(false)
  const range = resolvePreset(period)

  const party = useRemote<Customer | Supplier>(
    partyType === 'customer' ? CHANNELS.customersGet : CHANNELS.suppliersGet,
    { id },
    [partyType, id]
  )

  const statement = useRemote<LedgerStatement>(
    partyType === 'customer' ? CHANNELS.customersLedger : CHANNELS.suppliersLedger,
    { id, range },
    [partyType, id, period]
  )

  const cash = (value: number): string => format.currency(value, shop.currency)
  const data = statement.data
  const balance = party.data ? format.balanceLabel(party.data.currentBalance, partyType) : null

  const csv = useAction(async () =>
    downloadCsv(partyType === 'customer' ? 'customer-ledger' : 'supplier-ledger', {
      partyId: id,
      from: range.from,
      to: range.to
    })
  )

  return (
    <Screen>
      <TopBar
        title={party.data?.name ?? 'Statement'}
        subtitle={party.data?.phone ?? undefined}
        onBack={() => navigate(-1)}
      />
      {statement.isStale && <StaleBanner label={statement.staleLabel} />}

      <Section>
        <div className="grid grid-cols-2 gap-3">
          <Tile
            label={partyType === 'customer' ? 'Balance' : 'Balance'}
            value={balance?.text ?? '—'}
            tone={balance?.tone === 'bad' ? 'bad' : balance?.tone === 'good' ? 'good' : 'neutral'}
          />
          <Tile label="In this period" value={cash(data?.totalCredit ?? 0)} tone="good" />
        </div>
      </Section>

      <Section>
        <div className="flex flex-col gap-3">
          <Button variant="primary" block disabled={!online} onClick={() => setPayOpen(true)}>
            {partyType === 'customer' ? 'Take a payment' : 'Record a payout'}
          </Button>
          <Button block disabled={!online} loading={csv.isPending} onClick={() => void csv.run()}>
            Download statement (CSV)
          </Button>
          {csv.error && <Note tone="bad">{csv.error}</Note>}
        </div>
      </Section>

      <div className="flex gap-2 px-4 pt-5">
        {PERIODS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setPeriod(entry.key)}
            className={`flex-1 rounded-xl border px-3 text-sm font-medium ${
              period === entry.key
                ? 'border-accent-border bg-accent-weak text-accent-ink'
                : 'border-line bg-surface-raised text-ink-muted'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {statement.error && (
        <Section>
          <Note tone="bad">{statement.error}</Note>
        </Section>
      )}

      <Section title="Statement">
        <Card>
          {statement.isLoading && !data ? (
            <Loading />
          ) : !data || data.entries.length === 0 ? (
            <Empty title="Nothing in this period" />
          ) : (
            <Rows>
              <Row
                title="Opening balance"
                subtitle={`as on ${format.date(range.from)}`}
                value={format.money(data.openingBalance)}
              />
              {data.entries.map((entry, index) => (
                <Row
                  key={`${entry.sourceTable}-${entry.sourceId}-${index}`}
                  title={entry.description}
                  subtitle={format.date(entry.date)}
                  value={
                    entry.debit > 0 ? (
                      <span className="text-bad">+{format.money(entry.debit)}</span>
                    ) : (
                      <span className="text-good">−{format.money(entry.credit)}</span>
                    )
                  }
                  valueNote={`balance ${format.money(entry.balance)}`}
                />
              ))}
              <Row
                title="Closing balance"
                subtitle={`as on ${format.date(range.to)}`}
                value={format.money(data.closingBalance)}
              />
            </Rows>
          )}
        </Card>
      </Section>

      <PaymentSheet
        open={payOpen}
        partyType={partyType}
        partyId={id}
        partyName={party.data?.name ?? ''}
        currency={shop.currency}
        suggested={Math.max(0, party.data?.currentBalance ?? 0)}
        onClose={() => setPayOpen(false)}
        onSaved={() => {
          party.refetch()
          statement.refetch()
        }}
      />
    </Screen>
  )
}

export function PaymentSheet({
  open,
  partyType,
  partyId,
  partyName,
  currency,
  suggested,
  onClose,
  onSaved
}: {
  open: boolean
  partyType: PartyType
  partyId: number
  partyName: string
  currency: string
  suggested: number
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [notes, setNotes] = useState('')

  const save = useAction(
    async () =>
      remote.createPayment({
        partyType,
        partyId,
        amount: Number(amount.replace(/,/g, '')) || 0,
        method,
        notes: notes.trim() || null
      }),
    {
      onSuccess: () => {
        setAmount('')
        setNotes('')
        onSaved()
        onClose()
      }
    }
  )

  return (
    <Sheet
      open={open}
      title={partyType === 'customer' ? `Payment from ${partyName}` : `Payout to ${partyName}`}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <Field label="Amount" error={save.fields['input.amount']}>
          <AmountInput
            value={amount}
            autoFocus
            placeholder="0"
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>

        {suggested > 0 && (
          <Button block onClick={() => setAmount(String(suggested))}>
            Settle the whole balance · {format.currency(suggested, currency)}
          </Button>
        )}

        <Field label="How">
          <Select
            value={method}
            onChange={(event) => setMethod(event.target.value as PaymentMethod)}
          >
            {METHODS.map((entry) => (
              <option key={entry} value={entry}>
                {entry[0]?.toUpperCase()}
                {entry.slice(1)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Note" hint="Optional">
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>

        <Note tone="warn">
          This is money collected against the khata generally. If the money came back with a
          delivery, record it on that bill instead — doing both counts it twice.
        </Note>

        {save.error && <Note tone="bad">{save.error}</Note>}

        <Button variant="primary" block loading={save.isPending} onClick={() => void save.run()}>
          Save
        </Button>
      </div>
    </Sheet>
  )
}
