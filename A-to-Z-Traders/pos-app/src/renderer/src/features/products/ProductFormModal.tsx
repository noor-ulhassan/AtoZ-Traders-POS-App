import type { JSX } from 'react'
import { useState } from 'react'
import type { Category, ProductUnitInput, ProductWithUnits } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Field, Input, NumberInput, Select } from '../../components/ui/Field'
import { Callout } from '../../components/ui/Feedback'
import { Modal } from '../../components/ui/Modal'
import { FormGrid, GridCell, SectionLabel } from '../../components/ui/Surface'
import { useMutation } from '../../hooks/useMutation'
import { api, unwrap } from '../../lib/api'
import { useCurrency } from '../../app/SettingsContext'
import { UnitsEditor } from './UnitsEditor'

interface ProductFormModalProps {
  onClose: () => void
  onSaved: () => void
  categories: Category[]
  /** Null means "create". */
  product: ProductWithUnits | null
}

interface FormState {
  name: string
  sku: string
  barcode: string
  categoryId: string
  baseUnit: string
  costPrice: number
  salePrice: number
  reorderLevel: number
  openingStock: number
  units: ProductUnitInput[]
}

const EMPTY: FormState = {
  name: '',
  sku: '',
  barcode: '',
  categoryId: '',
  baseUnit: 'piece',
  costPrice: 0,
  salePrice: 0,
  reorderLevel: 0,
  openingStock: 0,
  units: []
}

/** Common base units in a wholesale shop, offered as a starting point. Weight
 *  and volume units are first-class: a product can be counted (and sold loose)
 *  in kg, grams, litres or millilitres, at fractional quantities. */
const BASE_UNITS = [
  'piece',
  'kg',
  'gram',
  'litre',
  'ml',
  'metre',
  'foot',
  'dozen',
  'pair',
  'packet',
  'bag'
]

function toFormState(product: ProductWithUnits | null): FormState {
  if (!product) return EMPTY
  return {
    name: product.name,
    sku: product.sku ?? '',
    barcode: product.barcode ?? '',
    categoryId: product.categoryId ? String(product.categoryId) : '',
    baseUnit: product.baseUnit,
    costPrice: product.costPrice,
    salePrice: product.salePrice,
    reorderLevel: product.reorderLevel,
    openingStock: 0,
    units: product.units.map((unit) => ({
      unitName: unit.unitName,
      factor: unit.factor,
      salePrice: unit.salePrice
    }))
  }
}

/**
 * The parent renders this only while the dialog is open, so the form starts
 * from the product it was opened with and no effect is needed to reset it
 * between openings.
 */
