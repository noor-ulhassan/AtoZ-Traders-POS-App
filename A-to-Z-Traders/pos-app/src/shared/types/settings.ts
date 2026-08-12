export interface Settings {
  businessName: string
  address: string
  phone: string
  taxNumber: string
  taxEnabled: boolean
  /** percent, e.g. 17 means 17% */
  taxRate: number
  receiptFooter: string
  logoPath: string
  currency: string
  /** Copy the database to this folder when the app closes. Empty = disabled. */
  autoBackupDir: string
}

export type SettingsUpdate = Partial<Settings>
