import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import type { PosApi } from '@shared/ipc'
import type { IpcChannel } from '@shared/ipc'
import type { IpcResult } from '@shared/types'

/**
 * The only bridge between the renderer and Node.
 *
 * Nothing else is exposed: no `require`, no filesystem, no database handle.
 * Every method here is one `ipcRenderer.invoke` of a channel declared in the
 * shared contract, and `satisfies PosApi` below makes TypeScript reject any
 * method that drifts from the contract the renderer codes against.
 */
async function invoke<T>(channel: IpcChannel, payload?: unknown): Promise<IpcResult<T>> {
  try {
    return (await ipcRenderer.invoke(channel, payload)) as IpcResult<T>
  } catch (error) {
    // Reaching here means the channel itself failed (no handler, serialization
    // failure) — handled errors always come back as a resolved envelope.
    return {
      ok: false,
      error: {
        code: 'INTERNAL',
        message: `The application could not complete that action. (${(error as Error).message})`
      }
    }
  }
}

const api = {
  settings: {
    get: () => invoke(IPC_CHANNELS.settingsGet),
    update: (patch) => invoke(IPC_CHANNELS.settingsUpdate, patch)
  },

  categories: {
    list: () => invoke(IPC_CHANNELS.categoriesList),
    add: (name) => invoke(IPC_CHANNELS.categoriesAdd, { name }),
    update: (id, name) => invoke(IPC_CHANNELS.categoriesUpdate, { id, name }),
    remove: (id) => invoke(IPC_CHANNELS.categoriesDelete, { id })
  },

  products: {
    list: (filters) => invoke(IPC_CHANNELS.productsList, filters),
    get: (id) => invoke(IPC_CHANNELS.productsGet, { id }),
    add: (input) => invoke(IPC_CHANNELS.productsAdd, { input }),
    update: (id, input) => invoke(IPC_CHANNELS.productsUpdate, { id, input }),
    setActive: (id, isActive) => invoke(IPC_CHANNELS.productsSetActive, { id, isActive }),
    sellableUnits: (productId) => invoke(IPC_CHANNELS.productsSellableUnits, { productId }),
    units: {
      list: (productId) => invoke(IPC_CHANNELS.productsUnitsList, { productId }),
      set: (productId, units) => invoke(IPC_CHANNELS.productsUnitsSet, { productId, units })
    }
  },

  stock: {
    adjust: (input) => invoke(IPC_CHANNELS.stockAdjust, input),
    movements: (filters) => invoke(IPC_CHANNELS.stockMovements, filters)
  },

  customers: {
    list: (filters) => invoke(IPC_CHANNELS.customersList, filters),
    get: (id) => invoke(IPC_CHANNELS.customersGet, { id }),
    add: (input) => invoke(IPC_CHANNELS.customersAdd, { input }),
    update: (id, input) => invoke(IPC_CHANNELS.customersUpdate, { id, input }),
    ledger: (id, range) => invoke(IPC_CHANNELS.customersLedger, { id, range })
  },

  suppliers: {
    list: (filters) => invoke(IPC_CHANNELS.suppliersList, filters),
    get: (id) => invoke(IPC_CHANNELS.suppliersGet, { id }),
    add: (input) => invoke(IPC_CHANNELS.suppliersAdd, { input }),
    update: (id, input) => invoke(IPC_CHANNELS.suppliersUpdate, { id, input }),
    ledger: (id, range) => invoke(IPC_CHANNELS.suppliersLedger, { id, range })
  },

  purchases: {
    list: (filters) => invoke(IPC_CHANNELS.purchasesList, filters),
    get: (id) => invoke(IPC_CHANNELS.purchasesGet, { id }),
    create: (input) => invoke(IPC_CHANNELS.purchasesCreate, { input })
  },

  sales: {
    list: (filters) => invoke(IPC_CHANNELS.salesList, filters),
    get: (id) => invoke(IPC_CHANNELS.salesGet, { id }),
    create: (input) => invoke(IPC_CHANNELS.salesCreate, { input }),
    nextInvoiceNo: () => invoke(IPC_CHANNELS.salesNextInvoiceNo),
    suggestPrice: (customerId, productId, unitName) =>
      invoke(IPC_CHANNELS.salesSuggestPrice, { customerId, productId, unitName }),
    receipt: (id) => invoke(IPC_CHANNELS.salesReceipt, { id })
  },

  returns: {
    sale: {
      list: (filters) => invoke(IPC_CHANNELS.saleReturnsList, filters),
      get: (id) => invoke(IPC_CHANNELS.saleReturnsGet, { id }),
      create: (input) => invoke(IPC_CHANNELS.saleReturnsCreate, { input })
    },
    purchase: {
      list: (filters) => invoke(IPC_CHANNELS.purchaseReturnsList, filters),
      get: (id) => invoke(IPC_CHANNELS.purchaseReturnsGet, { id }),
      create: (input) => invoke(IPC_CHANNELS.purchaseReturnsCreate, { input })
    }
  },

  payments: {
    create: (input) => invoke(IPC_CHANNELS.paymentsCreate, { input }),
    list: (filters) => invoke(IPC_CHANNELS.paymentsList, filters),
    remove: (id) => invoke(IPC_CHANNELS.paymentsDelete, { id })
  },

  expenses: {
    categories: {
      list: () => invoke(IPC_CHANNELS.expenseCategoriesList),
      add: (name) => invoke(IPC_CHANNELS.expenseCategoriesAdd, { name })
    },
    list: (filters) => invoke(IPC_CHANNELS.expensesList, filters),
    add: (input) => invoke(IPC_CHANNELS.expensesAdd, { input }),
    update: (id, input) => invoke(IPC_CHANNELS.expensesUpdate, { id, input }),
    remove: (id) => invoke(IPC_CHANNELS.expensesDelete, { id })
  },

  reports: {
    profitLoss: (range) => invoke(IPC_CHANNELS.reportsProfitLoss, range),
    stockValuation: () => invoke(IPC_CHANNELS.reportsStockValuation),
    lowStock: () => invoke(IPC_CHANNELS.reportsLowStock),
    salesSummary: (range) => invoke(IPC_CHANNELS.reportsSalesSummary, range),
    productProfit: (range) => invoke(IPC_CHANNELS.reportsProductProfit, range)
  },

  dashboard: {
    summary: (range) => invoke(IPC_CHANNELS.dashboardSummary, range)
  },

  exports: {
    csv: (request) => invoke(IPC_CHANNELS.exportCsv, request)
  },

  backup: {
    now: () => invoke(IPC_CHANNELS.backupNow),
    restore: () => invoke(IPC_CHANNELS.backupRestore),
    info: () => invoke(IPC_CHANNELS.backupInfo)
  },

  printing: {
    receipt: (id) => invoke(IPC_CHANNELS.printReceipt, { id })
  }
} satisfies PosApi

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // Context isolation is on in every window this app creates; this branch only
  // exists so a misconfiguration fails loudly in development rather than
  // leaving `window.api` undefined.
  throw new Error('Context isolation must be enabled.')
}
