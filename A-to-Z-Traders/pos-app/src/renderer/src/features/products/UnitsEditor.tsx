import clsx from 'clsx'
import type { JSX } from 'react'
import type { ProductUnitInput } from '@shared/types'
import { money } from '@shared/money'
import { Button } from '../../components/ui/Button'
import { Input, NumberInput } from '../../components/ui/Field'
import { useCurrency } from '../../app/SettingsContext'
import * as format from '../../lib/format'

/* The header and the rows under it are one grid repeated, so the column widths
   are named once — a header that drifts out of line with its rows is the whole
   point of having a header. */
const ROW_GRID = 'grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_34px] gap-2'

interface UnitsEditorProps {
  baseUnit: string
  basePrice: number
  units: ProductUnitInput[]
  onChange: (units: ProductUnitInput[]) => void
}

/**
 * Alternate units a product is bought or sold in, e.g. "1 box = 24 pieces" or
 * "1 sack = 50 kg". They can be larger than the base unit (a box, a sack) or
 * smaller (a 250 g pack of a kg-counted product): the "contains" amount is any
 * positive number, whole or fractional.
 *
 * The base unit is implicit and always first at factor 1, so it is shown as a
 * fixed line rather than an editable row — letting someone define a second
 * unit called "piece" with a different factor is how stock counts go wrong.
 *
 * Leaving the price blank is meaningful: the unit then sells at the base price
 * times its factor, which is what most shops want and what stops a box price
 * from silently going stale when the base price changes.
 */
export function UnitsEditor({
  baseUnit,
  basePrice,
  units,
  onChange
}: UnitsEditorProps): JSX.Element {
  const currency = useCurrency()

  const update = (index: number, patch: Partial<ProductUnitInput>): void => {
    onChange(units.map((unit, i) => (i === index ? { ...unit, ...patch } : unit)))
  }

  const add = (): void => {
    onChange([...units, { unitName: '', factor: 1, salePrice: null }])
  }

  const remove = (index: number): void => {
    onChange(units.filter((_, i) => i !== index))
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption leading-normal text-ink-subtle">
        Stock is counted in {baseUnit || 'the base unit'}. Add any other unit you buy or sell in — a
        bigger pack (a box of 24, a 50 {baseUnit || 'unit'} sack) or a smaller measure. The amount
        it contains can be a fraction.
      </p>

      {units.length === 0 ? (
        <div className="rounded-md border border-dashed border-line-strong p-4 text-center text-sm text-ink-subtle">
          Sold only by the {baseUnit || 'base unit'}.
        </div>
      ) : (
        <>
          <div className={clsx(ROW_GRID, 'text-caption font-medium text-ink-muted')}>
            <span>Unit name</span>
            <span>Contains ({baseUnit || 'base'})</span>
            <span>Price per unit</span>
            <span />
          </div>

          {units.map((unit, index) => (
            <div key={index}>
              <div className={clsx(ROW_GRID, 'items-center')}>
                <Input
                  value={unit.unitName}
                  placeholder="box"
                  onChange={(event) => update(index, { unitName: event.target.value })}
                />
                <NumberInput
                  value={unit.factor}
                  onValueChange={(value) => update(index, { factor: value })}
                />
                <NumberInput
                  prefix={currency}
                  value={unit.salePrice ?? ''}
                  placeholder={String(money(basePrice * unit.factor))}
                  onValueChange={(value) =>
                    update(index, { salePrice: value === 0 ? null : value })
                  }
                />
                <Button
                  variant="ghost"
                  icon="trash"
                  aria-label={`Remove ${unit.unitName || 'unit'}`}
                  onClick={() => remove(index)}
                />
              </div>
              {unit.unitName && unit.factor > 0 && (
                <div className="pl-[2px] text-caption text-ink-muted">
                  1 {unit.unitName} = {format.quantity(unit.factor)} {baseUnit} · sells at{' '}
                  {currency} {format.money(unit.salePrice ?? money(basePrice * unit.factor))}
                  {unit.salePrice === null && ' (follows the base price)'}
                </div>
              )}
            </div>
          ))}
        </>
      )}

      <div>
        <Button size="sm" icon="plus" onClick={add}>
          Add a unit
        </Button>
      </div>
    </div>
  )
}
