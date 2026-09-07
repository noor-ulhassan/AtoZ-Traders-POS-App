import type { JSX } from 'react'
import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { SaleRevision, SaleWithItems } from '@shared/types'
import * as format from '@renderer/lib/format'
import { useShop } from '../App'
import { useAction, useOnline, useRemote } from '../lib/hooks'
import { CHANNELS, remote } from '../lib/remote'
import {
  AmountInput,
  Badge,
  Button,
  Card,
  Field,
  Loading,
  Note,
  Row,
  Rows,
  Screen,
  Section,
  Sheet,
  StaleBanner,
  TopBar
} from '../ui/kit'

/**
 * One bill, and the one thing the phone is for.
 *
 * **Settling** is here and editing is not, and that split is the whole reason
 * this screen exists. Settling is what happens on a delivery round: the bill
 * was right, and the owner now knows what came back with the goods. Rewriting
 * a bill's contents or cancelling it moves stock and restates what a past day
 * earned — that is done at the counter, with the printed copy in hand, so
 * `sales:update` and `sales:void` are not exposed to the network at all
 * (`mobile/channels.ts`).
 *
 * The warning about double-counting is repeated here word for word from the
 * desktop's settle dialog. It is the single easiest mistake to make in this
 * whole application, and it must read the same wherever it is made.
 */

