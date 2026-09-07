import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  Customer,
  PageWithTotals,
  PartyPageTotals,
  PaymentType,
  Product,
  SaleItemInput,
  SellableUnit,
  Settings
} from '@shared/types'
import { money, percentOf, sumMoney } from '@shared/money'
import * as format from '@renderer/lib/format'
import { useShop } from '../App'
import { useAction, useDebounced, useOnline, useRemote } from '../lib/hooks'
import { CHANNELS, remote } from '../lib/remote'
import {
  AmountInput,
  Badge,
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
  Spinner,
  TopBar
} from '../ui/kit'

/**
 * Writing a bill from the phone.
 *
 * The arithmetic here mirrors `salesService` line for line — rate rounded,
 * then the gross, then the line discount off that — for the same reason the
 * desktop's `useBill` does: the screen must never show a total that the save
 * then disagrees with by a paisa. The server recomputes all of it and its
 * answer is the one that counts; this is only so the number under the owner's
 * thumb is the number he is about to commit to.
 *
 * What is deliberately NOT reimplemented is the rules. Stock, the walk-in
 * rule, the own-goods discount cap, the derived payment type — all of that is
 * `priceBill` on the shop computer, and a bill from a phone goes through
 * exactly the same function a bill from the till does.
 */

interface BillLine {
  key: number
  product: Product
  units: SellableUnit[]
  unitName: string
  factor: number
  qty: number
  rate: number
  lineDiscount: number
}

