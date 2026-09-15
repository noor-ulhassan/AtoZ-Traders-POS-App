import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { resolveStaticFile } from '../src/main/mobile/staticFiles'
import { isBusy, underMaintenance } from '../src/main/ipc/maintenance'

const folder = mkdtempSync(join(tmpdir(), 'pos-static-test-'))
writeFileSync(join(folder, 'index.html'), 'desktop')
writeFileSync(join(folder, 'mobile.html'), 'phone')
afterAll(() => rmSync(folder, { recursive: true, force: true }))

describe('untrusted phone paths', () => {
  it.each(['/%', '/%E0%A4%A', '/%00'])(
    'refuses malformed path %s without throwing into the till',
    (path) => {
      expect(resolveStaticFile(path, folder)).toBeNull()
    }
  )
  it.each(['/index.html', '/%69ndex.html', '/INDEX.HTML', '/sub/../index.html'])(
    'keeps the desktop shell private through path variant %s',
    (path) => {
      expect(resolveStaticFile(path, folder)).toBeNull()
    }
  )
  it('continues to serve the phone shell', () => {
    expect(resolveStaticFile('/', folder)).toBe(join(folder, 'mobile.html'))
  })
})

it('refuses overlapping restores without clearing the first maintenance lock', async () => {
  let finish!: () => void
  const first = underMaintenance(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  try {
    await expect(underMaintenance(async () => undefined)).rejects.toThrow(/already|busy|progress/i)
    expect(isBusy()).toBe(true)
  } finally {
    finish()
    await first
  }
  expect(isBusy()).toBe(false)
})
