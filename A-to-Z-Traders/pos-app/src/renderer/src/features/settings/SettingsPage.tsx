import clsx from 'clsx'
import type { JSX, ReactNode } from 'react'
import { useState } from 'react'
import type { Settings } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Checkbox, Field, Input, NumberInput, Textarea } from '../../components/ui/Field'
import { Callout } from '../../components/ui/Feedback'
import { Card, CardBody, CardHeader, FormGrid, GridCell } from '../../components/ui/Surface'
import { PageBody, PageHeader } from '../../components/layout/PageHeader'
import { useMutation } from '../../hooks/useMutation'
import { useQuery } from '../../hooks/useQuery'
import { useToast } from '../../components/ui/Toast'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useSettings } from '../../app/SettingsContext'
import { ChangePasswordModal } from '../auth/ChangePasswordModal'
import { BackupPanel } from './BackupPanel'
import { DemoDataPanel } from './DemoDataPanel'

interface InfoRowProps {
  label: string
  /** Renders the value as a path or code, in the monospace face. */
  mono?: boolean
  /** Allows the value to be selected and copied, e.g. the database path. */
  selectable?: boolean
  children: ReactNode
}

/**
 * A label/value line in the database card.
 *
 * Values here can be a long Windows path, so they break inside the word rather
 * than forcing the card wider than the column it sits in.
 */
function InfoRow({ label, mono, selectable, children }: InfoRowProps): JSX.Element {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm not-first:border-t not-first:border-line">
      <span className="text-ink-muted">{label}</span>
      <span
        className={clsx('text-right tabular-nums break-all', mono && 'font-mono text-caption')}
        data-selectable={selectable || undefined}
      >
        {children}
      </span>
    </div>
  )
}