/** Parses what a thumb typed. A half-typed "12." is 12, not NaN. */
function num(value: string): number {
  const parsed = Number(value.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

export function NewBillScreen(): JSX.Element {
  const { shop } = useShop()
  const navigate = useNavigate()
  const online = useOnline()

  const settings = useRemote<Settings>(CHANNELS.settingsGet)
  const nextInvoice = useRemote<string>(CHANNELS.salesNextInvoiceNo)

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [lines, setLines] = useState<BillLine[]>([])
  const [nextKey, setNextKey] = useState(1)
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState<number | null>(null)
  const [editing, setEditing] = useState<BillLine | null>(null)
  const [customerOpen, setCustomerOpen] = useState(false)
  const [finishOpen, setFinishOpen] = useState(false)

  const [discountText, setDiscountText] = useState('')
  const [paidText, setPaidText] = useState('')
  const [notes, setNotes] = useState('')

  const query = useDebounced(search, 250)
  const products = useRemote<PageWithTotals<Product, { stockValue: number }>>(
    CHANNELS.productsList,
    { search: query, status: 'active', limit: 20 },
    [query]
  )

  const taxEnabled = settings.data?.taxEnabled ?? false
  const taxRate = settings.data?.taxRate ?? 0

  const totals = useMemo(() => {
    const subtotal = sumMoney(
      lines.map((line) => money(money(line.qty * money(line.rate)) - money(line.lineDiscount)))
    )
    const discount = Math.min(num(discountText), subtotal)
    const taxable = money(subtotal - discount)
    const tax = taxEnabled ? percentOf(taxable, taxRate) : 0
    return { subtotal, discount, tax, total: money(taxable + tax) }
  }, [lines, discountText, taxEnabled, taxRate])

  const cash = (value: number): string => format.currency(value, shop.currency)

  /* ------------------------------------------------------------ lines */

  const addProduct = async (product: Product): Promise<void> => {
    setAdding(product.id)
    try {
      const units = await remote.sellableUnits(product.id)
      const base = units[0]
      if (!base) return
      const suggestion = await remote.suggestPrice(customer?.id ?? null, product.id, base.unitName)

      setLines((current) => {
        // Tapping the same item twice means two of it, not two rows.
        const existing = current.find(
          (line) => line.product.id === product.id && line.unitName === base.unitName
        )
        if (existing) {
          return current.map((line) =>
            line.key === existing.key ? { ...line, qty: line.qty + 1 } : line
          )
        }
        return [
          ...current,
          {
            key: nextKey,
            product,
            units,
            unitName: base.unitName,
            factor: base.factor,
            qty: 1,
            rate: suggestion.rate,
            lineDiscount: 0
          }
        ]
      })
      setNextKey((key) => key + 1)
      setSearch('')
    } finally {
      setAdding(null)
    }
  }

  const changeUnit = async (line: BillLine, unitName: string): Promise<void> => {
    const unit = line.units.find((entry) => entry.unitName === unitName)
    if (!unit) return
    const suggestion = await remote.suggestPrice(customer?.id ?? null, line.product.id, unitName)
    const next = { ...line, unitName, factor: unit.factor, rate: suggestion.rate }
    setLines((current) => current.map((entry) => (entry.key === line.key ? next : entry)))
    setEditing(next)
  }

  const patchLine = (key: number, patch: Partial<BillLine>): void => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
    setEditing((current) => (current && current.key === key ? { ...current, ...patch } : current))
  }

  const removeLine = (key: number): void => {
    setLines((current) => current.filter((line) => line.key !== key))
    setEditing(null)
  }

  /* ------------------------------------------------------------- save */

  const save = useAction(
    async (paymentType: PaymentType, paidAmount: number) => {
      const items: SaleItemInput[] = lines.map((line) => ({
        productId: line.product.id,
        unitName: line.unitName,
        qty: line.qty,
        rate: line.rate,
        lineDiscount: line.lineDiscount
      }))

      return remote.createSale({
        customerId: customer?.id ?? null,
        items,
        discount: totals.discount,
        paymentType,
        paidAmount,
        notes: notes.trim() || null
      })
    },
    {
      onSuccess: (result) => {
        setFinishOpen(false)
        navigate(`/bills/${result.sale.id}?new=1`)
      }
    }
  )

  const finish = (type: PaymentType): void => {
    const paid = type === 'cash' ? totals.total : type === 'credit' ? 0 : num(paidText)
    void save.run(type, paid)
  }

  /* ------------------------------------------------------------- view */

  return (
    <Screen>
      <TopBar
        title="New bill"
        subtitle={nextInvoice.data ? `Next: ${nextInvoice.data}` : undefined}
      />

      <Section>
        <button
          type="button"
          onClick={() => setCustomerOpen(true)}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface-raised px-4 py-3 text-left active:bg-surface-active"
        >
          <span className="flex min-w-0 flex-col">
            <span className="text-caption text-ink-muted">Customer</span>
            <span className="truncate text-base font-medium">
              {customer ? customer.name : 'Walk-in (cash)'}
            </span>
          </span>
          {customer && customer.currentBalance !== 0 && (
            <Badge tone={customer.currentBalance > 0 ? 'bad' : 'good'}>
              {format.balanceLabel(customer.currentBalance, 'customer').text}
            </Badge>
          )}
        </button>
      </Section>

      <Section title="Add items">
        <SearchInput
          value={search}
          placeholder="Search by name, SKU or barcode"
          onChange={(event) => setSearch(event.target.value)}
        />

        {query.length > 0 && (
          <Card className="mt-3">
            {products.isLoading && !products.data ? (
              <Loading />
            ) : (products.data?.rows.length ?? 0) === 0 ? (
              <Empty title="Nothing matched" hint="Try part of the name, or the SKU." />
            ) : (
              <Rows>
                {products.data?.rows.map((product) => (
                  <Row
                    key={product.id}
                    title={product.name}
                    subtitle={`${format.quantity(product.stockQty)} ${product.baseUnit} in stock${
                      product.ownership === 'other' ? ' · other stock' : ''
                    }`}
                    value={
                      adding === product.id ? (
                        <Spinner className="size-4" />
                      ) : (
                        format.money(product.salePrice)
                      )
                    }
                    valueNote={`per ${product.baseUnit}`}
                    onClick={() => void addProduct(product)}
                  />
                ))}
              </Rows>
            )}
          </Card>
        )}
      </Section>

      <Section title={`On this bill (${lines.length})`}>
        <Card>
          {lines.length === 0 ? (
            <Empty title="Nothing on the bill yet" hint="Search above and tap to add." />
          ) : (
            <Rows>
              {lines.map((line) => (
                <Row
                  key={line.key}
                  title={line.product.name}
                  subtitle={`${format.quantity(line.qty)} ${line.unitName} × ${format.money(line.rate)}${
                    line.lineDiscount > 0 ? ` − ${format.money(line.lineDiscount)}` : ''
                  }`}
                  value={format.money(
                    money(money(line.qty * money(line.rate)) - money(line.lineDiscount))
                  )}
                  valueNote="tap to change"
                  onClick={() => setEditing(line)}
                />
              ))}
            </Rows>
          )}
        </Card>
      </Section>

      {lines.length > 0 && (
        <>
          <Section>
            <Card className="p-4">
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Subtotal</dt>
                  <dd className="tabular-nums">{cash(totals.subtotal)}</dd>
                </div>
                {totals.discount > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Discount</dt>
                    <dd className="tabular-nums">−{cash(totals.discount)}</dd>
                  </div>
                )}
                {totals.tax > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Tax ({taxRate}%)</dt>
                    <dd className="tabular-nums">{cash(totals.tax)}</dd>
                  </div>
                )}
                <div className="flex justify-between border-t border-line pt-2 text-md font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">{cash(totals.total)}</dd>
                </div>
              </dl>
            </Card>
          </Section>

          <Section>
            {!online && (
              <div className="mb-3">
                <Note tone="warn" title="Offline">
                  A bill can only be saved while the phone can reach the shop computer — it needs
                  today&rsquo;s stock and the next invoice number, and only that machine has them.
                </Note>
              </div>
            )}
            <Button variant="primary" block disabled={!online} onClick={() => setFinishOpen(true)}>
              Save bill · {cash(totals.total)}
            </Button>
          </Section>
        </>
      )}

      {/* ------------------------------------------------------- sheets */}

      <CustomerSheet
        open={customerOpen}
        current={customer}
        onClose={() => setCustomerOpen(false)}
        onPick={(picked) => {
          setCustomer(picked)
          setCustomerOpen(false)
        }}
      />

      <Sheet
        open={editing !== null}
        title={editing?.product.name ?? ''}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <div className="flex flex-col gap-4">
            {editing.units.length > 1 && (
              <Field label="Unit">
                <Select
                  value={editing.unitName}
                  onChange={(event) => void changeUnit(editing, event.target.value)}
                >
                  {editing.units.map((unit) => (
                    <option key={unit.unitName} value={unit.unitName}>
                      {unit.unitName}
                      {unit.isBase
                        ? ''
                        : ` (${format.quantity(unit.factor)} ${editing.product.baseUnit})`}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity">
                <AmountInput
                  value={String(editing.qty)}
                  onChange={(event) => patchLine(editing.key, { qty: num(event.target.value) })}
                />
              </Field>
              <Field label={`Rate per ${editing.unitName}`}>
                <AmountInput
                  value={String(editing.rate)}
                  onChange={(event) => patchLine(editing.key, { rate: num(event.target.value) })}
                />
              </Field>
            </div>

            <Field label="Discount on this line" hint="Leave at zero for none">
              <AmountInput
                value={String(editing.lineDiscount)}
                onChange={(event) =>
                  patchLine(editing.key, { lineDiscount: num(event.target.value) })
                }
              />
            </Field>

            <p className="text-sm text-ink-muted">
              In stock: {format.quantity(editing.product.stockQty)} {editing.product.baseUnit}
            </p>

            <div className="flex gap-3">
              <Button variant="danger" onClick={() => removeLine(editing.key)}>
                Remove
              </Button>
              <Button variant="primary" block onClick={() => setEditing(null)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={finishOpen} title="Finish this bill" onClose={() => setFinishOpen(false)}>
        <div className="flex flex-col gap-4">
          <Field label="Discount on the whole bill">
            <AmountInput
              value={discountText}
              placeholder="0"
              onChange={(event) => setDiscountText(event.target.value)}
            />
          </Field>

          <div className="rounded-xl border border-line bg-surface-sunken px-4 py-3">
            <div className="flex justify-between text-md font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{cash(totals.total)}</span>
            </div>
          </div>

          <Field label="Note on the bill" hint="Optional">
            <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>

          {save.error && <Note tone="bad">{save.error}</Note>}

          {!customer && (
            <Note tone="info">
              A walk-in bill has to be paid in full — there is no khata to put it on. Choose a
              customer above to bill on credit.
            </Note>
          )}

          <div className="flex flex-col gap-3">
            <Button variant="primary" block loading={save.isPending} onClick={() => finish('cash')}>
              Paid in full · {cash(totals.total)}
            </Button>

            {customer && (
              <>
                <Field label="Or, part paid now">
                  <AmountInput
                    value={paidText}
                    placeholder="0"
                    onChange={(event) => setPaidText(event.target.value)}
                  />
                </Field>
                <Button block loading={save.isPending} onClick={() => finish('partial')}>
                  Save part paid
                </Button>
                <Button block loading={save.isPending} onClick={() => finish('credit')}>
                  All on khata
                </Button>
              </>
            )}
          </div>
        </div>
      </Sheet>
    </Screen>
  )
}

/* ------------------------------------------------------- customer picker */

function CustomerSheet({
  open,
  current,
  onClose,
  onPick
}: {
  open: boolean
  current: Customer | null
  onClose: () => void
  onPick: (customer: Customer | null) => void
}): JSX.Element {
  const [search, setSearch] = useState('')
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const query = useDebounced(search, 250)

  const list = useRemote<PageWithTotals<Customer, PartyPageTotals>>(
    CHANNELS.customersList,
    { search: query, limit: 20 },
    [query, open]
  )

  const add = useAction(
    async () => remote.addCustomer({ name: newName.trim(), phone: newPhone.trim() || null }),
    {
      onSuccess: (customer) => {
        setAddOpen(false)
        setNewName('')
        setNewPhone('')
        onPick(customer)
      }
    }
  )

  return (
    <Sheet open={open} title="Who is this bill for?" onClose={onClose}>
      {addOpen ? (
        <div className="flex flex-col gap-4">
          <Field label="Name">
            <Input value={newName} autoFocus onChange={(event) => setNewName(event.target.value)} />
          </Field>
          <Field label="Phone" hint="Optional">
            <Input
              type="tel"
              value={newPhone}
              onChange={(event) => setNewPhone(event.target.value)}
            />
          </Field>
          {add.error && <Note tone="bad">{add.error}</Note>}
          <div className="flex gap-3">
            <Button block onClick={() => setAddOpen(false)}>
              Back
            </Button>
            <Button
              variant="primary"
              block
              loading={add.isPending}
              disabled={newName.trim().length === 0}
              onClick={() => void add.run()}
            >
              Add and use
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <SearchInput
            value={search}
            placeholder="Search customers"
            onChange={(event) => setSearch(event.target.value)}
          />

          <Card>
            <Rows>
              <Row
                title="Walk-in (cash)"
                subtitle="No khata — the bill must be paid in full"
                valueNote={current === null ? 'selected' : undefined}
                onClick={() => onPick(null)}
              />
              {list.data?.rows.map((customer) => (
                <Row
                  key={customer.id}
                  title={customer.name}
                  subtitle={customer.phone ?? '—'}
                  value={format.balanceLabel(customer.currentBalance, 'customer').text}
                  valueNote={current?.id === customer.id ? 'selected' : undefined}
                  onClick={() => onPick(customer)}
                />
              ))}
            </Rows>
          </Card>

          <Button block onClick={() => setAddOpen(true)}>
            Add a new customer
          </Button>
        </div>
      )}
    </Sheet>
  )
}
