import type { Id } from './common'

/**
 * Bulk product import from a spreadsheet.
 *
 * A catalogue of any real size is not typed in one product at a time, so the
 * app has to accept the file the wholesaler already keeps. The flow is always
 * preview-then-commit: nothing is written until the owner has seen, row by row,
 * exactly what the file will do.
 */

/** What committing the file would do to one row of it. */
export type ImportAction = 'create' | 'update' | 'skip'

export interface ImportRowIssue {
  /** The CSV column the problem is in, or null when it concerns the whole row. */
  column: string | null
  message: string
}

export interface ImportRowPreview {
  /** 1-based line number in the file, counting the header — what Excel shows. */
  line: number
  action: ImportAction
  name: string
  sku: string | null
  barcode: string | null
  categoryName: string | null
  baseUnit: string
  costPrice: number
  salePrice: number
  openingStock: number
  reorderLevel: number
  /** Set when this row matched an existing product by SKU or barcode. */
  matchedProductId: Id | null
  /** How the match was made, for the "why is this an update?" column. */
  matchedBy: 'sku' | 'barcode' | null
  /** Blocking problems. A row with any issue is skipped, never guessed at. */
  issues: ImportRowIssue[]
  /** Non-blocking things worth seeing before committing. */
  warnings: string[]
}

export interface ProductImportPreview {
  /** Identifies the parsed file for the commit that follows. */
  token: string
  fileName: string
  rows: ImportRowPreview[]
  /** Category names in the file that do not exist yet and would be created. */
  newCategories: string[]
  counts: {
    create: number
    update: number
    skip: number
  }
  /** Columns present in the file that the importer does not understand. */
  unknownColumns: string[]
}

export interface ProductImportResult {
  created: number
  updated: number
  skipped: number
  categoriesCreated: number
}
