# Wholesale POS

A point-of-sale and ledger application designed for wholesale operations. The application operates offline, storing all data locally in a SQLite database on one machine — which is also the only writer. A phone on the same local network can act as a second screen onto it (see **Phone access** below); there is no second database and no synchronisation step.

## Architecture

- **Stack:** Electron, React, TypeScript, better-sqlite3, Vite.
- **Process Model:**
  - The Main process owns all database connections and operating system interactions.
  - The Renderer process (React UI) is strictly isolated (`nodeIntegration` is disabled, `contextIsolation` is enabled).
  - Inter-process communication (IPC) is exclusively routed through the preload script.

## Directory Structure

- `src/main/`: Core business logic, SQLite repositories, transactions, and IPC handlers.
- `src/main/mobile/`: The LAN HTTP server behind phone access — access policy, sessions, routing.
- `src/preload/`: Secure context bridge mapping IPC channels to the renderer.
- `src/renderer/`: React frontend, views, and design system components.
- `src/renderer/mobile/`: The companion PWA, built as a second entry point of the same bundle.
- `src/shared/`: Shared type definitions and IPC contracts.
- `test/`: Test suite covering database and service layers.
- `test/e2e/`: Scripted runs against the built application.

## Development and Setup

```bash
# Install dependencies and build native modules for Electron
npm install

# Start development server with hot-reload
npm run dev
```

### Scripts

- `npm run dev`: Starts the application in development mode.
- `npm test`: Executes the Vitest test suite.
- `npm run typecheck`: Validates TypeScript typing across main, preload, and renderer.
- `npm run lint`: Executes ESLint.
- `npm run verify`: Runs typecheck, linting, and tests.
- `npm run build:win`: Packages the application into a Windows installer.

### Native Module Testing

The `better-sqlite3` native module is compiled against the Electron V8 ABI during installation. To enable Vitest (which runs on Node), the `npm test` command executes a `pretest` hook that builds a separate Node-compatible binary in `.native-cache/`. Always use `npm test` rather than invoking `vitest` directly to ensure correct bindings.

## Database Management

- **Storage Location:** `%APPDATA%/Wholesale POS/pos.db`
- **Migrations:** Managed via append-only SQL scripts in `src/main/db/migrations/`. The migration runner executes unapplied scripts in a transaction upon application startup.
- **Transactions:** All multi-table writes (e.g., sales processing, inventory updates, ledger modifications) must be wrapped in atomic transactions to guarantee data integrity.
- **Backups:** The application includes a manual and automated backup utility. Backups checkpoint the WAL prior to copying the database file.

## Domain Guidelines

- **Quantities:** Stored internally in base units. Conversion factors apply at the presentation layer.
- **Currency:** Values are rounded to two decimal places on every write operation.
- **Costing:** Weighted-average cost is captured at the time of sale. Profit margins on historical transactions remain fixed regardless of subsequent cost fluctuations.
- **Dates:** Stored as `YYYY-MM-DD` strings to prevent timezone offset errors.

## Phone access

The application can serve a companion progressive web app to phones on the same
local network. It is disabled by default and enabled from **Settings → Phone
access**, which also shows the address to open on the phone.

- **One writer.** Requests from the phone are dispatched through the same
  `invokeChannel` pipeline as the desktop IPC — the same Zod schemas, the same
  access policy, the same services. There is no second data store.
- **Two allowlists.** `SHOPKEEPER_CHANNELS` (`src/main/ipc/registry.ts`) governs
  roles; `MOBILE_CHANNELS` (`src/main/mobile/channels.ts`) governs what is
  exposed to the network. Both fail closed, and both must pass.
- **Local only.** The server answers loopback and RFC 1918 addresses and refuses
  everything else. Authentication is the existing admin password, throttled per
  device; sessions are held in memory and end when the application closes.
- **Offline behaviour is read-only.** The service worker caches the shell and
  each screen's last response, labelled with when it was read. Writes are
  refused while offline rather than queued — a queued sale would be priced
  against stale stock and requires a server-assigned invoice number.

## Release

To compile and package the application for Windows:

```bash
npm run build:win
```

The installer will be generated in the `release/` directory.
