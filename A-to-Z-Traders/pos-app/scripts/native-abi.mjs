#!/usr/bin/env node
/**
 * Swaps the compiled `better-sqlite3` binding between the Node and Electron
 * ABIs.
 *
 * Why this exists: a native module is compiled against one V8 ABI. Electron 39
 * is NODE_MODULE_VERSION 140 and Node 24 is 137, so the binding that lets the
 * app run cannot be loaded by the test runner, and vice versa. The usual
 * workarounds are to rebuild before each (slow) or to stop testing the
 * database layer at all (worse — the money math is exactly what needs tests).
 *
 * Instead, both compiled bindings are kept in `.native-cache/` and the right
 * one is copied into place by the `pretest` / `predev` / `prebuild` hooks. A
 * missing cache entry is rebuilt once, automatically.
 *
 *   node scripts/native-abi.mjs node       # before running tests
 *   node scripts/native-abi.mjs electron   # before running or building the app
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = join(root, '.native-cache')
const binding = join(
  root,
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node'
)

const target = process.argv[2]
if (target !== 'node' && target !== 'electron') {
  console.error('Usage: node scripts/native-abi.mjs <node|electron>')
  process.exit(1)
}

const cached = join(cacheDir, `${target}.node`)

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
}

function build(which) {
  if (which === 'electron') {
    run('npx', ['electron-builder', 'install-app-deps'])
  } else {
    execFileSync('npx', ['prebuild-install', '-r', 'node'], {
      cwd: join(root, 'node_modules', 'better-sqlite3'),
      stdio: 'inherit',
      shell: process.platform === 'win32'
    })
  }
}

function sameAsCache() {
  if (!existsSync(cached) || !existsSync(binding)) return false
  return readFileSync(cached).equals(readFileSync(binding))
}

mkdirSync(cacheDir, { recursive: true })

if (sameAsCache()) {
  process.exit(0)
}

if (!existsSync(cached)) {
  console.log(`Building the ${target} binding for better-sqlite3 (one time)…`)
  build(target)
  copyFileSync(binding, cached)
  process.exit(0)
}

copyFileSync(cached, binding)
console.log(`better-sqlite3 switched to the ${target} ABI.`)
