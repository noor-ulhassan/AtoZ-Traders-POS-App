import type { JSX } from 'react'
import type { ProductUnitInput } from '@shared/types'
import { money } from '@shared/money'
import { Button } from '../../components/ui/Button'
import { Input, NumberInput } from '../../components/ui/Field'
import { useCurrency } from '../../app/SettingsContext'
import * as format from '../../lib/format'
import styles from './UnitsEditor.module.css'

interface UnitsEditorProps {
  baseUnit: string
  basePrice: number
  units: ProductUnitInput[]
  onChange: (units: ProductUnitInput[]) => void
}

/**
 * Alternate selling units, e.g. "1 box = 24 pieces".
 *
 * The base unit is implicit and always first at factor 1, so it is shown as a
 * fixed line rather than an editable row — letting someone define a second
 * unit called "piece" with a different factor is how stock counts go wrong.
 *
 * Leaving the price blank is meaningful: the unit then sells at the base price
 * times its factor, which is what most shops want and what stops a box price
 * from silently going stale when the piece price changes.
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
    <div className={styles.wrap}>
      <p className={styles.hint}>
        Stock is always counted in {baseUnit || 'the base unit'}. Add a larger unit here if you also
        sell by the box, dozen or bag.
      </p>

      {units.length === 0 ? (
        <div className={styles.empty}>Sold only by the {baseUnit || 'base unit'}.</div>
      ) : (
        <>
          <div className={styles.headerRow}>
            <span>Unit name</span>
            <span>Contains ({baseUnit || 'base'})</span>
            <span>Price per unit</span>
            <span />
          </div>

          {units.map((unit, index) => (
            <div key={index}>
              <div className={styles.row}>
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
                <div className={styles.equivalence}>
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
