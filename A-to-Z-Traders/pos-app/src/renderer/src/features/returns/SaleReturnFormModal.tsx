import type { JSX } from 'react'
import { useState } from 'react'
import type { Customer, Product, RefundType, SaleWithItems, SellableUnit } from '@shared/types'
import { today } from '@shared/date'
import { money as round, sumMoney } from '@shared/money'
import { Button } from '../../components/ui/Button'
import { ChosenValue } from '../../components/ui/ChosenValue'
import { Combobox } from '../../components/ui/Combobox'
import { Field, Input, NumberInput, Select, Textarea } from '../../components/ui/Field'
import { Callout } from '../../components/ui/Feedback'
import { Column, DataTable, PrimaryCell } from '../../components/ui/DataTable'
import { Modal } from '../../components/ui/Modal'
import { SummaryList } from '../../components/ui/SummaryList'
import { useDebounced } from '../../hooks/useDebounced'
import { useMutation } from '../../hooks/useMutation'
import { usePartySearch } from '../../hooks/usePartySearch'
import { useProductSearch } from '../../hooks/useProductSearch'
import { useQuery } from '../../hooks/useQuery'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useCurrency } from '../../app/SettingsContext'

interface SaleReturnFormModalProps {
  onClose: () => void
  onSaved: () => void
}

interface ReturnLine {
  key: number
  product: Product
  units: SellableUnit[]
  unitName: string
  factor: number
  qty: number
  rate: number
}

/**
 * Taking goods back from a customer.
 *
 * The bill is asked for first, because a return against a known invoice can
 * reuse that bill's rate and its captured cost — which is what makes the
 * profit reversal exact rather than approximate. Returns without a bill are
 * still allowed; they fall back to today's price and average cost.
 */
