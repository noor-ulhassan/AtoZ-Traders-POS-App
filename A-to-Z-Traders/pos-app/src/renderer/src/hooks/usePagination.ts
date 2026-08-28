import { useMemo, useState } from 'react'
import { DEFAULT_PAGE_SIZE, offsetFor, pageCount } from '@shared/pagination'

export interface Pagination {
  /** 1-based. */
  page: number
  pageSize: number
  /** Pass straight into a list filter. */
  limit: number
  offset: number
  setPage: (page: number) => void
}

/**
 * The page a list screen is currently showing.
 *
 * `filterKey` is every filter the query depends on. When any of them changes
 * the page snaps back to 1 — without that, narrowing a search while on page 6
 * would ask for rows 251-300 of a three-row result and show an empty table.
 *
 * The reset happens during render rather than in an effect on purpose. React
 * discards this render and immediately re-runs it with the new state, so the
 * database is never asked for the stale offset; an effect would let that
 * request go out first and flash an empty table before correcting itself.
 */
export function usePagination(
  filterKey: unknown[],
  pageSize: number = DEFAULT_PAGE_SIZE
): Pagination {
  const key = JSON.stringify(filterKey)
  const [page, setPage] = useState(1)
  const [lastKey, setLastKey] = useState(key)

  if (key !== lastKey) {
    setLastKey(key)
    setPage(1)
  }

  return useMemo(
    () => ({
      page,
      pageSize,
      limit: pageSize,
      offset: offsetFor(page, pageSize),
      setPage
    }),
    [page, pageSize]
  )
}

/**
 * Pulls the page back into range once the true total is known.
 *
 * Deleting the only row on the last page would otherwise strand the screen on
 * a page that no longer has anything on it. Skipped while `total` is 0, which
 * is also what a screen reports before its first response has arrived.
 */
export function useClampedPage(pagination: Pagination, total: number): number {
  if (total === 0) return pagination.page

  const pages = pageCount(total, pagination.pageSize)
  if (pagination.page > pages) pagination.setPage(pages)
  return Math.min(pagination.page, pages)
}
