import type { JSX } from 'react'
import { useState } from 'react'
import type { BackupFile, BackupHealth, BackupStatus, Settings } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Field, Input, Select } from '../../components/ui/Field'
import { Badge, Callout } from '../../components/ui/Feedback'
import { Card, CardBody, CardHeader } from '../../components/ui/Surface'
import { Column, DataTable } from '../../components/ui/DataTable'
import { useConfirm } from '../../components/ui/Confirm'
import { useMutation } from '../../hooks/useMutation'
import { useQuery } from '../../hooks/useQuery'
import { useToast } from '../../components/ui/Toast'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'

interface BackupPanelProps {
  form: Settings
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  /** True while the folder or interval on screen differ from what is saved. */
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

/** What each state means, said the way the owner would say it. */
const HEALTH: Record<BackupHealth, { tone: 'good' | 'warn' | 'bad' | 'neutral'; label: string }> = {
  off: { tone: 'neutral', label: 'Off' },
  never: { tone: 'warn', label: 'Not yet run' },
  ok: { tone: 'good', label: 'Protected' },
  stale: { tone: 'warn', label: 'Out of date' },
  failing: { tone: 'bad', label: 'Failing' }
}

function headline(status: BackupStatus): string {
  switch (status.health) {
    case 'off':
      return 'Your records exist in one place, on this computer only.'
    case 'never':
      return 'A folder is set, but no backup has been written to it yet.'
    case 'ok':
      return `Backing up automatically. Last copy ${format.dateTime(status.lastBackupAt)}.`
    case 'stale':
      return `The newest backup is from ${format.dateTime(status.lastBackupAt)} — over a day old.`
    case 'failing':
      return 'The last backup did not complete.'
  }
}

/**
 * Whether backups are actually happening — and if not, why.
 *
 * A backup that quietly stopped working looks exactly like one that works,
 * right up until the day it is needed. So the state is stated plainly at the
 * top of the card, an out-of-date or failing schedule is called out rather
 * than left to be noticed, and the copies themselves are listed so the owner
 * can see with their own eyes that they exist.
 */
export function BackupPanel({ form, set, isDirty, onRestored }: BackupPanelProps): JSX.Element {
  const confirm = useConfirm()
  const toast = useToast()
  const [showAll, setShowAll] = useState(false)

  const status = useQuery(() => unwrap(api.backup.status()), [])
  const backups = useQuery(() => unwrap(api.backup.list()), [])

  const refresh = (): void => {
    status.refetch()
    backups.refetch()
  }

  const runNow = useMutation(async () => unwrap(api.backup.runNow()), {
    errorTitle: 'Backup failed',
    onSuccess: (result) => {
      if (!result) return
      toast.success('Backup written', `${result.path} (${format.fileSize(result.size)})`)
      refresh()
    }
  })

  const saveCopy = useMutation(async () => unwrap(api.backup.now()), {
    errorTitle: 'Backup failed',
    onSuccess: (result) => {
      if (!result) return
      toast.success('Copy saved', `${result.path} (${format.fileSize(result.size)})`)
    }
  })

  const restoreFrom = useMutation(async (path: string) => unwrap(api.backup.restoreFrom(path)), {
    errorTitle: 'Restore failed',
    onSuccess: (result) => {
      if (result) onRestored(result.safetyCopyPath)
    }
  })

  const restoreFile = useMutation(async () => unwrap(api.backup.restore()), {
    errorTitle: 'Restore failed',
    onSuccess: (result) => {
      if (result) onRestored(result.safetyCopyPath)
    }
  })

  const askRestoreFile = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Restore from a backup file?',
      message:
        'This replaces everything currently in the app with the contents of the file you choose — a copy on a USB drive, say. A copy of your current data is kept, and you will be asked to confirm once more.',
      confirmLabel: 'Choose a file',
      destructive: true
    })
    if (ok) await restoreFile.run()
  }

  const askRestore = async (file: BackupFile): Promise<void> => {
    const ok = await confirm({
      title: `Restore the backup from ${format.dateTime(file.createdAt)}?`,
      message:
        'Everything currently in the app will be replaced by what this backup holds. A copy of your current data is kept, and you will be asked to confirm once more.',
      confirmLabel: 'Continue',
      destructive: true
    })
    if (ok) await restoreFrom.run(file.path)
  }

  const data = status.data
  const files = backups.data ?? []
  const shown = showAll ? files : files.slice(0, 8)
  const health = HEALTH[data?.health ?? 'off']

  const columns: Column<BackupFile>[] = [
    {
      key: 'when',
      header: 'Taken',
      render: (file) => (
        <span className="flex flex-col gap-px py-1 leading-[1.35]">
          <strong className="font-medium">{format.dateTime(file.createdAt)}</strong>
          <span className="font-mono text-caption text-ink-subtle">{file.fileName}</span>
        </span>
      )
    },
    {
      key: 'size',
      header: 'Size',
      numeric: true,
      width: '110px',
      render: (file) => format.fileSize(file.size)
    },
    {
      key: 'actions',
      header: '',
      width: '110px',
      render: (file) => (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            icon="restore"
            loading={restoreFrom.isPending}
            onClick={() => void askRestore(file)}
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
        title="Backups"
        subtitle="Keeping a copy of your records somewhere other than this computer"
        actions={<Badge tone={health.tone}>{health.label}</Badge>}
      />
      <CardBody>
        <p className="text-sm text-ink-muted">{data ? headline(data) : 'Checking…'}</p>

        {data?.health === 'failing' && data.lastError && (
          <div className="mt-3">
            <Callout tone="bad" title="The last backup did not complete">
              {data.lastError} Check the folder still exists and has space, then press
              &ldquo;Back up now&rdquo;.
            </Callout>
          </div>
        )}

        {data?.health === 'stale' && (
          <div className="mt-3">
            <Callout tone="warn" title="Backups have fallen behind">
              The app only backs up while it is running and something has changed. If this computer
              has been off, this is expected — press &ldquo;Back up now&rdquo; to catch up.
            </Callout>
          </div>
        )}

        {data?.health === 'off' && (
          <div className="mt-3">
            <Callout tone="warn" title="Nothing is being backed up">
              If this computer fails or is stolen, your records go with it. Set a folder below —
              one that Google Drive or OneDrive syncs is best, because then the copies leave the
              building.
            </Callout>
          </div>
        )}

        <div className="mt-5 flex flex-col gap-4">
          <Field
            label="Backup folder"
            hint="Leave empty to turn automatic backups off. A folder synced by Google Drive or OneDrive keeps your records safe even if this computer does not survive."
          >
            <Input
              className="font-mono"
              value={form.autoBackupDir}
              placeholder="C:\Users\You\Google Drive\POS-backups"
              onChange={(event) => set('autoBackupDir', event.target.value)}
            />
          </Field>

          <Field
            label="How often"
            hint="Backups are skipped when nothing has changed, so a quiet day does not fill the folder."
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

          {isDirty && (
            <Callout tone="info">
              Press Save at the top of the page to start using these backup settings.
            </Callout>
          )}
        </div>

        {data && data.folder.trim() !== '' && (
          <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-line bg-surface-sunken p-4 text-sm">
            <span className="text-ink-muted">Copies kept</span>
            <span className="text-right tabular-nums">{data.count}</span>

            <span className="text-ink-muted">Oldest</span>
            <span className="text-right tabular-nums">
              {data.oldestBackupAt ? format.dateTime(data.oldestBackupAt) : '—'}
            </span>

            <span className="text-ink-muted">Space used</span>
            <span className="text-right tabular-nums">{format.fileSize(data.totalSize)}</span>

            <span className="text-ink-muted">Space free</span>
            <span className="text-right tabular-nums">
              {data.freeSpace === null ? '—' : format.fileSize(data.freeSpace)}
            </span>
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            variant="primary"
            icon="backup"
            loading={runNow.isPending}
            disabled={form.autoBackupDir.trim() === ''}
            onClick={() => void runNow.run()}
          >
            Back up now
          </Button>
          <Button icon="download" loading={saveCopy.isPending} onClick={() => void saveCopy.run()}>
            Save a copy elsewhere
          </Button>
          <Button
            variant="danger"
            icon="restore"
            loading={restoreFile.isPending}
            onClick={() => void askRestoreFile()}
          >
            Restore from a file
          </Button>
        </div>

        {files.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-micro font-semibold tracking-[0.07em] text-ink-subtle uppercase">
                Restore a backup
              </span>
              {files.length > shown.length && (
                <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>
                  Show all {files.length}
                </Button>
              )}
            </div>
            <div className="overflow-hidden rounded-md border border-line">
              <DataTable
                columns={columns}
                rows={shown}
                rowKey={(file) => file.fileName}
                compact
                isLoading={backups.isLoading}
                error={backups.error}
                onRetry={backups.refetch}
              />
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
