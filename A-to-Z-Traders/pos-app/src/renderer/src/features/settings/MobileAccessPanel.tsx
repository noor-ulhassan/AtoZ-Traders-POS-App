import type { JSX } from 'react'
import { useEffect } from 'react'
import type { MobileDevice, Settings } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Checkbox, Field, NumberInput } from '../../components/ui/Field'
import { Badge, Callout } from '../../components/ui/Feedback'
import { Card, CardBody, CardHeader } from '../../components/ui/Surface'
import { useConfirm } from '../../components/ui/Confirm'
import { useMutation } from '../../hooks/useMutation'
import { useQuery } from '../../hooks/useQuery'
import { useToast } from '../../components/ui/Toast'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'

interface MobileAccessPanelProps {
  form: Settings
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  /** True while the switch or the port on screen differ from what is saved. */
  isDirty: boolean
}

/** How often the card re-reads the server's state while it is on screen. */
const POLL_MS = 5000

/**
 * Phone access — the shop's own Wi-Fi, and nothing beyond it.
 *
 * The card has one job beyond the on/off switch: tell the owner the address to
 * type into his phone, and show him which phones are connected. Both matter
 * more than they look. The address is the only thing standing between him and
 * "it doesn't work", and the device list is the only way he can ever notice
 * that something he does not recognise is signed in to his books.
 *
 * The switch and the port are ordinary settings fields, saved with the page's
 * own Save button, because there must be exactly one saved copy of "is this
 * on" and the server follows it. That is why the card refuses to show an
 * address while there are unsaved changes: the address it could show would be
 * for the port that is running, not the one on screen.
 */
export function MobileAccessPanel({ form, set, isDirty }: MobileAccessPanelProps): JSX.Element {
  const confirm = useConfirm()
  const toast = useToast()

  const status = useQuery(() => unwrap(api.mobile.status()), [])
  const { refetch } = status

  // The server starts and stops behind this screen — a save takes a moment to
  // bind a port, and a phone can sign in or drop off at any time — so the card
  // re-reads rather than showing whatever was true when it was opened.
  useEffect(() => {
    const timer = setInterval(refetch, POLL_MS)
    return () => clearInterval(timer)
  }, [refetch])

  const signOut = useMutation(async (id?: string) => unwrap(api.mobile.signOut(id)), {
    errorTitle: 'Could not sign the phone out',
    onSuccess: () => refetch()
  })

  const askSignOutAll = async (devices: MobileDevice[]): Promise<void> => {
    const ok = await confirm({
      title: `Sign out ${format.pluralize(devices.length, 'phone')}?`,
      message:
        'Every phone will have to enter the shop password again before it can do anything. Nothing on this computer changes.',
      confirmLabel: 'Sign them out',
      destructive: true
    })
    if (ok) await signOut.run(undefined)
  }

  const copy = (url: string): void => {
    void navigator.clipboard
      ?.writeText(url)
      .then(() => toast.success('Address copied', url))
      .catch(() => toast.error('Could not copy', 'Type the address into the phone by hand.'))
  }

  const data = status.data
  const devices = data?.devices ?? []
  const badge = !form.mobileEnabled
    ? { tone: 'neutral' as const, label: 'Off' }
    : data?.running
      ? { tone: 'good' as const, label: 'On' }
      : { tone: 'bad' as const, label: 'Not running' }

  return (
    <Card>
      <CardHeader
        title="Phone access"
        subtitle="Use this shop from your phone, on the shop's own Wi-Fi"
        actions={<Badge tone={badge.tone}>{badge.label}</Badge>}
      />
      <CardBody>
        <p className="text-sm text-ink-muted">
          Turns this computer into the shop&rsquo;s own little server. A phone on the same Wi-Fi
          opens the address below in its browser, signs in with this shop&rsquo;s password, and can
          bill, take payments, look up a khata and read the reports — all writing straight into the
          records on this machine. Nothing goes to the internet.
        </p>

        <div className="mt-4">
          <Checkbox
            label="Let phones on the shop Wi-Fi connect to this computer"
            checked={form.mobileEnabled}
            onChange={(event) => set('mobileEnabled', event.target.checked)}
          />
        </div>

        {form.mobileEnabled && (
          <div className="mt-4 max-w-[220px]">
            <Field label="Port" hint="Change this only if another program is using it">
              <NumberInput
                value={form.mobilePort}
                onValueChange={(value) => set('mobilePort', Math.round(value))}
              />
            </Field>
          </div>
        )}

        {isDirty && (
          <div className="mt-4">
            <Callout tone="info">
              Press &ldquo;Save changes&rdquo; at the top of this page to apply this. The address
              below still describes what is running now.
            </Callout>
          </div>
        )}

        {data?.error && (
          <div className="mt-4">
            <Callout tone="bad" title="Phone access could not start">
              {data.error}
            </Callout>
          </div>
        )}

        {form.mobileEnabled && data?.running && (
          <div className="mt-4 rounded-md border border-line bg-surface-sunken p-4">
            {data.urls.length === 0 ? (
              <p className="text-sm text-ink-muted">
                This computer is not on a local network right now, so there is no address to give
                the phone. Connect it to the shop Wi-Fi and this will fill in.
              </p>
            ) : (
              <>
                <p className="text-caption text-ink-muted">
                  Open this in the phone&rsquo;s browser, then use its menu to{' '}
                  <strong className="text-ink">Add to Home screen</strong>. It will then open like
                  an app.
                </p>
                <ul className="mt-3 flex flex-col gap-2">
                  {data.urls.map((url) => (
                    <li key={url} className="flex items-center justify-between gap-3">
                      <code className="font-mono text-sm break-all text-ink" data-selectable>
                        {url}
                      </code>
                      <Button size="sm" variant="ghost" onClick={() => copy(url)}>
                        Copy
                      </Button>
                    </li>
                  ))}
                </ul>
                {data.urls.length > 1 && (
                  <p className="mt-3 text-caption text-ink-subtle">
                    This computer has more than one network address. Try the first; if the phone
                    cannot reach it, try the next.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {form.mobileEnabled && (
          <div className="mt-4">
            <Callout tone="warn" title="Two things to know">
              Windows may ask whether to allow this app on the network the first time — say yes, for
              private networks. And anyone who knows this shop&rsquo;s password and is on the same
              Wi-Fi can sign in, so keep the password to yourself and use the list below to check.
            </Callout>
          </div>
        )}

        <div className="mt-5 border-t border-line pt-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-ink">
              Phones signed in {devices.length > 0 && `(${devices.length})`}
            </span>
            {devices.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                loading={signOut.isPending}
                onClick={() => void askSignOutAll(devices)}
              >
                Sign out all
              </Button>
            )}
          </div>

          {devices.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">
              No phone is signed in. Every phone is signed out whenever this app closes.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {devices.map((device) => (
                <li
                  key={device.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2"
                >
                  <span className="flex min-w-0 flex-col gap-px leading-[1.35]">
                    <strong className="truncate text-sm font-medium">{device.device}</strong>
                    <span className="font-mono text-caption text-ink-subtle">{device.address}</span>
                    <span className="text-caption text-ink-muted">
                      Last used {format.dateTime(device.lastSeenAt)}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="close"
                    loading={signOut.isPending}
                    onClick={() => void signOut.run(device.id)}
                  >
                    Sign out
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
