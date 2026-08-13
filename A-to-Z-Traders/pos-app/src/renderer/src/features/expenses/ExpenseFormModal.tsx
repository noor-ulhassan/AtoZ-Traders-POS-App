import type { JSX } from 'react'
import { useState } from 'react'
import type { Expense, ExpenseCategory } from '@shared/types'
import { today } from '@shared/date'
import { Button } from '../../components/ui/Button'
import { Field, Input, NumberInput, Select, Textarea } from '../../components/ui/Field'
import { Modal } from '../../components/ui/Modal'
import { FormGrid, GridCell } from '../../components/ui/Surface'
import { useMutation } from '../../hooks/useMutation'
import { api, unwrap } from '../../lib/api'
import { useCurrency } from '../../app/SettingsContext'

interface ExpenseFormModalProps {
  onClose: () => void
  onSaved: () => void
  categories: ExpenseCategory[]
  expense: Expense | null
}

/** The categories a wholesale shop reaches for first, offered on a blank slate. */
const STARTER_CATEGORIES = ['Rent', 'Wages', 'Utilities', 'Transport', 'Repairs', 'Other']

export function ExpenseFormModal({
  onClose,
  onSaved,
  categories,
  expense
}: ExpenseFormModalProps): JSX.Element {
  const currency = useCurrency()
  const isEditing = expense !== null

  const [title, setTitle] = useState(expense?.title ?? '')
  const [amount, setAmount] = useState(expense?.amount ?? 0)
  const [categoryId, setCategoryId] = useState(
    expense?.categoryId ? String(expense.categoryId) : ''
  )
  const [newCategory, setNewCategory] = useState('')
  const [date, setDate] = useState(expense?.date ?? today())
  const [notes, setNotes] = useState(expense?.notes ?? '')

  const save = useMutation(
    async () => {
      // Creating a category inline keeps the owner in one dialog rather than
      // sending them off to a settings screen mid-entry.
      let resolvedCategoryId = categoryId ? Number(categoryId) : null
      if (categoryId === '__new' && newCategory.trim()) {
        const created = await unwrap(api.expenses.categories.add(newCategory.trim()))
        resolvedCategoryId = created.id
      }

      const input = { title, amount, categoryId: resolvedCategoryId, date, notes: notes || null }
      return isEditing
        ? unwrap(api.expenses.update(expense.id, input))
        : unwrap(api.expenses.add(input))
    },
    {
      successMessage: isEditing ? 'Expense updated' : 'Expense recorded',
      onSuccess: () => {
        onSaved()
        onClose()
      }
    }
  )

  const suggestions = categories.length === 0 ? STARTER_CATEGORIES : []

  const canSave = Boolean(title.trim()) && amount > 0 && !save.isPending
  const submit = (): void => {
    if (canSave) void save.run()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEditing ? 'Edit expense' : 'Add expense'}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!canSave} loading={save.isPending} onClick={submit}>
            {isEditing ? 'Save changes' : 'Record expense'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <FormGrid>
          <GridCell span={8}>
            <Field label="What was it for" required error={save.errors['input.title']}>
              <Input
                value={title}
                autoFocus
                placeholder="e.g. Shop rent for August"
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
          </GridCell>

          <GridCell span={4}>
            <Field label="Amount" required>
              <NumberInput prefix={currency} value={amount} onValueChange={setAmount} />
            </Field>
          </GridCell>

          <GridCell span={6}>
            <Field label="Category">
              <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                <option value="">Uncategorised</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
                <option value="__new">+ New category…</option>
              </Select>
            </Field>
          </GridCell>

          <GridCell span={6}>
            <Field label="Date">
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
          </GridCell>

          {categoryId === '__new' && (
            <GridCell span={12}>
              <Field label="New category name" required>
                <Input
                  list="starter-categories"
                  value={newCategory}
                  autoFocus
                  onChange={(event) => setNewCategory(event.target.value)}
                />
                <datalist id="starter-categories">
                  {suggestions.map((suggestion) => (
                    <option key={suggestion} value={suggestion} />
                  ))}
                </datalist>
              </Field>
            </GridCell>
          )}

          <GridCell span={12}>
            <Field label="Notes">
              <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </Field>
          </GridCell>
        </FormGrid>
        {/* Lets Enter submit from any field; the visible action is in the footer. */}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}
