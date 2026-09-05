import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out', '**/.native-cache'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,

      /*
       * Provider components live in the same file as the hook that reads them
       * (ToastProvider/useToast, ConfirmProvider/useConfirm). Keeping the pair
       * together is the point — splitting them to satisfy a fast-refresh
       * heuristic would scatter the context across two files for no gain, so
       * this stays a warning rather than a build-breaking error.
       */
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }]
    }
  },
  {
    // Build tooling and the end-to-end runs, not application code: plain Node
    // scripts, and the e2e ones also evaluate helper functions inside the
    // renderer, where `window`/`document` are the globals that matter.
    files: ['scripts/**/*.mjs', 'test/e2e/**/*.mjs', '*.config.{ts,mjs}'],
    languageOptions: {
      globals: { window: 'readonly', document: 'readonly', HTMLInputElement: 'readonly' }
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  eslintConfigPrettier
)
