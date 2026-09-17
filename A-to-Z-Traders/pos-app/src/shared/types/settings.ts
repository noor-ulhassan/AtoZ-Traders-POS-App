export interface Settings {
  businessName: string
  address: string
  phone: string
  email: string
  website: string
  taxNumber: string
  taxEnabled: boolean
  /** percent, e.g. 17 means 17% */
  taxRate: number
  receiptFooter: string
  logoPath: string
  currency: string
  /**
   * Optional additional backup destination. Empty keeps local recovery enabled.
   * A separate device or synced folder can provide another recovery location;
   * a successful local write does not confirm that a cloud upload completed.
   */
  autoBackupDir: string
  /** Minutes between additional copies. 0 = only when the app closes. */
  backupIntervalMinutes: number

  /**
   * Whether a phone on the shop Wi-Fi may connect to this machine.
   *
   * Off unless the owner turns it on. Switching it on opens a port on the
   * shop network; that is a deliberate decision, not something an upgrade
   * makes for him.
   */
  mobileEnabled: boolean
  /** The port the companion app is served on. Changeable in case of a clash. */
  mobilePort: number
}

export type SettingsUpdate = Partial<Settings>
