/**
 * Sample data for trying the app out.
 *
 * The shop's real records and the samples share one database, so the seeder
 * keeps a manifest of everything it created (`demo_records`) and the remover
 * works only from that list. Nothing the owner entered is ever in scope.
 */

/** What one table contributed, for the summary on screen. */
export interface DemoTableCount {
  /** Plain-language name: 'Products', 'Bills', … */
  label: string
  count: number
}

export interface DemoStatus {
  /** True when any sample data is currently in the database. */
  present: boolean
  /** Rows the seeder created, by kind. Empty when nothing is present. */
  counts: DemoTableCount[]
  total: number
  /** When the samples were added; null when there are none. */
  createdAt: string | null
  /**
   * Real records that now depend on sample records — a bill written against a
   * demo customer, say. While this is non-empty the samples cannot be removed,
   * because doing so would leave the shop's own data referring to nothing.
   */
  blockers: string[]
}

export interface DemoSeedResult {
  total: number
  counts: DemoTableCount[]
}

export interface DemoClearResult {
  removed: number
}
