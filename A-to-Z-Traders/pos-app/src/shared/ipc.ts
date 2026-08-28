import type {
  AuthChangePasswordInput,
  AuthLoginInput,
  AuthResetInput,
  AuthSetupInput,
  AuthStatus,
  BackupResult,
  Category,
  Customer,
  DashboardSummary,
  DatabaseInfo,
  DateRange,
  Expense,
  ExpenseCategory,
  ExpenseFilters,
  ExpenseInput,
  ExpensePageTotals,
  ExportRequest,
  ExportResult,
  Id,
  IpcResult,
  LedgerStatement,
  LowStockRow,
  Page,
  PageWithTotals,
  PartyFilters,
  PartyInput,
  PartyPageTotals,
  Payment,
  PaymentFilters,
  PaymentInput,
  PaymentPageTotals,
  PriceSuggestion,
  Product,
  ProductFilters,
  ProductImportPreview,
  ProductImportResult,
  ProductInput,
  ProductPageTotals,
  ProductProfitRow,
  ProductUnit,
  ProductUnitInput,
  ProductWithUnits,
  ProfitLossReport,
  Purchase,
  PurchaseFilters,
  PurchaseInput,
  PurchasePageTotals,
  PurchaseReturn,
  PurchaseReturnInput,
  PurchaseReturnWithItems,
  PurchaseWithItems,
  Receipt,
  RestoreResult,
  ReturnFilters,
  ReturnPageTotals,
  Sale,
  SaleFilters,
  SaleInput,
  SalePageTotals,
  SaleReturn,
  SaleReturnInput,
  SaleReturnWithItems,
  SaleWithItems,
  SalesSummaryReport,
  SecurityQuestion,
  SellableUnit,
  Settings,
  SettingsUpdate,
  StaffCreateInput,
  StaffLoginInput,
  StaffResetPinInput,
  StaffSetActiveInput,
  StaffUser,
  StockAdjustmentInput,
  StockMovement,
  StockMovementFilters,
  StockValuationReport,
  Supplier
} from './types'

/**
 * The single source of truth for the main <-> renderer boundary.
 *
 * Channel names live in `IPC_CHANNELS`; the shape each one carries lives in
 * `PosApi`. The preload script implements `PosApi` by invoking channels, and
 * the main process registers a handler for every channel — TypeScript fails
 * the build if either side drifts.
 */
