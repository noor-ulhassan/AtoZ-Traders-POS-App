import { IPC_CHANNELS } from '@shared/ipc'
import * as userService from '../../services/userService'
import { noInput, registerHandler } from '../registry'
import { staffCreateSchema, staffResetPinSchema, staffSetActiveSchema } from '../schemas/auth'

/**
 * Staff account management. None of these channels appear in the shopkeeper
 * allowlist (registry.ts), so the role guard denies them to anyone but the
 * admin — the handlers themselves carry no role logic.
 */
export function registerUserHandlers(): void {
  registerHandler(IPC_CHANNELS.usersList, noInput, () => userService.listUsers())

  registerHandler(IPC_CHANNELS.usersCreate, staffCreateSchema, (input) =>
    userService.createUser(input)
  )

  registerHandler(IPC_CHANNELS.usersSetActive, staffSetActiveSchema, (input) =>
    userService.setUserActive(input)
  )

  registerHandler(IPC_CHANNELS.usersResetPin, staffResetPinSchema, (input) =>
    userService.resetPin(input)
  )
}
