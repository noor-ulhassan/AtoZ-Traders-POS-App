import { BrowserWindow, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'node:path'
import icon from '../../../resources/icon.png?asset'

/**
 * The billing screen is a dense, two-column workspace, so the window opens
 * wide and refuses to be squeezed below the width where the bill table starts
 * to wrap.
 */
export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f6f7f9',
    title: 'Wholesale POS',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // The renderer never touches Node or the filesystem; everything goes
      // through the preload contract (Guide §1.1).
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  window.on('ready-to-show', () => {
    window.maximize()
    window.show()
  })

  // Any target="_blank" or window.open goes to the system browser, never a
  // second Electron window with app privileges.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Block in-page navigation away from the app shell.
  window.webContents.on('will-navigate', (event, url) => {
    const isDevServer = is.dev && process.env['ELECTRON_RENDERER_URL']
    if (isDevServer && url.startsWith(process.env['ELECTRON_RENDERER_URL'] as string)) return
    event.preventDefault()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}
