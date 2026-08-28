import type { JSX } from 'react'
import type { DemoStatus } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Badge, Callout } from '../../components/ui/Feedback'
import { Card, CardBody, CardHeader } from '../../components/ui/Surface'
import { useConfirm } from '../../components/ui/Confirm'
import { useMutation } from '../../hooks/useMutation'
import { useQuery } from '../../hooks/useQuery'
import { useToast } from '../../components/ui/Toast'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'

interface DemoDataPanelProps {
  /** Called after data is added or removed, so other screens re-read. */
  onChanged: () => void
}

/**
 * Sample data, for trying the app out before trusting it with real trade.
 *
 * The whole design rests on one promise, which this screen has to make
 * believable: the samples can be taken out again without touching anything the
 * owner typed. So the card states exactly what was added, and the remove button
 * says the count rather than a vague "clear".
 */
export function DemoDataPanel({ onChanged }: DemoDataPanelProps): JSX.Element {
  const confirm = useConfirm()
  const toast = useToast()

  const status = useQuery(() => unwrap(api.demo.status()), [])

  const refresh = (): void => {
    status.refetch()
    onChanged()
  }

  const seed = useMutation(async () => unwrap(api.demo.seed()), {
    errorTitle: 'Could not add the sample data',
    onSuccess: (result) => {
      if (!result) return
      toast.success(
        'Sample data added',
        `${format.pluralize(result.total, 'record')} created. Remove it here whenever you like.`
      )
      refresh()
    }
  })

  const clear = useMutation(async () => unwrap(api.demo.clear()), {
    errorTitle: 'Could not remove the sample data',
    onSuccess: (result) => {
      if (!result) return
      toast.success('Sample data removed', `${format.pluralize(result.removed, 'record')} deleted.`)
      refresh()
    }
  })

  const askSeed = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Add sample data?',
      message:
        'This fills the app with a made-up shop — products, customers, three months of bills, payments and expenses — so you can try every screen. Anything you have already entered is left alone, and the samples can be removed again at any time.',
      confirmLabel: 'Add sample data'
    })
    if (ok) await seed.run()
  }

  const askClear = async (data: DemoStatus): Promise<void> => {
    const ok = await confirm({
      title: `Remove ${format.pluralize(data.total, 'sample record')}?`,
      message:
        'Every record the sample data created will be deleted. Anything you entered yourself is untouched, and your stock and khata figures are recalculated afterwards.',
      confirmLabel: 'Remove sample data',
      destructive: true
    })
    if (ok) await clear.run()
  }

  const data = status.data
  const blocked = (data?.blockers.length ?? 0) > 0

  return (
    <Card>
      <CardHeader
        title="Sample data"
        subtitle="A made-up shop to try the app with"
        actions={data?.present ? <Badge tone="warn">Loaded</Badge> : undefined}
      />
      <CardBody>
        {!data ? (
          <p className="text-sm text-ink-muted">Checking…</p>
        ) : data.present ? (
          <>
            <p className="text-sm text-ink-muted">
              This app is holding {format.pluralize(data.total, 'sample record')}, added{' '}
              {format.dateTime(data.createdAt)}. They are mixed in with your own records on every
              screen — remove them before you start trading for real.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-line bg-surface-sunken p-4 text-sm">
              {data.counts.map((entry) => (
                <div key={entry.label} className="contents">
                  <span className="text-ink-muted">{entry.label}</span>
                  <span className="text-right tabular-nums">{entry.count}</span>
                </div>
              ))}
            </div>

            {blocked && (
              <div className="mt-4">
                <Callout tone="warn" title="Some of your own records depend on these">
                  {data.blockers.join('. ')}. Delete or re-enter those first — removing the samples
                  now would leave your records pointing at nothing.
                </Callout>
              </div>
            )}

            <div className="mt-5">
              <Button
                variant="danger"
                icon="trash"
                loading={clear.isPending}
                disabled={blocked}
                onClick={() => void askClear(data)}
              >
                Remove sample data
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              Fills the app with a made-up shop — products, customers, suppliers, three months of
              bills, returns, payments and expenses — so you can see how every screen behaves with
              real-looking numbers in it.
            </p>
            <p className="mt-3 text-sm text-ink-muted">
              It includes a staff login (<strong className="text-ink">salesman</strong>, PIN{' '}
              <strong className="text-ink">1234</strong>) so you can see what a shopkeeper is
              allowed to do. Anything you have already entered is left alone.
            </p>

            <div className="mt-5">
              <Button icon="plus" loading={seed.isPending} onClick={() => void askSeed()}>
                Add sample data
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  )
}
