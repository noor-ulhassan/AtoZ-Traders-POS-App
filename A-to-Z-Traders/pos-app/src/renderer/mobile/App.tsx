import type { JSX, ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import type { ShopIdentity } from './lib/client'
import {
  MobileApiError,
  currentToken,
  resumeSession,
  setSignedOutHandler,
  signIn,
  signOut
} from './lib/client'
import { clearCache } from './lib/offline'
import { useOnline } from './lib/hooks'
import { Button, Field, Input, Note, Spinner } from './ui/kit'
import { HomeScreen } from './screens/Home'
import { NewBillScreen } from './screens/NewBill'
import { BillsScreen } from './screens/Bills'
import { BillDetailScreen } from './screens/BillDetail'
import { PartiesScreen } from './screens/Parties'
import { PartyDetailScreen } from './screens/PartyDetail'
import { StockScreen } from './screens/Stock'
import { ProductDetailScreen } from './screens/ProductDetail'
import { MoneyScreen } from './screens/Money'
import { ReportsScreen } from './screens/Reports'
import { MoreScreen } from './screens/More'

/**
 * The companion app.
 *
 * `HashRouter` for the same practical reason the desktop uses it, plus one of
 * its own: this is installed to a phone's home screen and reloaded from
 * whatever screen it was left on, and a hash never has to be understood by the
 * server for that to work.
 */

/* --------------------------------------------------------------- session */

interface SessionValue {
  shop: ShopIdentity
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

export function useShop(): SessionValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useShop used outside the signed-in app.')
  return value
}

/* ------------------------------------------------------------- sign in */

function SignInScreen({
  onSignedIn,
  offline
}: {
  onSignedIn: (shop: ShopIdentity) => void
  offline: boolean
}): JSX.Element {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      onSignedIn(await signIn(password))
    } catch (caught) {
      setError(caught instanceof MobileApiError ? caught.message : 'Could not sign in. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col justify-center px-6 py-10">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-xl font-semibold">Wholesale POS</h1>
        <p className="mt-1 text-sm text-ink-muted">
          The same shop, on your phone. Sign in with the password that unlocks the app on the shop
          computer.
        </p>

        {offline && (
          <div className="mt-5">
            <Note tone="warn" title="No connection">
              This phone cannot reach the shop computer. Check you are on the shop Wi-Fi and that
              the app is open there.
            </Note>
          </div>
        )}

        <form
          className="mt-6 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <Field label="Shop password" error={error ?? undefined}>
            <Input
              type="password"
              value={password}
              autoFocus
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          <Button
            type="submit"
            variant="primary"
            block
            loading={busy}
            disabled={password.length === 0}
          >
            Sign in
          </Button>
        </form>

        <p className="mt-6 text-caption text-ink-subtle">
          Signing in here does not sign anybody out at the counter. The shop computer can end this
          session at any time from its Settings screen.
        </p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- tab bar */

const TABS = [
  { to: '/', label: 'Home', icon: 'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z' },
  { to: '/bill', label: 'Bill', icon: 'M12 5v14M5 12h14' },
  { to: '/bills', label: 'Bills', icon: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6' },
  {
    to: '/parties',
    label: 'Khata',
    icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0'
  },
  { to: '/more', label: 'More', icon: 'M5 12h.01M12 12h.01M19 12h.01' }
] as const

function TabBar(): JSX.Element {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper pb-[var(--safe-bottom)]">
      <div className="flex h-[var(--tabbar-height)]">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center gap-0.5 text-micro ${
                isActive ? 'text-accent' : 'text-ink-subtle'
              }`
            }
          >
            <svg
              viewBox="0 0 24 24"
              className="size-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={tab.icon} />
            </svg>
            {tab.label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

/* ------------------------------------------------------------------ app */

function SignedInApp({
  shop,
  onSignedOut
}: {
  shop: ShopIdentity
  onSignedOut: () => void
}): JSX.Element {
  const online = useOnline()

  const value = useMemo<SessionValue>(
    () => ({
      shop,
      signOut: async () => {
        await signOut()
        clearCache()
        onSignedOut()
      }
    }),
    [shop, onSignedOut]
  )

  return (
    <SessionContext.Provider value={value}>
      {!online && (
        <div className="sticky top-0 z-40 bg-warn px-4 py-1.5 text-center text-caption font-medium text-white">
          Offline — you can look, but nothing can be saved
        </div>
      )}

      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/bill" element={<NewBillScreen />} />
        <Route path="/bills" element={<BillsScreen />} />
        <Route path="/bills/:saleId" element={<BillDetailScreen />} />
        <Route path="/parties" element={<PartiesScreen />} />
        <Route path="/parties/:type/:id" element={<PartyDetailScreen />} />
        <Route path="/stock" element={<StockScreen />} />
        <Route path="/stock/:productId" element={<ProductDetailScreen />} />
        <Route path="/money" element={<MoneyScreen />} />
        <Route path="/reports" element={<ReportsScreen />} />
        <Route path="/more" element={<MoreScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <TabBar />
    </SessionContext.Provider>
  )
}

function Boundary({ children }: { children: ReactNode }): JSX.Element {
  return <div className="min-h-full bg-canvas">{children}</div>
}

export function App(): JSX.Element {
  const [shop, setShop] = useState<ShopIdentity | null>(null)
  const [checking, setChecking] = useState(true)
  const online = useOnline()

  const forgetShop = useCallback(() => {
    setShop(null)
    // The cache is cleared on a deliberate sign-out (see `SignedInApp`), but
    // not here: an expired session is the normal end of a day, and the owner
    // should still see the last figures while typing the password back in.
  }, [])

  useEffect(() => {
    setSignedOutHandler(forgetShop)
  }, [forgetShop])

  // Resume without asking for the password again, when the token is still good.
  useEffect(() => {
    let cancelled = false

    void (async () => {
      if (!currentToken()) {
        if (!cancelled) setChecking(false)
        return
      }
      try {
        const resumed = await resumeSession()
        if (!cancelled) setShop(resumed)
      } catch {
        // Offline with a token in hand. There is nothing to verify against, so
        // the honest thing is to ask for the password when the shop is back.
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  if (checking) {
    return (
      <Boundary>
        <div className="flex min-h-full items-center justify-center">
          <Spinner />
        </div>
      </Boundary>
    )
  }

  return (
    <HashRouter>
      <Boundary>
        {shop ? (
          <SignedInApp shop={shop} onSignedOut={forgetShop} />
        ) : (
          <SignInScreen onSignedIn={setShop} offline={!online} />
        )}
      </Boundary>
    </HashRouter>
  )
}
