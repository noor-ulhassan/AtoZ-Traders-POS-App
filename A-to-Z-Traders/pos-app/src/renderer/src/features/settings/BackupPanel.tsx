import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type { BackupCheck, BackupDestinationStatus, BackupFile, Settings } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Field, Input, Select } from '../../components/ui/Field'
import { Badge, Callout } from '../../components/ui/Feedback'
import { Card, CardBody, CardHeader } from '../../components/ui/Surface'
import { Column, DataTable } from '../../components/ui/DataTable'
import { useMutation } from '../../hooks/useMutation'
import { useQuery } from '../../hooks/useQuery'
import { useToast } from '../../components/ui/Toast'
import { useSettings } from '../../app/SettingsContext'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'

interface BackupPanelProps {
  form: Settings
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  isDirty: boolean
  onRestored: (safetyCopyPath: string) => void
}

const INTERVALS = [
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
  { value: 180, label: 'Every 3 hours' },
  { value: 360, label: 'Every 6 hours' },
  { value: 0, label: 'Only when I close the app' }
]

function Destination({
  title,
  data
}: {
  title: string
  data: BackupDestinationStatus
}): JSX.Element {
  const label =
    data.health === 'failing'
      ? 'Needs attention'
      : data.health === 'never'
        ? 'Waiting for first copy'
        : data.health === 'stale'
          ? 'Backup overdue'
          : data.pendingChanges
            ? 'Changes awaiting backup'
            : 'No new changes'
  const tone =
    data.health === 'failing'
      ? 'bad'
      : data.health === 'stale' || data.health === 'never'
        ? 'warn'
        : 'neutral'
  return (
    <div className="rounded-md border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{title}</h3>
        <Badge tone={tone}>{label}</Badge>
      </div>
      <p className="mt-2 font-mono text-caption break-all" data-selectable>
        {data.folder}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-ink-muted">Latest backup file</dt>
        <dd className="text-right">
          {data.lastBackupAt ? format.dateTime(data.lastBackupAt) : 'Not yet created'}
        </dd>
        <dt className="text-ink-muted">Last verification</dt>
        <dd className="text-right">
          {data.lastVerifiedAt
            ? new Date(data.lastVerifiedAt).toLocaleString('en-GB', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
              })
            : 'Not recorded'}
        </dd>
        <dt className="text-ink-muted">Copies available</dt>
        <dd className="text-right">{data.count}</dd>
      </dl>
      {data.lastError && (
        <div className="mt-3">
          <Callout tone="bad" title="Last attempt failed">
            {data.lastError} Connect the drive or check folder access, then retry Back up now.
          </Callout>
        </div>
      )}
    </div>
  )
}

