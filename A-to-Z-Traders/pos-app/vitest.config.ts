import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

/**
 * Tests run the real services against a real (in-memory) SQLite database.
 *
 * Two modules are redirected:
 *
 *  - `electron` is stubbed. The services only touch `app.getPath` and the
 *    dialogs, so replacing that module is far cheaper than booting Electron
 *    and keeps every business rule under test with the SQL that ships.
 *  - `better-sqlite3` resolves to the Node-ABI copy prepared by
 *    `scripts/prepare-test-sqlite.mjs`, because the one in `node_modules` is
 *    compiled for Electron's ABI and cannot be loaded here.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
      electron: resolve(__dirname, 'test/stubs/electron.ts'),
      'better-sqlite3': resolve(__dirname, '.native-cache/better-sqlite3')
    }
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    restoreMocks: true
  }
})
