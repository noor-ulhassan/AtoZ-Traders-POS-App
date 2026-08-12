import { IPC_CHANNELS } from '@shared/ipc'
import * as settingsService from '../../services/settingsService'
import { noInput, registerHandler } from '../registry'
import { settingsUpdateSchema } from '../schemas/settings'

export function registerSettingsHandlers(): void {
  registerHandler(IPC_CHANNELS.settingsGet, noInput, () => settingsService.getSettings())

  registerHandler(IPC_CHANNELS.settingsUpdate, settingsUpdateSchema, (patch) =>
    settingsService.updateSettings(patch)
  )
}
