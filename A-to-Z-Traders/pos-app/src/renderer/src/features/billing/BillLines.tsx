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

/**
 * Explains a rate the screen filled in rather than the biller typing it.
 *
 * Carried as a tooltip on the rate field, which is marked with an accent bar
 * to show it did not come from the unit's own price. It used to be an inline
 * "Their price" label beside the input; on the ~660px this table actually gets
 * — a 1280px window, less the nav and the totals panel — that label took most
 * of the rate column and squeezed the item name down to one word per line.
 */
const PRICE_HINT: Partial<Record<BillLine['priceSource'], string>> = {
  customer_history: 'Their price — what this customer paid last time. Type over it to change it.'
}

/**
 * Six of the seven columns are sized; Item takes whatever is left.
 *
 * `table-fixed` is what makes those sizes hold. Under the default `auto`
 * layout a column is driven by its content, and an `<input>` asks for roughly
 * 180px whatever `w-full` says — so every entry column overran its declared
 * width and Item collapsed to the length of its longest word. The padding is
 * trimmed from the shared px-4 for the same reason: across seven columns that
 * alone was 224px of a table that only has 660.
 */
const GRID =
  '[&_table]:table-fixed [&_table]:min-w-[640px] ' +
  '[&_th]:px-2 [&_td]:px-2 [&_th:first-child]:pl-5 [&_td:first-child]:pl-5 ' +
  '[&_select]:pl-2 [&_select]:pr-7'

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
        const stock =
          remaining < 0
            ? `Short by ${format.qtyWithUnit(-remaining, line.product.baseUnit)}`
            : `${format.qtyWithUnit(remaining, line.product.baseUnit)} left after this`
        return (
          // Both lines are held to one line and clipped, with the whole text on
          // hover. A name long enough to wrap would give that row a different
          // height from the rest, and a grid the eye runs down has to keep its
          // rows level.
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium" title={line.product.name}>
                {line.product.name}
              </span>
              {line.product.ownership === 'other' && (
                <span className="shrink-0">
                  <Badge tone="neutral">{line.product.ownerName || 'Other stock'}</Badge>
                </span>
              )}
            </div>
            <div
              className={clsx(
                'truncate text-caption',
                remaining < 0 ? 'text-bad' : 'text-ink-subtle'
              )}
              title={stock}
            >
              {stock}
            </div>
          </div>
        )
      }
    },
    {
      key: 'unit',
      header: 'Unit',
      // Wide enough for a unit that carries its factor — "carton (12)" — since
      // a select clips rather than ellipsising, and "carton (1" would read as a
      // different pack size.
      width: '124px',
      render: (line) => (
        <Select value={line.unitName} onChange={(event) => onChangeUnit(line, event.target.value)}>
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
      width: '72px',
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
      width: '96px',
      render: (line, index) => {
        const hint = PRICE_HINT[line.priceSource]
        return (
          <NumberInput
            name={`bill-rate-${index}`}
            value={line.rate}
            title={hint}
            // An inset bar down the left edge rather than a tint or a coloured
            // border: `CONTROL` already sets background and border-colour, and
            // a utility that collides with one of those loses on Tailwind's
            // output order however it is written here. Nothing sets box-shadow
            // until focus, where the focus ring takes over — by which point
            // the rate is being typed over anyway.
            className={clsx(hint && 'shadow-[inset_3px_0_0_var(--accent)]')}
            onValueChange={(value) =>
              onUpdate(line.key, { rate: value, priceSource: 'unit_default' })
            }
          />
        )
      }
    },
    {
      key: 'discount',
      header: `Less (${currency})`,
      numeric: true,
      width: '80px',
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
      width: '104px',
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
        className={GRID}
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
