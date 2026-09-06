import type { IsoTimestamp } from './common'

/**
 * Phone access — the shop's own Wi-Fi, and nothing beyond it.
 *
 * The phone is a second screen onto the till, not a second till. Everything
 * here describes the little HTTP server the desktop app runs so that screen
 * can exist; none of it is a second copy of the business.
 */

/** A phone currently signed in. Sessions are in-memory and die with the app. */
export interface MobileDevice {
  /** Opaque handle for revoking this session. Never the session token itself. */
  id: string
  /** The LAN address it connected from, e.g. `192.168.1.34`. */
  address: string
  /** A short, readable guess at the device, from its user agent. */
  device: string
  signedInAt: IsoTimestamp
  lastSeenAt: IsoTimestamp
}

export interface MobileStatus {
  /** The saved setting: whether the owner has switched phone access on. */
  enabled: boolean
  /** Whether the server is listening right now. */
  running: boolean
  port: number
  /**
   * Every address a phone on the shop Wi-Fi can reach this machine on, ready
   * to type into a browser. Empty means the machine is not on a network the
   * app is willing to serve — see `network.ts`.
   */
  urls: string[]
  devices: MobileDevice[]
  /** Why it is not listening, when it is enabled but not running. */
  error: string | null
}
