import type { JSX } from 'react'
import { useSettings } from '../../app/SettingsContext'

/**
 * A slim, always-visible strip at the bottom of every screen carrying the
 * business identity the admin sets in Settings → Business profile: name,
 * address, and contact channels. It lives outside the scroll region in
 * `AppShell`, so it stays put no matter how long the page is.
 *
 * Only the details that have a value are shown, joined by middots, so a shop
 * that fills in just a name and phone gets a tidy line rather than a row of
 * empty separators.
 */
export function AppFooter(): JSX.Element {
  const { settings } = useSettings()
  const name = settings.businessName.trim() || 'A to Z Traders'

  const details = [
    settings.address.trim(),
    settings.phone.trim() && `Ph: ${settings.phone.trim()}`,
    settings.email.trim(),
    settings.website.trim()
  ].filter((detail): detail is string => Boolean(detail))

  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-line bg-paper px-6 py-2 text-caption text-ink-muted">
      <span className="font-semibold text-ink">{name}</span>
      {details.map((detail) => (
        <span key={detail} className="flex items-center gap-2">
          <span aria-hidden="true" className="text-ink-subtle">
            ·
          </span>
          <span>{detail}</span>
        </span>
      ))}
    </footer>
  )
}
