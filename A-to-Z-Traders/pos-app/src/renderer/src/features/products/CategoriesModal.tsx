import type { JSX } from 'react'
import { useState } from 'react'
import type { Category } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Field'
import { Column, DataTable, RowActions } from '../../components/ui/DataTable'
import { Modal } from '../../components/ui/Modal'
import { useConfirm } from '../../components/ui/Confirm'
import { useMutation } from '../../hooks/useMutation'
import { api, unwrap } from '../../lib/api'
import { pluralize } from '../../lib/format'

interface CategoriesModalProps {
  open: boolean
  onClose: () => void
  categories: Category[]
  onChanged: () => void
}

export function CategoriesModal({
  open,
  onClose,
  categories,
  onChanged
}: CategoriesModalProps): JSX.Element {
  const confirm = useConfirm()
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')

  const add = useMutation(async (name: string) => unwrap(api.categories.add(name)), {
    successMessage: 'Category added',
    onSuccess: () => {
      setNewName('')
      onChanged()
    }
  })

  const rename = useMutation(
    async (id: number, name: string) => unwrap(api.categories.update(id, name)),
    {
      onSuccess: () => {
        setEditingId(null)
        onChanged()
      }
    }
  )

  const remove = useMutation(async (id: number) => unwrap(api.categories.remove(id)), {
    successMessage: 'Category removed',
    onSuccess: onChanged,
    errorTitle: 'Could not remove'
  })

  const askRemove = async (category: Category): Promise<void> => {
    const ok = await confirm({
      title: `Remove "${category.name}"?`,
      message: 'This only removes the category. No products are deleted.',
      confirmLabel: 'Remove',
      destructive: true
    })
    if (ok) await remove.run(category.id)
  }

  const columns: Column<Category>[] = [
    {
      key: 'name',
      header: 'Category',
      render: (category) =>
        editingId === category.id ? (
          <Input
            value={editingName}
            autoFocus
            onChange={(event) => setEditingName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void rename.run(category.id, editingName)
              if (event.key === 'Escape') setEditingId(null)
            }}
          />
        ) : (
          category.name
        )
    },
    {
      key: 'count',
      header: 'Products',
      numeric: true,
      width: '110px',
      render: (category) => category.productCount ?? 0
    },
    {
      key: 'actions',
      header: '',
      width: '90px',
      render: (category) => (
        <RowActions>
          {editingId === category.id ? (
            <Button
              size="sm"
              variant="primary"
              icon="check"
              aria-label="Save name"
              loading={rename.isPending}
              onClick={() => void rename.run(category.id, editingName)}
            />
          ) : (
            <Button
              size="sm"
              variant="ghost"
              icon="edit"
              aria-label={`Rename ${category.name}`}
              onClick={() => {
                setEditingId(category.id)
                setEditingName(category.name)
              }}
            />
          )}
          <Button
            size="sm"
            variant="ghost"
            icon="trash"
            aria-label={`Remove ${category.name}`}
            onClick={() => void askRemove(category)}
          />
        </RowActions>
      )
    }
  ]

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Categories"
      description={`${pluralize(categories.length, 'category', 'categories')} used to group products in reports.`}
      size="md"
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="mb-4 flex gap-2">
        <Input
          value={newName}
          placeholder="New category name"
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && newName.trim()) void add.run(newName.trim())
          }}
        />
        <Button
          variant="primary"
          icon="plus"
          loading={add.isPending}
          disabled={!newName.trim()}
          onClick={() => void add.run(newName.trim())}
        >
          Add
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={categories}
        rowKey={(category) => category.id}
        compact
        empty={{
          title: 'No categories yet',
          description: 'Categories group products so reports can show what sells by type.'
        }}
      />
    </Modal>
  )
}
