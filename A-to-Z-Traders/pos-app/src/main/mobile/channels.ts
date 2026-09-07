import type { IpcChannel } from '@shared/ipc'
import { IPC_CHANNELS } from '@shared/ipc'

/**
 * What the companion app on the phone may ask for.
 *
 * A second allowlist, written for the same reason as `SHOPKEEPER_CHANNELS` in
 * `ipc/registry.ts` and read the same way: fail closed. A channel added to the
 * app tomorrow is unreachable from the network until somebody puts it here on
 * purpose. `mobileServer.test.ts` asserts that as a property, so the door does
 * not open by accident.
 *
 * The two lists compose rather than overlap. A request from the phone is still
 * judged by the role policy afterwards — this list only decides what is
 * exposed to the network AT ALL, whoever is holding the phone.
 *
 * Three kinds of channel are deliberately absent:
 *
 *  1. **Anything that opens a window on the shop PC.** `export:csv`,
 *     `backup:now`, `backup:restore` and `products:import:preview` all raise a
 *     native dialog. Over the network that is a request that never returns and
 *     a modal nobody is standing in front of. CSV has a network path of its
 *     own instead (`/api/export`), which builds the same report without a file
 *     picker.
 *
 *  2. **Anything that replaces or rewrites the whole database** — restoring a
 *     backup, seeding or clearing the sample data. Those are done in front of
 *     the machine they affect, with the paper trail on the desk.
 *
 *  3. **Anything that changes who can get in.** The auth channels, the staff
 *     accounts, the settings write (which owns the port this very server
 *     listens on) and the mobile controls themselves. A phone can use the
 *     shop's records; it cannot re-cut the keys.
 *
 * Two more are absent for a reason worth stating plainly: `sales:update` and
 * `sales:void`. SETTLING a delivered bill is the whole point of having the app
 * out on a delivery round and is here. Rewriting a bill's goods, or cancelling
 * it outright, moves stock and restates what a past day earned — that belongs
 * at the till, where the printed copy is.
 */
export const MOBILE_CHANNELS: ReadonlySet<IpcChannel> = new Set<IpcChannel>([
  // The shop's own name, currency and tax rate — every screen needs them.
  IPC_CHANNELS.settingsGet,

  // Catalogue: search for something to bill, and look at what is on the shelf.
  IPC_CHANNELS.categoriesList,
  IPC_CHANNELS.productsList,
  IPC_CHANNELS.productsGet,
  IPC_CHANNELS.productsSellableUnits,
  IPC_CHANNELS.productsUnitsList,

  // Stock: correct a count, and read the ledger behind it.
  IPC_CHANNELS.stockAdjust,
  IPC_CHANNELS.stockMovements,

  // Consignment goods are readable but not movable from the phone: they
  // arrive and leave physically, at the counter, where the till is.
  IPC_CHANNELS.otherStockReport,
  IPC_CHANNELS.otherStockOwners,

  // Customers and their khata, including adding one mid-bill.
  IPC_CHANNELS.customersList,
  IPC_CHANNELS.customersGet,
  IPC_CHANNELS.customersAdd,
  IPC_CHANNELS.customersUpdate,
  IPC_CHANNELS.customersLedger,

  // Suppliers, so a payout on a delivery round can be recorded where it happens.
  IPC_CHANNELS.suppliersList,
  IPC_CHANNELS.suppliersGet,
  IPC_CHANNELS.suppliersLedger,

  // Billing, start to finish.
  IPC_CHANNELS.salesList,
  IPC_CHANNELS.salesGet,
  IPC_CHANNELS.salesCreate,
  IPC_CHANNELS.salesNextInvoiceNo,
  IPC_CHANNELS.salesSuggestPrice,
  IPC_CHANNELS.salesReceipt,
  IPC_CHANNELS.salesSettle,
  IPC_CHANNELS.salesRevisions,
  IPC_CHANNELS.printReceipt,

  // Returns are readable so a bill's history makes sense on screen; creating
  // one means goods coming back over the counter.
  IPC_CHANNELS.saleReturnsList,
  IPC_CHANNELS.saleReturnsGet,
  IPC_CHANNELS.purchaseReturnsList,
  IPC_CHANNELS.purchaseReturnsGet,

  // Purchases are readable; entering one is a desk job with an invoice in hand.
  IPC_CHANNELS.purchasesList,
  IPC_CHANNELS.purchasesGet,

  // Money in and out — the client's "credit/debit records", both directions.
  IPC_CHANNELS.paymentsCreate,
  IPC_CHANNELS.paymentsList,

  // Expenses, so a cost paid out on the road is not remembered until evening.
  IPC_CHANNELS.expenseCategoriesList,
  IPC_CHANNELS.expensesList,
  IPC_CHANNELS.expensesAdd,

  // Reading the business.
  IPC_CHANNELS.reportsProfitLoss,
  IPC_CHANNELS.reportsStockValuation,
  IPC_CHANNELS.reportsLowStock,
  IPC_CHANNELS.reportsSalesSummary,
  IPC_CHANNELS.reportsProductProfit,
  IPC_CHANNELS.dashboardSummary,

  // A crash on the phone should reach the same log as a crash at the till.
  IPC_CHANNELS.systemLogError
])

/** Whether `channel` is exposed to the network at all. */
export function isMobileChannel(channel: IpcChannel): boolean {
  return MOBILE_CHANNELS.has(channel)
}
