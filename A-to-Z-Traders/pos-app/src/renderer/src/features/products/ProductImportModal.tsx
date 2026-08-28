import type { JSX } from 'react'
import { useState } from 'react'
import type { ImportRowPreview, ProductImportPreview } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Badge, Callout } from '../../components/ui/Feedback'
import { Column, DataTable } from '../../components/ui/DataTable'
import { Modal } from '../../components/ui/Modal'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { useMutation } from '../../hooks/useMutation'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useCurrency } from '../../app/SettingsContext'

interface ProductImportModalProps {
  onClose: () => void
  onImported: () => void
}

type RowFilter = 'all' | 'create' | 'update' | 'skip'

const ACTION_BADGE: Record<
  ImportRowPreview['action'],
  { label: string; tone: 'good' | 'accent' | 'bad' }
> = {
  create: { label: 'New', tone: 'good' },
  update: { label: 'Update', tone: 'accent' },
  skip: { label: 'Skipped', tone: 'bad' }
}

/**
 * Bulk import, as a two-step the owner drives.
 *
 * Step one picks a file and shows what committing it would do, row by row.
 * Nothing is written until the second step, and the file is never re-read from
 * the renderer — the main process commits the rows it parsed itself, named by
 * a token. So what is approved on this screen is exactly what lands.
 */