export function ProductFormModal({
  onClose,
  onSaved,
  categories,
  product
}: ProductFormModalProps): JSX.Element {
  const currency = useCurrency()
  const [form, setForm] = useState<FormState>(() => toFormState(product))
  const isEditing = product !== null

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setForm((current) => ({ ...current, [key]: value }))

  const save = useMutation(
    async () => {
      const input = {
        name: form.name,
        sku: form.sku || null,
        barcode: form.barcode || null,
        categoryId: form.categoryId ? Number(form.categoryId) : null,
        baseUnit: form.baseUnit,
        costPrice: form.costPrice,
        salePrice: form.salePrice,
        reorderLevel: form.reorderLevel,
        units: form.units,
        ...(isEditing ? {} : { openingStock: form.openingStock })
      }

      return isEditing
        ? unwrap(api.products.update(product.id, input))
        : unwrap(api.products.add(input))
    },
    {
      successMessage: isEditing ? 'Product updated' : 'Product added',
      onSuccess: () => {
        onSaved()
        onClose()
      }
    }
  )

  // Once a product has been purchased, its cost belongs to the weighted
  // average and a form must not overwrite it.
  const costIsLocked = isEditing && product.stockQty !== 0

  // Opening stock carries a cost: without one, every sale of that stock reports
  // pure profit (COGS of zero). We warn rather than block, because stock that
  // really was free is a valid case and 100% profit is then the honest number.
  const openingStockHasNoCost = !isEditing && form.openingStock > 0 && form.costPrice <= 0

  return (
    <Modal
      open
      onClose={onClose}
      title={isEditing ? `Edit ${product.name}` : 'New product'}
      description={
        isEditing
          ? 'Changes apply to future bills. Past bills keep the prices they were made with.'
          : 'Set how this item is counted, what it costs and what it sells for.'
      }
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => void save.run()}>
            {isEditing ? 'Save changes' : 'Add product'}
          </Button>
        </>
      }
    >
      <FormGrid>
        <GridCell span={8}>
          <Field label="Product name" required error={save.errors['input.name']}>
            <Input
              value={form.name}
              onChange={(event) => set('name', event.target.value)}
              placeholder="e.g. Sunflower cooking oil 5L"
              invalid={Boolean(save.errors['input.name'])}
            />
          </Field>
        </GridCell>

        <GridCell span={4}>
          <Field label="Category">
            <Select
              value={form.categoryId}
              onChange={(event) => set('categoryId', event.target.value)}
            >
              <option value="">No category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
        </GridCell>

        <GridCell span={4}>
          <Field label="SKU" hint="Your own item code" error={save.errors['input.sku']}>
            <Input value={form.sku} onChange={(event) => set('sku', event.target.value)} />
          </Field>
        </GridCell>

        <GridCell span={4}>
          <Field label="Barcode" hint="Scan here to fill">
            <Input value={form.barcode} onChange={(event) => set('barcode', event.target.value)} />
          </Field>
        </GridCell>

        <GridCell span={4}>
          <Field
            label="Base unit"
            required
            hint="Stock is counted in this unit"
            error={save.errors['input.baseUnit']}
          >
            <Input
              list="base-units"
              value={form.baseUnit}
              onChange={(event) => set('baseUnit', event.target.value)}
              disabled={isEditing && product.hasStockHistory}
            />
            <datalist id="base-units">
              {BASE_UNITS.map((unit) => (
                <option key={unit} value={unit} />
              ))}
            </datalist>
          </Field>
        </GridCell>

        <GridCell span={4}>
          <Field
            label={`Cost price per ${form.baseUnit || 'unit'}`}
            hint={
              costIsLocked
                ? 'Set by purchases (weighted average)'
                : isEditing
                  ? 'Updated automatically as you buy stock'
                  : 'The cost of your opening stock. Purchases update it automatically after that.'
            }
          >
            <NumberInput
              prefix={currency}
              value={form.costPrice}
              onValueChange={(value) => set('costPrice', value)}
              disabled={costIsLocked}
            />
          </Field>
        </GridCell>

        <GridCell span={4}>
          <Field
            label={`Sale price per ${form.baseUnit || 'unit'}`}
            required
            hint="Editable on every bill"
            error={save.errors['input.salePrice']}
          >
            <NumberInput
              prefix={currency}
              value={form.salePrice}
              onValueChange={(value) => set('salePrice', value)}
            />
          </Field>
        </GridCell>

        <GridCell span={4}>
          <Field label="Reorder level" hint="Warn when stock falls to this">
            <NumberInput
              value={form.reorderLevel}
              onValueChange={(value) => set('reorderLevel', value)}
            />
          </Field>
        </GridCell>

        {!isEditing && (
          <GridCell span={4}>
            <Field label="Opening stock" hint={`In ${form.baseUnit || 'base units'}`}>
              <NumberInput
                value={form.openingStock}
                onValueChange={(value) => set('openingStock', value)}
              />
            </Field>
          </GridCell>
        )}

        {openingStockHasNoCost && (
          <GridCell span={12}>
            <Callout tone="warn" title="Opening stock has no cost">
              Every sale of this opening stock will show as pure profit. Set the cost price above if
              these goods were not free.
            </Callout>
          </GridCell>
        )}

        <GridCell span={12}>
          <SectionLabel>Selling units</SectionLabel>
        </GridCell>

        <GridCell span={12}>
          <UnitsEditor
            baseUnit={form.baseUnit}
            basePrice={form.salePrice}
            units={form.units}
            onChange={(units) => set('units', units)}
          />
        </GridCell>

        {isEditing && product.hasStockHistory && (
          <GridCell span={12}>
            <Callout tone="info">
              The base unit of &ldquo;{product.name}&rdquo; is fixed because it already has stock
              history — changing it would reinterpret every past quantity.
              {product.stockQty !== 0 &&
                ` Its cost is the weighted average of what you paid and updates only through purchases.`}{' '}
              Use a stock adjustment to correct quantities.
            </Callout>
          </GridCell>
        )}
      </FormGrid>
    </Modal>
  )
}
