import type { JSX } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PageWithTotals, Product, ProductPageTotals } from '@shared/types'
import * as format from '@renderer/lib/format'
import { useShop } from '../App'
import { useDebounced, useRemote } from '../lib/hooks'
import { CHANNELS } from '../lib/remote'
import {
  Badge,
  Card,
  Empty,
  Loading,
  Note,
  Row,
  Rows,
  Screen,
  SearchInput,
  Section,
  StaleBanner,
  Tile,
  TopBar
} from '../ui/kit'

/**
 * What is on the shelf.
 *
 * The "running out" filter is the reason this screen is on a phone at all: it
 * is the list the owner wants while standing in a supplier's shop, and it is
 * the one thing he cannot work out from memory.
 */

export function StockScreen(): JSX.Element {
  const { shop } = useShop()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const query = useDebounced(search, 250)

  const products = useRemote<PageWithTotals<Product, ProductPageTotals>>(
    CHANNELS.productsList,
    { search: query, status: 'active', lowStockOnly: lowOnly, limit: 50 },
    [query, lowOnly]
  )

  const rows = products.data?.rows ?? []

  return (
    <Screen>
      <TopBar title="Stock" onBack={() => navigate('/more')} />
      {products.isStale && <StaleBanner label={products.staleLabel} />}

      <Section>
        <SearchInput
          value={search}
          placeholder="Search by name, SKU or barcode"
          onChange={(event) => setSearch(event.target.value)}
        />
      </Section>

      <Section>
        <div className="grid grid-cols-2 gap-3">
          <Tile
            label="Stock at cost"
            value={format.currency(products.data?.totals.stockValue ?? 0, shop.currency)}
          />
          <button
            type="button"
            onClick={() => setLowOnly((current) => !current)}
            className={`rounded-xl border p-3 text-left ${
              lowOnly
                ? 'border-warn-border bg-warn-weak text-warn'
                : 'border-line bg-surface-raised text-ink-muted'
            }`}
          >
            <div className="text-caption">Filter</div>
            <div className="mt-1 text-md font-semibold">
              {lowOnly ? 'Running out' : 'Everything'}
            </div>
          </button>
        </div>
      </Section>

      {products.error && (
        <Section>
          <Note tone="bad">{products.error}</Note>
        </Section>
      )}

      <Section title={`${products.data?.total ?? 0} products`}>
        <Card>
          {products.isLoading && !products.data ? (
            <Loading />
          ) : rows.length === 0 ? (
            <Empty
              title="Nothing to show"
              hint={lowOnly ? 'Nothing is at or below its reorder level.' : undefined}
            />
          ) : (
            <Rows>
              {rows.map((product) => (
                <Row
                  key={product.id}
                  title={
                    <span className="flex items-center gap-2">
                      {product.name}
                      {product.ownership === 'other' && <Badge>other stock</Badge>}
                    </span>
                  }
                  subtitle={`${product.categoryName ?? 'Uncategorised'} · ${format.money(product.salePrice)} per ${product.baseUnit}`}
                  value={
                    <span
                      className={product.stockQty <= product.reorderLevel ? 'text-bad' : undefined}
                    >
                      {format.quantity(product.stockQty)}
                    </span>
                  }
                  valueNote={product.baseUnit}
                  onClick={() => navigate(`/stock/${product.id}`)}
                />
              ))}
            </Rows>
          )}
        </Card>

        {products.data && products.data.total > rows.length && (
          <p className="px-1 pt-3 text-caption text-ink-subtle">
            Showing {rows.length} of {products.data.total}. Search to narrow it down.
          </p>
        )}
      </Section>
    </Screen>
  )
}
