import { IPC_CHANNELS } from '@shared/ipc'
import * as backupService from '../../services/backupService'
import * as salesService from '../../services/salesService'
import { printReceipt } from '../../printing/printer'
import { logger } from '../../utils/logger'
import { noInput, registerHandler } from '../registry'
import { backupPathSchema, logErrorSchema } from '../schemas/system'
import { saleIdSchema } from '../schemas/trade'

const rendererLog = logger.child('renderer')

export function registerSystemHandlers(): void {
  registerHandler(IPC_CHANNELS.backupNow, noInput, () => backupService.backupNow())
  registerHandler(IPC_CHANNELS.backupRunNow, noInput, () => backupService.backupToConfiguredFolder())
  registerHandler(IPC_CHANNELS.backupRestore, noInput, () => backupService.restoreFromFile())
  registerHandler(IPC_CHANNELS.backupRestoreFrom, backupPathSchema, ({ path }) =>
    backupService.restoreFromPath(path)
  )
  registerHandler(IPC_CHANNELS.backupInfo, noInput, () => backupService.databaseInfo())
  registerHandler(IPC_CHANNELS.backupStatus, noInput, () => backupService.backupStatus())
  registerHandler(IPC_CHANNELS.backupList, noInput, () => backupService.listConfiguredBackups())

  registerHandler(IPC_CHANNELS.printReceipt, saleIdSchema, async ({ id }) => {
    await printReceipt(salesService.getReceipt(id))
    return { printed: true }
  })

  // Public: a crash can happen before the app is unlocked, and reporting it must
  // never itself be gated.
  registerHandler(
    IPC_CHANNELS.systemLogError,
    logErrorSchema,
    (input) => {
      rendererLog.error(`${input.context ?? 'crash'}: ${input.message}`, input.stack ?? '')
      return { logged: true }
    },
    { public: true }
  )
}
