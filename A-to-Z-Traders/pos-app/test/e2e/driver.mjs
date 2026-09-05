// Minimal Electron + CDP driver. No new dependencies: Node 24 has a global
// WebSocket, and Electron exposes a DevTools endpoint on --remote-debugging-port.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, rmSync } from 'node:fs'

const require = createRequire(import.meta.url)

export function freshDir(path, { wipe = true } = {}) {
  if (wipe) rmSync(path, { recursive: true, force: true })
  mkdirSync(path, { recursive: true })
  return path
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launch({ appDir, userDataRoot, port = 9333, env = {} }) {
  const electronPath = require(`${appDir}/node_modules/electron`)

  const child = spawn(
    electronPath,
    [
      '.',
      `--remote-debugging-port=${port}`,
      '--no-sandbox',
      // Redirect app.getPath('userData') so the real shop database is never
      // opened by this harness — and so the single-instance lock is separate
      // from any copy of the app the owner already has running.
      `--user-data-dir=${userDataRoot}`
    ],
    {
      cwd: appDir,
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )

  const mainOut = []
  child.stdout.on('data', (b) => mainOut.push(['out', b.toString()]))
  child.stderr.on('data', (b) => mainOut.push(['err', b.toString()]))

  const deadline = Date.now() + 45_000
  let target = null
  while (Date.now() < deadline) {
    await sleep(400)
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      const list = await res.json()
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (target) break
    } catch {
      // devtools endpoint not up yet
    }
  }
  if (!target) {
    child.kill()
    throw new Error(
      `Electron never exposed a page target.\n${mainOut.map(([s, t]) => `[${s}] ${t}`).join('')}`
    )
  }

  const cdp = await connect(target.webSocketDebuggerUrl)
  return { child, cdp, mainOut }
}

async function connect(url) {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  let nextId = 1
  const pending = new Map()
  const events = []
  const listeners = []

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id != null) {
      const entry = pending.get(msg.id)
      if (!entry) return
      pending.delete(msg.id)
      if (msg.error) entry.reject(new Error(`${msg.error.message} (${entry.method})`))
      else entry.resolve(msg.result)
      return
    }
    events.push(msg)
    for (const fn of listeners) fn(msg)
  })

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject, method })
      ws.send(JSON.stringify({ id, method, params }))
    })

  return {
    send,
    events,
    onEvent: (fn) => listeners.push(fn),
    close: () => ws.close()
  }
}

/** Console errors, page exceptions and failed requests, collected as they happen. */
export function collectProblems(cdp) {
  const problems = []
  cdp.onEvent((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      problems.push({
        kind: 'exception',
        text: d.exception?.description ?? d.text,
        url: d.url,
        line: d.lineNumber
      })
    }
    if (
      msg.method === 'Runtime.consoleAPICalled' &&
      ['error', 'warning'].includes(msg.params.type)
    ) {
      problems.push({
        kind: `console.${msg.params.type}`,
        text: msg.params.args
          .map((a) => a.description ?? a.value ?? JSON.stringify(a.preview ?? {}))
          .join(' ')
      })
    }
    if (msg.method === 'Log.entryAdded' && ['error', 'warning'].includes(msg.params.entry.level)) {
      problems.push({
        kind: `log.${msg.params.entry.level}`,
        text: msg.params.entry.text,
        url: msg.params.entry.url
      })
    }
  })
  return problems
}

export function makeEval(cdp) {
  return async function evaluate(fn, ...args) {
    const expression = `(${fn.toString()}).apply(null, ${JSON.stringify(args)})`
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    })
    if (result.exceptionDetails) {
      throw new Error(
        `evaluate failed: ${
          result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
        }`
      )
    }
    return result.result.value
  }
}

export { sleep }
