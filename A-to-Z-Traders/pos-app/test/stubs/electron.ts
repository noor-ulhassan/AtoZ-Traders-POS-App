import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The slice of Electron the main-process services actually touch.
 *
 * Anything a test exercises must not need a running Electron: `userData`
 * points at a throwaway temp directory, and the dialogs throw so a test that
 * accidentally reaches a native file picker fails loudly instead of hanging.
 */
const userData = mkdtempSync(join(tmpdir(), 'pos-test-'))

export const app = {
  getPath: (name: string): string => (name === 'userData' ? userData : userData),
  getName: (): string => 'pos-test'
}

export const ipcMain = {
  handle: (): void => undefined,
  on: (): void => undefined
}

export const dialog = {
  showOpenDialog: async (): Promise<never> => {
    throw new Error('A native dialog was opened during a test.')
  },
  showOpenDialogSync: (): never => {
    throw new Error('A native dialog was opened during a test.')
  },
  showSaveDialog: async (): Promise<never> => {
    throw new Error('A native dialog was opened during a test.')
  },
  showMessageBox: async (): Promise<never> => {
    throw new Error('A native dialog was opened during a test.')
  },
  showErrorBox: (): void => undefined
}

export const shell = { openExternal: async (): Promise<void> => undefined }

export const BrowserWindow = class {}
