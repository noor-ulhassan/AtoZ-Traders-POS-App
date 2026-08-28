import type { JSX } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/AuthContext'
import { useSettings } from '../../app/SettingsContext'
import { useQuery } from '../../hooks/useQuery'
import { api, unwrap } from '../../lib/api'

/**
 * A slim, always-visible strip at the bottom of every screen carrying the
 * business identity the admin sets in Settings → Business profile: name,
 * address, and contact channels. It lives outside the scroll region in
 * `AppShell`, so it stays put no matter how long the page is.
 *
 * Only the details that have a value are shown, joined by middots, so a shop
 * that fills in just a name and phone gets a tidy line rather than a row of
 * empty separators.
 *
 * It also carries the sample-data warning. That belongs somewhere permanent and
 * unmissable rather than on one screen: made-up bills sit in the same lists as
 * real ones, and an owner who forgets they are there would read every total on
 * every report as fact.
 */
export function AppFooter(): JSX.Element {
  const { settings } = useSettings()
  const isAdmin = useAuth().role === 'admin'
  const name = settings.businessName.trim() || 'A to Z Traders'

  // Owner-only: the channel is admin-gated, so asking as a shopkeeper would be
  // a guaranteed refusal on every screen load.
  const demo = useQuery(async () => (isAdmin ? unwrap(api.demo.status()) : null), [isAdmin])

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

      {demo.data?.present && (
        <>
          <span className="min-w-4 flex-1" />
          <Link
            to="/settings"
            className="rounded-sm border border-warn-border bg-warn-weak px-2 py-0.5 font-medium text-warn hover:brightness-95"
          >
            Sample data is loaded — these figures are not real
          </Link>
        </>
      )}
    </footer>
  )
}
