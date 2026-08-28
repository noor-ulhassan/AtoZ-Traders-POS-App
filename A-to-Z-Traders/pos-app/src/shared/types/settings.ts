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
   * Where automatic backups are written. Empty turns them off.
   *
   * Point this at a folder a cloud client syncs (Google Drive, OneDrive) and
   * the shop's records survive the machine itself. Never point it at the folder
   * holding the live database — the app refuses that.
   */
  autoBackupDir: string
  /** Minutes between automatic backups. 0 = only when the app closes. */
  backupIntervalMinutes: number
}

export type SettingsUpdate = Partial<Settings>
