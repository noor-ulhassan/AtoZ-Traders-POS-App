import clsx from 'clsx'
import type { JSX, KeyboardEvent, RefObject } from 'react'
import { money, qty as roundQty } from '@shared/money'
import { Button } from '../../components/ui/Button'
import { NumberInput, Select } from '../../components/ui/Field'
import { Column, DataTable } from '../../components/ui/DataTable'
import { Badge } from '../../components/ui/Feedback'
import * as format from '../../lib/format'
import type { BillLine } from './useBill'

interface BillLinesProps {
  lines: BillLine[]
  currency: string
  onUpdate: (key: number, patch: Partial<BillLine>) => void
  onChangeUnit: (line: BillLine, unitName: string) => void
  onRemove: (key: number) => void
  /** Enter/Escape/arrow-off-the-top return here — usually the product search. */
  onFocusSearch: () => void
  /** Attached to the table wrapper so the page can focus a specific cell (F3). */
  containerRef: RefObject<HTMLDivElement | null>
}

const FIELD_NAME = /^bill-(qty|rate|discount|amount)-(\d+)$/

/** Shown next to a rate the customer was given last time. */
const PRICE_FLAG: Partial<Record<BillLine['priceSource'], string>> = {
  customer_history: 'Their price'
}

export function BillLines({
  lines,
  currency,
  onUpdate,
  onChangeUnit,
  onRemove,
  onFocusSearch,
  containerRef
}: BillLinesProps): JSX.Element {
  /** Move focus to a specific editable cell; returns false if it isn't there. */
  const focusCell = (field: string, row: number): boolean => {
    const cell = containerRef.current?.querySelector<HTMLInputElement>(
      `input[name="bill-${field}-${row}"]`
    )
    cell?.focus()
    return Boolean(cell)
  }

  /**
   * Turns the line table into a keyboard grid: ↑/↓ walk a column, Enter/Escape
   * hand focus back to the search box for the next scan, and Alt+Delete drops
   * the current line — so a whole bill can be edited without the mouse.
   */
  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement
    if (target.tagName !== 'INPUT') return
    const match = FIELD_NAME.exec((target as HTMLInputElement).name)
    if (!match) return

    const field = match[1]
    const row = Number(match[2])

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        focusCell(field, row + 1)
        break
      case 'ArrowUp':
        event.preventDefault()
        if (!focusCell(field, row - 1)) onFocusSearch()
        break
      case 'Enter':
      case 'Escape':
        event.preventDefault()
        onFocusSearch()
        break
      case 'Delete':
        if (event.altKey) {
          event.preventDefault()
          const line = lines[row]
          if (line) {
            onRemove(line.key)
            // Land on the row that slid up into this slot, or the search box.
            requestAnimationFrame(() => {
              if (!focusCell(field, row) && !focusCell(field, row - 1)) onFocusSearch()
            })
          }
        }
        break
    }
  }

  const columns: Column<BillLine>[] = [
    {
      key: 'product',
      header: 'Item',
      render: (line) => {
        const remaining = line.product.stockQty - line.qty * line.factor
        return (
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{line.product.name}</span>
              {line.product.ownership === 'other' && (
                <Badge tone="neutral">{line.product.ownerName || 'Other stock'}</Badge>
              )}
            </div>
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
      render: (line, index) => (
        <NumberInput
          name={`bill-qty-${index}`}
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
      render: (line, index) => (
        <div className="flex items-center justify-end gap-2">
          {PRICE_FLAG[line.priceSource] && (
            <span className="text-[10px] font-semibold tracking-[0.04em] text-accent uppercase whitespace-nowrap">
              {PRICE_FLAG[line.priceSource]}
            </span>
          )}
          <NumberInput
            name={`bill-rate-${index}`}
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
      render: (line, index) => (
        <NumberInput
          name={`bill-discount-${index}`}
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
      // Editable, so a weight sale can be entered as money: type "250" and the
      // quantity is back-solved from the rate — "give me 250 of sugar".
      render: (line, index) => (
        <NumberInput
          name={`bill-amount-${index}`}
          value={money(line.qty * line.rate - line.lineDiscount)}
          onValueChange={(value) => {
            if (line.rate > 0) {
              onUpdate(line.key, { qty: roundQty((value + line.lineDiscount) / line.rate) })
            }
          }}
        />
      )
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
    <div ref={containerRef} onKeyDown={onGridKeyDown}>
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
    </div>
  )
}
