import type { ErrorCode, IpcError } from '@shared/types'

/**
 * The only error type services should throw deliberately.
 *
 * Anything else that escapes a service is a bug, and the IPC layer reports it
 * as INTERNAL with a generic message so we never leak a SQL string or a file
 * path into the UI.
 */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly fields?: Record<string, string>

  constructor(code: ErrorCode, message: string, fields?: Record<string, string>) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.fields = fields
  }

  toIpcError(): IpcError {
    return {
      code: this.code,
      message: this.message,
      ...(this.fields ? { fields: this.fields } : {})
    }
  }
}

export const notFound = (what: string): AppError =>
  new AppError('NOT_FOUND', `${what} was not found.`)

export const conflict = (message: string): AppError => new AppError('CONFLICT', message)

export const businessRule = (message: string): AppError => new AppError('BUSINESS_RULE', message)

export const invalid = (message: string, fields?: Record<string, string>): AppError =>
  new AppError('VALIDATION', message, fields)

/** The session is locked; the caller must unlock before this channel runs. */
export const authRequired = (message = 'Please unlock the app to continue.'): AppError =>
  new AppError('AUTH', message)

/** Turn a driver-level SQLite error into something the shop owner can act on. */
export function translateSqliteError(error: unknown): AppError | null {
  if (!(error instanceof Error)) return null
  const code = (error as NodeJS.ErrnoException).code

  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
    if (error.message.includes('products.sku')) {
      return conflict('Another product already uses this SKU.')
    }
    if (error.message.includes('sales.invoice_no')) {
      return conflict('That invoice number already exists. Please try saving again.')
    }
    if (error.message.includes('categories.name')) {
      return conflict('A category with this name already exists.')
    }
    if (error.message.includes('expense_categories.name')) {
      return conflict('An expense category with this name already exists.')
    }
    if (error.message.includes('product_units')) {
      return conflict('That unit is already defined for this product.')
    }
    if (error.message.includes('staff_users.username')) {
      return conflict('That username is already taken.')
    }
    return conflict('This record conflicts with one that already exists.')
  }

  if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return conflict('This record is still referenced by other records and cannot be changed.')
  }

  if (code === 'SQLITE_CONSTRAINT_CHECK') {
    return new AppError('VALIDATION', 'A value was outside the range this field allows.')
  }

  return null
}
