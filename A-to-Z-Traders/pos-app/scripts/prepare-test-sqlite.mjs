#!/usr/bin/env node
/**
 * Prepares a Node-ABI copy of `better-sqlite3` for the test runner.
 *
 * Why this exists: a native module is compiled against one V8 ABI. Electron 39
 * is NODE_MODULE_VERSION 140 and Node 24 is 137, so the binding that lets the
 * app run cannot be loaded by Vitest. The obvious fixes are both bad — swapping
 * the one binding back and forth breaks the moment the app is open (Windows
 * locks a loaded .node file), and skipping the database tests would leave the
 * money math untested.
 *
 * So the test runner gets its own copy. `node_modules/better-sqlite3` always
 * holds the Electron binding; `.native-cache/better-sqlite3` holds an
 * identical module with the Node binding, and `vitest.config.ts` aliases to
 * it. Tests and the running app never touch the same file, so both can run at
 * once. This is a one-time setup that `pretest` keeps current.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'node_modules', 'better-sqlite3')
const target = join(root, '.native-cache', 'better-sqlite3')
const binding = join(target, 'build', 'Release', 'better_sqlite3.node')

function installedVersion(modulePath) {
  try {
    return JSON.parse(readFileSync(join(modulePath, 'package.json'), 'utf8')).version
  } catch {
    return null
  }
}

// Rebuild the copy when it is missing or when the dependency has been upgraded.
const wanted = installedVersion(source)
const current = existsSync(binding) ? installedVersion(target) : null

if (wanted !== null && wanted === current) {
  process.exit(0)
}

if (wanted === null) {
  console.error('better-sqlite3 is not installed. Run `npm install` first.')
  process.exit(1)
}

console.log(`Preparing a Node-ABI copy of better-sqlite3@${wanted} for tests (one time)…`)

rmSync(target, { recursive: true, force: true })
mkdirSync(dirname(target), { recursive: true })

// The compiled Electron binding is deliberately left behind; the copy gets its
// own from the prebuild below.
cpSync(source, target, {
  recursive: true,
  filter: (path) => !path.includes(`${join('build', 'Release')}`)
})

try {
  execFileSync('npx', ['prebuild-install', '-r', 'node'], {
    cwd: target,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })
} catch {
  console.error(
    'Could not fetch a Node build of better-sqlite3. Tests that use the database will fail.'
  )
  process.exit(1)
}

if (!existsSync(binding)) {
  console.error(`Expected a compiled binding at ${binding}, but it is not there.`)
  process.exit(1)
}

console.log('Ready.')
