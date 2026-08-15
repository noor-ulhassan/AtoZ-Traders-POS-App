import type {
  Id,
  Page,
  Product,
  ProductFilters,
  ProductInput,
  ProductUnit,
  ProductUnitInput,
  ProductWithUnits,
  SellableUnit
} from '@shared/types'
import { today } from '@shared/date'
import { qty } from '@shared/money'
import type { Db } from '../db/connection'
import { getDb } from '../db/connection'
import * as products from '../repositories/productRepository'
import * as stock from '../repositories/stockRepository'
import { businessRule, conflict, notFound } from '../utils/errors'

export function listProducts(filters: ProductFilters = {}): Page<Product> {
  return products.listProducts(getDb(), filters)
}

export function getProduct(id: Id): ProductWithUnits {
  const db = getDb()
  const product = products.findProduct(db, id)
  if (!product) throw notFound('Product')
  return {
    ...product,
    units: products.listUnits(db, id),
    hasStockHistory: stock.hasMovements(db, id)
  }
}

/** Throws unless the product exists — used by every module that references one. */
export function requireProduct(db: Db, id: Id): Product {
  const product = products.findProduct(db, id)
  if (!product) throw notFound(`Product #${id}`)
  return product
}

function assertUnitsAreSane(baseUnit: string, units: ProductUnitInput[]): void {
  const seen = new Set<string>([baseUnit.trim().toLowerCase()])
  for (const unit of units) {
    const key = unit.unitName.trim().toLowerCase()
    if (seen.has(key)) {
      throw conflict(`The unit "${unit.unitName}" is listed more than once.`)
    }
    seen.add(key)
    if (unit.factor <= 0) {
      throw businessRule(`"${unit.unitName}" must contain more than zero ${baseUnit}.`)
    }
  }
}

export function addProduct(input: ProductInput): Product {
  const db = getDb()
  const units = input.units ?? []
  assertUnitsAreSane(input.baseUnit, units)

  const create = db.transaction(() => {
    const id = products.insertProduct(db, {
      name: input.name,
      sku: input.sku ?? null,
      barcode: input.barcode ?? null,
      categoryId: input.categoryId ?? null,
      baseUnit: input.baseUnit,
      costPrice: input.costPrice,
      salePrice: input.salePrice,
      reorderLevel: input.reorderLevel,
      isActive: input.isActive ?? true
    })

    if (units.length > 0) products.replaceUnits(db, id, units)

    const opening = qty(input.openingStock ?? 0)
    if (opening !== 0) {
      // Opening stock is a real movement so the ledger explains every unit on
      // the shelf, right back to day one.
      stock.insertMovement(db, {
        productId: id,
        changeQty: opening,
        reason: 'opening',
        refTable: 'products',
        refId: id,
        costPrice: input.costPrice,
        date: today(),
        notes: 'Opening stock'
      })
      products.applyStockDelta(db, id, opening)
    }

    return id
  })

  const id = create()
  return products.findProduct(db, id) as Product
}

export function updateProduct(id: Id, input: ProductInput): Product {
  const db = getDb()
  const existing = products.findProduct(db, id)
  if (!existing) throw notFound('Product')

  const units = input.units ?? []
  assertUnitsAreSane(input.baseUnit, units)

  // Renaming the base unit after stock has moved would silently reinterpret
  // every historical quantity. Adjust stock to zero first, or create a new product.
  if (input.baseUnit !== existing.baseUnit) {
    const movements = stock.listMovements(db, { productId: id, limit: 1 })
    if (movements.total > 0) {
      throw businessRule(
        `The base unit cannot be changed once "${existing.name}" has stock history. Create a new product instead.`
      )
    }
  }

  const run = db.transaction(() => {
    products.updateProduct(db, id, {
      name: input.name,
      sku: input.sku ?? null,
      barcode: input.barcode ?? null,
      categoryId: input.categoryId ?? null,
      baseUnit: input.baseUnit,
      // Cost price is owned by the purchase flow's weighted average; the form
      // may only set it while the product has never been purchased.
      costPrice: existing.stockQty === 0 ? input.costPrice : existing.costPrice,
      salePrice: input.salePrice,
      reorderLevel: input.reorderLevel,
      isActive: input.isActive ?? existing.isActive
    })
    products.replaceUnits(db, id, units)
  })

  run()
  return products.findProduct(db, id) as Product
}

export function setProductActive(id: Id, isActive: boolean): Product {
  const db = getDb()
  const existing = products.findProduct(db, id)
  if (!existing) throw notFound('Product')

  if (!isActive && existing.stockQty > 0) {
    throw businessRule(
      `"${existing.name}" still has ${existing.stockQty} ${existing.baseUnit} in stock. Clear the stock before deactivating it.`
    )
  }

  products.setProductActive(db, id, isActive)
  return products.findProduct(db, id) as Product
}

export function listUnits(productId: Id): ProductUnit[] {
  const db = getDb()
  requireProduct(db, productId)
  return products.listUnits(db, productId)
}

export function setUnits(productId: Id, units: ProductUnitInput[]): ProductUnit[] {
  const db = getDb()
  const product = requireProduct(db, productId)
  assertUnitsAreSane(product.baseUnit, units)
  db.transaction(() => products.replaceUnits(db, productId, units))()
  return products.listUnits(db, productId)
}

export function getSellableUnits(productId: Id): SellableUnit[] {
  const db = getDb()
  return products.sellableUnits(db, requireProduct(db, productId))
}

/**
 * Resolves the unit a sale/purchase line was entered in.
 *
 * Every quantity in the database is stored in base units; this is the one
 * place that knows how to get there from "2 boxes".
 */
export function resolveUnit(db: Db, product: Product, unitName: string): SellableUnit {
  const match = products
    .sellableUnits(db, product)
    .find((unit) => unit.unitName.toLowerCase() === unitName.trim().toLowerCase())

  if (!match) {
    throw businessRule(`"${product.name}" is not sold in "${unitName}".`)
  }
  return match
}
