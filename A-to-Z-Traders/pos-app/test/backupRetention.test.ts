import { describe, expect, it } from 'vitest'
import type { BackupFile } from '@shared/types'
import { RETENTION, isBackupDue, planRetention } from '../src/main/services/backupRetention'

/**
 * Retention decides what the owner will still have on the day they need it, so
 * the rules are pinned here rather than left to be inferred from the folder.
 * These run entirely on data — no files are written — which is the point of
 * keeping the policy separate from the file system.
 */

/** A backup taken `minutesAgo`, named the way the service names them. */
function at(iso: string): BackupFile {
  return {
    path: `C:\\backups\\pos-backup-${iso.replace(/[-: ]/g, '').slice(0, 8)}-x.db`,
    fileName: `pos-backup-${iso}.db`,
    size: 1024,
    createdAt: iso
  }
}

/** `count` backups, one every `stepHours`, walking back from a fixed instant. */
function series(count: number, stepHours: number): BackupFile[] {
  const start = Date.parse('2026-08-28T12:00:00Z')
  return Array.from({ length: count }, (_, index) => {
    const when = new Date(start - index * stepHours * 60 * 60 * 1000)
    return at(when.toISOString().slice(0, 19).replace('T', ' '))
  })
}

describe('planRetention', () => {
  it('keeps everything while there is little to keep', () => {
    const files = series(5, 1)
    const { keep, remove } = planRetention(files)

    expect(keep).toHaveLength(5)
    expect(remove).toHaveLength(0)
  })

  it('always keeps the newest ones, whatever their spacing', () => {
    const files = series(40, 1)
    const { keep } = planRetention(files)

    const newest = files.slice(0, RETENTION.recent).map((file) => file.fileName)
    expect(keep.slice(0, RETENTION.recent).map((file) => file.fileName)).toEqual(newest)
  })

  it('thins a busy day down instead of keeping every quarter hour', () => {
    // Four days of backups every 15 minutes — what a real shop generates.
    const files = series(4 * 96, 0.25)
    const { keep, remove } = planRetention(files)

    expect(remove.length).toBeGreaterThan(0)
    // The 12 most recent, plus one for each of the days involved.
    expect(keep.length).toBeLessThan(RETENTION.recent + 10)
    expect(keep.length + remove.length).toBe(files.length)
  })

  it('still reaches back weeks after thinning', () => {
    // A backup every 6 hours for 90 days.
    const files = series(90 * 4, 6)
    const { keep } = planRetention(files)

    const oldestKept = keep[keep.length - 1] as BackupFile
    const spanDays =
      (Date.parse(files[0]!.createdAt.replace(' ', 'T')) -
        Date.parse(oldestKept.createdAt.replace(' ', 'T'))) /
      (24 * 60 * 60 * 1000)

    // The daily tier alone would stop at a fortnight. The weekly slots carry it
    // considerably further — how much further depends on where the week
    // boundaries land, so this asserts the reach, not an exact day.
    expect(spanDays).toBeGreaterThan(35)
  })

  it('never keeps and removes the same file', () => {
    const files = series(200, 2)
    const { keep, remove } = planRetention(files)

    const keptNames = new Set(keep.map((file) => file.fileName))
    expect(remove.some((file) => keptNames.has(file.fileName))).toBe(false)
    expect(keep.length + remove.length).toBe(files.length)
  })

  it('sorts for itself, so a caller cannot get the order wrong', () => {
    const files = series(30, 1)
    const shuffled = [...files].reverse()

    expect(planRetention(shuffled).keep.map((file) => file.fileName)).toEqual(
      planRetention(files).keep.map((file) => file.fileName)
    )
  })

  it('copes with an empty folder', () => {
    expect(planRetention([])).toEqual({ keep: [], remove: [] })
  })
})

describe('isBackupDue', () => {
  const base = {
    folder: 'C:\\backups',
    intervalMinutes: 15,
    lastBackupAt: Date.now() - 60 * 60 * 1000,
    changeCount: 100,
    changeCountAtLastBackup: 50,
    now: Date.now()
  }

  it('is due when time has passed and something changed', () => {
    expect(isBackupDue(base)).toBe(true)
  })

  it('is never due without a folder', () => {
    expect(isBackupDue({ ...base, folder: '' })).toBe(false)
    expect(isBackupDue({ ...base, folder: '   ' })).toBe(false)
  })

  it('is never due when the schedule is set to on-close only', () => {
    expect(isBackupDue({ ...base, intervalMinutes: 0 })).toBe(false)
  })

  it('skips a quiet period rather than filling the folder with copies', () => {
    // A shut shop writes nothing, so there is nothing new to protect.
    expect(isBackupDue({ ...base, changeCount: 50, changeCountAtLastBackup: 50 })).toBe(false)
  })

  it('waits out the interval even after a busy minute', () => {
    expect(isBackupDue({ ...base, lastBackupAt: base.now - 60 * 1000 })).toBe(false)
  })

  it('takes one immediately at the start of a session', () => {
    // total_changes() resets when the connection reopens, so a fresh session
    // cannot compare counts and should simply back up.
    expect(isBackupDue({ ...base, lastBackupAt: null, changeCountAtLastBackup: null })).toBe(true)
  })
})
