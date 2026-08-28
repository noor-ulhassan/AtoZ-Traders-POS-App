import { dialog } from 'electron'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  Id,
  ImportRowIssue,
  ImportRowPreview,
  ProductImportPreview,
  ProductImportResult
} from '@shared/types'
import { today } from '@shared/date'
import { money, qty } from '@shared/money'
import type { Db } from '../db/connection'
import { getDb } from '../db/connection'
import * as categories from '../repositories/categoryRepository'
import * as products from '../repositories/productRepository'
import * as stock from '../repositories/stockRepository'
import { AppError, businessRule } from '../utils/errors'
import { parseCsv } from '../utils/csv'
import { logger } from '../utils/logger'

const log = logger.child('import')

/**
 * Bulk product import.
 *
 * A shop with a catalogue of any real size already keeps it in a spreadsheet,
 * and re-typing that into a form one product at a time is not a real option.
 * This accepts the file as it is: header names are matched loosely, column
 * order is free, and every row is reported on before anything is written.
 *
 * The rule throughout is that the file may not do anything the owner could not
 * see coming. Nothing is written during preview; a row with any problem is
 * skipped rather than guessed at; and stock only ever moves for a product the
 * file is creating.
 */

/** Header aliases, so the file need not be written for this importer. */
const COLUMN_ALIASES: Record<string, string[]> = {
  name: ['name', 'product', 'product name', 'item', 'item name', 'description'],
  sku: ['sku', 'code', 'product code', 'item code', 'article'],
  barcode: ['barcode', 'bar code', 'ean', 'upc'],
  category: ['category', 'category name', 'group', 'type'],
  baseUnit: ['unit', 'base unit', 'uom'],
  costPrice: ['cost', 'cost price', 'purchase price', 'buy price', 'buying price'],
  salePrice: ['price', 'sale price', 'selling price', 'sell price', 'mrp', 'rate'],
  openingStock: ['stock', 'opening stock', 'qty', 'quantity', 'on hand'],
  reorderLevel: ['reorder', 'reorder level', 'min stock', 'minimum']
}

type Field = keyof typeof COLUMN_ALIASES

const MAX_ROWS = 20_000
const MAX_FILE_BYTES = 16 * 1024 * 1024

/**
 * The parsed, validated file waiting for a commit.
 *
 * Held here rather than round-tripped through the renderer, so the rows that
 * get written are provably the rows the main process itself validated. One at a
 * time: a second preview replaces the first, because there is one owner at one
 * screen.
 */
let pending: { token: string; fileName: string; rows: ImportRowPreview[] } | null = null

/** Maps each recognised field to the column index it was found at. */
type ColumnMap = Partial<Record<Field, number>>

function normaliseHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_-]+/g, ' ')
}

function mapColumns(header: string[]): { map: ColumnMap; unknown: string[] } {
  const map: ColumnMap = {}
  const unknown: string[] = []

  header.forEach((raw, index) => {
    const label = normaliseHeader(raw)
    if (label === '') return

    const field = (Object.keys(COLUMN_ALIASES) as Field[]).find((key) =>
      COLUMN_ALIASES[key]?.includes(label)
    )

    // First column wins: a file with two "price" columns uses the leftmost
    // rather than silently preferring whichever came last.
    if (field) {
      if (map[field] === undefined) map[field] = index
    } else {
      unknown.push(raw.trim())
    }
  })

  return { map, unknown }
}

function cell(row: string[], index: number | undefined): string {
  if (index === undefined) return ''
  return (row[index] ?? '').trim()
}

/** Text, or null for a blank — matching how the rest of the app stores optionals. */
function optional(value: string): string | null {
  return value === '' ? null : value
}

/**
 * Reads a money or quantity cell the way a spreadsheet is likely to hold it:
 * thousands separators, a stray currency symbol, parentheses for a negative.
 * Returns null for a blank cell, and NaN when the cell is genuinely not a number.
 */
