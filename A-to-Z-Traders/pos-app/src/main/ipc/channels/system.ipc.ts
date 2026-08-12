import { IPC_CHANNELS } from '@shared/ipc'
import * as backupService from '../../services/backupService'
import * as salesService from '../../services/salesService'
import { printReceipt } from '../../printing/printer'
import { noInput, registerHandler } from '../registry'
import { saleIdSchema } from '../schemas/trade'

export function registerSystemHandlers(): void {
  registerHandler(IPC_CHANNELS.backupNow, noInput, () => backupService.backupNow())
  registerHandler(IPC_CHANNELS.backupRestore, noInput, () => backupService.restoreFromFile())
  registerHandler(IPC_CHANNELS.backupInfo, noInput, () => backupService.databaseInfo())

  registerHandler(IPC_CHANNELS.printReceipt, saleIdSchema, async ({ id }) => {
    await printReceipt(salesService.getReceipt(id))
    return { printed: true }
  })
}
