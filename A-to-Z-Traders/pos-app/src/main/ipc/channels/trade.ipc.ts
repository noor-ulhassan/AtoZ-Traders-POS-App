import { IPC_CHANNELS } from '@shared/ipc'
import * as purchaseService from '../../services/purchaseService'
import * as returnService from '../../services/returnService'
import * as salesService from '../../services/salesService'
import { noInput, registerHandler } from '../registry'
import {
  purchaseCreateSchema,
  purchaseFiltersSchema,
  purchaseReturnCreateSchema,
  returnFiltersSchema,
  saleCreateSchema,
  saleFiltersSchema,
  saleIdSchema,
  saleReturnCreateSchema,
  saleSettleSchema,
  saleUpdateSchema,
  saleVoidSchema,
  suggestPriceSchema
} from '../schemas/trade'

export function registerTradeHandlers(): void {
  // ---- purchases
  registerHandler(IPC_CHANNELS.purchasesList, purchaseFiltersSchema, (filters) =>
    purchaseService.listPurchases(filters)
  )
  registerHandler(IPC_CHANNELS.purchasesGet, saleIdSchema, ({ id }) =>
    purchaseService.getPurchase(id)
  )
  registerHandler(IPC_CHANNELS.purchasesCreate, purchaseCreateSchema, ({ input }) =>
    purchaseService.createPurchase(input)
  )

  // ---- sales
  registerHandler(IPC_CHANNELS.salesList, saleFiltersSchema, (filters) =>
    salesService.listSales(filters)
  )
  registerHandler(IPC_CHANNELS.salesGet, saleIdSchema, ({ id }) => salesService.getSale(id))
  registerHandler(IPC_CHANNELS.salesCreate, saleCreateSchema, ({ input }) =>
    salesService.createSale(input)
  )
  registerHandler(IPC_CHANNELS.salesNextInvoiceNo, noInput, () => salesService.peekNextInvoiceNo())
  registerHandler(IPC_CHANNELS.salesSuggestPrice, suggestPriceSchema, (input) =>
    salesService.suggestPrice(input.customerId, input.productId, input.unitName)
  )
  registerHandler(IPC_CHANNELS.salesReceipt, saleIdSchema, ({ id }) => salesService.getReceipt(id))
  registerHandler(IPC_CHANNELS.salesSettle, saleSettleSchema, ({ input }) =>
    salesService.settleSale(input)
  )
  registerHandler(IPC_CHANNELS.salesUpdate, saleUpdateSchema, ({ input }) =>
    salesService.updateSale(input)
  )
  registerHandler(IPC_CHANNELS.salesVoid, saleVoidSchema, ({ input }) =>
    salesService.voidSale(input)
  )
  registerHandler(IPC_CHANNELS.salesRevisions, saleIdSchema, ({ id }) =>
    salesService.listSaleRevisions(id)
  )

  // ---- returns
  registerHandler(IPC_CHANNELS.saleReturnsList, returnFiltersSchema, (filters) =>
    returnService.listSaleReturns(filters)
  )
  registerHandler(IPC_CHANNELS.saleReturnsGet, saleIdSchema, ({ id }) =>
    returnService.getSaleReturn(id)
  )
  registerHandler(IPC_CHANNELS.saleReturnsCreate, saleReturnCreateSchema, ({ input }) =>
    returnService.createSaleReturn(input)
  )
  registerHandler(IPC_CHANNELS.purchaseReturnsList, returnFiltersSchema, (filters) =>
    returnService.listPurchaseReturns(filters)
  )
  registerHandler(IPC_CHANNELS.purchaseReturnsGet, saleIdSchema, ({ id }) =>
    returnService.getPurchaseReturn(id)
  )
  registerHandler(IPC_CHANNELS.purchaseReturnsCreate, purchaseReturnCreateSchema, ({ input }) =>
    returnService.createPurchaseReturn(input)
  )
}