function readNumber(value: string): number | null {
  if (value === '') return null

  const negative = /^\(.*\)$/.test(value)
  const cleaned = value
    .replace(/^\(|\)$/g, '')
    .replace(/[^0-9.-]/g, '')
    .replace(/(?!^)-/g, '')

  if (cleaned === '' || cleaned === '-' || cleaned === '.') return Number.NaN

  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed)) return Number.NaN
  return negative ? -parsed : parsed
}

interface NumberFieldSpec {
  column: string
  max: number
  label: string
}

function readNumberField(raw: string, spec: NumberFieldSpec, issues: ImportRowIssue[]): number {
  const value = readNumber(raw)
  if (value === null) return 0

  if (Number.isNaN(value)) {
    issues.push({ column: spec.column, message: `"${raw}" is not a number.` })
    return 0
  }
  if (value < 0) {
    issues.push({ column: spec.column, message: `${spec.label} cannot be negative.` })
    return 0
  }
  if (value > spec.max) {
    issues.push({ column: spec.column, message: `${spec.label} is unrealistically large.` })
    return 0
  }
  return value
}

/** Existing products indexed by the keys a row may be matched on. */
interface ExistingIndex {
  bySku: Map<string, Id>
  byBarcode: Map<string, Id>
  byName: Set<string>
}

function existingIndex(db: Db): ExistingIndex {
  const rows = db
    .prepare<[], { id: number; name: string; sku: string | null; barcode: string | null }>(
      'SELECT id, name, sku, barcode FROM products'
    )
    .all()

  const bySku = new Map<string, Id>()
  const byBarcode = new Map<string, Id>()
  const byName = new Set<string>()

  for (const row of rows) {
    if (row.sku) bySku.set(row.sku.trim().toLowerCase(), row.id)
    if (row.barcode) byBarcode.set(row.barcode.trim().toLowerCase(), row.id)
    byName.add(row.name.trim().toLowerCase())
  }

  return { bySku, byBarcode, byName }
}

/**
 * Turns the parsed file into a per-row account of what committing would do.
 *
 * Exported for tests, which drive it with CSV text directly rather than through
 * a file dialog.
 */
