import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import type { Product, ProductWithUnits } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Checkbox, SearchInput, Select } from '../../components/ui/Field'
import { Badge, ToneValue } from '../../components/ui/Feedback'
import { Card, CardBody } from '../../components/ui/Surface'
import { Column, DataTable, PrimaryCell, RowActions } from '../../components/ui/DataTable'
import { FilterBar, FilterSpacer, PageBody, PageHeader } from '../../components/layout/PageHeader'
import { useConfirm } from '../../components/ui/Confirm'
import { useDebounced } from '../../hooks/useDebounced'
import { useMutation } from '../../hooks/useMutation'
import { useQuery } from '../../hooks/useQuery'
import { api, unwrap } from '../../lib/api'
import * as format from '../../lib/format'
import { useCurrency } from '../../app/SettingsContext'
import { CategoriesModal } from './CategoriesModal'
import { ProductFormModal } from './ProductFormModal'
import { StockAdjustModal } from './StockAdjustModal'

type Status = 'active' | 'inactive' | 'all'

export function ProductsPage(): JSX.Element {
  const currency = useCurrency()
  const confirm = useConfirm()

  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [status, setStatus] = useState<Status>('active')
  const [lowStockOnly, setLowStockOnly] = useState(false)

  const [editing, setEditing] = useState<ProductWithUnits | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false)
  const [adjusting, setAdjusting] = useState<Product | null>(null)

  const debouncedSearch = useDebounced(search)

  const categories = useQuery(() => unwrap(api.categories.list()), [])

  const products = useQuery(
    () =>
      unwrap(
        api.products.list({
          search: debouncedSearch || undefined,
          categoryId: categoryId ? Number(categoryId) : null,
          status,
          lowStockOnly
        })
      ),
    [debouncedSearch, categoryId, status, lowStockOnly]
  )

  const refresh = useCallback(() => {
    products.refetch()
    categories.refetch()
  }, [products, categories])

  const openNew = (): void => {
    setEditing(null)
    setIsFormOpen(true)
  }

  const openEdit = async (product: Product): Promise<void> => {
    setEditing(await unwrap(api.products.get(product.id)))
    setIsFormOpen(true)
  }

  const setActive = useMutation(
    async (id: number, isActive: boolean) => unwrap(api.products.setActive(id, isActive)),
    { onSuccess: refresh, errorTitle: 'Could not update the product' }
  )

  const exportCsv = useMutation(async () => unwrap(api.exports.csv({ report: 'inventory' })), {
    successMessage: 'Inventory exported',
    errorTitle: 'Export failed'
  })

  const askDeactivate = async (product: Product): Promise<void> => {
    const ok = await confirm({
      title: product.isActive ? `Deactivate ${product.name}?` : `Reactivate ${product.name}?`,
      message: product.isActive
        ? 'It will stop appearing on new bills. Past bills and reports are unchanged.'
        : 'It will appear on new bills again.',
      confirmLabel: product.isActive ? 'Deactivate' : 'Reactivate',
      destructive: product.isActive
    })
    if (ok) await setActive.run(product.id, !product.isActive)
  }

  const columns: Column<Product>[] = [
    {
      key: 'name',
      header: 'Product',
      render: (product) => (
        <PrimaryCell
          title={product.name}
          subtitle={[product.sku, product.categoryName].filter(Boolean).join(' · ') || undefined}
        />
      )
    },
    {
      key: 'stock',
      header: 'In stock',
      numeric: true,
      width: '130px',
      render: (product) => {
        const isLow = product.reorderLevel > 0 && product.stockQty <= product.reorderLevel
        return (
          <ToneValue tone={product.stockQty <= 0 ? 'bad' : isLow ? 'bad' : 'neutral'}>
            {format.quantity(product.stockQty)}
          </ToneValue>
        )
      }
    },
    {
      key: 'unit',
      header: 'Unit',
      width: '90px',
      render: (product) => <span style={{ color: 'var(--ink-muted)' }}>{product.baseUnit}</span>
    },
    {
      key: 'cost',
      header: `Cost (${currency})`,
      numeric: true,
      width: '120px',
      render: (product) => format.money(product.costPrice)
    },
    {
      key: 'price',
      header: `Sale (${currency})`,
      numeric: true,
      width: '120px',
      render: (product) => format.money(product.salePrice)
    },
    {
      key: 'value',
      header: `Stock value (${currency})`,
      numeric: true,
      width: '150px',
      render: (product) => format.money(product.stockQty * product.costPrice)
    },
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      render: (product) => {
        if (!product.isActive) return <Badge tone="neutral">Inactive</Badge>
        if (product.reorderLevel > 0 && product.stockQty <= product.reorderLevel) {
          return <Badge tone="warn">Reorder</Badge>
        }
        return <Badge tone="good">Active</Badge>
      }
    },
    {
      key: 'actions',
      header: '',
      width: '120px',
      render: (product) => (
        <RowActions>
          <Button
            size="sm"
            variant="ghost"
            icon="stock"
            aria-label={`Adjust stock for ${product.name}`}
            title="Adjust stock"
            onClick={() => setAdjusting(product)}
          />
          <Button
            size="sm"
            variant="ghost"
            icon="edit"
            aria-label={`Edit ${product.name}`}
            title="Edit"
            onClick={() => void openEdit(product)}
          />
          <Button
            size="sm"
            variant="ghost"
            icon={product.isActive ? 'trash' : 'check'}
            aria-label={
              product.isActive ? `Deactivate ${product.name}` : `Reactivate ${product.name}`
            }
            title={product.isActive ? 'Deactivate' : 'Reactivate'}
            onClick={() => void askDeactivate(product)}
          />
        </RowActions>
      )
    }
  ]

  const rows = products.data?.rows ?? []
  const stockValue = rows.reduce((sum, product) => sum + product.stockQty * product.costPrice, 0)

  return (
    <>
      <PageHeader
        title="Products"
        subtitle={
          products.data
            ? `${format.pluralize(products.data.total, 'product')} · stock worth ${currency} ${format.money(stockValue)}`
            : 'Loading'
        }
        actions={
          <>
            <Button
              icon="download"
              loading={exportCsv.isPending}
              onClick={() => void exportCsv.run()}
            >
              Export
            </Button>
            <Button onClick={() => setIsCategoriesOpen(true)}>Categories</Button>
            <Button variant="primary" icon="plus" onClick={openNew}>
              New product
            </Button>
          </>
        }
      />

      <FilterBar>
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search by name, SKU or barcode"
        />
        <div style={{ width: 180 }}>
          <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">All categories</option>
            {(categories.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </div>
        <div style={{ width: 150 }}>
          <Select value={status} onChange={(event) => setStatus(event.target.value as Status)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </Select>
        </div>
        <Checkbox
          label="Needs reorder"
          checked={lowStockOnly}
          onChange={(event) => setLowStockOnly(event.target.checked)}
        />
        <FilterSpacer />
      </FilterBar>

      <PageBody>
        <Card>
          <CardBody flush>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(product) => product.id}
              isLoading={products.isLoading}
              empty={{
                title: search || lowStockOnly ? 'No products match' : 'No products yet',
                description:
                  search || lowStockOnly
                    ? 'Try a different search, or clear the filters.'
                    : 'Add the items you buy and sell. You can set opening stock as you go.',
                action: !search && !lowStockOnly && (
                  <Button variant="primary" icon="plus" onClick={openNew}>
                    Add your first product
                  </Button>
                )
              }}
            />
          </CardBody>
        </Card>
      </PageBody>

      {isFormOpen && (
        <ProductFormModal
          onClose={() => setIsFormOpen(false)}
          onSaved={refresh}
          categories={categories.data ?? []}
          product={editing}
        />
      )}

      <CategoriesModal
        open={isCategoriesOpen}
        onClose={() => setIsCategoriesOpen(false)}
        categories={categories.data ?? []}
        onChanged={refresh}
      />

      {adjusting && (
        <StockAdjustModal
          onClose={() => setAdjusting(null)}
          onSaved={refresh}
          product={adjusting}
        />
      )}
    </>
  )
}
