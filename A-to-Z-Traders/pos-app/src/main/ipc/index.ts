import { assertAllChannelsRegistered } from './registry'
import { registerAuthHandlers } from './channels/auth.ipc'
import { registerCatalogHandlers } from './channels/catalog.ipc'
import { registerInsightsHandlers } from './channels/insights.ipc'
import { registerMoneyHandlers } from './channels/money.ipc'
import { registerPartyHandlers } from './channels/parties.ipc'
import { registerSettingsHandlers } from './channels/settings.ipc'
import { registerSystemHandlers } from './channels/system.ipc'
import { registerTradeHandlers } from './channels/trade.ipc'

/**
 * Registers every IPC handler, then verifies that the contract in
 * `@shared/ipc` is fully covered. A missing handler fails startup instead of
 * failing silently the first time the owner opens that screen.
 */
export function registerIpcHandlers(): void {
  registerAuthHandlers()
  registerSettingsHandlers()
  registerCatalogHandlers()
  registerPartyHandlers()
  registerTradeHandlers()
  registerMoneyHandlers()
  registerInsightsHandlers()
  registerSystemHandlers()

  assertAllChannelsRegistered()
}