export function buildPreview(db: Db, text: string, fileName: string): ProductImportPreview {
  const grid = parseCsv(text)
  if (grid.length === 0) {
    throw businessRule('That file is empty.')
  }

  const header = grid[0] as string[]
  const body = grid.slice(1)
  const { map, unknown } = mapColumns(header)

  if (map.name === undefined) {
    throw businessRule('The file needs a "Name" column. The first row must be the column headings.')
  }
  if (body.length > MAX_ROWS) {
    throw businessRule(`That file has ${body.length} rows. Import at most ${MAX_ROWS} at a time.`)
  }

  const existing = existingIndex(db)
  const knownCategories = new Set(
    categories.listCategories(db).map((category) => category.name.trim().toLowerCase())
  )
  const newCategories = new Set<string>()

  // Duplicates *within the file* matter as much as clashes with the database:
  // two rows claiming one SKU would otherwise create a product and then
  // immediately update it, letting the second row silently win.
  const seenSku = new Map<string, number>()
  const seenBarcode = new Map<string, number>()

  const rows = body.map<ImportRowPreview>((raw, index) => {
    const line = index + 2 // 1-based, and the header occupies line 1.
    const issues: ImportRowIssue[] = []
    const warnings: string[] = []

    const name = cell(raw, map.name)
    const sku = optional(cell(raw, map.sku))
    const barcode = optional(cell(raw, map.barcode))
    const categoryName = optional(cell(raw, map.category))
    const baseUnit = cell(raw, map.baseUnit) || 'piece'

    if (name === '') issues.push({ column: 'Name', message: 'A product needs a name.' })
    if (name.length > 160) {
      issues.push({ column: 'Name', message: 'That name is longer than 160 characters.' })
    }
    if (baseUnit.length > 40) {
      issues.push({ column: 'Unit', message: 'That unit name is longer than 40 characters.' })
    }

    const costPrice = readNumberField(
      cell(raw, map.costPrice),
      { column: 'Cost', max: 100_000_000, label: 'Cost' },
      issues
    )
    const salePrice = readNumberField(
      cell(raw, map.salePrice),
      { column: 'Price', max: 100_000_000, label: 'Price' },
      issues
    )
    const openingStock = readNumberField(
      cell(raw, map.openingStock),
      { column: 'Stock', max: 10_000_000, label: 'Opening stock' },
      issues
    )
    const reorderLevel = readNumberField(
      cell(raw, map.reorderLevel),
      { column: 'Reorder', max: 10_000_000, label: 'Reorder level' },
      issues
    )

    // ---- how this row relates to what is already there -------------------
    let matchedProductId: Id | null = null
    let matchedBy: 'sku' | 'barcode' | null = null

    const skuKey = sku?.toLowerCase() ?? null
    const barcodeKey = barcode?.toLowerCase() ?? null

    if (skuKey) {
      const duplicateLine = seenSku.get(skuKey)
      if (duplicateLine !== undefined) {
        issues.push({ column: 'SKU', message: `The same SKU is on line ${duplicateLine}.` })
      } else {
        seenSku.set(skuKey, line)
      }
      const match = existing.bySku.get(skuKey)
      if (match !== undefined) {
        matchedProductId = match
        matchedBy = 'sku'
      }
    }

    if (barcodeKey) {
      const duplicateLine = seenBarcode.get(barcodeKey)
      if (duplicateLine !== undefined) {
        issues.push({ column: 'Barcode', message: `The same barcode is on line ${duplicateLine}.` })
      } else {
        seenBarcode.set(barcodeKey, line)
      }
      const match = existing.byBarcode.get(barcodeKey)
      if (match !== undefined && matchedProductId === null) {
        matchedProductId = match
        matchedBy = 'barcode'
      } else if (match !== undefined && match !== matchedProductId) {
        issues.push({
          column: 'Barcode',
          message: 'This barcode already belongs to a different product.'
        })
      }
    }

    // A name on its own is never a match key — two genuinely different items
    // often share one. It is worth flagging, not acting on.
    if (matchedProductId === null && name !== '' && existing.byName.has(name.toLowerCase())) {
      warnings.push('A product with this name already exists; this row adds a second one.')
    }

    if (categoryName && !knownCategories.has(categoryName.toLowerCase())) {
      newCategories.add(categoryName)
    }

    if (matchedProductId !== null && openingStock > 0) {
      warnings.push(
        'Stock is only set for new products. This row updates an existing one, so its stock is left alone — use a stock adjustment.'
      )
    }

    const action: ImportRowPreview['action'] =
      issues.length > 0 ? 'skip' : matchedProductId !== null ? 'update' : 'create'

    return {
      line,
      action,
      name,
      sku,
      barcode,
      categoryName,
      baseUnit,
      costPrice: money(costPrice),
      salePrice: money(salePrice),
      openingStock: qty(openingStock),
      reorderLevel: qty(reorderLevel),
      matchedProductId,
      matchedBy,
      issues,
      warnings
    }
  })

  const counts = {
    create: rows.filter((row) => row.action === 'create').length,
    update: rows.filter((row) => row.action === 'update').length,
    skip: rows.filter((row) => row.action === 'skip').length
  }

  // Only categories on rows that will actually be written get created.
  const usedCategories = new Set(
    rows
      .filter((row) => row.action !== 'skip' && row.categoryName !== null)
      .map((row) => row.categoryName as string)
  )

  return {
    token: randomUUID(),
    fileName,
    rows,
    newCategories: [...newCategories].filter((name) => usedCategories.has(name)).sort(),
    counts,
    unknownColumns: unknown
  }
}

function pickFile(): string[] {
  return (
    dialog.showOpenDialogSync({
      title: 'Choose a product list to import',
      properties: ['openFile'],
      filters: [{ name: 'Spreadsheet (CSV)', extensions: ['csv', 'txt'] }]
    }) ?? []
  )
}

function readImportFile(path: string): string {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    throw businessRule('That file could not be read. Check that it is not open in Excel.')
  }

  if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
    throw businessRule('That file is too large to import. Split it into smaller files.')
  }
  return text
}

