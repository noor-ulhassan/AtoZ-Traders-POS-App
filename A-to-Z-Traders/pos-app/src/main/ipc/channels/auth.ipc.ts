import { IPC_CHANNELS } from '@shared/ipc'
import * as authService from '../../services/authService'
import { noInput, registerHandler } from '../registry'
import {
  authChangePasswordSchema,
  authLoginSchema,
  authResetSchema,
  authSetupSchema
} from '../schemas/auth'

/**
 * Auth channels are the one group registered `public`: they must run while the
 * app is still locked (you cannot log in through a gate that requires being
 * logged in). Every finer rule — "setup only once", "change needs the current
 * password" — lives in the service, not here.
 */
export function registerAuthHandlers(): void {
  const publicChannel = { public: true }

  registerHandler(IPC_CHANNELS.authStatus, noInput, () => authService.getStatus(), publicChannel)

  registerHandler(
    IPC_CHANNELS.authSetup,
    authSetupSchema,
    (input) => authService.setup(input),
    publicChannel
  )

  registerHandler(
    IPC_CHANNELS.authLogin,
    authLoginSchema,
    (input) => authService.login(input),
    publicChannel
  )

  registerHandler(IPC_CHANNELS.authLock, noInput, () => authService.lock(), publicChannel)

  registerHandler(
    IPC_CHANNELS.authChangePassword,
    authChangePasswordSchema,
    (input) => authService.changePassword(input),
    publicChannel
  )

  registerHandler(
    IPC_CHANNELS.authSecurityQuestion,
    noInput,
    () => authService.getSecurityQuestion(),
    publicChannel
  )

  registerHandler(
    IPC_CHANNELS.authResetPassword,
    authResetSchema,
    (input) => authService.resetPassword(input),
    publicChannel
  )
}