export function SettingsPage(): JSX.Element {
  const { settings, save: persist } = useSettings()
  const toast = useToast()

  // Seeded from context, then kept in step by `persist` — saving updates both
  // the form and the context with the same values, so no sync effect is needed.
  const [form, setForm] = useState<Settings>(settings)
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const info = useQuery(() => unwrap(api.backup.info()), [])

  const set = <K extends keyof Settings>(key: K, value: Settings[K]): void =>
    setForm((current) => ({ ...current, [key]: value }))

  const isDirty = JSON.stringify(form) !== JSON.stringify(settings)

  const save = useMutation(async () => persist(form), {
    successMessage: 'Settings saved'
  })

  /**
   * Adding or removing sample data rewrites what every screen is showing, so
   * the honest response is the same one a restore gets: reload, and let the
   * whole app read the database again.
   */
  const reloadAfterDataChange = (): void => {
    setTimeout(() => window.location.reload(), 1200)
  }

  const onRestored = (safetyCopyPath: string): void => {
    toast.success(
      'Data restored',
      `Your previous data was kept at ${safetyCopyPath}. Reloading the app now.`
    )
    // Everything on screen is now describing a database that no longer exists,
    // so the safest next step is a clean reload.
    setTimeout(() => window.location.reload(), 1200)
  }

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Business details, tax, and the safety of your data"
        actions={
          <Button
            variant="primary"
            disabled={!isDirty}
            loading={save.isPending}
            onClick={() => void save.run()}
          >
            Save changes
          </Button>
        }
      />

      <PageBody>
        <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start gap-5">
          <div className="flex flex-col gap-5">
            <Card>
              <CardHeader
                title="Business profile"
                subtitle="Your name and contact details — shown in the app and on every bill you print"
              />
              <CardBody>
                <FormGrid>
                  <GridCell span={8}>
                    <Field
                      label="Business name"
                      hint="Used as the app name in the sidebar, window title, and on bills"
                    >
                      <Input
                        value={form.businessName}
                        placeholder="A to Z Traders"
                        onChange={(event) => set('businessName', event.target.value)}
                      />
                    </Field>
                  </GridCell>

                  <GridCell span={4}>
                    <Field label="Phone">
                      <Input
                        value={form.phone}
                        onChange={(event) => set('phone', event.target.value)}
                      />
                    </Field>
                  </GridCell>

                  <GridCell span={6}>
                    <Field label="Email">
                      <Input
                        type="email"
                        value={form.email}
                        placeholder="shop@example.com"
                        onChange={(event) => set('email', event.target.value)}
                      />
                    </Field>
                  </GridCell>

                  <GridCell span={6}>
                    <Field label="Website">
                      <Input
                        value={form.website}
                        placeholder="www.example.com"
                        onChange={(event) => set('website', event.target.value)}
                      />
                    </Field>
                  </GridCell>

                  <GridCell span={12}>
                    <Field label="Address">
                      <Textarea
                        rows={2}
                        value={form.address}
                        onChange={(event) => set('address', event.target.value)}
                      />
                    </Field>
                  </GridCell>

                  <GridCell span={6}>
                    <Field label="NTN / STRN" hint="Optional — printed under the business name">
                      <Input
                        value={form.taxNumber}
                        onChange={(event) => set('taxNumber', event.target.value)}
                      />
                    </Field>
                  </GridCell>

                  <GridCell span={6}>
                    <Field label="Currency" hint="Shown throughout the app and on bills">
                      <Input
                        value={form.currency}
                        onChange={(event) => set('currency', event.target.value)}
                      />
                    </Field>
                  </GridCell>

                  <GridCell span={12}>
                    <Field label="Receipt footer" hint="A thank-you line, return policy, anything">
                      <Input
                        value={form.receiptFooter}
                        placeholder="Thank you for your business"
                        onChange={(event) => set('receiptFooter', event.target.value)}
                      />
                    </Field>
                  </GridCell>
                </FormGrid>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Tax" subtitle="Off by default — turn it on only if you bill tax" />
              <CardBody>
                <FormGrid>
                  <GridCell span={6}>
                    <Checkbox
                      label="Add tax to every bill"
                      checked={form.taxEnabled}
                      onChange={(event) => set('taxEnabled', event.target.checked)}
                    />
                  </GridCell>

                  <GridCell span={6}>
                    <Field label="Tax rate" hint="Percent of the bill after discount">
                      <NumberInput
                        value={form.taxRate}
                        onValueChange={(value) => set('taxRate', value)}
                        disabled={!form.taxEnabled}
                      />
                    </Field>
                  </GridCell>

                  {form.taxEnabled && (
                    <GridCell span={12}>
                      <Callout tone="info">
                        Bills saved from now on will add {form.taxRate}% tax. Bills already saved
                        keep the tax they were made with.
                      </Callout>
                    </GridCell>
                  )}
                </FormGrid>
              </CardBody>
            </Card>
          </div>

          <div className="flex flex-col gap-5">
            <BackupPanel form={form} set={set} isDirty={isDirty} onRestored={onRestored} />

            <DemoDataPanel onChanged={reloadAfterDataChange} />

            <Card>
              <CardHeader title="Security" subtitle="The admin password that locks this app" />
              <CardBody>
                <p className="text-sm text-ink-muted">
                  The app asks for this password every time it starts. Change it here; you will need
                  your current password to do so.
                </p>
                <div className="mt-4">
                  <Button icon="lock" onClick={() => setChangePasswordOpen(true)}>
                    Change admin password
                  </Button>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="This database" />
              <CardBody>
                <InfoRow label="File" mono selectable>
                  {info.data?.path ?? '—'}
                </InfoRow>
                <InfoRow label="Size">{info.data ? format.fileSize(info.data.size) : '—'}</InfoRow>
                <InfoRow label="Schema version">{info.data?.schemaVersion ?? '—'}</InfoRow>
                <InfoRow label="Products">{info.data?.counts.products ?? 0}</InfoRow>
                <InfoRow label="Customers">{info.data?.counts.customers ?? 0}</InfoRow>
                <InfoRow label="Suppliers">{info.data?.counts.suppliers ?? 0}</InfoRow>
                <InfoRow label="Bills">{info.data?.counts.sales ?? 0}</InfoRow>
                <InfoRow label="Purchases">{info.data?.counts.purchases ?? 0}</InfoRow>

                <div className="mt-5 flex gap-2 border-t border-line pt-4">
                  <Button size="sm" onClick={() => info.refetch()}>
                    Refresh
                  </Button>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      </PageBody>

      <ChangePasswordModal open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
    </>
  )
}
