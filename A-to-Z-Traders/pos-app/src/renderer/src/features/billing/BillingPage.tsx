import type { JSX } from 'react'
import { useRef, useState } from 'react'
import type { Customer, PaymentType, Product, Receipt } from '@shared/types'
import { today } from '@shared/date'
import { money as round } from '@shared/money'
import { Button } from '../../components/ui/Button'
import { Combobox } from '../../components/ui/Combobox'
import { Field, Input, NumberInput, Textarea } from '../../components/ui/Field'
import { Callout } from '../../components/ui/Feedback'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { SummaryList } from '../../components/ui/SummaryList'
import { useConfirm } from '../../components/ui/Confirm'
import { useHotkey } from '../../hooks/useHotkey'
import { useMutation } from '../../hooks/useMutation'
import { usePartySearch } from '../../hooks/usePartySearch'
import { useProductSearch } from '../../hooks/useProductSearch'
import { useQuery } from '../../hooks/useQuery'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useSettings } from '../../app/SettingsContext'
import { BillLines } from './BillLines'
import { ReceiptModal } from './ReceiptModal'
import { useBill } from './useBill'

const PAYMENT_TYPES: { value: PaymentType; label: string }[] = [
  { value: 'cash', label: 'Paid in full' },
  { value: 'partial', label: 'Part paid' },
  { value: 'credit', label: 'On khata' }
]

/** A keyboard key in the shortcut hints under the search box. */
function Kbd({ children }: { children: string }): JSX.Element {
  return (
    <span className="rounded-sm border border-b-2 border-line-strong bg-surface-sunken px-[5px] py-px font-mono text-[11px] text-ink-muted">
      {children}
    </span>
  )
}

/**
 * The billing screen.
 *
 * Built to be run from the keyboard: the search box holds focus, a scanner's
 * Enter adds the first match, F4 jumps to the amount received and Ctrl+Enter
 * saves. The totals panel is fixed to the right so the figure the customer is
 * being told never moves.
 */
