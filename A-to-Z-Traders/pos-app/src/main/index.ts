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

    // A shop machine can stay open for weeks. Auto-backup only on clean quit
    // would mean a single power cut loses everything since the last close, so
    // also snapshot on a timer (a no-op unless a backup folder is configured).
    setInterval(runAutoBackup, SIX_HOURS).unref()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })
}

const SIX_HOURS = 6 * 60 * 60 * 1000

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

/**
 * Last-resort handler for an error no service caught. Better-sqlite3 is
 * synchronous and each write is its own committed transaction, so the database
 * on disk is already consistent — but we still flush the WAL, tell the owner
 * plainly, and exit rather than limp along in an unknown state.
 */
let crashing = false
function handleFatal(label: string, error: unknown): void {
  log.error(label, error)
  if (crashing) return
  crashing = true

  // app.exit() below does NOT emit 'before-quit', so the normal auto-backup is
  // skipped on a crash — the one time a fresh snapshot matters most. Take it
  // here, before the connection is closed. Every completed write is already on
  // disk; this just captures it somewhere safe.
  try {
    runAutoBackup()
  } catch (backupError) {
    log.error('crash-time auto-backup failed', backupError)
  }

  try {
    closeDatabase()
  } catch (closeError) {
    log.error('failed to close database during crash', closeError)
  }

  try {
    dialog.showErrorBox(
      'The app has to close',
      'An unexpected error occurred. Your data is safe — every completed sale and payment was already saved. Please start the app again.\n\n' +
        `Details: ${error instanceof Error ? error.message : String(error)}`
    )
  } catch {
    // A dialog failure must not stop the exit below.
  }

  app.exit(1)
}

process.on('uncaughtException', (error) => handleFatal('uncaught exception', error))
process.on('unhandledRejection', (reason) => handleFatal('unhandled rejection', reason))
