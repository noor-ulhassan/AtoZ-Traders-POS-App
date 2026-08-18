import type { JSX } from 'react'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Customer, Product, SellableUnit } from '@shared/types'
import { today } from '@shared/date'
import { money as round, sumMoney } from '@shared/money'
import { Button } from '../../components/ui/Button'
import { ChosenValue } from '../../components/ui/ChosenValue'
import { Combobox } from '../../components/ui/Combobox'
import { Field, Input, NumberInput, Select, Textarea } from '../../components/ui/Field'
import { Callout } from '../../components/ui/Feedback'
import { Card, CardBody, CardHeader } from '../../components/ui/Surface'
import { Column, DataTable, PrimaryCell } from '../../components/ui/DataTable'
import { SummaryList } from '../../components/ui/SummaryList'
import { PageBody, PageHeader } from '../../components/layout/PageHeader'
import { useMutation } from '../../hooks/useMutation'
import { usePartySearch } from '../../hooks/usePartySearch'
import { useProductSearch } from '../../hooks/useProductSearch'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useCurrency } from '../../app/SettingsContext'

interface Line {
  key: number
  product: Product
  units: SellableUnit[]
  unitName: string
  factor: number
  qty: number
  /** Cost for ONE of the chosen unit, as it appears on the supplier's bill. */
  unitCost: number
}

/**
 * Recording stock coming in.
 *
 * Cost is entered per purchased unit — a supplier bills "1 carton = 1,200",
 * not "50 per piece" — and the service converts to a per-base cost before it
 * recalculates the weighted average.
 */
