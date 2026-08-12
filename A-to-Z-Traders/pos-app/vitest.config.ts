import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

/**
 * Tests run the real services against a real (in-memory) SQLite database.
 *
 * Electron itself is stubbed — the services only touch `app.getPath` and the
 * dialogs, so replacing that module is far cheaper than booting Electron, and
 * it keeps every business rule under test with the actual SQL that ships.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
      electron: resolve(__dirname, 'test/stubs/electron.ts')
    }
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    restoreMocks: true
  }
})
