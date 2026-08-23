import type { JSX, ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { Settings, SettingsUpdate } from '@shared/types'
import { api, errorMessage, unwrap } from '../lib/api'

interface SettingsContextValue {
  settings: Settings
  /** Persists a patch and updates every screen that reads settings. */
  save: (patch: SettingsUpdate) => Promise<void>
  reload: () => Promise<void>
}

const FALLBACK: Settings = {
  businessName: '',
  address: '',
  phone: '',
  email: '',
  website: '',
  taxNumber: '',
  taxEnabled: false,
  taxRate: 0,
  receiptFooter: '',
  logoPath: '',
  currency: 'PKR',
  autoBackupDir: ''
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

/**
 * Business profile, loaded once at startup.
 *
 * The currency code, tax switch and business name are read by almost every
 * screen. Fetching them per screen would mean a dozen redundant IPC calls and
 * a moment where the header renders with the wrong currency.
 */
export function SettingsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [settings, setSettings] = useState<Settings>(FALLBACK)
  const [isReady, setIsReady] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setSettings(await unwrap(api.settings.get()))
      setFailure(null)
    } catch (error) {
      setFailure(errorMessage(error))
    } finally {
      setIsReady(true)
    }
  }, [])

  useEffect(() => {
    // Loading the business profile from the database is synchronisation with
    // an external system, and every state update inside `reload` happens in a
    // promise callback rather than synchronously in this effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload()
  }, [reload])

  const save = useCallback(async (patch: SettingsUpdate) => {
    setSettings(await unwrap(api.settings.update(patch)))
  }, [])

  // The window title is part of the app's identity, so it follows the business
  // name the admin sets rather than a build-time constant. Empty name falls
  // back to the generic product title.
  useEffect(() => {
    const name = settings.businessName.trim()
    document.title = name ? `${name} — Point of Sale` : 'Wholesale POS'
  }, [settings.businessName])

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, save, reload }),
    [settings, save, reload]
  )

  // Rendering the shell before settings arrive would flash the wrong business
  // name in the sidebar; this is a local database read, so the wait is a frame.
  if (!isReady) return <></>

  if (failure) {
    return (
      <div role="alert" style={{ padding: 32, fontSize: 14 }}>
        <strong>The app could not read its settings.</strong>
        <p style={{ marginTop: 8, color: 'var(--ink-muted)' }}>{failure}</p>
      </div>
    )
  }

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext)
  if (!context) throw new Error('useSettings must be used inside <SettingsProvider>.')
  return context
}

/** The currency code, for labelling amounts. */
export function useCurrency(): string {
  return useSettings().settings.currency
}
