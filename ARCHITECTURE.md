# Architecture

MyKhata has one shared React/TypeScript application and three database adapters. All accounting rules live above the adapter layer so Windows, Android, and browser development use identical validation and posting logic.

## Layers

```text
src/pages + src/components        UI, forms, navigation, PDF preview, lock screen
src/store/useAppStore.ts          Zustand state, adapter lifecycle, lock state, refresh/actions
src/security/*                    platform security facade, PIN policy, Electron/native/web implementations
src/core/schemas.ts               Zod input validation
src/core/services.ts              repositories, posting orchestration, idempotency, serialized critical sections
src/core/ledger.ts                double-entry posting rules and balance calculations
src/core/money.ts                 immutable decimal Money based on big.js
src/core/reports.ts               dashboard, statements, summaries, category/currency reports
src/core/attachments.ts           local receipt/invoice BLOB storage and validation
src/db/*                          DbAdapter interface, versioned migrations, platform implementations
src/pdf/*                         local PDF generation and native share
src/backup/*                      encrypted backup and restore validation
src/sync/*                        optional Supabase change queue sync
electron/*                        Electron main process, native SQLite encryption and preload bridge
android/*                         generated Capacitor Android project
```

## Database adapter contract

`DbAdapter` exposes `all`, `get`, `batch`, `exportBytes`, `replaceBytes`, and `close`. Every write is submitted as a `batch` of parameterized SQL statements and executed in a single native transaction. There is no path that writes financial rows one by one outside a transaction.

Implementations:

- `electronAdapter.ts` sends SQL to Electron main over IPC; main uses `better-sqlite3-multiple-ciphers`, SQLCipher-compatible pragmas, WAL journaling, foreign keys, and a busy timeout. The database key exists only in main memory while unlocked.
- `capacitorAdapter.ts` uses `@capacitor-community/sqlite` with SQLCipher on Android once encryption is enabled; plaintext mode is retained for migration and browser-like development paths.
- `webAdapter.ts` and `sqlJsAdapter.ts` use sql.js with an IndexedDB snapshot for browser development; this mode cannot provide database-at-rest encryption.

Logical dump/restore (`dumpDatabase` / `restoreDump`) is used by all adapters because raw SQLite bytes are not interchangeable across the three engines. A dump is a `mykhata-sqlite-dump` containing all application tables. Restore validates version, table presence, columns and primary keys, deletes all tables in child-to-parent order, and reinserts in parent-to-child order inside one atomic batch. Migrations apply only versions newer than the recorded schema version and never delete legacy rate rows. Electron additionally validates a temporary database and keeps a pre-restore copy before swapping files.

## Encryption and app lock

`src/security/types.ts` defines one `SecurityController` contract. `src/security/index.ts` selects the platform implementation:

- **Electron:** `auth.json` in user data contains only a random salt, a scrypt verifier and metadata. The 32-byte database key is derived from the PIN with scrypt, held in memory, and used with `cipher='sqlcipher'`, `legacy=4` pragmas. Enabling the lock rekeys the existing plaintext database in place after a WAL checkpoint and integrity check, with a rollback copy. While locked, all `db:*` IPC is rejected with `APP_LOCKED`.
- **Android:** the SQLCipher secret is managed through the Capacitor SQLite plugin's encryption APIs. The PIN verifier and database key are stored in OS-protected storage so unlock works after restart; the key is only held in memory while unlocked. Biometric unlock is optional. Plaintext-to-encrypted migration uses the plugin's `mode: 'encryption'` path and keeps the original file until verification succeeds.
- **Browser:** `webSecurity` gates the UI with a PBKDF2 verifier but explicitly reports `supported: false`; IndexedDB is not encrypted.

The app shell renders a lock screen before any financial component when `locked` is true, auto-locks after the configured idle timeout, and clears in-memory records on lock.

## Financial model

