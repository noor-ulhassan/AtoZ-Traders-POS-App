import type { JSX } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  Customer,
  Expense,
  ExpenseCategory,
  ExpensePageTotals,
  PageWithTotals,
  PartyPageTotals,
  PartyType,
  Payment,
  PaymentPageTotals,
  Supplier
} from '@shared/types'
import { resolvePreset } from '@shared/date'
import type { DatePresetKey } from '@shared/date'
import * as format from '@renderer/lib/format'
import { useShop } from '../App'
import { useAction, useDebounced, useOnline, useRemote } from '../lib/hooks'
import { CHANNELS, remote } from '../lib/remote'
import { PaymentSheet } from './PartyDetail'
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
  SearchInput,
  Section,
  Select,
  Sheet,
  StaleBanner,
  Tile,
  TopBar
} from '../ui/kit'

/**
 * Money that is not a bill: receipts, payouts and costs.
 *
 * Two tabs rather than two screens, because they answer the same question —
 * "what moved today that was not a sale" — and a phone with five tabs at the
 * bottom has no room for a sixth.
 */

const PERIODS: { key: DatePresetKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'last7', label: '7 days' },
  { key: 'thisMonth', label: 'Month' }
]

export function MoneyScreen(): JSX.Element {
  const { shop } = useShop()
  const navigate = useNavigate()
  const online = useOnline()

  const [tab, setTab] = useState<'payments' | 'expenses'>('payments')
  const [period, setPeriod] = useState<DatePresetKey>('last7')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [payFor, setPayFor] = useState<{ type: PartyType; party: Customer | Supplier } | null>(null)

  const range = resolvePreset(period)
  const cash = (value: number): string => format.currency(value, shop.currency)

  const payments = useRemote<PageWithTotals<Payment, PaymentPageTotals>>(
    CHANNELS.paymentsList,
    { from: range.from, to: range.to, limit: 50 },
    [period]
  )

  const expenses = useRemote<PageWithTotals<Expense, ExpensePageTotals>>(
    CHANNELS.expensesList,
    { from: range.from, to: range.to, limit: 50 },
    [period]
  )

  const active = tab === 'payments' ? payments : expenses

  return (
    <Screen>
      <TopBar title="Money" onBack={() => navigate('/more')} />
      {active.isStale && <StaleBanner label={active.staleLabel} />}

      <div className="flex gap-2 px-4 pt-4">
        {(['payments', 'expenses'] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setTab(entry)}
            className={`flex-1 rounded-xl border px-3 text-sm font-medium capitalize ${
              tab === entry
                ? 'border-accent-border bg-accent-weak text-accent-ink'
                : 'border-line bg-surface-raised text-ink-muted'
            }`}
          >
            {entry}
          </button>
        ))}
      </div>

      <div className="flex gap-2 px-4 pt-3">
        {PERIODS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setPeriod(entry.key)}
            className={`flex-1 rounded-xl border px-3 text-sm font-medium ${
              period === entry.key
                ? 'border-line-strong bg-surface-active text-ink'
                : 'border-line bg-surface-raised text-ink-muted'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'payments' ? (
        <>
          <Section>
            <div className="grid grid-cols-2 gap-3">
              <Tile
                label="Received"
                value={cash(payments.data?.totals.received ?? 0)}
                tone="good"
              />
              <Tile label="Paid out" value={cash(payments.data?.totals.paid ?? 0)} tone="bad" />
            </div>
          </Section>

          <Section>
            <Button variant="primary" block disabled={!online} onClick={() => setPickerOpen(true)}>
              Record a payment
            </Button>
          </Section>

          {payments.error && (
            <Section>
              <Note tone="bad">{payments.error}</Note>
            </Section>
          )}

          <Section title={`${payments.data?.total ?? 0} payments`}>
            <Card>
              {payments.isLoading && !payments.data ? (
                <Loading />
              ) : (payments.data?.rows.length ?? 0) === 0 ? (
                <Empty title="Nothing in this period" />
              ) : (
                <Rows>
                  {payments.data?.rows.map((payment) => (
                    <Row
                      key={payment.id}
                      title={payment.partyName}
                      subtitle={`${format.date(payment.date)} · ${payment.method}${
                        payment.notes ? ` · ${payment.notes}` : ''
                      }`}
                      value={
                        <span className={payment.direction === 'in' ? 'text-good' : 'text-bad'}>
                          {payment.direction === 'in' ? '+' : '−'}
                          {format.money(payment.amount)}
                        </span>
                      }
                      valueNote={payment.direction === 'in' ? 'received' : 'paid out'}
                    />
                  ))}
                </Rows>
              )}
            </Card>
          </Section>
        </>
      ) : (
        <>
          <Section>
            <div className="grid grid-cols-2 gap-3">
              <Tile label="Spent" value={cash(expenses.data?.totals.amount ?? 0)} tone="bad" />
              <Tile label="Entries" value={String(expenses.data?.total ?? 0)} />
            </div>
          </Section>

          <Section>
            <Button variant="primary" block disabled={!online} onClick={() => setExpenseOpen(true)}>
              Record an expense
            </Button>
          </Section>

          {expenses.error && (
            <Section>
              <Note tone="bad">{expenses.error}</Note>
            </Section>
          )}

          <Section title="Expenses">
            <Card>
              {expenses.isLoading && !expenses.data ? (
                <Loading />
              ) : (expenses.data?.rows.length ?? 0) === 0 ? (
                <Empty title="Nothing in this period" />
              ) : (
                <Rows>
                  {expenses.data?.rows.map((expense) => (
                    <Row
                      key={expense.id}
                      title={expense.title}
                      subtitle={`${format.date(expense.date)} · ${expense.categoryName ?? 'Uncategorised'}`}
                      value={format.money(expense.amount)}
                    />
                  ))}
                </Rows>
              )}
            </Card>
          </Section>
        </>
      )}

      <PartyPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(type, party) => {
          setPickerOpen(false)
          setPayFor({ type, party })
        }}
      />

      {payFor && (
        <PaymentSheet
          open
          partyType={payFor.type}
          partyId={payFor.party.id}
          partyName={payFor.party.name}
          currency={shop.currency}
          suggested={Math.max(0, payFor.party.currentBalance)}
          onClose={() => setPayFor(null)}
          onSaved={() => payments.refetch()}
        />
      )}

      <ExpenseSheet
        open={expenseOpen}
        onClose={() => setExpenseOpen(false)}
        onSaved={() => expenses.refetch()}
      />
    </Screen>
  )
}

/* ------------------------------------------------------------- pickers */

function PartyPickerSheet({
  open,
  onClose,
  onPick
}: {
  open: boolean
  onClose: () => void
  onPick: (type: PartyType, party: Customer | Supplier) => void
}): JSX.Element {
  const [type, setType] = useState<PartyType>('customer')
  const [search, setSearch] = useState('')
  const query = useDebounced(search, 250)

  const list = useRemote<PageWithTotals<Customer | Supplier, PartyPageTotals>>(
    type === 'customer' ? CHANNELS.customersList : CHANNELS.suppliersList,
    { search: query, limit: 25 },
    [type, query, open]
  )

  return (
    <Sheet open={open} title="Who is the money from or to?" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          {(['customer', 'supplier'] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => setType(entry)}
              className={`min-h-12 flex-1 rounded-xl border px-3 text-sm font-medium ${
                type === entry
                  ? 'border-accent-border bg-accent-weak text-accent-ink'
                  : 'border-line bg-surface-raised text-ink-muted'
              }`}
            >
              {entry === 'customer' ? 'From a customer' : 'To a supplier'}
            </button>
          ))}
        </div>

        <SearchInput
          value={search}
          placeholder="Search"
          onChange={(event) => setSearch(event.target.value)}
        />

        <Card>
          {list.isLoading && !list.data ? (
            <Loading />
          ) : (list.data?.rows.length ?? 0) === 0 ? (
            <Empty title="Nobody matched" />
          ) : (
            <Rows>
              {list.data?.rows.map((party) => (
                <Row
                  key={party.id}
                  title={party.name}
                  subtitle={party.phone ?? '—'}
                  value={format.balanceLabel(party.currentBalance, type).text}
                  onClick={() => onPick(type, party)}
                />
              ))}
            </Rows>
          )}
        </Card>
      </div>
    </Sheet>
  )
}

function ExpenseSheet({
  open,
  onClose,
  onSaved
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [notes, setNotes] = useState('')

  const categories = useRemote<ExpenseCategory[]>(CHANNELS.expenseCategoriesList, undefined, [open])

  const save = useAction(
    async () =>
      remote.addExpense({
        title: title.trim(),
        amount: Number(amount.replace(/,/g, '')) || 0,
        categoryId: categoryId === '' ? null : Number(categoryId),
        notes: notes.trim() || null
      }),
    {
      onSuccess: () => {
        setTitle('')
        setAmount('')
        setNotes('')
        onSaved()
        onClose()
      }
    }
  )

  return (
    <Sheet open={open} title="New expense" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Field label="What was it for" error={save.fields['input.title']}>
          <Input
            value={title}
            autoFocus
            placeholder="Diesel for the van"
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>

        <Field label="Amount" error={save.fields['input.amount']}>
          <AmountInput
            value={amount}
            placeholder="0"
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>

        <Field label="Category" hint="Optional — new categories are added on the shop computer">
          <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">Uncategorised</option>
            {categories.data?.map((category) => (
              <option key={category.id} value={String(category.id)}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Note" hint="Optional">
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>

        {save.error && <Note tone="bad">{save.error}</Note>}

        <Button
          variant="primary"
          block
          loading={save.isPending}
          disabled={title.trim().length === 0}
          onClick={() => void save.run()}
        >
          Save expense
        </Button>
      </div>
    </Sheet>
  )
}