export function PurchaseEntryPage(): JSX.Element {
  const currency = useCurrency()
  const navigate = useNavigate()

  const [supplier, setSupplier] = useState<Customer | null>(null)
  const [supplierQuery, setSupplierQuery] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [date, setDate] = useState(today())
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [discount, setDiscount] = useState(0)
  const [paidAmount, setPaidAmount] = useState(0)
  const [productQuery, setProductQuery] = useState('')

  // Line identity has to survive re-ordering and removal, and a product can
  // legitimately appear twice at different costs — so keys are counter-based.
  const nextKey = useRef(1)
  const supplierSearch = usePartySearch('supplier', supplierQuery)
  const productSearch = useProductSearch(productQuery)

  const addProduct = async (product: Product): Promise<void> => {
    const units = await unwrap(api.products.sellableUnits(product.id))
    const base = units[0] as SellableUnit

    setLines((current) => [
      ...current,
      {
        key: nextKey.current++,
        product,
        units,
        unitName: base.unitName,
        factor: base.factor,
        // The last known cost is the best guess; the buyer confirms or edits it.
        unitCost: round(product.costPrice * base.factor),
        qty: 1
      }
    ])
    setProductQuery('')
  }

  const updateLine = (key: number, patch: Partial<Line>): void => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  const changeUnit = (line: Line, unitName: string): void => {
    const unit = line.units.find((candidate) => candidate.unitName === unitName)
    if (!unit) return
    updateLine(line.key, {
      unitName: unit.unitName,
      factor: unit.factor,
      unitCost: round(line.product.costPrice * unit.factor)
    })
  }

  const removeLine = (key: number): void => {
    setLines((current) => current.filter((line) => line.key !== key))
  }

  const subtotal = sumMoney(lines.map((line) => round(line.qty * line.unitCost)))
  const total = round(subtotal - discount)
  const owing = round(total - paidAmount)

  const save = useMutation(
    async () =>
      unwrap(
        api.purchases.create({
          supplierId: supplier?.id ?? null,
          invoiceNo: invoiceNo || null,
          date,
          discount,
          paidAmount,
          notes: notes || null,
          items: lines.map((line) => ({
            productId: line.product.id,
            unitName: line.unitName,
            qty: line.qty,
            unitCost: line.unitCost
          }))
        })
      ),
    {
      successMessage: 'Purchase recorded — stock and costs updated',
      onSuccess: () => navigate('/purchases'),
      errorTitle: 'Could not record the purchase'
    }
  )

  const columns: Column<Line>[] = [
    {
      key: 'product',
      header: 'Item',
      render: (line) => (
        <PrimaryCell
          title={line.product.name}
          subtitle={`In stock: ${format.qtyWithUnit(line.product.stockQty, line.product.baseUnit)}`}
        />
      )
    },
    {
      key: 'unit',
      header: 'Unit',
      width: '140px',
      render: (line) => (
        <Select
          className="min-w-[110px]"
          value={line.unitName}
          onChange={(event) => changeUnit(line, event.target.value)}
        >
          {line.units.map((unit) => (
            <option key={unit.unitName} value={unit.unitName}>
              {unit.unitName}
              {unit.isBase ? '' : ` (${format.quantity(unit.factor)})`}
            </option>
          ))}
        </Select>
      )
    },
    {
      key: 'qty',
      header: 'Quantity',
      numeric: true,
      width: '120px',
      render: (line) => (
        <NumberInput
          value={line.qty}
          onValueChange={(value) => updateLine(line.key, { qty: value })}
        />
      )
    },
    {
      key: 'cost',
      header: `Cost per unit (${currency})`,
      numeric: true,
      width: '160px',
      render: (line) => (
        <NumberInput
          value={line.unitCost}
          onValueChange={(value) => updateLine(line.key, { unitCost: value })}
        />
      )
    },
    {
      key: 'base',
      header: 'Adds to stock',
      numeric: true,
      width: '130px',
      render: (line) => (
        <span style={{ color: 'var(--ink-muted)' }}>
          {format.qtyWithUnit(line.qty * line.factor, line.product.baseUnit)}
        </span>
      )
    },
    {
      key: 'amount',
      header: `Amount (${currency})`,
      numeric: true,
      width: '140px',
      render: (line) => <strong>{format.money(line.qty * line.unitCost)}</strong>
    },
    {
      key: 'remove',
      header: '',
      width: '48px',
      render: (line) => (
        <Button
          size="sm"
          variant="ghost"
          icon="close"
          aria-label={`Remove ${line.product.name}`}
          onClick={() => removeLine(line.key)}
        />
      )
    }
  ]

  return (
    <>
      <PageHeader
        back={{ to: '/purchases', label: 'Purchases' }}
        title="Record purchase"
        subtitle="Bringing stock in updates quantity and recalculates the average cost"
        actions={
          <>
            <Button onClick={() => navigate('/purchases')}>Cancel</Button>
            <Button
              variant="primary"
              loading={save.isPending}
              disabled={lines.length === 0 || (owing > 0.005 && !supplier)}
              onClick={() => void save.run()}
            >
              Save purchase
            </Button>
          </>
        }
      />

      <PageBody>
        <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-5">
          <Card>
            <div className="border-b border-line p-4">
              <label className="mb-1 block text-caption font-medium text-ink-muted">Add item</label>
              <Combobox
                query={productQuery}
                onQueryChange={setProductQuery}
                options={productSearch.options}
                onSelect={(option) => void addProduct(option.value)}
                placeholder="Search a product by name, SKU or barcode"
                noResults="No product matches. Add it under Products first."
                autoFocus
              />
            </div>

            <CardBody flush>
              <DataTable
                columns={columns}
                rows={lines}
                rowKey={(line) => line.key}
                empty={{
                  title: 'No items yet',
                  description: 'Search above to add what you bought, then set quantity and cost.'
                }}
              />
            </CardBody>
          </Card>

          <Card className="sticky top-[calc(var(--header-height)+24px)]">
            <CardHeader title="Purchase details" />
            <CardBody>
              <div className="flex flex-col gap-4">
                <Field label="Supplier" hint="Leave empty for a cash purchase with no account">
                  {supplier ? (
                    <ChosenValue
                      clearLabel="Clear supplier"
                      onClear={() => {
                        setSupplier(null)
                        setSupplierQuery('')
                      }}
                    >
                      {supplier.name}
                    </ChosenValue>
                  ) : (
                    <Combobox
                      query={supplierQuery}
                      onQueryChange={setSupplierQuery}
                      options={supplierSearch.options}
                      onSelect={(option) => {
                        setSupplier(option.value)
                        setSupplierQuery('')
                      }}
                      placeholder="Search suppliers"
                      noResults="No supplier matches"
                    />
                  )}
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Their invoice no.">
                    <Input
                      value={invoiceNo}
                      onChange={(event) => setInvoiceNo(event.target.value)}
                    />
                  </Field>
                  <Field label="Date">
                    <Input
                      type="date"
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                    />
                  </Field>
                </div>

                <Field label="Bill discount">
                  <NumberInput prefix={currency} value={discount} onValueChange={setDiscount} />
                </Field>

                <Field
                  label="Paid now"
                  hint={
                    supplier
                      ? 'The rest goes on the supplier account'
                      : 'Cash purchases must be paid in full'
                  }
                >
                  <NumberInput
                    prefix={currency}
                    size="lg"
                    value={paidAmount}
                    onValueChange={setPaidAmount}
                  />
                </Field>

                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setPaidAmount(total)}>
                    Paid in full
                  </Button>
                  <Button size="sm" onClick={() => setPaidAmount(0)}>
                    Nothing paid
                  </Button>
                </div>

                <Field label="Notes">
                  <Textarea
                    rows={2}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                </Field>
              </div>

              <SummaryList
                rows={[
                  { label: 'Subtotal', value: format.money(subtotal) },
                  ...(discount > 0
                    ? [{ label: 'Discount', value: `− ${format.money(discount)}` }]
                    : []),
                  { label: 'Total', value: format.money(total), emphasis: true },
                  { label: 'Paid now', value: format.money(paidAmount) },
                  {
                    label: 'Goes on account',
                    value: format.money(Math.max(0, owing)),
                    tone: owing > 0.005 ? 'bad' : undefined
                  }
                ]}
              />

              {owing > 0.005 && !supplier && (
                <div className="mt-4">
                  <Callout tone="warn" title="Choose a supplier">
                    An unpaid amount has to sit on someone&apos;s account. Pick a supplier, or mark
                    the purchase as paid in full.
                  </Callout>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </PageBody>
    </>
  )
}