/** Opens the file picker, parses and validates. Writes nothing. */
export function previewImport(): ProductImportPreview {
  const filePaths = pickFile()
  if (filePaths.length === 0) {
    throw new AppError('CANCELLED', 'Import cancelled.')
  }

  const path = filePaths[0] as string
  const preview = buildPreview(getDb(), readImportFile(path), basename(path))

  pending = { token: preview.token, fileName: preview.fileName, rows: preview.rows }
  log.info(
    `previewed ${preview.fileName}: ${preview.counts.create} new, ` +
      `${preview.counts.update} updates, ${preview.counts.skip} skipped`
  )
  return preview
}

/**
 * Writes the previewed file.
 *
 * Everything happens in one transaction: either the whole file lands or none of
 * it does. A failure halfway through would otherwise leave a half-imported
 * catalogue that nobody could tell apart from a complete one.
 */
export function commitImport(token: string): ProductImportResult {
  const staged = pending
  if (!staged || staged.token !== token) {
    throw businessRule('That import is no longer open. Choose the file again.')
  }

  const db = getDb()
  const writable = staged.rows.filter((row) => row.action !== 'skip')

  if (writable.length === 0) {
    throw businessRule('There is nothing to import — every row in that file has a problem.')
  }

  const run = db.transaction((): ProductImportResult => {
    const categoryIds = new Map(
      categories
        .listCategories(db)
        .map((category) => [category.name.trim().toLowerCase(), category.id] as const)
    )
    let categoriesCreated = 0

    const categoryIdFor = (name: string | null): Id | null => {
      if (!name) return null
      const key = name.trim().toLowerCase()
      const found = categoryIds.get(key)
      if (found !== undefined) return found

      const id = categories.insertCategory(db, name.trim())
      categoryIds.set(key, id)
      categoriesCreated += 1
      return id
    }

    let created = 0
    let updated = 0
    let skipped = staged.rows.length - writable.length

    for (const row of writable) {
      const categoryId = categoryIdFor(row.categoryName)

      if (row.matchedProductId !== null) {
        const existing = products.findProduct(db, row.matchedProductId)
        // The catalogue could have changed between preview and commit.
        if (!existing) {
          skipped += 1
          continue
        }

        products.updateProduct(db, existing.id, {
          name: row.name,
          sku: row.sku,
          barcode: row.barcode,
          categoryId,
          // The base unit reinterprets every historical quantity, so a file may
          // never change it once the product has moved stock.
          baseUnit: existing.stockQty === 0 ? row.baseUnit : existing.baseUnit,
          // Cost belongs to the purchase flow's weighted average once stock
          // exists — the same rule the product form follows.
          costPrice: existing.stockQty === 0 ? row.costPrice : existing.costPrice,
          salePrice: row.salePrice,
          reorderLevel: row.reorderLevel,
          isActive: existing.isActive
        })
        updated += 1
        continue
      }

      const id = products.insertProduct(db, {
        name: row.name,
        sku: row.sku,
        barcode: row.barcode,
        categoryId,
        baseUnit: row.baseUnit,
        costPrice: row.costPrice,
        salePrice: row.salePrice,
        reorderLevel: row.reorderLevel,
        isActive: true
      })

      if (row.openingStock > 0) {
        // Opening stock is a real movement, exactly as when a product is added
        // through the form — the ledger explains every unit on the shelf.
        stock.insertMovement(db, {
          productId: id,
          changeQty: row.openingStock,
          reason: 'opening',
          refTable: 'products',
          refId: id,
          costPrice: row.costPrice,
          date: today(),
          notes: `Opening stock (imported from ${staged.fileName})`
        })
        products.applyStockDelta(db, id, row.openingStock)
      }
      created += 1
    }

    return { created, updated, skipped, categoriesCreated }
  })

  const result = run()
  pending = null
  log.info(
    `imported ${staged.fileName}: ${result.created} created, ` +
      `${result.updated} updated, ${result.skipped} skipped`
  )
  return result
}

/** Test seam: stages a preview without going through the file dialog. */
export function stagePreview(preview: ProductImportPreview): void {
  pending = { token: preview.token, fileName: preview.fileName, rows: preview.rows }
}

/** Test seam: drops any staged file. */
export function clearPendingImport(): void {
  pending = null
}
