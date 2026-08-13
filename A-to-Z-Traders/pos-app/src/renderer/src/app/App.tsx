import type { JSX } from 'react'
import { HashRouter } from 'react-router-dom'
import { ConfirmProvider } from '../components/ui/Confirm'
import { ToastProvider } from '../components/ui/Toast'
import { AuthGate } from '../features/auth/AuthGate'
import { AuthProvider } from './AuthContext'
import { SettingsProvider } from './SettingsContext'
import { AppRoutes } from './routes'

/**
 * `HashRouter`, not `BrowserRouter`: the packaged app loads the renderer from
 * `file://`, where path-based routing has no server to fall back on and a
 * refresh would land on a 404.
 */
export function App(): JSX.Element {
  return (
    <HashRouter>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <AuthGate>
              <SettingsProvider>
                <AppRoutes />
              </SettingsProvider>
            </AuthGate>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </HashRouter>
  )
}
