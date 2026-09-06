import { IPC_CHANNELS } from '@shared/ipc'
import { syncMobileServer } from '../../mobile/server'
import * as settingsService from '../../services/settingsService'
import { noInput, registerHandler } from '../registry'
import { settingsUpdateSchema } from '../schemas/settings'

export function registerSettingsHandlers(): void {
  registerHandler(IPC_CHANNELS.settingsGet, noInput, () => settingsService.getSettings())

  registerHandler(IPC_CHANNELS.settingsUpdate, settingsUpdateSchema, (patch) => {
    const settings = settingsService.updateSettings(patch)

    // Phone access has no state of its own: the settings row IS the state, and
    // the server is made to match it here, on the one path that can change it.
    // Same reasoning as the backup scheduler re-reading its settings every
    // tick — there is no second copy to fall out of step. Not awaited, because
    // saving the shop's name must not wait on a socket closing; failures land
    // in the status the Settings screen is already polling.
    if (patch.mobileEnabled !== undefined || patch.mobilePort !== undefined) {
      void syncMobileServer()
    }

    return settings
  })
}