export const IPC_CHANNELS = {
  authStatus: 'auth:status',
  authSetup: 'auth:setup',
  authLogin: 'auth:login',
  authStaffLogin: 'auth:staffLogin',
  authLock: 'auth:lock',
  authChangePassword: 'auth:changePassword',
  authSecurityQuestion: 'auth:securityQuestion',
  authResetPassword: 'auth:resetPassword',

  usersList: 'users:list',
  usersCreate: 'users:create',
  usersSetActive: 'users:setActive',
  usersResetPin: 'users:resetPin',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',

  categoriesList: 'categories:list',
  categoriesAdd: 'categories:add',
  categoriesUpdate: 'categories:update',
  categoriesDelete: 'categories:delete',

  productsList: 'products:list',
  productsGet: 'products:get',
  productsAdd: 'products:add',
  productsUpdate: 'products:update',
  productsSetActive: 'products:setActive',
  productsUnitsList: 'products:units:list',
  productsUnitsSet: 'products:units:set',
  productsSellableUnits: 'products:sellableUnits',
  productsImportPreview: 'products:import:preview',
  productsImportCommit: 'products:import:commit',

  stockAdjust: 'stock:adjust',
  stockMovements: 'stock:movements',

  customersList: 'customers:list',
  customersGet: 'customers:get',
  customersAdd: 'customers:add',
  customersUpdate: 'customers:update',
  customersLedger: 'customers:ledger',

  suppliersList: 'suppliers:list',
  suppliersGet: 'suppliers:get',
  suppliersAdd: 'suppliers:add',
  suppliersUpdate: 'suppliers:update',
  suppliersLedger: 'suppliers:ledger',

  purchasesList: 'purchases:list',
  purchasesGet: 'purchases:get',
  purchasesCreate: 'purchases:create',

  salesList: 'sales:list',
  salesGet: 'sales:get',
  salesCreate: 'sales:create',
  salesNextInvoiceNo: 'sales:nextInvoiceNo',
  salesSuggestPrice: 'sales:suggestPrice',
  salesReceipt: 'sales:receipt',

  saleReturnsList: 'returns:sale:list',
  saleReturnsGet: 'returns:sale:get',
  saleReturnsCreate: 'returns:sale:create',
  purchaseReturnsList: 'returns:purchase:list',
  purchaseReturnsGet: 'returns:purchase:get',
  purchaseReturnsCreate: 'returns:purchase:create',

  paymentsCreate: 'payments:create',
  paymentsList: 'payments:list',
  paymentsDelete: 'payments:delete',

  expenseCategoriesList: 'expenses:categories:list',
  expenseCategoriesAdd: 'expenses:categories:add',
  expensesList: 'expenses:list',
  expensesAdd: 'expenses:add',
  expensesUpdate: 'expenses:update',
  expensesDelete: 'expenses:delete',

  reportsProfitLoss: 'reports:profitLoss',
  reportsStockValuation: 'reports:stockValuation',
  reportsLowStock: 'reports:lowStock',
  reportsSalesSummary: 'reports:salesSummary',
  reportsProductProfit: 'reports:productProfit',

  dashboardSummary: 'dashboard:summary',

  exportCsv: 'export:csv',

  backupNow: 'backup:now',
  backupRestore: 'backup:restore',
  backupInfo: 'backup:info',

  printReceipt: 'printing:receipt',

  systemLogError: 'system:logError'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

/** Every method resolves — failures arrive as `{ ok: false, error }`. */
type Result<T> = Promise<IpcResult<T>>

export interface PosApi {
  auth: {
    status(): Result<AuthStatus>
    setup(input: AuthSetupInput): Result<AuthStatus>
    login(input: AuthLoginInput): Result<AuthStatus>
    staffLogin(input: StaffLoginInput): Result<AuthStatus>
    lock(): Result<AuthStatus>
    changePassword(input: AuthChangePasswordInput): Result<AuthStatus>
    securityQuestion(): Result<SecurityQuestion>
    resetPassword(input: AuthResetInput): Result<AuthStatus>
  }

  /** Staff account management. Admin-only at the IPC boundary. */
  users: {
    list(): Result<StaffUser[]>
    create(input: StaffCreateInput): Result<StaffUser>
    setActive(input: StaffSetActiveInput): Result<StaffUser>
    resetPin(input: StaffResetPinInput): Result<StaffUser>
  }

  settings: {
    get(): Result<Settings>
    update(patch: SettingsUpdate): Result<Settings>
  }

  categories: {
    list(): Result<Category[]>
    add(name: string): Result<Category>
    update(id: Id, name: string): Result<Category>
    remove(id: Id): Result<{ id: Id }>
  }

  products: {
    list(filters?: ProductFilters): Result<PageWithTotals<Product, ProductPageTotals>>
    get(id: Id): Result<ProductWithUnits>
    add(input: ProductInput): Result<Product>
    update(id: Id, input: ProductInput): Result<Product>
    setActive(id: Id, isActive: boolean): Result<Product>
    sellableUnits(productId: Id): Result<SellableUnit[]>
    units: {
      list(productId: Id): Result<ProductUnit[]>
      set(productId: Id, units: ProductUnitInput[]): Result<ProductUnit[]>
    }
    /**
     * Bulk import from a spreadsheet, always in two steps.
     *
     * `preview` opens the file picker, parses and validates, and writes
     * nothing — it returns a per-row account of what committing would do,
     * plus a token identifying the parsed file. `commit` takes that token, so
     * the rows written are the rows the main process itself validated, never
     * a version echoed back from the renderer.
     */
    import: {
      preview(): Result<ProductImportPreview>
      commit(token: string): Result<ProductImportResult>
    }
  }

  stock: {
    adjust(input: StockAdjustmentInput): Result<{ productId: Id; stockQty: number }>
    movements(filters?: StockMovementFilters): Result<Page<StockMovement>>
  }

  customers: {
    list(filters?: PartyFilters): Result<PageWithTotals<Customer, PartyPageTotals>>
    get(id: Id): Result<Customer>
    add(input: PartyInput): Result<Customer>
    update(id: Id, input: PartyInput): Result<Customer>
    ledger(customerId: Id, range: DateRange): Result<LedgerStatement>
  }

  suppliers: {
    list(filters?: PartyFilters): Result<PageWithTotals<Supplier, PartyPageTotals>>
    get(id: Id): Result<Supplier>
    add(input: PartyInput): Result<Supplier>
    update(id: Id, input: PartyInput): Result<Supplier>
    ledger(supplierId: Id, range: DateRange): Result<LedgerStatement>
  }

  purchases: {
    list(filters?: PurchaseFilters): Result<PageWithTotals<Purchase, PurchasePageTotals>>
    get(id: Id): Result<PurchaseWithItems>
    create(input: PurchaseInput): Result<PurchaseWithItems>
  }

  sales: {
    list(filters?: SaleFilters): Result<PageWithTotals<Sale, SalePageTotals>>
    get(id: Id): Result<SaleWithItems>
    create(input: SaleInput): Result<{ sale: SaleWithItems; receipt: Receipt }>
    nextInvoiceNo(): Result<string>
    suggestPrice(customerId: Id | null, productId: Id, unitName: string): Result<PriceSuggestion>
    receipt(saleId: Id): Result<Receipt>
  }

  returns: {
    sale: {
      list(filters?: ReturnFilters): Result<PageWithTotals<SaleReturn, ReturnPageTotals>>
      get(id: Id): Result<SaleReturnWithItems>
      create(input: SaleReturnInput): Result<SaleReturnWithItems>
    }
    purchase: {
      list(filters?: ReturnFilters): Result<PageWithTotals<PurchaseReturn, ReturnPageTotals>>
      get(id: Id): Result<PurchaseReturnWithItems>
      create(input: PurchaseReturnInput): Result<PurchaseReturnWithItems>
    }
  }

  payments: {
    create(input: PaymentInput): Result<Payment>
    list(filters?: PaymentFilters): Result<PageWithTotals<Payment, PaymentPageTotals>>
    remove(id: Id): Result<{ id: Id }>
  }

  expenses: {
    categories: {
      list(): Result<ExpenseCategory[]>
      add(name: string): Result<ExpenseCategory>
    }
    list(filters?: ExpenseFilters): Result<PageWithTotals<Expense, ExpensePageTotals>>
    add(input: ExpenseInput): Result<Expense>
    update(id: Id, input: ExpenseInput): Result<Expense>
    remove(id: Id): Result<{ id: Id }>
  }

  reports: {
    profitLoss(range: DateRange): Result<ProfitLossReport>
    stockValuation(): Result<StockValuationReport>
    lowStock(): Result<LowStockRow[]>
    salesSummary(range: DateRange): Result<SalesSummaryReport>
    productProfit(range: DateRange): Result<ProductProfitRow[]>
  }

  dashboard: {
    summary(range: DateRange): Result<DashboardSummary>
  }

  exports: {
    csv(request: ExportRequest): Result<ExportResult>
  }

  backup: {
    now(): Result<BackupResult>
    restore(): Result<RestoreResult>
    info(): Result<DatabaseInfo>
  }

  printing: {
    receipt(saleId: Id): Result<{ printed: boolean }>
  }

  system: {
    /** Persists a renderer-side crash to the main log for support. */
    logError(input: { message: string; stack?: string; context?: string }): Result<{
      logged: boolean
    }>
  }
}
