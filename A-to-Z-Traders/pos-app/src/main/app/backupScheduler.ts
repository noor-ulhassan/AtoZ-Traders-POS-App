import { runScheduledBackup, scheduleInputs } from '../services/backupService'
import { isBackupDue } from '../services/backupRetention'
import { logger } from '../utils/logger'

const log = logger.child('backup-schedule')

/**
 * The timer behind automatic backups.
 *
 * It ticks once a minute and re-reads the settings every time rather than being
 * reconfigured when they change. That costs one trivial query a minute and buys
 * something worth more: there is no second copy of the schedule to fall out of
 * step with the database, so turning backups on, off, or changing the interval
 * takes effect on its own with nothing to wire up and nothing to forget.
 */
const TICK_MS = 60 * 1000

let timer: NodeJS.Timeout | null = null

async function tick(): Promise<void> {
  try {
    if (!isBackupDue({ ...scheduleInputs(), now: Date.now() })) return
    await runScheduledBackup()
  } catch (error) {
    // runScheduledBackup already records its own failures; anything reaching
    // here is a problem reading the settings, and a timer has nobody to tell.
    log.error('backup tick failed', error)
  }
}

export function startBackupScheduler(): void {
  if (timer) return

  timer = setInterval(() => void tick(), TICK_MS)
  // Never hold the process open on the app's account.
  timer.unref()
  log.info('automatic backup scheduler started')
}

export function stopBackupScheduler(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}