export function SaleReturnFormModal({ onClose, onSaved }: SaleReturnFormModalProps): JSX.Element {
  const currency = useCurrency()

  const [invoiceQuery, setInvoiceQuery] = useState('')
  const [sale, setSale] = useState<SaleWithItems | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [customerQuery, setCustomerQuery] = useState('')
  const [productQuery, setProductQuery] = useState('')
  const [lines, setLines] = useState<ReturnLine[]>([])
  const [refundType, setRefundType] = useState<RefundType>('cash')
  const [date, setDate] = useState(today())
  const [notes, setNotes] = useState('')
  const [nextKey, setNextKey] = useState(1)

  const debouncedInvoice = useDebounced(invoiceQuery, 200)
  const customerSearch = usePartySearch('customer', customerQuery)
  const productSearch = useProductSearch(productQuery)

  const invoiceMatches = useQuery(
    () =>
      debouncedInvoice.trim().length === 0
        ? Promise.resolve({ rows: [], total: 0 })
        : unwrap(api.sales.list({ search: debouncedInvoice.trim(), limit: 8 })),
    [debouncedInvoice]
  )

  const chooseSale = async (saleId: number): Promise<void> => {
    const full = await unwrap(api.sales.get(saleId))
    setSale(full)
    setInvoiceQuery('')

    // Pre-load the bill's lines at zero quantity: the biller ticks off what
    // actually came back rather than re-entering the whole bill.
    let key = nextKey
    const loaded: ReturnLine[] = []
    for (const item of full.items) {
      const units = await unwrap(api.products.sellableUnits(item.productId))
      const product = await unwrap(api.products.get(item.productId))
      loaded.push({
        key: key++,
        product,
        units,
        unitName: item.unitName,
        factor: item.factor,
        qty: 0,
        rate: item.rate
      })
    }
    setNextKey(key)
    setLines(loaded)
    if (full.customerId) setCustomer(await unwrap(api.customers.get(full.customerId)))
    // A credit bill is normally settled by reducing the khata, not cash back.
    setRefundType(full.paidAmount < full.total ? 'credit' : 'cash')
  }

  const addProduct = async (product: Product): Promise<void> => {
    const units = await unwrap(api.products.sellableUnits(product.id))
    const base = units[0] as SellableUnit
    setLines((current) => [
      ...current,
      {
        key: nextKey,
        product,
        units,
        unitName: base.unitName,
        factor: base.factor,
        qty: 1,
        rate: base.salePrice
      }
    ])
    setNextKey((key) => key + 1)
    setProductQuery('')
  }

  const updateLine = (key: number, patch: Partial<ReturnLine>): void =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))

  const activeLines = lines.filter((line) => line.qty > 0)
  const total = sumMoney(activeLines.map((line) => round(line.qty * line.rate)))

  const save = useMutation(
    async () =>
      unwrap(
        api.returns.sale.create({
          saleId: sale?.id ?? null,
          customerId: customer?.id ?? null,
          date,
          refundType,
          notes: notes || null,
          items: activeLines.map((line) => ({
            productId: line.product.id,
            unitName: line.unitName,
            qty: line.qty,
            rate: line.rate
          }))
        })
      ),
    {
      successMessage: 'Return recorded — stock is back in',
      errorTitle: 'Could not record the return',
      onSuccess: () => {
        onSaved()
        onClose()
      }
    }
  )

  const columns: Column<ReturnLine>[] = [
    {
      key: 'product',
      header: 'Item',
      render: (line) => (
        <PrimaryCell
          title={line.product.name}
          subtitle={`Back in stock: ${format.qtyWithUnit(line.qty * line.factor, line.product.baseUnit)}`}
        />
      )
    },
    {
      key: 'unit',
      header: 'Unit',
      width: '130px',
      render: (line) => (
        <Select
          value={line.unitName}
          disabled={sale !== null}
          onChange={(event) => {
            const unit = line.units.find((candidate) => candidate.unitName === event.target.value)
            if (unit) updateLine(line.key, { unitName: unit.unitName, factor: unit.factor })
          }}
        >
          {line.units.map((unit) => (
            <option key={unit.unitName} value={unit.unitName}>
              {unit.unitName}
            </option>
          ))}
        </Select>
      )
    },
    {
      key: 'qty',
      header: 'Returning',
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
      key: 'rate',
      header: `Rate (${currency})`,
      numeric: true,
      width: '140px',
      render: (line) => (
        <NumberInput
          value={line.rate}
          onValueChange={(value) => updateLine(line.key, { rate: value })}
        />
      )
    },
    {
      key: 'amount',
      header: `Refund (${currency})`,
      numeric: true,
      width: '130px',
      render: (line) => <strong>{format.money(line.qty * line.rate)}</strong>
    }
  ]

  return (
    <Modal
      open
      onClose={onClose}
      title="Record a sale return"
      description="Goods coming back from a customer"
      size="xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={activeLines.length === 0}
            loading={save.isPending}
            onClick={() => void save.run()}
          >
            Record return
          </Button>
        </>
      }
    >
      <div className="mb-4 flex items-start gap-4">
        <Field
          label="Original bill"
          hint="Recommended — keeps profit and stock exactly right"
          className="min-w-0 flex-1"
        >
          {sale ? (
            <ChosenValue
              clearLabel="Clear bill"
              onClear={() => {
                setSale(null)
                setLines([])
              }}
            >
              <strong>{sale.invoiceNo}</strong> · {format.date(sale.date)} ·{' '}
              {sale.customerName ?? 'Walk-in'}
            </ChosenValue>
          ) : (
            <Combobox
              query={invoiceQuery}
              onQueryChange={setInvoiceQuery}
              options={(invoiceMatches.data?.rows ?? []).map((row) => ({
                value: row,
                title: row.invoiceNo,
                subtitle: `${format.date(row.date)} · ${row.customerName ?? 'Walk-in'}`,
                meta: `${currency} ${format.money(row.total)}`
              }))}
              onSelect={(option) => void chooseSale(option.value.id)}
              placeholder="Search by invoice number or customer"
              noResults="No bill matches"
            />
          )}
        </Field>

        <Field label="Customer" className="min-w-0 flex-1">
          {customer ? (
            // With a bill attached the customer comes from it, so it cannot be
            // cleared independently.
            <ChosenValue
              clearLabel="Clear customer"
              onClear={sale ? undefined : () => setCustomer(null)}
            >
              {customer.name}
            </ChosenValue>
          ) : (
            <Combobox
              query={customerQuery}
              onQueryChange={setCustomerQuery}
              options={customerSearch.options}
              onSelect={(option) => setCustomer(option.value)}
              placeholder="Walk-in — search to attach a customer"
              noResults="No customer matches"
            />
          )}
        </Field>

        <Field label="Date" className="w-[170px] shrink-0">
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
      </div>

      {!sale && (
        <div className="mb-4">
          <Field label="Add item">
            <Combobox
              query={productQuery}
              onQueryChange={setProductQuery}
              options={productSearch.options}
              onSelect={(option) => void addProduct(option.value)}
              placeholder="Search a product"
              noResults="No product matches"
            />
          </Field>
        </div>
      )}

      <div className="mb-4 overflow-hidden rounded-md border border-line">
        <DataTable
          columns={columns}
          rows={lines}
          rowKey={(line) => line.key}
          compact
          empty={{
            title: 'Nothing to return yet',
            description: sale
              ? 'This bill has no items.'
              : 'Find the original bill above, or add the items being returned.'
          }}
        />
      </div>

      <div className="flex items-start gap-4">
        <Field label="Refund method" className="w-[170px] shrink-0">
          <Select
            value={refundType}
            onChange={(event) => setRefundType(event.target.value as RefundType)}
          >
            <option value="cash">Cash back</option>
            <option value="credit" disabled={!customer}>
              Reduce their khata
            </option>
          </Select>
        </Field>

        <Field label="Notes" className="min-w-0 flex-1">
          <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>

        <div className="w-[260px] shrink-0">
          <SummaryList
            rows={[
              { label: 'Items returning', value: activeLines.length },
              { label: `Refund total (${currency})`, value: format.money(total), emphasis: true }
            ]}
          />
        </div>
      </div>

      {refundType === 'credit' && !customer && (
        <Callout tone="warn" title="Choose a customer">
          Reducing a khata needs an account to reduce. Refund in cash instead.
        </Callout>
      )}
    </Modal>
  )
}
