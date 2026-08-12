import type { JSX } from 'react'
import { useRef, useState } from 'react'
import type { Customer, PaymentType, Product, Receipt } from '@shared/types'
import { today } from '@shared/date'
import { money as round } from '@shared/money'
import { Button } from '../../components/ui/Button'
import { Combobox } from '../../components/ui/Combobox'
import { Field, Input, NumberInput, Textarea } from '../../components/ui/Field'
import { Callout } from '../../components/ui/Feedback'
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
import styles from './BillingPage.module.css'

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

  const searchRef = useRef<HTMLInputElement>(null)
  const paidRef = useRef<HTMLInputElement>(null)

  const productSearch = useProductSearch(productQuery)
  const customerSearch = usePartySearch('customer', customerQuery)
  const invoiceNo = useQuery(() => unwrap(api.sales.nextInvoiceNo()), [saved])

  const { totals } = bill
  const due = round(totals.total - paidAmount)

  /* ------------------------------------------------------------ payment */

  const choosePaymentType = (next: PaymentType): void => {
    setPaymentType(next)
    if (next === 'cash') setPaidAmount(totals.total)
    if (next === 'credit') setPaidAmount(0)
  }

  const addProduct = async (product: Product): Promise<void> => {
    await bill.addProduct(product, bill.customer?.id ?? null)
    setProductQuery('')
    // Cash bills are paid in full by definition, so keep the figure in step
    // as items are added rather than making the biller retype it.
    searchRef.current?.focus()
  }

  const chooseCustomer = (customer: Customer | null): void => {
    bill.setCustomer(customer)
    setCustomerQuery('')
  }

  /* --------------------------------------------------------------- save */

  const save = useMutation(
    async () => {
      const paid = paymentType === 'cash' ? totals.total : paidAmount
      const result = await unwrap(
        api.sales.create({
          customerId: bill.customer?.id ?? null,
          date,
          discount: bill.discount,
          paymentType,
          paidAmount: paid,
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
    if (bill.lines.length === 0) return
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
  }

  useHotkey('F4', () => paidRef.current?.focus(), { allowInInput: true })
  useHotkey('ctrl+enter', () => void submit(), { allowInInput: true })
  useHotkey('F8', () => void clearBill(), { allowInInput: true })

  const needsCustomer = due > 0.005 && !bill.customer

  return (
    <div className={styles.workspace}>
      {/* ------------------------------------------------------------ left */}
      <section className={styles.left}>
        <div className={styles.topBar}>
          <div>
            <span className={styles.invoiceLabel}>Invoice</span>
            <span className={styles.invoiceNo}>{invoiceNo.data ?? '—'}</span>
          </div>
          <div className={styles.topSpacer} />
          <label className={styles.dateField}>
            Date
            <Input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              style={{ width: 150 }}
            />
          </label>
          <Button icon="trash" onClick={() => void clearBill()} disabled={bill.lines.length === 0}>
            Clear
          </Button>
        </div>

        <div className={styles.scanRow}>
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
          <div className={styles.scanHint}>
            <span>
              <span className={styles.key}>Enter</span> add first match
            </span>
            <span>
              <span className={styles.key}>F4</span> amount received
            </span>
            <span>
              <span className={styles.key}>Ctrl</span>
              <span className={styles.key}>Enter</span> save bill
            </span>
            <span>
              <span className={styles.key}>F8</span> clear
            </span>
          </div>
        </div>

        <div className={styles.lines}>
          <BillLines
            lines={bill.lines}
            currency={settings.currency}
            onUpdate={bill.updateLine}
            onChangeUnit={(line, unitName) =>
              void bill.changeUnit(line, unitName, bill.customer?.id ?? null)
            }
            onRemove={bill.removeLine}
          />
        </div>
      </section>

      {/* ----------------------------------------------------------- right */}
      <aside className={styles.panel}>
        <div className={styles.panelScroll}>
          <div className={styles.panelSection}>
            <Field
              label="Customer"
              hint={bill.customer ? undefined : 'Leave empty for a walk-in cash sale'}
            >
              {bill.customer ? (
                <div className={styles.customerCard}>
                  <div>
                    <div className={styles.customerName}>{bill.customer.name}</div>
                    <div className={styles.customerMeta}>
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
                />
              )}
            </Field>
          </div>

          <div className={styles.panelSection}>
            <div className={styles.stack}>
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

          <div className={styles.grandTotal}>
            <span className={styles.grandTotalLabel}>Total {settings.currency}</span>
            <span className={styles.grandTotalValue}>{format.money(totals.total)}</span>
          </div>

          <div className={styles.panelSection}>
            <div className={styles.paymentTabs} role="group" aria-label="Payment type">
              {(['cash', 'partial', 'credit'] as PaymentType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`${styles.paymentTab} ${paymentType === type ? styles.paymentTabActive : ''}`}
                  disabled={type !== 'cash' && !bill.customer}
                  title={type !== 'cash' && !bill.customer ? 'Choose a customer first' : undefined}
                  onClick={() => choosePaymentType(type)}
                >
                  {type === 'cash' ? 'Paid in full' : type === 'partial' ? 'Part paid' : 'On khata'}
                </button>
              ))}
            </div>

            {paymentType !== 'credit' && (
              <Field label="Amount received">
                <NumberInput
                  ref={paidRef}
                  prefix={settings.currency}
                  size="lg"
                  value={paymentType === 'cash' ? totals.total : paidAmount}
                  disabled={paymentType === 'cash'}
                  onValueChange={setPaidAmount}
                />
                {paymentType === 'partial' && (
                  <div className={styles.quickAmounts}>
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

            <div style={{ marginTop: 'var(--space-3)' }}>
              <SummaryList
                rows={[
                  {
                    label: paymentType === 'cash' ? 'Change to return' : 'Goes on khata',
                    value: format.money(Math.max(0, due)),
                    tone: due > 0.005 ? 'bad' : undefined,
                    emphasis: true
                  }
                ]}
              />
            </div>
          </div>

          <div className={styles.panelSection}>
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
            <div className={styles.panelSection}>
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
            <div className={styles.panelSection}>
              <Callout tone="warn" title="Choose a customer">
                An unpaid amount has to go on someone&apos;s khata.
              </Callout>
            </div>
          )}
        </div>

        <div className={styles.actions}>
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
