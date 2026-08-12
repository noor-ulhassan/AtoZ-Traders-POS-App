import { useMemo } from 'react'
import type { Product } from '@shared/types'
import type { ComboOption } from '../components/ui/Combobox'
import { useDebounced } from './useDebounced'
import { useQuery } from './useQuery'
import { api, unwrap } from '../lib/api'
import * as format from '../lib/format'

interface ProductSearch {
  options: ComboOption<Product>[]
  isLoading: boolean
  /** The full result list, for callers that need more than the picker. */
  products: Product[]
}

/**
 * Product lookup for the sale and purchase entry screens.
 *
 * Shows stock on hand beside each result — on a counter, "do I even have
 * this?" is answered at the moment of picking rather than after the line has
 * been added and rejected.
 */
export function useProductSearch(query: string, limit = 12): ProductSearch {
  const debounced = useDebounced(query, 150)

  const result = useQuery(
    () =>
      debounced.trim().length === 0
        ? Promise.resolve({ rows: [], total: 0 })
        : unwrap(api.products.list({ search: debounced.trim(), status: 'active', limit })),
    [debounced, limit]
  )

  // Memoised so the empty-result fallback is a stable reference; otherwise a
  // fresh `[]` on every render would invalidate the options below each time.
  const products = useMemo(() => result.data?.rows ?? [], [result.data])

  const options = useMemo<ComboOption<Product>[]>(
    () =>
      products.map((product) => ({
        value: product,
        title: product.name,
        subtitle: [product.sku, product.categoryName].filter(Boolean).join(' · ') || undefined,
        meta: `${format.quantity(product.stockQty)} ${product.baseUnit}`
      })),
    [products]
  )

  return { options, isLoading: result.isLoading, products }
}
