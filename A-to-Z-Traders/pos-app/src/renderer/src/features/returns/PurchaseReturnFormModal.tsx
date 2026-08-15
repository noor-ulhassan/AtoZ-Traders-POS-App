import type { JSX } from 'react'
import { useState } from 'react'
import type { Customer, Product, SellableUnit } from '@shared/types'
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
import { useMutation } from '../../hooks/useMutation'
import { usePartySearch } from '../../hooks/usePartySearch'
import { useProductSearch } from '../../hooks/useProductSearch'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useCurrency } from '../../app/SettingsContext'

interface PurchaseReturnFormModalProps {
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
  unitCost: number
}

/**
 * Sending goods back to a supplier.
 *
 * Cost defaults to the current weighted average, which is what keeps the
 * average unchanged when returning stock bought at that average — the honest
 * default. It stays editable for the case where the supplier credits a
 * different figure.
 */
export function PurchaseReturnFormModal({
  onClose,
  onSaved
}: PurchaseReturnFormModalProps): JSX.Element {
  const currency = useCurrency()

  const [supplier, setSupplier] = useState<Customer | null>(null)
  const [supplierQuery, setSupplierQuery] = useState('')
  const [productQuery, setProductQuery] = useState('')
  const [lines, setLines] = useState<ReturnLine[]>([])
  const [date, setDate] = useState(today())
  const [notes, setNotes] = useState('')
  const [nextKey, setNextKey] = useState(1)

  const supplierSearch = usePartySearch('supplier', supplierQuery)
  const productSearch = useProductSearch(productQuery)

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
        unitCost: round(product.costPrice * base.factor)
      }
    ])
    setNextKey((key) => key + 1)
    setProductQuery('')
  }

  const updateLine = (key: number, patch: Partial<ReturnLine>): void =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))

  const total = sumMoney(lines.map((line) => round(line.qty * line.unitCost)))
  const shortages = lines.filter((line) => line.qty * line.factor > line.product.stockQty)

  const save = useMutation(
    async () =>
      unwrap(
        api.returns.purchase.create({
          supplierId: supplier?.id ?? null,
          date,
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
      successMessage: 'Return recorded — stock and payable updated',
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
          subtitle={`In stock: ${format.qtyWithUnit(line.product.stockQty, line.product.baseUnit)}`}
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
          onChange={(event) => {
            const unit = line.units.find((candidate) => candidate.unitName === event.target.value)
            if (!unit) return
            updateLine(line.key, {
              unitName: unit.unitName,
              factor: unit.factor,
              unitCost: round(line.product.costPrice * unit.factor)
            })
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
      key: 'amount',
      header: `Credit (${currency})`,
      numeric: true,
      width: '130px',
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
          onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
        />
      )
    }
  ]

  return (
    <Modal
      open
      onClose={onClose}
      title="Record a purchase return"
      description="Goods going back to a supplier"
      size="xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={lines.length === 0 || shortages.length > 0}
            loading={save.isPending}
            onClick={() => void save.run()}
          >
            Record return
          </Button>
        </>
      }
    >
      <div className="mb-4 flex items-start gap-4">
        <Field label="Supplier" className="min-w-0 flex-1" hint="The payable to reduce">
          {supplier ? (
            <ChosenValue clearLabel="Clear supplier" onClear={() => setSupplier(null)}>
              {supplier.name}
            </ChosenValue>
          ) : (
            <Combobox
              query={supplierQuery}
              onQueryChange={setSupplierQuery}
              options={supplierSearch.options}
              onSelect={(option) => setSupplier(option.value)}
              placeholder="Search suppliers"
              noResults="No supplier matches"
            />
          )}
        </Field>

        <Field label="Add item" className="min-w-0 flex-1">
          <Combobox
            query={productQuery}
            onQueryChange={setProductQuery}
            options={productSearch.options}
            onSelect={(option) => void addProduct(option.value)}
            placeholder="Search a product"
            noResults="No product matches"
          />
        </Field>

        <Field label="Date" className="w-[170px] shrink-0">
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
      </div>

      <div className="mb-4 overflow-hidden rounded-md border border-line">
        <DataTable
          columns={columns}
          rows={lines}
          rowKey={(line) => line.key}
          compact
          empty={{
            title: 'Nothing to return yet',
            description: 'Search above for the items going back to the supplier.'
          }}
        />
      </div>

      <div className="flex items-start gap-4">
        <Field label="Notes" className="min-w-0 flex-1">
          <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>

        <div className="w-[260px] shrink-0">
          <SummaryList
            rows={[
              { label: 'Lines', value: lines.length },
              { label: `Credit total (${currency})`, value: format.money(total), emphasis: true }
            ]}
          />
        </div>
      </div>

      {shortages.length > 0 && (
        <Callout tone="bad" title="Not enough stock to return">
          {shortages
            .map(
              (line) =>
                `${line.product.name}: ${format.quantity(line.product.stockQty)} in stock, returning ${format.quantity(line.qty * line.factor)}`
            )
            .join('. ')}
          .
        </Callout>
      )}
    </Modal>
  )
}
