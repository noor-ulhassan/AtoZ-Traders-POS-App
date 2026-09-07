import type { JSX } from 'react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Page, ProductWithUnits, StockMovement } from '@shared/types'
import * as format from '@renderer/lib/format'
import { useShop } from '../App'
import { useAction, useOnline, useRemote } from '../lib/hooks'
import { CHANNELS, remote } from '../lib/remote'
import {
  AmountInput,
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Loading,
  Note,
  Row,
  Rows,
  Screen,
  Section,
  Sheet,
  StaleBanner,
  Tile,
  TopBar
} from '../ui/kit'

/**
 * One product: what is on the shelf, and how it got there.
 *
 * The adjustment form asks for the counted quantity, not the difference,
 * because that is what the person holding the phone actually has — they are
 * standing in front of the goods with a number in their head. The difference
 * is arithmetic, and arithmetic is the machine's job.
 *
 * It insists on a reason for the same purpose the desktop does: `stock_movements`
 * is the source of truth for every stock figure in the application, and a
 * correction with no explanation is a hole in that record a month later.
 */

const REASONS: Record<string, string> = {
  opening: 'Opening stock',
  purchase: 'Purchase',
  sale: 'Sold',
  sale_return: 'Returned by customer',
  purchase_return: 'Returned to supplier',
  adjustment: 'Adjustment',
  other_in: 'Other stock received',
  other_out: 'Other stock sent back'
}

export function ProductDetailScreen(): JSX.Element {
  const { shop } = useShop()
  const navigate = useNavigate()
  const { productId } = useParams<{ productId: string }>()
  const online = useOnline()

  const id = Number(productId)
  const [adjustOpen, setAdjustOpen] = useState(false)

  const product = useRemote<ProductWithUnits>(CHANNELS.productsGet, { id }, [id])
  const movements = useRemote<Page<StockMovement>>(
    CHANNELS.stockMovements,
    { productId: id, limit: 25 },
    [id]
  )

  const data = product.data

  return (
    <Screen>
      <TopBar
        title={data?.name ?? 'Product'}
        subtitle={data?.categoryName ?? undefined}
        onBack={() => navigate(-1)}
      />
      {product.isStale && <StaleBanner label={product.staleLabel} />}

      {product.error && (
        <Section>
          <Note tone="bad">{product.error}</Note>
        </Section>
      )}

      {!data ? (
        product.isLoading ? (
          <Loading />
        ) : null
      ) : (
        <>
          <Section>
            <div className="grid grid-cols-2 gap-3">
              <Tile
                label={`In stock (${data.baseUnit})`}
                value={format.quantity(data.stockQty)}
                tone={data.stockQty <= data.reorderLevel ? 'bad' : 'neutral'}
              />
              <Tile
                label={`Sells at (per ${data.baseUnit})`}
                value={format.currency(data.salePrice, shop.currency)}
              />
            </div>
          </Section>

          {data.ownership === 'other' && (
            <Section>
              <Note tone="info" title="These goods are not the shop's">
                Consignment stock belonging to {data.ownerName || 'someone else'}. It is billable
                and countable, and deliberately kept out of every cost, profit and stock-value
                figure. Receiving it and sending it back are done at the counter.
              </Note>
            </Section>
          )}

          <Section>
            <Card className="p-4">
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-muted">SKU</dt>
                  <dd className="font-mono text-caption">{data.sku ?? '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Barcode</dt>
                  <dd className="font-mono text-caption">{data.barcode ?? '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Reorder level</dt>
                  <dd className="tabular-nums">
                    {format.quantity(data.reorderLevel)} {data.baseUnit}
                  </dd>
                </div>
                {data.ownership === 'own' && (
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Average cost</dt>
                    <dd className="tabular-nums">{format.money(data.costPrice)}</dd>
                  </div>
                )}
                {data.units.length > 0 && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-muted">Also sold as</dt>
                    <dd className="text-right">
                      {data.units
                        .map((unit) => `${unit.unitName} = ${format.quantity(unit.factor)}`)
                        .join(', ')}
                    </dd>
                  </div>
                )}
              </dl>
            </Card>
          </Section>

          <Section>
            <Button variant="primary" block disabled={!online} onClick={() => setAdjustOpen(true)}>
              Correct the stock count
            </Button>
          </Section>

          <Section title="Movements">
            <Card>
              {movements.isLoading && !movements.data ? (
                <Loading />
              ) : (movements.data?.rows.length ?? 0) === 0 ? (
                <Empty title="Nothing has moved yet" />
              ) : (
                <Rows>
                  {movements.data?.rows.map((movement) => (
                    <Row
                      key={movement.id}
                      title={
                        <span className="flex items-center gap-2">
                          {REASONS[movement.reason] ?? movement.reason}
                          {movement.reason === 'adjustment' && <Badge tone="warn">manual</Badge>}
                        </span>
                      }
                      subtitle={`${format.date(movement.date)}${movement.notes ? ` · ${movement.notes}` : ''}`}
                      value={
                        <span className={movement.changeQty < 0 ? 'text-bad' : 'text-good'}>
                          {movement.changeQty > 0 ? '+' : ''}
                          {format.quantity(movement.changeQty)}
                        </span>
                      }
                      valueNote={data.baseUnit}
                    />
                  ))}
                </Rows>
              )}
            </Card>
          </Section>

          <AdjustSheet
            open={adjustOpen}
            product={data}
            onClose={() => setAdjustOpen(false)}
            onSaved={() => {
              product.refetch()
              movements.refetch()
            }}
          />
        </>
      )}
    </Screen>
  )
}

function AdjustSheet({
  open,
  product,
  onClose,
  onSaved
}: {
  open: boolean
  product: ProductWithUnits
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const [counted, setCounted] = useState('')
  const [notes, setNotes] = useState('')

  const target = Number(counted.replace(/,/g, ''))
  const change = Number.isFinite(target) && counted.trim() !== '' ? target - product.stockQty : 0

  const save = useAction(
    async () =>
      remote.adjustStock({
        productId: product.id,
        changeQty: change,
        notes: notes.trim() || null
      }),
    {
      onSuccess: () => {
        setCounted('')
        setNotes('')
        onSaved()
        onClose()
      }
    }
  )

  return (
    <Sheet open={open} title="Correct the stock count" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">
          The app currently thinks there are{' '}
          <strong className="text-ink">
            {format.quantity(product.stockQty)} {product.baseUnit}
          </strong>
          . Enter what you have actually counted.
        </p>

        <Field label={`Counted (${product.baseUnit})`}>
          <AmountInput
            value={counted}
            autoFocus
            placeholder={String(product.stockQty)}
            onChange={(event) => setCounted(event.target.value)}
          />
        </Field>

        {counted.trim() !== '' && (
          <Note tone={change === 0 ? 'info' : change > 0 ? 'good' : 'warn'}>
            {change === 0
              ? 'That matches what the app already has — nothing will be recorded.'
              : `This records an adjustment of ${change > 0 ? '+' : ''}${format.quantity(change)} ${product.baseUnit}.`}
          </Note>
        )}

        <Field label="Why" hint="Kept on the stock ledger, so the figure can be explained later">
          <Input
            value={notes}
            placeholder="Counted on the shelf"
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>

        {save.error && <Note tone="bad">{save.error}</Note>}

        <Button
          variant="primary"
          block
          loading={save.isPending}
          disabled={change === 0}
          onClick={() => void save.run()}
        >
          Record the correction
        </Button>
      </div>
    </Sheet>
  )
}
