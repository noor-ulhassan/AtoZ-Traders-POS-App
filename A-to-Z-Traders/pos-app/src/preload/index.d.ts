import type { PosApi } from '@shared/ipc'

declare global {
  interface Window {
    api: PosApi
  }
}

export {}
