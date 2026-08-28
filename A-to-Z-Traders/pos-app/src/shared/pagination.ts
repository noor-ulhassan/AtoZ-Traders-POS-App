/**
 * One page size for the whole app.
 *
 * Every list screen pages through its results rather than fetching all of them,
 * so a catalogue or a sales history of any size stays responsive and — more
 * importantly — stays *complete*. Before paging existed each screen silently
 * stopped at its repository's default limit and gave no sign that anything was
 * missing.
 *
 * 50 fills a shop monitor without scrolling twice, and keeps the per-page
 * render cheap on the modest hardware these machines usually are.
 */
export const DEFAULT_PAGE_SIZE = 50

/** Rows to skip to reach a 1-based page number. */
export function offsetFor(page: number, pageSize: number = DEFAULT_PAGE_SIZE): number {
  return Math.max(0, (Math.max(1, page) - 1) * pageSize)
}

/** How many pages `total` rows make at this size. Always at least 1. */
export function pageCount(total: number, pageSize: number = DEFAULT_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize))
}
