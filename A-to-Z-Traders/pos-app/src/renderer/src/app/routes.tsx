import type { JSX, ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { BillingPage } from '../features/billing/BillingPage'
import { SalesPage } from '../features/sales/SalesPage'
import { SaleReturnsPage } from '../features/returns/SaleReturnsPage'
import { PurchaseReturnsPage } from '../features/returns/PurchaseReturnsPage'
import { ProductsPage } from '../features/products/ProductsPage'
import { StockLedgerPage } from '../features/products/StockLedgerPage'
import { OtherStockPage } from '../features/otherStock/OtherStockPage'
import { PurchasesPage } from '../features/purchases/PurchasesPage'
import { PurchaseEntryPage } from '../features/purchases/PurchaseEntryPage'
import { CustomersPage } from '../features/parties/CustomersPage'
import { SuppliersPage } from '../features/parties/SuppliersPage'
import { LedgerPage } from '../features/parties/LedgerPage'
import { PaymentsPage } from '../features/payments/PaymentsPage'
import { ExpensesPage } from '../features/expenses/ExpensesPage'
import { ReportsPage } from '../features/reports/ReportsPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { UsersPage } from '../features/users/UsersPage'
import { useAuth } from './AuthContext'
import type { Feature } from './permissions'
import { canAccess } from './permissions'

/**
 * Sends a role that lacks a feature back to the dashboard rather than showing
 * an empty or forbidden screen. This is a UX guard only — the main process
 * still refuses the underlying channels (ipc/registry.ts), so a hand-typed
 * hash cannot reach data the role may not have.
 */
function Guarded({ feature, children }: { feature: Feature; children: ReactNode }): JSX.Element {
  const { role } = useAuth()
  return canAccess(role, feature) ? <>{children}</> : <Navigate to="/" replace />
}

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
        <Route
          path="/returns/purchase"
          element={
            <Guarded feature="purchaseReturns">
              <PurchaseReturnsPage />
            </Guarded>
          }
        />
        <Route
          path="/other-stock"
          element={
            <Guarded feature="otherStock">
              <OtherStockPage />
            </Guarded>
          }
        />
        <Route
          path="/products"
          element={
            <Guarded feature="products">
              <ProductsPage />
            </Guarded>
          }
        />
        <Route
          path="/stock"
          element={
            <Guarded feature="stock">
              <StockLedgerPage />
            </Guarded>
          }
        />
        <Route
          path="/purchases"
          element={
            <Guarded feature="purchases">
              <PurchasesPage />
            </Guarded>
          }
        />
        <Route
          path="/purchases/new"
          element={
            <Guarded feature="purchases">
              <PurchaseEntryPage />
            </Guarded>
          }
        />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/customers/:id" element={<LedgerPage partyType="customer" />} />
        <Route
          path="/suppliers"
          element={
            <Guarded feature="suppliers">
              <SuppliersPage />
            </Guarded>
          }
        />
        <Route
          path="/suppliers/:id"
          element={
            <Guarded feature="suppliers">
              <LedgerPage partyType="supplier" />
            </Guarded>
          }
        />
        <Route path="/payments" element={<PaymentsPage />} />
        <Route
          path="/expenses"
          element={
            <Guarded feature="expenses">
              <ExpensesPage />
            </Guarded>
          }
        />
        <Route
          path="/reports"
          element={
            <Guarded feature="reports">
              <ReportsPage />
            </Guarded>
          }
        />
        <Route
          path="/users"
          element={
            <Guarded feature="users">
              <UsersPage />
            </Guarded>
          }
        />
        <Route
          path="/settings"
          element={
            <Guarded feature="settings">
              <SettingsPage />
            </Guarded>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
