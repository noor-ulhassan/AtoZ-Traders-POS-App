import clsx from 'clsx'
import type { JSX } from 'react'
import { Button } from '../../components/ui/Button'
import { NumberInput, Select } from '../../components/ui/Field'
import { Column, DataTable } from '../../components/ui/DataTable'
import * as format from '../../lib/format'
import type { BillLine } from './useBill'

interface BillLinesProps {
  lines: BillLine[]
  currency: string
  onUpdate: (key: number, patch: Partial<BillLine>) => void
  onChangeUnit: (line: BillLine, unitName: string) => void
  onRemove: (key: number) => void
}

/** Shown next to a rate the customer was given last time. */
const PRICE_FLAG: Partial<Record<BillLine['priceSource'], string>> = {
  customer_history: 'Their price'
}

export function BillLines({
  lines,
  currency,
  onUpdate,
  onChangeUnit,
  onRemove
}: BillLinesProps): JSX.Element {
  const columns: Column<BillLine>[] = [
    {
      key: 'product',
      header: 'Item',
      render: (line) => {
        const remaining = line.product.stockQty - line.qty * line.factor
        return (
          <div>
            <div className="font-medium">{line.product.name}</div>
            <div className={clsx('text-caption', remaining < 0 ? 'text-bad' : 'text-ink-subtle')}>
              {remaining < 0
                ? `Short by ${format.qtyWithUnit(-remaining, line.product.baseUnit)}`
                : `${format.qtyWithUnit(remaining, line.product.baseUnit)} left after this`}
            </div>
          </div>
        )
      }
    },
    {
      key: 'unit',
      header: 'Unit',
      width: '120px',
      render: (line) => (
        <Select
          className="min-w-[100px]"
          value={line.unitName}
          onChange={(event) => onChangeUnit(line, event.target.value)}
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
      header: 'Qty',
      numeric: true,
      width: '100px',
      render: (line) => (
        <NumberInput
          value={line.qty}
          onValueChange={(value) => onUpdate(line.key, { qty: value })}
        />
      )
    },
    {
      key: 'rate',
      header: `Rate (${currency})`,
      numeric: true,
      width: '170px',
      render: (line) => (
        <div className="flex items-center justify-end gap-2">
          {PRICE_FLAG[line.priceSource] && (
            <span className="text-[10px] font-semibold tracking-[0.04em] text-accent uppercase whitespace-nowrap">
              {PRICE_FLAG[line.priceSource]}
            </span>
          )}
          <NumberInput
            value={line.rate}
            onValueChange={(value) =>
              onUpdate(line.key, { rate: value, priceSource: 'unit_default' })
            }
          />
        </div>
      )
    },
    {
      key: 'discount',
      header: `Less (${currency})`,
      numeric: true,
      width: '120px',
      render: (line) => (
        <NumberInput
          value={line.lineDiscount}
          onValueChange={(value) => onUpdate(line.key, { lineDiscount: value })}
        />
      )
    },
    {
      key: 'amount',
      header: `Amount (${currency})`,
      numeric: true,
      width: '130px',
      render: (line) => <strong>{format.money(line.qty * line.rate - line.lineDiscount)}</strong>
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
          onClick={() => onRemove(line.key)}
        />
      )
    }
  ]

  return (
    <DataTable
      columns={columns}
      rows={lines}
      rowKey={(line) => line.key}
      empty={{
        title: 'Start the bill',
        description:
          'Scan a barcode or search for an item above. The rate fills in from what this customer paid last time, and you can type over it.'
      }}
    />
  )
}
