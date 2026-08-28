import type { BackupFile } from '@shared/types'

/**
 * Which backups to keep, and which to let go.
 *
 * A folder that only ever grows is a folder a cloud client eventually chokes
 * on, and one that keeps only the newest few is no protection against a
 * problem noticed a week late — a corrupted row, a mistaken bulk edit. So the
 * policy thins with age rather than truncating: everything from the last few
 * hours, a day's worth going back a fortnight, a week's worth going back two
 * months.
 *
 * Kept pure and separate from the file system so the rules can be tested
 * without writing a single file.
 */

export const RETENTION = {
  /** The newest N, whatever their spacing — covers "I broke it just now". */
  recent: 12,
  /**
   * Distinct days to hold one copy of. The recent tier claims its own days
   * first, so this is a total rather than an addition to it.
   */
  dailyDays: 14,
  /**
   * Distinct weeks to hold one copy of — again a total, claimed by the tiers
   * above before this one gets to add any. Combined with the daily tier that
   * reaches roughly six to eight weeks back, depending on where the week
   * boundaries fall relative to the newest backup.
   */
  weeklyWeeks: 8
} as const

/** `YYYY-MM-DD` — the day a backup belongs to. */
function dayKey(createdAt: string): string {
  return createdAt.slice(0, 10)
}

/**
 * A key identifying the week a backup belongs to.
 *
 * Weeks are counted from the epoch in whole 7-day blocks rather than by ISO
 * week number: the only thing required here is that two backups in the same
 * week share a key, and this cannot disagree with itself at a year boundary
 * the way a hand-rolled ISO week can.
 */
function weekKey(createdAt: string): string {
  const time = Date.parse(`${createdAt.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(time)) return createdAt.slice(0, 10)
  return String(Math.floor(time / (7 * 24 * 60 * 60 * 1000)))
}

export interface RetentionPlan {
  keep: BackupFile[]
  remove: BackupFile[]
}

/**
 * Splits a folder's backups into the ones worth keeping and the rest.
 *
 * `files` may arrive in any order; it is sorted newest-first here so callers
 * cannot get the policy wrong by handing over a differently sorted list.
 */
export function planRetention(files: BackupFile[]): RetentionPlan {
  const ordered = [...files].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const keep: BackupFile[] = []
  const remove: BackupFile[] = []

  const daysKept = new Set<string>()
  const weeksKept = new Set<string>()

  ordered.forEach((file, index) => {
    if (index < RETENTION.recent) {
      keep.push(file)
      // The recent ones still claim their day and week, so the daily tier does
      // not immediately keep a second copy of today.
      daysKept.add(dayKey(file.createdAt))
      weeksKept.add(weekKey(file.createdAt))
      return
    }

    const day = dayKey(file.createdAt)
    if (daysKept.size < RETENTION.dailyDays && !daysKept.has(day)) {
      daysKept.add(day)
      weeksKept.add(weekKey(file.createdAt))
      keep.push(file)
      return
    }

    const week = weekKey(file.createdAt)
    if (weeksKept.size < RETENTION.weeklyWeeks && !weeksKept.has(week)) {
      weeksKept.add(week)
      keep.push(file)
      return
    }

    remove.push(file)
  })

  return { keep, remove }
}

/**
 * Whether a scheduled backup is due.
 *
 * Three things have to be true, and each rules out a different way of getting
 * this wrong:
 *
 *  - a folder is configured, and the schedule is not set to "on close only";
 *  - enough time has passed since the last one;
 *  - something has actually been written since the last one. Without this a
 *    quiet Sunday produces ninety-six identical copies, and the folder the
 *    owner has to search through fills with noise.
 */
export function isBackupDue(input: {
  folder: string
  intervalMinutes: number
  /** Epoch ms of the last successful backup in this session; null if none yet. */
  lastBackupAt: number | null
  /** SQLite's total_changes() now, and as of the last backup. */
  changeCount: number
  changeCountAtLastBackup: number | null
  now: number
}): boolean {
  if (input.folder.trim() === '') return false
  if (input.intervalMinutes <= 0) return false

  // Nothing backed up yet this session: take one, so a machine that is only
  // ever put to sleep still gets a fresh copy after every start.
  if (input.lastBackupAt === null || input.changeCountAtLastBackup === null) return true

  if (input.changeCount === input.changeCountAtLastBackup) return false

  return input.now - input.lastBackupAt >= input.intervalMinutes * 60 * 1000
}
