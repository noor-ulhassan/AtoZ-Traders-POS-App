import type { IpcError, IpcResult } from '@shared/types'

/**
 * The renderer's view of the main process.
 *
 * `window.api` returns `{ ok, data | error }` envelopes. Screens rarely want
 * to branch on that shape by hand, so `unwrap` turns a failure into a typed
 * throw and everything else stays ordinary async code.
 */
export const api = window.api

export class ApiError extends Error {
  readonly code: IpcError['code']
  readonly fields: Record<string, string>

  constructor(error: IpcError) {
    super(error.message)
    this.name = 'ApiError'
    this.code = error.code
    this.fields = error.fields ?? {}
  }

  /** True when the owner dismissed a native dialog — not worth a red toast. */
  get isCancelled(): boolean {
    return this.code === 'CANCELLED'
  }
}

export async function unwrap<T>(promise: Promise<IpcResult<T>>): Promise<T> {
  const result = await promise
  if (result.ok) return result.data
  throw new ApiError(result.error)
}

/** Message for any thrown value, so a catch block never renders "[object Object]". */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}

/** Field-level errors from a rejected save, for inline form messages. */
export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof ApiError ? error.fields : {}
}
