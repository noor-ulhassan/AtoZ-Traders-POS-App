import type { JSX } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { BillingPage } from '../features/billing/BillingPage'
import { SalesPage } from '../features/sales/SalesPage'
import { SaleReturnsPage } from '../features/returns/SaleReturnsPage'
import { PurchaseReturnsPage } from '../features/returns/PurchaseReturnsPage'
import { ProductsPage } from '../features/products/ProductsPage'
import { StockLedgerPage } from '../features/products/StockLedgerPage'
import { PurchasesPage } from '../features/purchases/PurchasesPage'
import { PurchaseEntryPage } from '../features/purchases/PurchaseEntryPage'
import { CustomersPage } from '../features/parties/CustomersPage'
import { SuppliersPage } from '../features/parties/SuppliersPage'
import { LedgerPage } from '../features/parties/LedgerPage'
import { PaymentsPage } from '../features/payments/PaymentsPage'
import { ExpensesPage } from '../features/expenses/ExpensesPage'
import { ReportsPage } from '../features/reports/ReportsPage'
import { SettingsPage } from '../features/settings/SettingsPage'

/**
 * Every screen is imported eagerly. This is a local desktop app — the whole
 * bundle is already on disk, so lazy routes would only add a loading flicker
 * between screens the owner switches between all day.
 */
export function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/sales" element={<SalesPage />} />
        <Route path="/returns/sale" element={<SaleReturnsPage />} />
        <Route path="/returns/purchase" element={<PurchaseReturnsPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/stock" element={<StockLedgerPage />} />
        <Route path="/purchases" element={<PurchasesPage />} />
        <Route path="/purchases/new" element={<PurchaseEntryPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/customers/:id" element={<LedgerPage partyType="customer" />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/suppliers/:id" element={<LedgerPage partyType="supplier" />} />
        <Route path="/payments" element={<PaymentsPage />} />
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
