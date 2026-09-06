import { IPC_CHANNELS } from '@shared/ipc'
import { mobileStatus, signOutMobileDevice } from '../../mobile/server'
import { noInput, registerHandler } from '../registry'
import { mobileSignOutSchema } from '../schemas/mobile'

/**
 * The desktop's controls for phone access.
 *
 * Only two, because only two things here are not already settings. Whether the
 * feature is on, and which port it uses, are `mobileEnabled` and `mobilePort`
 * in the settings row — one saved copy, which the server follows. These are
 * the parts with no saved form: what is happening this minute, and turning a
 * device away.
 *
 * Neither is in `SHOPKEEPER_CHANNELS`, so both are owner-only by the fail-
 * closed default rather than by anything written here. Neither is in
 * `MOBILE_CHANNELS` either — a phone cannot close the door it came in by.
 */
export function registerMobileHandlers(): void {
  registerHandler(IPC_CHANNELS.mobileStatus, noInput, () => mobileStatus())

  registerHandler(IPC_CHANNELS.mobileSignOut, mobileSignOutSchema, ({ id }) =>
    signOutMobileDevice(id)
  )
}
