import { app } from 'electron'
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Cap the log so it cannot grow without bound on a machine that runs for years.
// At the limit the current file becomes main.log.1 (overwriting the previous
// backup) and a fresh main.log starts — so at most ~10 MB of logs are kept.
const MAX_LOG_BYTES = 5 * 1024 * 1024

function rotateIfLarge(file: string): void {
  try {
    if (statSync(file).size < MAX_LOG_BYTES) return
    renameSync(file, `${file}.1`)
  } catch {
    // No file yet, or the rename lost a race — either way, keep logging.
  }
}

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

const minimumLevel: Level = process.env.NODE_ENV === 'development' ? 'debug' : 'info'

// Under test, only failures are worth printing — a migration notice per test
// case buries the actual results.
const isTest = Boolean(process.env.VITEST)

let logFile: string | null = null

function resolveLogFile(): string | null {
  if (logFile) return logFile
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    logFile = join(dir, 'main.log')
    return logFile
  } catch {
    // Logging must never be the reason the app fails to start.
    return null
  }
}

function serialize(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ''}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function write(level: Level, scope: string, message: string, extra: unknown[]): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minimumLevel]) return
  if (isTest && level !== 'error') return

  const timestamp = new Date().toISOString()
  const details = extra.map(serialize).join(' ')
  const line = `${timestamp} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${
    details ? ` ${details}` : ''
  }`

  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)

  // Only durable-log what matters after the fact; debug noise stays in the console.
  if (LEVEL_ORDER[level] >= LEVEL_ORDER.info) {
    const file = resolveLogFile()
    if (file) {
      try {
        rotateIfLarge(file)
        appendFileSync(file, `${line}\n`, 'utf8')
      } catch {
        /* ignore */
      }
    }
  }
}

export interface Logger {
  debug(message: string, ...extra: unknown[]): void
  info(message: string, ...extra: unknown[]): void
  warn(message: string, ...extra: unknown[]): void
  error(message: string, ...extra: unknown[]): void
  child(scope: string): Logger
}

function createLogger(scope: string): Logger {
  return {
    debug: (message, ...extra) => write('debug', scope, message, extra),
    info: (message, ...extra) => write('info', scope, message, extra),
    warn: (message, ...extra) => write('warn', scope, message, extra),
    error: (message, ...extra) => write('error', scope, message, extra),
    child: (childScope) => createLogger(`${scope}:${childScope}`)
  }
}

export const logger = createLogger('pos')
