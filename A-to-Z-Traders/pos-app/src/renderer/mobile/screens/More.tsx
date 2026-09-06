import type { JSX } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { OtherStockReport, Settings } from '@shared/types'
import * as format from '@renderer/lib/format'
import { useShop } from '../App'
import { useOnline, useRemote } from '../lib/hooks'
import { CHANNELS } from '../lib/remote'
import { Button, Card, Note, Row, Rows, Screen, Section, Sheet, Tile, TopBar } from '../ui/kit'

/**
 * Everything that does not deserve a tab of its own, plus the way out.
 *
 * The note about what the phone cannot do is not an apology — it is the map.
 * Somebody who knows that purchases and bill edits live at the counter will
 * stop hunting for them here, and will understand why the two halves differ.
 */

export function MoreScreen(): JSX.Element {
  const { shop, signOut } = useShop()
  const navigate = useNavigate()
  const online = useOnline()
  const [aboutOpen, setAboutOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const settings = useRemote<Settings>(CHANNELS.settingsGet)
  const otherStock = useRemote<OtherStockReport>(CHANNELS.otherStockReport, {})

  const consignment = otherStock.data

  return (
    <Screen>
      <TopBar title="More" subtitle={shop.businessName} />

      <Section title="Go to">
        <Card>
          <Rows>
            <Row
              title="Stock"
              subtitle="What is on the shelf, and correcting a count"
              onClick={() => navigate('/stock')}
            />
            <Row
              title="Money"
              subtitle="Payments in and out, and expenses"
              onClick={() => navigate('/money')}
            />
            <Row
              title="Reports"
              subtitle="Profit and loss, valuation, and spreadsheets"
              onClick={() => navigate('/reports')}
            />
          </Rows>
        </Card>
      </Section>

      {consignment && consignment.rows.length > 0 && (
        <Section title="Other stock">
          <div className="grid grid-cols-2 gap-3">
            <Tile label="On hand" value={format.quantity(consignment.totals.onHand)} />
            <Tile
              label="Billed"
              value={format.currency(consignment.totals.billedAmount, shop.currency)}
            />
          </div>
          <p className="px-1 pt-3 text-caption text-ink-subtle">
            Goods the shop sells but does not own. Receiving them and sending them back is done at
            the counter, where they physically arrive.
          </p>
        </Section>
      )}

      <Section title="This connection">
        <Card className="p-4">
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-muted">Shop</dt>
              <dd className="text-right">{settings.data?.businessName || shop.businessName}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">Connection</dt>
              <dd className={online ? 'text-good' : 'text-bad'}>
                {online ? 'On the shop network' : 'Offline'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">Signed in for</dt>
              <dd>{Math.round(shop.sessionMinutes / 60)} hours of quiet</dd>
            </div>
          </dl>
        </Card>
      </Section>

      <Section>
        <div className="flex flex-col gap-3">
          <Button block onClick={() => setAboutOpen(true)}>
            What this phone can and cannot do
          </Button>
          <Button
            variant="danger"
            block
            loading={signingOut}
            onClick={() => {
              setSigningOut(true)
              void signOut().finally(() => setSigningOut(false))
            }}
          >
            Sign out
          </Button>
        </div>
        <p className="px-1 pt-3 text-caption text-ink-subtle">
          Signing out here does not touch the till. Everything this phone remembers is forgotten.
        </p>
      </Section>

      <Sheet open={aboutOpen} title="What this phone can do" onClose={() => setAboutOpen(false)}>
        <div className="flex flex-col gap-4 text-sm">
          <div>
            <h3 className="font-semibold text-ink">It writes into the same records</h3>
            <p className="mt-1 text-ink-muted">
              There is no separate phone database and nothing to sync. A bill written here is the
              same bill on the counter screen a second later, because it was written by the shop
              computer itself — this phone only asked it to.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-ink">Some things stay at the counter</h3>
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-ink-muted">
              <li>Changing what is on a bill, or cancelling one</li>
              <li>Entering a purchase, or a return of goods</li>
              <li>Receiving or sending back other stock</li>
              <li>Backups, sample data, staff accounts and settings</li>
            </ul>
            <p className="mt-2 text-ink-muted">
              Each of those either moves goods across the counter or changes who can get in. They
              belong where the paperwork and the goods are.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-ink">Off the Wi-Fi it can only look</h3>
            <p className="mt-1 text-ink-muted">
              What was last read stays readable, marked with when it was read. Nothing is saved for
              later: a bill held on a phone would be priced against stock it last saw and would need
              an invoice number only the shop computer can give it. Better to be told at the time.
            </p>
          </div>

          <Note tone="info">
            The shop computer can end this phone&rsquo;s session at any moment from its Settings
            screen — and does automatically whenever the app there is closed.
          </Note>
        </div>
      </Sheet>
    </Screen>
  )
}
