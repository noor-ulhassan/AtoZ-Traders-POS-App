import type { JSX } from 'react'
import { useState } from 'react'
import type { DateRange, Expense } from '@shared/types'
import { resolvePreset } from '@shared/date'
import { Button } from '../../components/ui/Button'
import { SearchInput, Select } from '../../components/ui/Field'
import { Card, CardBody } from '../../components/ui/Surface'
import { Column, DataTable, PrimaryCell, RowActions } from '../../components/ui/DataTable'
import { DateRangeFilter } from '../../components/ui/DateRangeFilter'
import { StatTile } from '../../components/ui/StatTile'
import { FilterBar, FilterSpacer, PageBody, PageHeader } from '../../components/layout/PageHeader'
import { useConfirm } from '../../components/ui/Confirm'
import { useDebounced } from '../../hooks/useDebounced'
import { useMutation } from '../../hooks/useMutation'
import { useQuery } from '../../hooks/useQuery'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useCurrency } from '../../app/SettingsContext'
import { ExpenseFormModal } from './ExpenseFormModal'
import styles from './ExpensesPage.module.css'

export function ExpensesPage(): JSX.Element {
  const currency = useCurrency()
  const confirm = useConfirm()

  const [range, setRange] = useState<DateRange>(() => resolvePreset('thisMonth'))
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [editing, setEditing] = useState<Expense | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)

  const debouncedSearch = useDebounced(search)

  const categories = useQuery(() => unwrap(api.expenses.categories.list()), [])
  const expenses = useQuery(
    () =>
      unwrap(
        api.expenses.list({
          from: range.from,
          to: range.to,
          search: debouncedSearch || undefined,
          categoryId: categoryId ? Number(categoryId) : null,
          limit: 500
        })
      ),
    [range.from, range.to, debouncedSearch, categoryId]
  )

  const exportCsv = useMutation(
    async () =>
      unwrap(api.exports.csv({ report: 'expenses', filters: { from: range.from, to: range.to } })),
    { successMessage: 'Expenses exported', errorTitle: 'Export failed' }
  )

  const remove = useMutation(async (id: number) => unwrap(api.expenses.remove(id)), {
    successMessage: 'Expense removed',
    onSuccess: () => expenses.refetch()
  })

  const askRemove = async (expense: Expense): Promise<void> => {
    const ok = await confirm({
      title: 'Remove this expense?',
      message: `"${expense.title}" of ${currency} ${format.money(expense.amount)} will no longer count against profit.`,
      confirmLabel: 'Remove',
      destructive: true
    })
    if (ok) await remove.run(expense.id)
  }

  const rows = expenses.data?.rows ?? []
  const total = rows.reduce((sum, row) => sum + row.amount, 0)
  const biggest = rows.reduce<Expense | null>(
    (largest, row) => (largest === null || row.amount > largest.amount ? row : largest),
    null
  )

  const columns: Column<Expense>[] = [
    { key: 'date', header: 'Date', width: '120px', render: (row) => format.date(row.date) },
    {
      key: 'title',
      header: 'Expense',
      render: (row) => <PrimaryCell title={row.title} subtitle={row.notes ?? undefined} />
    },
    {
      key: 'category',
      header: 'Category',
      width: '180px',
      render: (row) => (
        <span style={{ color: 'var(--ink-muted)' }}>{row.categoryName ?? 'Uncategorised'}</span>
      )
    },
    {
      key: 'amount',
      header: `Amount (${currency})`,
      numeric: true,
      width: '150px',
      render: (row) => format.money(row.amount)
    },
    {
      key: 'actions',
      header: '',
      width: '90px',
      render: (row) => (
        <RowActions>
          <Button
            size="sm"
            variant="ghost"
            icon="edit"
            aria-label={`Edit ${row.title}`}
            onClick={() => {
              setEditing(row)
              setIsFormOpen(true)
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            icon="trash"
            aria-label={`Remove ${row.title}`}
            onClick={() => void askRemove(row)}
          />
        </RowActions>
      )
    }
  ]

  return (
    <>
      <PageHeader
        title="Expenses"
        subtitle="Rent, wages, transport and everything else that comes off the profit"
        actions={
          <>
            <Button
              icon="download"
              loading={exportCsv.isPending}
              onClick={() => void exportCsv.run()}
            >
              Export
            </Button>
            <Button
              variant="primary"
              icon="plus"
              onClick={() => {
                setEditing(null)
                setIsFormOpen(true)
              }}
            >
              Add expense
            </Button>
          </>
        }
      />

      <FilterBar>
        <DateRangeFilter value={range} onChange={setRange} />
        <SearchInput value={search} onValueChange={setSearch} placeholder="Search expenses" />
        <div style={{ width: 190 }}>
          <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">All categories</option>
            {(categories.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </div>
        <FilterSpacer />
      </FilterBar>

      <PageBody>
        <div className={styles.tiles}>
          <StatTile
            label="Total in period"
            unit={currency}
            value={format.money(total)}
            tone="bad"
          />
          <StatTile label="Entries" value={rows.length} />
          <StatTile
            label="Largest single expense"
            unit={currency}
            value={format.money(biggest?.amount ?? 0)}
            footnote={biggest?.title}
          />
        </div>

        <Card>
          <CardBody flush>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              isLoading={expenses.isLoading}
              empty={{
                title: 'No expenses in this period',
                description: 'Recording expenses is what turns gross profit into real profit.',
                action: (
                  <Button
                    variant="primary"
                    icon="plus"
                    onClick={() => {
                      setEditing(null)
                      setIsFormOpen(true)
                    }}
                  >
                    Add expense
                  </Button>
                )
              }}
            />
          </CardBody>
        </Card>
      </PageBody>

      {isFormOpen && (
        <ExpenseFormModal
          onClose={() => setIsFormOpen(false)}
          onSaved={() => {
            expenses.refetch()
            categories.refetch()
          }}
          categories={categories.data ?? []}
          expense={editing}
        />
      )}
    </>
  )
}