export function BackupPanel({ form, set, isDirty, onRestored }: BackupPanelProps): JSX.Element {
  const toast = useToast()
  const { settings } = useSettings()
  const [showAll, setShowAll] = useState(false)
  const [checked, setChecked] = useState<BackupCheck | null>(null)
  const status = useQuery(
    () => unwrap(api.backup.status()),
    [settings.autoBackupDir, settings.backupIntervalMinutes]
  )
  const backups = useQuery(() => unwrap(api.backup.list()), [settings.autoBackupDir])
  const refreshStatus = status.refetch
  const refreshFiles = backups.refetch
  const refresh = (): void => {
    refreshStatus()
    refreshFiles()
  }
  useEffect(() => {
    const timer = setInterval(() => {
      refreshStatus()
      refreshFiles()
    }, 15000)
    return () => clearInterval(timer)
  }, [refreshStatus, refreshFiles])

  const runNow = useMutation(
    async () => {
      try {
        return await unwrap(api.backup.runNow())
      } finally {
        refresh()
      }
    },
    {
      errorTitle: 'Check backup destinations',
      onSuccess: () => toast.success('Backups completed and checked')
    }
  )
  const saveCopy = useMutation(
    async () => {
      try {
        return await unwrap(api.backup.now())
      } finally {
        refresh()
      }
    },
    {
      errorTitle: 'Backup failed',
      onSuccess: (result) => toast.success('Copy saved and checked', result.path)
    }
  )
  const browse = useMutation(async () => unwrap(api.backup.chooseFolder()), {
    onSuccess: (folder) => {
      if (folder) set('autoBackupDir', folder)
    }
  })
  const openFolder = useMutation(
    async (kind: 'data' | 'local' | 'additional') => unwrap(api.backup.openFolder(kind)),
    {
      errorTitle: 'Could not open folder'
    }
  )
  const check = useMutation(
    async (path?: string) => {
      setChecked(null)
      try {
        return await unwrap(api.backup.check(path))
      } finally {
        refresh()
      }
    },
    { errorTitle: 'Backup check failed', onSuccess: setChecked }
  )
  const restore = useMutation(
    async (path?: string) => unwrap(path ? api.backup.restoreFrom(path) : api.backup.restore()),
    {
      errorTitle: 'Restore failed',
      onSuccess: (result) => onRestored(result.safetyCopyPath)
    }
  )
  const busy =
    runNow.isPending ||
    saveCopy.isPending ||
    browse.isPending ||
    check.isPending ||
    restore.isPending
  const data = status.data
  const files = backups.data ?? []
  const shown = showAll ? files : files.slice(0, 8)
  const columns: Column<BackupFile>[] = [
    {
      key: 'when',
      header: 'Backup',
      render: (file) => (
        <div className="flex flex-col gap-1 py-1">
          <strong className="font-medium">{format.dateTime(file.createdAt)}</strong>
          <span className="text-caption text-ink-muted">
            {file.location === 'local' ? 'This computer' : 'Additional folder'} /{' '}
            {format.fileSize(file.size)}
          </span>
          <span className="text-caption text-ink-subtle">
            {file.verifiedAt ? 'Checked copy' : 'Check before restoring'}
          </span>
        </div>
      )
    },
    {
      key: 'actions',
      header: '',
      render: (file) => (
        <div className="flex flex-wrap justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void check.run(file.path)}
          >
            Check backup
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void restore.run(file.path)}
          >
            Restore
          </Button>
        </div>
      )
    }
  ]

  return (
    <Card>
      <CardHeader
        title="Data & backups"
        subtitle="Automatic recovery copies, with a separate copy wherever you choose"
      />
      <CardBody>
        <p className="text-sm text-ink-muted">
          Local recovery copies are made every 15 minutes while the app is open and records have
          changed, and again on normal close. You can inspect and restore .db backups here without
          another app.
        </p>
        {status.error && (
          <div className="mt-3">
            <Callout tone="bad" title="Backup status unavailable">
              {status.error}
            </Callout>
          </div>
        )}
        {data?.historyError && (
          <div className="mt-3">
            <Callout tone="warn" title="Backup history needs attention">
              {data.historyError}
            </Callout>
          </div>
        )}
        <div className="mt-4 flex flex-col gap-3">
          {data ? (
            <Destination title="Local recovery" data={data.local} />
          ) : (
            <p>Checking local backups...</p>
          )}
          {data?.additional && <Destination title="Additional copy" data={data.additional} />}
        </div>
        <p className="mt-3 text-caption text-ink-muted">
          Local copies are on this computer. For recovery if the computer fails, keep another copy
          on a separate device or outside the shop. A copy saved to a sync folder does not confirm a
          cloud upload.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void openFolder.run('local')}>
            Open local backups
          </Button>
          <Button size="sm" onClick={() => void openFolder.run('data')}>
            Open data folder
          </Button>
          {data?.additional && (
            <Button size="sm" disabled={isDirty} onClick={() => void openFolder.run('additional')}>
              Open additional folder
            </Button>
          )}
        </div>
        <div className="mt-5 flex flex-col gap-4">
          <Field
            label="Additional backup folder"
            hint="Optional. Use Browse to choose a USB drive or sync folder. Leaving this empty keeps local recovery enabled."
          >
            <div className="flex gap-2">
              <Input
                className="min-w-0 flex-1 font-mono"
                value={form.autoBackupDir}
                placeholder="Choose an additional destination"
                onChange={(event) => set('autoBackupDir', event.target.value)}
              />
              <Button disabled={busy} onClick={() => void browse.run()}>
                Browse
              </Button>
            </div>
          </Field>
          {form.autoBackupDir.trim() && (
            <Field
              label="Additional copy schedule"
              hint="Unavailable destinations retry while the app is open. Local recovery continues independently."
            >
              <Select
                value={String(form.backupIntervalMinutes)}
                onChange={(event) => set('backupIntervalMinutes', Number(event.target.value))}
              >
                {INTERVALS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {isDirty && (
            <Callout tone="info">
              Save changes at the top of Settings before backing up to the new destination.
            </Callout>
          )}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            variant="primary"
            icon="backup"
            disabled={busy || isDirty}
            loading={runNow.isPending}
            onClick={() => void runNow.run()}
          >
            Back up now
          </Button>
          <Button disabled={busy} onClick={() => void saveCopy.run()}>
            Save a copy elsewhere
          </Button>
          <Button disabled={busy} onClick={() => void check.run()}>
            Check a backup file
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void restore.run()}>
            Restore from a file
          </Button>
        </div>
        <p className="mt-2 text-caption text-ink-muted">
          Manual copies are kept until you remove them. Automatic copies are thinned over time,
          keeping recent copies plus daily and weekly recovery points.
        </p>
        {checked && (
          <div className="mt-4">
            <Callout tone="info" title="Backup check passed">
              <p className="font-medium">{checked.businessName || 'Shop backup'}</p>
              <p>
                {checked.counts.sales} bills, {checked.counts.products} products,{' '}
                {checked.counts.customers} customers, {checked.counts.suppliers} suppliers,{' '}
                {checked.counts.purchases} purchases
              </p>
              <p className="mt-1 text-caption break-all" data-selectable>
                {checked.path}
              </p>
              <p className="mt-1">
                This copy opens with the current app. Your current shop was not replaced.
              </p>
            </Callout>
          </div>
        )}
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="font-medium">Available backups</h3>
            <Button size="sm" variant="ghost" disabled={busy} onClick={refresh}>
              Refresh
            </Button>
          </div>
          <DataTable
            columns={columns}
            rows={shown}
            rowKey={(file) => file.path}
            compact
            isLoading={backups.isLoading}
            error={backups.error}
            onRetry={refreshFiles}
          />
          {!showAll && files.length > shown.length && (
            <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>
              Show all {files.length}
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
