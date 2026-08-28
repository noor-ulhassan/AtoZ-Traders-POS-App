import type { Settings, SettingsUpdate } from '@shared/types'
import { getDb } from '../db/connection'
import * as repository from '../repositories/settingsRepository'
import { assertBackupFolderIsSafe } from './backupService'
import { businessRule } from '../utils/errors'

export function getSettings(): Settings {
  return repository.getSettings(getDb())
}

export function updateSettings(patch: SettingsUpdate): Settings {
  if (patch.taxEnabled === true) {
    const rate = patch.taxRate ?? getSettings().taxRate
    if (rate <= 0) {
      throw businessRule('Set a tax rate above zero before turning tax on.')
    }
  }

  // Checked here rather than when a backup runs, so the owner finds out while
  // they are looking at the field — not silently, hours later, in a log.
  if (patch.autoBackupDir !== undefined && patch.autoBackupDir.trim() !== '') {
    assertBackupFolderIsSafe(patch.autoBackupDir)
  }

  const db = getDb()
  repository.updateSettings(db, patch)
  return repository.getSettings(db)
}
