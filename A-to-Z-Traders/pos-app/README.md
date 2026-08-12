# Wholesale POS

A point-of-sale and khata (credit ledger) application for a wholesale shop.
Single user, offline, all data in one SQLite file on the shop's own machine.

Built to the specification in `Guide.md`.

---

## Running it

```bash
npm install          # also compiles better-sqlite3 for Electron
npm run dev          # development, with hot reload
npm run build:win    # Windows installer -> release/
```

| Command             | What it does                                          |
| ------------------- | ----------------------------------------------------- |
| `npm run dev`       | Runs the app with hot reload                          |
| `npm test`          | Runs the test suite (50 tests)                        |
| `npm run typecheck` | TypeScript across main, preload and renderer          |
| `npm run lint`      | ESLint                                                |
| `npm run verify`    | typecheck + lint + tests — run this before committing |
| `npm run build:win` | Builds a Windows `.exe` installer                     |

### The one piece of local setup that is not obvious

`better-sqlite3` is a native module, and Electron and Node are built against
different V8 ABIs — so the binding the app loads is not one Vitest can load.
`node_modules/better-sqlite3` always holds the Electron build (from
`postinstall`), and `pretest` prepares a second, Node-built copy under
`.native-cache/` that `vitest.config.ts` aliases to. Nothing is swapped, so
tests run fine with the app open.

Use **`npm test`**, not `npx vitest` — `pretest` is what prepares that copy.
It runs once and is skipped afterwards until the dependency changes.

---

## How it is put together

```
src/
  shared/          types, money + date helpers, the IPC contract
  main/            everything with access to the database and the OS
    db/            connection, migration runner, migrations/*.sql
    repositories/  SQL and row→domain mapping. No business rules.
    services/      all business logic. Transactions live here.
    ipc/           thin handlers: validate → call a service → return a result
    printing/      receipt builder + printer driver (a stub for now)
    utils/         money rounding, CSV, logging, errors
  preload/         the only bridge to the renderer
  renderer/        React UI
    components/    design system (ui/) and layout
    features/      one folder per screen
    hooks/         useQuery, useMutation, useHotkey, …
```

**The rules that matter**, in the order they matter:

1. **The database is only ever touched from the main process.** The renderer
   has no Node access at all — `contextIsolation` is on, `nodeIntegration` is
   off, and `window.api` is the entire surface.
2. **Every multi-table write is one transaction.** A sale writes the bill, its
   lines, a stock movement per line, the cached stock, the customer balance
   and the remembered prices — all of it, or none of it.
3. **`stock_movements` is the truth about quantity.** `products.stock_qty` is a
   cache maintained in the same transaction, and a mismatch is repaired from
   the ledger at startup.
4. **Cost is frozen onto each sale line.** Profit on a bill from last week does
   not change when you buy stock at a new price today.
5. **Money is rounded to 2 decimals on every write** — through one `money()`
   helper, nowhere else.
6. **Every IPC input is validated in the main process.** The UI validates too,
   for a good typing experience, but it is never trusted.

### Adding a feature

A new screen usually means one file in each layer:

```
repositories/thingRepository.ts    SQL
services/thingService.ts           rules + transaction
ipc/schemas/…                      what a valid payload looks like
ipc/channels/….ipc.ts              wire it up
shared/ipc.ts                      add the channel + method signature
preload/index.ts                   implement the method
renderer/features/thing/           the screen
```

`shared/ipc.ts` is the contract. Adding a channel there without a handler
fails at startup, on purpose; adding a method without implementing it in the
preload fails the typecheck.

### Changing the database

Migrations are append-only. Add `src/main/db/migrations/NNNN_name.sql`, add one
line to `migrations/index.ts`, and the runner applies it inside a transaction
on next start. **Never edit a migration that has shipped** — write a new one.

---

## Where the data lives

|          |                                                                     |
| -------- | ------------------------------------------------------------------- |
| Database | `%APPDATA%/Wholesale POS/pos.db`                                    |
| Logs     | `%APPDATA%/Wholesale POS/logs/main.log`                             |
| Backups  | wherever the owner chooses, plus the auto-backup folder in Settings |

The database is never written to the install folder, so upgrading or
reinstalling the app cannot take the shop's records with it. Uninstalling
leaves the data in place.

**Backups are not optional.** One file on one machine is one hard-drive failure
away from losing every record. The Settings screen takes a backup on demand and
can copy the database to a chosen folder — ideally a USB drive — each time the
app closes. The WAL is checkpointed first, so a copy is always complete.
Restoring keeps the previous database alongside the new one.

---

## Conventions

- **Dates** are `YYYY-MM-DD` local calendar dates. Never `new Date(string)` on a
  stored date — that reads it as UTC and shifts the day.
- **Quantities** are stored in base units. A line entered as "2 cartons" is
  stored as its base quantity with the factor that produced it.
- **Balances**: positive means the party owes. For a customer that is money
  coming to the shop; for a supplier, money going out.
- **Profit** = line amount − (captured cost × base quantity). Bill-level
  discount is a flat deduction from gross, not spread across lines. Tax
  collected is never counted as revenue.

## Testing

`test/` runs the real services against an in-memory SQLite database with the
real migration applied, so the money math is tested against the SQL that
ships. `test/workflow.test.ts` walks a full trading day — purchase, cash sale,
credit sale, return, payment, expenses — and checks that stock, khata, cash and
profit all still agree at the end.

## Not done yet

- **Printing** is a stub (Guide §6.10). `buildReceipt()` produces the full
  receipt object and `printer.ts` renders it to the log in an 80mm column
  layout. Wiring a real ESC/POS printer means replacing the driver in
  `printing/printer.ts` and nothing else.
- **Receipt language** (English/Urdu) is decided in the printing phase.
- **Auto-update** is not configured; the app is installed and updated by hand.
