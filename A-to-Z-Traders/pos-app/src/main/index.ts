import { app, BrowserWindow, dialog } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { bootstrapDatabase } from './app/bootstrap'
import { createMainWindow } from './app/window'
import { closeDatabase } from './db/connection'
import { registerIpcHandlers } from './ipc'
import { runAutoBackup } from './services/backupService'
import { logger } from './utils/logger'

const log = logger.child('main')

// A second instance would open a second connection to the same SQLite file and
// let the owner bill from two windows with two different in-memory ideas of
// stock. One instance only; a second launch focuses the existing window.
const hasLock = app.requestSingleInstanceLock()
if (!hasLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.atoztraders.pos')

    app.on('browser-window-created', (_event, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    try {
      bootstrapDatabase()
      registerIpcHandlers()
    } catch (error) {
      log.error('startup failed', error)
      dialog.showErrorBox(
        'The app could not start',
        `${(error as Error).message}\n\nYour data has not been changed. Restore a backup from the Settings screen of a working installation, or contact support.`
      )
      app.exit(1)
      return
    }

    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })
}

let shuttingDown = false

app.on('before-quit', () => {
  if (shuttingDown) return
  shuttingDown = true
  runAutoBackup()
  closeDatabase()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// A crash mid-transaction must not leave the WAL unflushed.
process.on('uncaughtException', (error) => {
  log.error('uncaught exception', error)
})

process.on('unhandledRejection', (reason) => {
  log.error('unhandled rejection', reason)
})
