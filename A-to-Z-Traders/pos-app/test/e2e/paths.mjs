import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

/**
 * Where these runs live.
 *
 * `APP` is the project itself, resolved from this file rather than hard-coded,
 * so the harness works from any checkout. Everything a run writes goes under a
 * throwaway directory in the system temp folder — never `%APPDATA%` — so a run
 * can never open, migrate or overwrite the shop's real `pos.db`.
 */
export const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const workspace = mkdtempSync(join(tmpdir(), 'pos-e2e-'))

export const userDataDir = (name) => join(workspace, name)
export const WORKSPACE = workspace
export const PACKAGED_EXE = join(APP, 'release', 'win-unpacked', 'WholesalePOS.exe')
