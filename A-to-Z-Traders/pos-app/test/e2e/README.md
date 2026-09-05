# End-to-end runs

`npm test` proves the business rules against a real database. These scripts
prove the **application** — the built Electron app, its window, the preload
bridge, the IPC guard and the packaged installer — by driving the shipped
renderer the way a person at a counter would.

They are deliberately *not* part of `npm test`: each one launches a window,
takes tens of seconds, and needs a desktop session.

## Running them

Build first — every script runs `out/`, not the source tree:

```bash
npm run build
node test/e2e/journey.mjs      # a shop from first launch to backup, and a restart
node test/e2e/loaded.mjs       # every screen again, with a full shop behind it
node test/e2e/resilience.mjs   # a power cut mid-sale, a second copy, awkward data
npm run build:win              # only needed for the next one
node test/e2e/packaged.mjs     # the installed WholesalePOS.exe
```

Each prints a PASS/FAIL line per check and exits non-zero if anything failed.

## Safety

Every run passes `--user-data-dir` pointing at a fresh temporary directory, so
**the shop's real `%APPDATA%/Wholesale POS/pos.db` is never opened**. That also
gives each run its own single-instance lock, so a run does not fight a copy of
the app the owner already has open.

## How it works

There is no Playwright or Spectron here, and no new dependency. Electron
exposes a DevTools endpoint on `--remote-debugging-port`; `driver.mjs` connects
to it with Node's built-in `WebSocket` and speaks CDP directly:

- `driver.mjs` — launch, connect, evaluate, and collect console errors, page
  exceptions and browser log entries as they happen.
- `ui.mjs` — the page-side helpers, installed as `window.__t`. Inputs are
  filled through the native prototype setter plus a bubbling `input` event,
  which is what React's synthetic-event layer actually listens for; assigning
  `el.value` directly is discarded on the next render.
- `paths.mjs` — where a run reads the app from and writes its data to.

`window.__t.api('sales.create', …)` calls the app's own preload contract, so a
check goes through the real channel, the real Zod schema, the real role guard
and the real service — everything a click does except the click.
