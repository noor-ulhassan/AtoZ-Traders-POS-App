import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve('src/shared')

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': shared,
        '@main': resolve('src/main')
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': shared
      }
    }
  },
  /**
   * Two entry points, one build.
   *
   * `index.html` is the desktop window. `mobile.html` is the companion app the
   * shop computer serves to a phone over the local network — a different
   * layout and a different transport, but the same design tokens, the same
   * `@shared` contract and the same React runtime, so the two are built and
   * chunked together rather than as two projects that drift.
   */
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@mobile': resolve('src/renderer/mobile'),
        '@shared': shared
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          mobile: resolve('src/renderer/mobile.html')
        }
      }
    },
    plugins: [tailwindcss(), react()]
  }
})
