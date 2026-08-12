import type { JSX } from 'react'
import { useState } from 'react'
import type { Settings } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Checkbox, Field, Input, NumberInput, Textarea } from '../../components/ui/Field'
import { Callout } from '../../components/ui/Feedback'
import { Card, CardBody, CardHeader, FormGrid, GridCell } from '../../components/ui/Surface'
import { PageBody, PageHeader } from '../../components/layout/PageHeader'
import { useConfirm } from '../../components/ui/Confirm'
import { useMutation } from '../../hooks/useMutation'
import { useQuery } from '../../hooks/useQuery'
import { useToast } from '../../components/ui/Toast'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useSettings } from '../../app/SettingsContext'
import styles from './SettingsPage.module.css'

export function SettingsPage(): JSX.Element {
  const { settings, save: persist } = useSettings()
  const confirm = useConfirm()
  const toast = useToast()

  // Seeded from context, then kept in step by `persist` — saving updates both
  // the form and the context with the same values, so no sync effect is needed.
  const [form, setForm] = useState<Settings>(settings)
  const info = useQuery(() => unwrap(api.backup.info()), [])

  const set = <K extends keyof Settings>(key: K, value: Settings[K]): void =>
    setForm((current) => ({ ...current, [key]: value }))

  const isDirty = JSON.stringify(form) !== JSON.stringify(settings)

  const save = useMutation(async () => persist(form), {
    successMessage: 'Settings saved'
  })

  const backupNow = useMutation(async () => unwrap(api.backup.now()), {
    errorTitle: 'Backup failed',
    onSuccess: (result) => {
      if (!result) return
      toast.success('Backup saved', `${result.path} (${format.fileSize(result.size)})`)
      info.refetch()
    }
  })

  const restore = useMutation(async () => unwrap(api.backup.restore()), {
    errorTitle: 'Restore failed',
    onSuccess: (result) => {
      if (!result) return
      toast.success(
        'Data restored',
        `Your previous data was kept at ${result.safetyCopyPath}. Reloading the app now.`
      )
      // Everything on screen is now describing a database that no longer
      // exists, so the safest next step is a clean reload.
      setTimeout(() => window.location.reload(), 1200)
    }
  })

  const askRestore = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Restore from a backup?',
      message:
        'This replaces everything currently in the app with the contents of the backup file you choose. A copy of your current data is kept, and you will be asked to confirm once more.',
      confirmLabel: 'Choose a backup file',
      destructive: true
    })
    if (ok) await restore.run()
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
        <div className={styles.layout}>
          <div className={styles.stack}>
            <Card>
              <CardHeader
                title="Business details"
                subtitle="These appear on every bill you print"
              />
              <CardBody>
                <FormGrid>
                  <GridCell span={8}>
                    <Field label="Business name">
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

          <div className={styles.stack}>
            <Card>
              <CardHeader
                title="Backups"
                subtitle="Everything lives in one file on this computer"
              />
              <CardBody>
                <Callout tone="warn" title="Keep a copy somewhere else">
                  If this computer fails, a backup on a USB drive or another folder is the only way
                  your records survive. Take one at the end of every day.
                </Callout>

                <div className={styles.backupButtons}>
                  <Button
                    variant="primary"
                    icon="backup"
                    loading={backupNow.isPending}
                    onClick={() => void backupNow.run()}
                  >
                    Back up now
                  </Button>
                  <Button
                    variant="danger"
                    icon="restore"
                    loading={restore.isPending}
                    onClick={() => void askRestore()}
                  >
                    Restore
                  </Button>
                </div>

                <div style={{ marginTop: 'var(--space-5)' }}>
                  <Field
                    label="Automatic backup folder"
                    hint="Leave empty to turn off. A copy is written here each time you close the app."
                  >
                    <Input
                      className={styles.path}
                      value={form.autoBackupDir}
                      placeholder="D:\POS-backups"
                      onChange={(event) => set('autoBackupDir', event.target.value)}
                    />
                  </Field>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="This database" />
              <CardBody>
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>File</span>
                  <span className={`${styles.infoValue} ${styles.path}`} data-selectable>
                    {info.data?.path ?? '—'}
                  </span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Size</span>
                  <span className={styles.infoValue}>
                    {info.data ? format.fileSize(info.data.size) : '—'}
                  </span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Schema version</span>
                  <span className={styles.infoValue}>{info.data?.schemaVersion ?? '—'}</span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Products</span>
                  <span className={styles.infoValue}>{info.data?.counts.products ?? 0}</span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Customers</span>
                  <span className={styles.infoValue}>{info.data?.counts.customers ?? 0}</span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Suppliers</span>
                  <span className={styles.infoValue}>{info.data?.counts.suppliers ?? 0}</span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Bills</span>
                  <span className={styles.infoValue}>{info.data?.counts.sales ?? 0}</span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Purchases</span>
                  <span className={styles.infoValue}>{info.data?.counts.purchases ?? 0}</span>
                </div>

                <div className={styles.actions}>
                  <Button size="sm" onClick={() => info.refetch()}>
                    Refresh
                  </Button>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  )
}
