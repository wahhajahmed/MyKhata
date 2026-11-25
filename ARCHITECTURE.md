# Architecture

MyKhata has one shared React/TypeScript application and three database adapters. All accounting rules live above the adapter layer so Windows, Android, and browser development use identical validation and posting logic.

## Layers

```text
src/pages + src/components        UI, forms, navigation, PDF preview
src/store/useAppStore.ts          Zustand app state, adapter selection, refresh/actions
src/core/schemas.ts               Zod input validation
src/core/services.ts              repositories, posting orchestration, idempotency
src/core/ledger.ts                double-entry posting rules and balance calculations
src/core/money.ts                 immutable decimal Money based on big.js
src/core/reports.ts               dashboard, statements, summaries, category/currency reports
src/db/*                          DbAdapter interface and platform implementations
src/pdf/*                         local PDF generation and native share
src/backup/*                      encrypted backup and restore
src/sync/*                        optional Supabase change queue sync
electron/*                        Electron main process and preload bridge
android/*                         generated Capacitor Android project
```

## Database adapter contract

`DbAdapter` exposes `all`, `get`, `batch`, `exportBytes`, `replaceBytes`, and `close`. Every write is submitted as a `batch` of parameterized SQL statements and executed in a single native transaction. There is no path that writes financial rows one by one outside a transaction.

Implementations:

- `electronAdapter.ts` sends SQL to Electron main over IPC; main uses `better-sqlite3`, WAL journaling, foreign keys, and a busy timeout.
- `capacitorAdapter.ts` uses `@capacitor-community/sqlite` and `executeTransaction` on Android.
- `webAdapter.ts` and `sqlJsAdapter.ts` use sql.js with an IndexedDB snapshot for browser development.

Logical dump/restore (`dumpDatabase` / `restoreDump`) is used by all adapters because raw SQLite bytes are not interchangeable across the three engines. A dump is a `mykhata-sqlite-dump` containing all application tables; restore deletes children before parents and reinserts everything in one atomic batch.

## Financial model

- Amounts are decimal strings in SQLite and immutable `Money` objects in memory. JavaScript floating point is never used for storage or journal arithmetic.
- PKR is the seeded base reporting currency. Each transaction records original amount, currency, exchange rate, rate date, and converted base amount.
- Every posted transaction creates balanced journal entries. `assertBalanced` verifies debits equal credits before the batch is committed.
- Account codes are `ASSET:ACCOUNT:<id>`, `ASSET:RECEIVABLE:<party>`, `LIABILITY:PAYABLE:<party>`, `INCOME:<category>`, and `EXPENSE:<category>`.
- Obligations require an account and post their original journal entry at creation. Payments use allocation records and support partial settlement, overpayment rejection by default, and explicit overpayment approval.
- Posted history is immutable. Corrections create compensating `reversal` or `refund` transactions linked through `reversal_of`; the original row remains.
- `idempotency_key` is unique and prevents duplicate transaction submission.

## Reports and PDF

`reports.ts` derives all values from journal rows and posted transactions. There are no demo users, sample balances, or hardcoded financial figures. Dashboard metrics and charts are generated from real database rows. `pdf/statements.ts` builds a pdfmake document; downloads happen locally, and native Android sharing uses `@capacitor/share`.

## Desktop security boundary

Electron uses `contextIsolation: true`, `nodeIntegration: false`, and a preload script exposing a fixed `window.electronAPI` object. Main process IPC validates the shape of calls where relevant, allows only HTTPS external links, and confines database files to Electron's user data directory. The database bridge intentionally supports application SQL; it is not a general Node bridge.

## Sync design

`sync_queue` records entity changes with stable UUIDs and operation payloads. `SupabaseSync` upserts queued changes keyed by queue ID, making replay idempotent, then pulls remote changes from other devices. Remote financial edits are not applied automatically: the UI reports them as conflicts for manual review. Sync is inert without Supabase environment configuration and explicit user consent.

## Internationalization and responsive UI

Tailwind CSS provides light/dark themes and responsive layouts. The app shell uses `HashRouter` so deep links work from `file://` in Electron and inside the Android WebView. The header toggles English/Urdu; Urdu sets `dir="rtl"` on the document root. Preferences persist with Capacitor Preferences on Android and localStorage elsewhere.

## Tests

Vitest covers decimal arithmetic, receivables/payables, installments, overpayment, refunds, reversals, transfers, currency conversion, migrations, encrypted backup/restore, sync idempotency/conflicts, and PDF generation. All tests use in-memory or temporary SQLite databases, never personal data.

## Build outputs

| Target | Command | Output |
| --- | --- | --- |
| Web bundle | `npm run build` | `dist/` |
| Electron main | `npm run electron:build-main` | `dist-electron/` |
| Windows installer | `npm run desktop:build` | `release/MyKhata Setup 0.1.0.exe` |
| Android debug APK | `assembleDebug` | `android/app/build/outputs/apk/debug/app-debug.apk` |