export function ProductImportModal({ onClose, onImported }: ProductImportModalProps): JSX.Element {
  const currency = useCurrency()
  const [preview, setPreview] = useState<ProductImportPreview | null>(null)
  const [filter, setFilter] = useState<RowFilter>('all')

  const choose = useMutation(async () => unwrap(api.products.import.preview()), {
    errorTitle: 'Could not read that file',
    onSuccess: (result) => {
      if (!result) return
      setPreview(result)
      // Land on the problems when there are any — they are what needs a
      // decision, and they are easy to miss at the bottom of a long file.
      setFilter(result.counts.skip > 0 ? 'skip' : 'all')
    }
  })

  const commit = useMutation(async (token: string) => unwrap(api.products.import.commit(token)), {
    errorTitle: 'Could not import the products',
    onSuccess: (result) => {
      if (!result) return
      onImported()
      onClose()
    }
  })

  const rows = preview?.rows ?? []
  const shown = filter === 'all' ? rows : rows.filter((row) => row.action === filter)
  const writable = preview ? preview.counts.create + preview.counts.update : 0

  const columns: Column<ImportRowPreview>[] = [
    {
      key: 'line',
      header: 'Line',
      numeric: true,
      width: '70px',
      render: (row) => <span className="font-mono text-caption text-ink-muted">{row.line}</span>
    },
    {
      key: 'action',
      header: '',
      width: '100px',
      render: (row) => (
        <Badge tone={ACTION_BADGE[row.action].tone}>{ACTION_BADGE[row.action].label}</Badge>
      )
    },
    {
      key: 'name',
      header: 'Product',
      render: (row) => (
        <span className="flex flex-col gap-px py-1 leading-[1.35]">
          <strong className="font-medium">{row.name || '—'}</strong>
          <span className="text-caption text-ink-subtle">
            {[row.sku, row.barcode, row.categoryName].filter(Boolean).join(' · ') || row.baseUnit}
          </span>
        </span>
      )
    },
    {
      key: 'cost',
      header: `Cost (${currency})`,
      numeric: true,
      width: '110px',
      render: (row) => format.money(row.costPrice)
    },
    {
      key: 'price',
      header: `Price (${currency})`,
      numeric: true,
      width: '110px',
      render: (row) => format.money(row.salePrice)
    },
    {
      key: 'stock',
      header: 'Stock',
      numeric: true,
      width: '90px',
      // Stock only ever applies to a product the file is creating; showing a
      // figure against an update would promise something that will not happen.
      render: (row) =>
        row.action === 'create' && row.openingStock > 0 ? (
          format.quantity(row.openingStock)
        ) : (
          <span className="text-ink-subtle">—</span>
        )
    },
    {
      key: 'notes',
      header: 'What happens',
      render: (row) => {
        if (row.issues.length > 0) {
          return (
            <span className="text-caption text-bad">
              {row.issues.map((issue) => issue.message).join(' ')}
            </span>
          )
        }
        if (row.warnings.length > 0) {
          return <span className="text-caption text-warn">{row.warnings.join(' ')}</span>
        }
        if (row.action === 'update') {
          return (
            <span className="text-caption text-ink-muted">
              Matches an existing product by {row.matchedBy}
            </span>
          )
        }
        return <span className="text-caption text-ink-subtle">Added as a new product</span>
      }
    }
  ]

  return (
    <Modal
      open
      onClose={onClose}
      title="Import products"
      description={
        preview
          ? `${preview.fileName} — ${format.pluralize(rows.length, 'row')} read`
          : 'Bring a product list in from a spreadsheet'
      }
      size="xl"
      footerStart={
        preview && (
          <span className="text-caption text-ink-muted">
            {preview.counts.create} new · {preview.counts.update} updated · {preview.counts.skip}{' '}
            skipped
          </span>
        )
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button icon="download" loading={choose.isPending} onClick={() => void choose.run()}>
            {preview ? 'Choose another file' : 'Choose file'}
          </Button>
          {preview && (
            <Button
              variant="primary"
              loading={commit.isPending}
              disabled={writable === 0}
              onClick={() => void commit.run(preview.token)}
            >
              Import {format.pluralize(writable, 'product')}
            </Button>
          )}
        </>
      }
    >
      {!preview ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">
            Save your list as CSV from Excel, then choose it here. Nothing is written until you have
            seen what the file will do.
          </p>

          <div className="rounded-md border border-line bg-surface-sunken p-4">
            <div className="text-micro font-semibold tracking-[0.07em] text-ink-subtle uppercase">
              Columns it understands
            </div>
            <p className="mt-2 text-sm text-ink-muted">
              Only <strong className="text-ink">Name</strong> is required. Column order does not
              matter, and common alternatives are recognised — SKU or Code, Price or Rate, Stock or
              Quantity, Unit, Cost, Category, Barcode, Reorder.
            </p>
            <p className="mt-3 text-sm text-ink-muted">
              A row is matched to an existing product by its SKU, or failing that its barcode. A
              match updates that product; anything else is added as new. Stock is only set for new
              products — changing the stock of an existing one goes through a stock adjustment, so
              the ledger keeps its record of why.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {preview.counts.skip > 0 && (
            <Callout tone="warn" title={`${preview.counts.skip} rows will be skipped`}>
              These rows have problems the importer will not guess at. Fix them in the spreadsheet
              and choose the file again, or import the rest and add them by hand.
            </Callout>
          )}

          {writable === 0 && (
            <Callout tone="bad" title="Nothing can be imported from this file">
              Every row has a problem. Check the messages below.
            </Callout>
          )}

          {preview.newCategories.length > 0 && (
            <Callout tone="info" title="New categories will be created">
              {preview.newCategories.join(', ')}
            </Callout>
          )}

          {preview.unknownColumns.length > 0 && (
            <Callout tone="info" title="Columns that will be ignored">
              {preview.unknownColumns.join(', ')} — nothing in the app matches these, so they are
              left out.
            </Callout>
          )}

          <SegmentedControl
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `All (${rows.length})` },
              { value: 'create', label: `New (${preview.counts.create})` },
              { value: 'update', label: `Updates (${preview.counts.update})` },
              {
                value: 'skip',
                label: `Skipped (${preview.counts.skip})`,
                disabled: preview.counts.skip === 0
              }
            ]}
          />

          <div className="max-h-[46vh] overflow-auto rounded-md border border-line">
            <DataTable
              columns={columns}
              rows={shown}
              rowKey={(row) => row.line}
              compact
              empty={{ title: 'No rows of this kind' }}
            />
          </div>
        </div>
      )}
    </Modal>
  )
}