export function BillDetailScreen(): JSX.Element {
  const { shop } = useShop()
  const { saleId } = useParams<{ saleId: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const online = useOnline()

  const id = Number(saleId)
  const isNew = params.get('new') === '1'

  const sale = useRemote<SaleWithItems>(CHANNELS.salesGet, { id }, [id])
  const revisions = useRemote<SaleRevision[]>(CHANNELS.salesRevisions, { id }, [id])

  const [settleOpen, setSettleOpen] = useState(false)
  const [paidText, setPaidText] = useState('')
  const [reason, setReason] = useState('')
  const [printed, setPrinted] = useState(false)

  const cash = (value: number): string => format.currency(value, shop.currency)

  const settle = useAction(
    async () =>
      remote.settleSale({
        id,
        paidAmount: Number(paidText.replace(/,/g, '')) || 0,
        reason: reason.trim() || null
      }),
    {
      onSuccess: () => {
        setSettleOpen(false)
        setReason('')
        sale.refetch()
        revisions.refetch()
      }
    }
  )

  const print = useAction(async () => remote.printReceipt(id), {
    onSuccess: () => setPrinted(true)
  })

  const data = sale.data
  const due = data ? Math.max(0, data.total - data.paidAmount) : 0

  return (
    <Screen>
      <TopBar
        title={data?.invoiceNo ?? 'Bill'}
        subtitle={
          data ? `${data.customerName ?? 'Walk-in'} · ${format.date(data.date)}` : undefined
        }
        onBack={() => (isNew ? navigate('/bills') : navigate(-1))}
      />
      {sale.isStale && <StaleBanner label={sale.staleLabel} />}

      {isNew && (
        <Section>
          <Note tone="good" title="Bill saved">
            Invoice {data?.invoiceNo} is written into the shop&rsquo;s records. It is on the till
            screen too.
          </Note>
        </Section>
      )}

      {sale.error && (
        <Section>
          <Note tone="bad">{sale.error}</Note>
        </Section>
      )}

      {!data ? (
        sale.isLoading ? (
          <Loading />
        ) : null
      ) : (
        <>
          {data.voidedAt && (
            <Section>
              <Note tone="bad" title="This bill was cancelled">
                Cancelled {format.dateTime(data.voidedAt)}. It keeps its number so the printed copy
                can always be answered, but every figure on it is zero.
              </Note>
            </Section>
          )}

          <Section title="Items">
            <Card>
              {data.items.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-ink-muted">
                  This bill has no lines.
                </div>
              ) : (
                <Rows>
                  {data.items.map((item) => (
                    <Row
                      key={item.id}
                      title={
                        <span className="flex items-center gap-2">
                          {item.productName}
                          {item.isOther && <Badge>other stock</Badge>}
                        </span>
                      }
                      subtitle={`${format.quantity(item.qty)} ${item.unitName} × ${format.money(item.rate)}`}
                      value={format.money(item.amount)}
                    />
                  ))}
                </Rows>
              )}
            </Card>
          </Section>

          <Section>
            <Card className="p-4">
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Subtotal</dt>
                  <dd className="tabular-nums">{cash(data.subtotal)}</dd>
                </div>
                {data.otherSubtotal > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">of which other stock</dt>
                    <dd className="tabular-nums">{cash(data.otherSubtotal)}</dd>
                  </div>
                )}
                {data.discount > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Discount</dt>
                    <dd className="tabular-nums">−{cash(data.discount)}</dd>
                  </div>
                )}
                {data.tax > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Tax</dt>
                    <dd className="tabular-nums">{cash(data.tax)}</dd>
                  </div>
                )}
                <div className="flex justify-between border-t border-line pt-2 text-md font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">{cash(data.total)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Paid</dt>
                  <dd className="tabular-nums">{cash(data.paidAmount)}</dd>
                </div>
                {due > 0 && (
                  <div className="flex justify-between font-semibold text-bad">
                    <dt>Still due</dt>
                    <dd className="tabular-nums">{cash(due)}</dd>
                  </div>
                )}
              </dl>
            </Card>
          </Section>

          {!data.voidedAt && (
            <Section>
              <div className="flex flex-col gap-3">
                <Button
                  variant="primary"
                  block
                  disabled={!online}
                  onClick={() => {
                    setPaidText(String(data.total))
                    setSettleOpen(true)
                  }}
                >
                  Record what was paid
                </Button>
                <Button
                  block
                  disabled={!online}
                  loading={print.isPending}
                  onClick={() => void print.run()}
                >
                  {printed ? 'Sent to the shop printer' : 'Print at the shop'}
                </Button>
                {print.error && <Note tone="bad">{print.error}</Note>}
              </div>
              <p className="px-1 pt-3 text-caption text-ink-subtle">
                Changing what is ON a bill, or cancelling it, is done at the shop computer. Those
                move stock and rewrite what a past day earned.
              </p>
            </Section>
          )}

          {(revisions.data?.length ?? 0) > 0 && (
            <Section title="History">
              <Card>
                <Rows>
                  {revisions.data?.map((revision) => (
                    <Row
                      key={revision.id}
                      title={`${revision.action === 'settle' ? 'Payment recorded' : revision.action === 'edit' ? 'Bill changed' : 'Bill cancelled'}`}
                      subtitle={`${format.dateTime(revision.createdAt)} · by ${revision.changedBy}${
                        revision.reason ? ` · ${revision.reason}` : ''
                      }`}
                      value={format.money(revision.snapshot.paidAmount)}
                      valueNote="was paid"
                    />
                  ))}
                </Rows>
              </Card>
            </Section>
          )}
        </>
      )}

      <Sheet
        open={settleOpen}
        title="What was paid on this bill?"
        onClose={() => setSettleOpen(false)}
      >
        <div className="flex flex-col gap-4">
          <Note tone="warn" title="This is not the same as a payment">
            Record it here when the money came back with the delivery, against this bill. Record it
            under Money → Payments when collecting against the khata generally. Doing both counts
            the same money twice.
          </Note>

          <Field
            label="Total received against this bill"
            hint="The whole amount received, not the extra you are adding now."
          >
            <AmountInput value={paidText} onChange={(event) => setPaidText(event.target.value)} />
          </Field>

          <div className="flex gap-2">
            <Button block onClick={() => setPaidText(String(data?.total ?? 0))}>
              Paid in full
            </Button>
            <Button block onClick={() => setPaidText('0')}>
              Nothing yet
            </Button>
          </div>

          <Field label="Why" hint="Optional — kept in the bill's history">
            <input
              className="w-full rounded-xl border border-line-strong bg-paper px-3 py-3 text-base"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Paid half on delivery"
            />
          </Field>

          {settle.error && <Note tone="bad">{settle.error}</Note>}

          <Button
            variant="primary"
            block
            loading={settle.isPending}
            onClick={() => void settle.run()}
          >
            Save
          </Button>
        </div>
      </Sheet>
    </Screen>
  )
}
