import { IPC_CHANNELS } from '@shared/ipc'
import * as categoryService from '../../services/categoryService'
import * as inventoryService from '../../services/inventoryService'
import * as productService from '../../services/productService'
import { noInput, registerHandler } from '../registry'
import {
  categoryAddSchema,
  categoryDeleteSchema,
  categoryUpdateSchema,
  productAddSchema,
  productFiltersSchema,
  productGetSchema,
  productIdSchema,
  productSetActiveSchema,
  productUnitsSetSchema,
  productUpdateSchema,
  stockAdjustSchema,
  stockMovementFiltersSchema
} from '../schemas/catalog'

export function registerCatalogHandlers(): void {
  // ---- categories
  registerHandler(IPC_CHANNELS.categoriesList, noInput, () => categoryService.listCategories())
  registerHandler(IPC_CHANNELS.categoriesAdd, categoryAddSchema, ({ name }) =>
    categoryService.addCategory(name)
  )
  registerHandler(IPC_CHANNELS.categoriesUpdate, categoryUpdateSchema, ({ id, name }) =>
    categoryService.updateCategory(id, name)
  )
  registerHandler(IPC_CHANNELS.categoriesDelete, categoryDeleteSchema, ({ id }) =>
    categoryService.removeCategory(id)
  )

  // ---- products
  registerHandler(IPC_CHANNELS.productsList, productFiltersSchema, (filters) =>
    productService.listProducts(filters)
  )
  registerHandler(IPC_CHANNELS.productsGet, productGetSchema, ({ id }) =>
    productService.getProduct(id)
  )
  registerHandler(IPC_CHANNELS.productsAdd, productAddSchema, ({ input }) =>
    productService.addProduct(input)
  )
  registerHandler(IPC_CHANNELS.productsUpdate, productUpdateSchema, ({ id, input }) =>
    productService.updateProduct(id, input)
  )
  registerHandler(IPC_CHANNELS.productsSetActive, productSetActiveSchema, ({ id, isActive }) =>
    productService.setProductActive(id, isActive)
  )
  registerHandler(IPC_CHANNELS.productsSellableUnits, productIdSchema, ({ productId }) =>
    productService.getSellableUnits(productId)
  )
  registerHandler(IPC_CHANNELS.productsUnitsList, productIdSchema, ({ productId }) =>
    productService.listUnits(productId)
  )
  registerHandler(IPC_CHANNELS.productsUnitsSet, productUnitsSetSchema, ({ productId, units }) =>
    productService.setUnits(productId, units)
  )

  // ---- stock
  registerHandler(IPC_CHANNELS.stockAdjust, stockAdjustSchema, (input) =>
    inventoryService.adjustStock(input)
  )
  registerHandler(IPC_CHANNELS.stockMovements, stockMovementFiltersSchema, (filters) =>
    inventoryService.listMovements(filters)
  )
}