- Amounts are decimal strings in SQLite and immutable `Money` objects in memory. JavaScript floating point is never used for storage or journal arithmetic.
- The base reporting currency is configurable (PKR by default). Each transaction records original amount, currency, exchange rate, rate date, and converted base amount. Original currency/amount are retained on journal rows for audit.
- Every posted transaction creates balanced journal entries. `assertBalanced` verifies debits equal credits before the batch is committed.
- Account codes are `ASSET:ACCOUNT:<id>`, `ASSET:RECEIVABLE:<party>`, `LIABILITY:PAYABLE:<party>`, `INCOME:<category>`, and `EXPENSE:<category>`.
- Obligations require an account and post their original journal entry at creation. Payments use allocation records and support partial settlement, explicit overpayment approval, settlement idempotency, and reversals that restore obligation status.
- Posted history is immutable. Corrections create compensating `reversal` or `refund` transactions linked through `reversal_of`; the original row remains.
- `idempotency_key` is unique and prevents duplicate transaction submission; a reused key with a different payload is a conflict.

## Reports and PDF

`reports.ts` derives all values from journal rows and posted transactions. There are no demo users, sample balances, or hardcoded financial figures. Mixed-currency totals are grouped by currency or explicitly labelled as base-currency equivalents. `pdf/statements.ts` builds a pdfmake document; downloads happen locally, and native Android sharing uses `@capacitor/share`.

## Desktop security boundary

Electron uses `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and a preload script exposing a fixed `window.electronAPI` object. Every IPC handler validates the sender, production loads only packaged files, development only allows an explicit localhost URL, and a strict CSP is injected into production HTML. Arbitrary filesystem IPC was removed. The database bridge intentionally supports application SQL and remains the main residual renderer risk; it is lock-gated and never exposes the key or a Node bridge.

## Android hardening

`allowBackup` is disabled, FileProvider paths are narrowly scoped, and SQLCipher is bundled by the Capacitor SQLite plugin. Biometric prompts are handled in the renderer through the installed Capacitor plugin; no biometric secret is stored in plain preferences.

## Sync design

`sync_queue` records entity changes with stable UUIDs and operation payloads. `SupabaseSync` upserts queued changes keyed by queue ID, making replay idempotent, and pulls remote changes from other devices. The device ID is persisted rather than regenerated per render. Remote financial edits are not applied automatically: conflicts are reported and do not advance the sync watermark. Sync is inert without Supabase environment configuration and explicit user consent, and the consent text enumerates the uploaded fields.

## Internationalization and responsive UI

Tailwind CSS provides light/dark themes and responsive layouts. The app shell uses `HashRouter` so deep links work from `file://` in Electron and inside the Android WebView. The header toggles English/Urdu; Urdu sets `dir="rtl"` on the document root. Preferences persist with Capacitor Preferences on Android and localStorage elsewhere.

## Tests

Vitest covers decimal arithmetic, receivables/payables, installments, overpayment, refunds, reversals, transfers, currency conversion, settlement reversals, restore validation, encrypted backup failure modes, migration versioning, sync idempotency/conflicts, PDF generation, PIN policy, the lock screen, and base-currency formatting (60 tests). All tests use in-memory or temporary SQLite databases, never personal data.

## Build outputs

| Target | Command | Output |
| --- | --- | --- |
| Web bundle | `npm run build` | `dist/` |
| Electron main | `npm run electron:build-main` | `dist-electron/` |
| Windows installer | `npm run desktop:build` | `release/MyKhata Setup 0.2.0.exe` |
| Android debug APK | `assembleDebug` | `android/app/build/outputs/apk/debug/app-debug.apk` |
| Android release APK/AAB | release workflow (`assembleRelease bundleRelease`) | `android/app/build/outputs/{apk,bundle}/release/`; verified copies in `release/verified-android/` |

The manual release workflow is deny-by-default. It validates Windows and Android signing credentials before any build, rejects missing secrets, pins the Android keystore certificate fingerprint, verifies signatures with SignTool/`apksigner`/`jarsigner`, parses `bundletool` manifest output, checks package identity and release versions, generates `SHA256SUMS.txt`, uploads only verified artifacts, and creates a draft GitHub release without publishing it.