export function BillingPage(): JSX.Element {
  const { settings } = useSettings()
  const confirm = useConfirm()

  const bill = useBill({ taxEnabled: settings.taxEnabled, taxRate: settings.taxRate })
  const [date, setDate] = useState(today())
  const [productQuery, setProductQuery] = useState('')
  const [customerQuery, setCustomerQuery] = useState('')
  const [paymentType, setPaymentType] = useState<PaymentType>('cash')
  const [paidAmount, setPaidAmount] = useState(0)
  const [saved, setSaved] = useState<{ receipt: Receipt; saleId: number } | null>(null)
  // Blocks the page's own hotkeys while the "Clear this bill?" confirmation is
  // up — otherwise a reflexive Ctrl+Enter fires `submit()` on the still-intact
  // cart underneath the dialog, saving a sale the owner meant to discard.
  const [confirmingClear, setConfirmingClear] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)
  const paidRef = useRef<HTMLInputElement>(null)
  const customerRef = useRef<HTMLInputElement>(null)
  const paymentRef = useRef<HTMLDivElement>(null)
  const linesRef = useRef<HTMLDivElement>(null)

  const productSearch = useProductSearch(productQuery)
  const customerSearch = usePartySearch('customer', customerQuery)
  const invoiceNo = useQuery(() => unwrap(api.sales.nextInvoiceNo()), [saved])

  const { totals } = bill

  /*
   * A bill marked "paid in full" is paid in full by definition, so the amount
   * received tracks the total as items are added. Holding a stale figure in
   * state instead would leave a phantom balance the moment another item went
   * on the bill — and that balance would disable the save button.
   */
  const paidNow = paymentType === 'cash' ? totals.total : paidAmount
  const due = round(totals.total - paidNow)

  /* ------------------------------------------------------------ payment */

  const choosePaymentType = (next: PaymentType): void => {
    setPaymentType(next)
    if (next === 'credit') setPaidAmount(0)
    // Part payments start from whatever is already on screen, so the biller
    // types over a sensible figure rather than a zero.
    if (next === 'partial' && paidAmount === 0) setPaidAmount(totals.total)
  }

  const addProduct = async (product: Product): Promise<void> => {
    await bill.addProduct(product, bill.customer?.id ?? null)
    setProductQuery('')
    searchRef.current?.focus()
  }

  const chooseCustomer = (customer: Customer | null): void => {
    bill.setCustomer(customer)
    setCustomerQuery('')
  }

  /* --------------------------------------------------------------- save */

  const save = useMutation(
    async () => {
      const result = await unwrap(
        api.sales.create({
          customerId: bill.customer?.id ?? null,
          date,
          // Send the capped discount the totals panel is showing — not the raw
          // keyed figure. A discount typed larger than the subtotal is displayed
          // (and saved) as the subtotal; sending the raw value instead made the
          // server reject a bill whose on-screen total looked perfectly valid.
          discount: totals.discount,
          paymentType,
          paidAmount: paidNow,
          notes: bill.notes || null,
          items: bill.lines.map((line) => ({
            productId: line.product.id,
            unitName: line.unitName,
            qty: line.qty,
            rate: line.rate,
            lineDiscount: line.lineDiscount
          }))
        })
      )
      return result
    },
    {
      errorTitle: 'Could not save the bill',
      onSuccess: (result) => {
        if (!result) return
        setSaved({ receipt: result.receipt, saleId: result.sale.id })
        bill.reset()
        setPaymentType('cash')
        setPaidAmount(0)
        setDate(today())
      }
    }
  )

  const canSave = bill.lines.length > 0 && bill.shortages.length === 0 && !save.isPending

  const submit = async (): Promise<void> => {
    if (!canSave) return
    if (due > 0.005 && !bill.customer) return
    await save.run()
  }

  const clearBill = async (): Promise<void> => {
    if (bill.lines.length === 0 || confirmingClear) return
    setConfirmingClear(true)
    try {
      const ok = await confirm({
        title: 'Clear this bill?',
        message: 'The items entered so far will be discarded.',
        confirmLabel: 'Clear bill',
        destructive: true
      })
      if (ok) {
        bill.reset()
        setPaidAmount(0)
        setPaymentType('cash')
        searchRef.current?.focus()
      }
    } finally {
      setConfirmingClear(false)
    }
  }

  const focusSearch = (): void => searchRef.current?.focus()

  /** Jump to the quantity of the item just added, ready to type over the "1". */
  const focusLastQty = (): void => {
    if (bill.lines.length === 0) {
      focusSearch()
      return
    }
    linesRef.current
      ?.querySelector<HTMLInputElement>(`input[name="bill-qty-${bill.lines.length - 1}"]`)
      ?.focus()
  }

  /** Focus the selected payment segment; ←/→ then move between the three. */
  const focusPayment = (): void => {
    const control = paymentRef.current
    const target =
      control?.querySelector<HTMLButtonElement>('button[tabindex="0"]') ??
      control?.querySelector<HTMLButtonElement>('button:not([disabled])')
    target?.focus()
  }

  // Disabled while the clear-bill confirmation is open, so a reflexive
  // Ctrl+Enter (or any other page hotkey) cannot act on the cart underneath
  // an open "Clear this bill?" dialog.
  useHotkey('F2', focusSearch, { allowInInput: true, enabled: !confirmingClear })
  useHotkey('F3', focusLastQty, { allowInInput: true, enabled: !confirmingClear })
  useHotkey('F4', () => paidRef.current?.focus(), { allowInInput: true, enabled: !confirmingClear })
  useHotkey('F6', () => customerRef.current?.focus(), {
    allowInInput: true,
    enabled: !confirmingClear
  })
  useHotkey('F7', focusPayment, { allowInInput: true, enabled: !confirmingClear })
  useHotkey('ctrl+enter', () => void submit(), { allowInInput: true, enabled: !confirmingClear })
  useHotkey('F8', () => void clearBill(), { allowInInput: true, enabled: !confirmingClear })

  const needsCustomer = due > 0.005 && !bill.customer

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_380px] bg-canvas">
      {/* ------------------------------------------------------------ left */}
      <section className="flex min-h-0 min-w-0 flex-col border-r border-line bg-paper">
        <div className="flex shrink-0 items-center gap-4 border-b border-line px-5 py-3">
          <div>
            <span className="block text-micro font-semibold tracking-[0.07em] text-ink-subtle uppercase">
              Invoice
            </span>
            <span className="font-mono text-base font-semibold tracking-[-0.01em]">
              {invoiceNo.data ?? '—'}
            </span>
          </div>
          <div className="flex-1" />
          <label className="flex items-center gap-2 text-caption text-ink-muted">
            Date
            <div className="w-[150px] shrink-0">
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </div>
          </label>
          <Button icon="trash" onClick={() => void clearBill()} disabled={bill.lines.length === 0}>
            Clear
          </Button>
        </div>

        <div className="shrink-0 border-b border-line px-5 py-4">
          <Combobox
            query={productQuery}
            onQueryChange={setProductQuery}
            options={productSearch.options}
            onSelect={(option) => void addProduct(option.value)}
            placeholder="Scan a barcode or type an item name"
            noResults="Nothing matches. Check the name, or add the product first."
            inputRef={searchRef}
            size="lg"
            autoFocus
          />
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-subtle">
            <span>
              <Kbd>Enter</Kbd> add item
            </span>
            <span>
              <Kbd>F3</Kbd> edit qty
            </span>
            <span>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> move rows
            </span>
            <span>
              <Kbd>Alt</Kbd>
              <Kbd>Del</Kbd> remove line
            </span>
            <span>
              <Kbd>F6</Kbd> customer
            </span>
            <span>
              <Kbd>F7</Kbd> payment
            </span>
            <span>
              <Kbd>F4</Kbd> amount
            </span>
            <span>
              <Kbd>Ctrl</Kbd>
              <Kbd>Enter</Kbd> save
            </span>
            <span>
              <Kbd>F8</Kbd> clear
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <BillLines
            lines={bill.lines}
            currency={settings.currency}
            onUpdate={bill.updateLine}
            onChangeUnit={(line, unitName) =>
              void bill.changeUnit(line, unitName, bill.customer?.id ?? null)
            }
            onRemove={bill.removeLine}
            onFocusSearch={focusSearch}
            containerRef={linesRef}
          />
        </div>
      </section>

      {/* ----------------------------------------------------------- right */}
      <aside className="flex min-h-0 flex-col bg-paper">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="border-b border-line px-5 py-4">
            <Field
              label="Customer"
              hint={bill.customer ? undefined : 'Leave empty for a walk-in cash sale'}
            >
              {bill.customer ? (
                <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-sunken p-3">
                  <div>
                    <div className="text-sm font-semibold">{bill.customer.name}</div>
                    <div className="text-caption text-ink-muted">
                      {format.balanceLabel(bill.customer.currentBalance, 'customer').text}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    icon="close"
                    aria-label="Remove customer"
                    onClick={() => chooseCustomer(null)}
                  />
                </div>
              ) : (
                <Combobox
                  query={customerQuery}
                  onQueryChange={setCustomerQuery}
                  options={customerSearch.options}
                  onSelect={(option) => chooseCustomer(option.value)}
                  placeholder="Search by name or phone"
                  noResults="No customer matches"
                  inputRef={customerRef}
                />
              )}
            </Field>
          </div>

          <div className="border-b border-line px-5 py-4">
            <div className="flex flex-col gap-3">
              <Field label="Bill discount">
                <NumberInput
                  prefix={settings.currency}
                  value={bill.discount}
                  onValueChange={bill.setDiscount}
                />
              </Field>

              <SummaryList
                rows={[
                  { label: 'Items', value: bill.lines.length },
                  { label: 'Subtotal', value: format.money(totals.subtotal) },
                  ...(totals.discount > 0
                    ? [{ label: 'Discount', value: `− ${format.money(totals.discount)}` }]
                    : []),
                  ...(settings.taxEnabled
                    ? [{ label: `Tax (${settings.taxRate}%)`, value: format.money(totals.tax) }]
                    : []),
                  {
                    label: 'Profit on this bill',
                    value: format.money(totals.profit),
                    tone: totals.profit < 0 ? 'bad' : 'good'
                  }
                ]}
              />
            </div>
          </div>

          <div className="flex items-baseline justify-between gap-3 border-y border-accent-border bg-accent-weak px-5 py-4">
            <span className="text-micro font-semibold tracking-[0.07em] text-accent-ink uppercase">
              Total {settings.currency}
            </span>
            <span className="font-display text-2xl font-semibold tracking-[-0.02em] tabular-nums text-accent-ink">
              {format.money(totals.total)}
            </span>
          </div>

          <div className="border-b border-line px-5 py-4">
            <div className="mb-4" ref={paymentRef}>
              <SegmentedControl
                label="Payment type"
                fullWidth
                value={paymentType}
                onChange={choosePaymentType}
                options={PAYMENT_TYPES.map((type) => ({
                  ...type,
                  disabled: type.value !== 'cash' && !bill.customer,
                  title:
                    type.value !== 'cash' && !bill.customer ? 'Choose a customer first' : undefined
                }))}
              />
            </div>

            {paymentType !== 'credit' && (
              <Field label="Amount received">
                <NumberInput
                  ref={paidRef}
                  prefix={settings.currency}
                  size="lg"
                  value={paidNow}
                  disabled={paymentType === 'cash'}
                  onValueChange={setPaidAmount}
                />
                {paymentType === 'partial' && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[0.25, 0.5, 0.75].map((fraction) => (
                      <Button
                        key={fraction}
                        size="sm"
                        onClick={() => setPaidAmount(round(totals.total * fraction))}
                      >
                        {fraction * 100}%
                      </Button>
                    ))}
                  </div>
                )}
              </Field>
            )}

            <div className="mt-3">
              <SummaryList
                rows={[
                  {
                    label: due > 0.005 ? 'Goes on khata' : 'Balance',
                    value: format.money(Math.max(0, due)),
                    tone: due > 0.005 ? 'bad' : undefined,
                    emphasis: true
                  }
                ]}
              />
            </div>
          </div>

          <div className="border-b border-line px-5 py-4">
            <Field label="Notes">
              <Textarea
                rows={2}
                value={bill.notes}
                placeholder="Optional — appears on the bill record"
                onChange={(event) => bill.setNotes(event.target.value)}
              />
            </Field>
          </div>

          {bill.shortages.length > 0 && (
            <div className="border-b border-line px-5 py-4">
              <Callout tone="bad" title="Not enough stock">
                {bill.shortages
                  .map(
                    (shortage) =>
                      `${shortage.product.name}: ${format.quantity(shortage.product.stockQty)} in stock, bill needs ${format.quantity(shortage.needed)}`
                  )
                  .join('. ')}
                .
              </Callout>
            </div>
          )}

          {needsCustomer && (
            <div className="border-b border-line px-5 py-4">
              <Callout tone="warn" title="Choose a customer">
                An unpaid amount has to go on someone&apos;s khata.
              </Callout>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t border-line px-5 py-4">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={save.isPending}
            disabled={!canSave || needsCustomer}
            onClick={() => void submit()}
          >
            Save bill · {settings.currency} {format.money(totals.total)}
          </Button>
        </div>
      </aside>

      <ReceiptModal
        receipt={saved?.receipt ?? null}
        saleId={saved?.saleId ?? null}
        justSaved
        onClose={() => setSaved(null)}
      />
    </div>
  )
}
