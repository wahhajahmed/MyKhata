# Security and privacy

This document describes the guarantees implemented in MyKhata 0.2.0. It is not a claim of formal security audit, certification, or penetration testing.

## Data ownership

- MyKhata has no account, login, or required network service. Normal use works offline.
- Financial records are stored in a local SQLite database: Electron user data on Windows, native app storage on Android, and IndexedDB-backed sql.js in browser development mode.
- The repository and test suite contain no real personal financial data. Local databases, backups, logs, environment files, keystores, and signing material are ignored by Git.
- No telemetry, analytics, crash reporting, or advertising SDKs are included.
- Offline operation is the default. Cloud sync is inert unless Supabase credentials are supplied **and** explicit consent is given.

## Implemented protections

- **Encrypted local database (desktop and Android, opt-in).** Enabling app lock migrates the existing plaintext database to encrypted storage in place; records are preserved. Windows uses `better-sqlite3-multiple-ciphers` with the SQLCipher-compatible cipher and legacy-4 format. Android uses the SQLCipher build bundled with `@capacitor-community/sqlite`. Browser development mode cannot encrypt IndexedDB and is clearly labelled as such in the UI.
- **App lock.** PIN/password policy rejects trivial values. Only a salted verifier is persisted; the database key is held in memory while unlocked and is never written to a plain file. Android stores the database key in OS-protected storage so PIN unlock works after a restart, and biometric unlock is optional. The app locks automatically after an idle timeout and can be locked manually.
- **Encrypted backups.** Exported backups use AES-256-GCM with a PBKDF2-SHA256 key derived using 310,000 iterations, a random 16-byte salt, and a random 12-byte IV. The passphrase is not persisted or transmitted. The envelope is strictly validated, header fields are authenticated as additional data, and malformed, unsupported, wrong-password, and corrupt backups produce distinct errors. Restores validate the logical dump before replacing data.
- **Safe restore.** Logical restores validate table/column allowlists, reject missing tables, duplicate primary keys and inconsistent foreign keys, and delete all tables before reinserting in parent-to-child order. Electron keeps a pre-restore copy and only swaps the database after integrity and schema checks pass.
- **Atomic writes.** Financial mutations use parameterized SQL in a single adapter `batch` transaction. There is no path that writes financial rows one by one outside a transaction.
- **Decimal accuracy.** `big.js`-backed immutable `Money` avoids binary floating-point arithmetic for stored amounts and journal calculations.
- **Balanced journals and reversal integrity.** Posting builds debit/credit pairs and rejects unbalanced entries before commit. Settlement reversals produce compensating records and recycle obligation status, refunds/reversals are capped to the original amount, and settlement keys prevent duplicate payments.
- **Immutable history.** Posted transactions are not edited in place. Corrections create linked reversal/refund records.
- **Duplicate prevention.** `idempotency_key` is unique at the database level; the same key with a different payload is rejected as a conflict instead of silently returning the original record.
- **Attachments.** Receipts/invoices are stored as BLOBs inside the encrypted SQLite database, capped at 10 MiB with a MIME/extension allowlist. They are included in encrypted backups and never uploaded automatically.
- **Electron boundary.** `contextIsolation` is enabled, `nodeIntegration` is disabled, the production build ships a strict Content-Security-Policy, external links are restricted to HTTPS, arbitrary filesystem IPC has been removed, and IPC handlers validate the sender. Native SQLite stays in the main process; the renderer receives a fixed preload API, not Node access.
- **Android hardening.** Device backup of app data is disabled, FileProvider paths are restricted to specific subdirectories, and SQLCipher is used once the user enables app lock.
- **Optional sync.** Sync is off by default. Consent text enumerates exactly which fields are uploaded (names, contact details, notes, amounts, descriptions, ids). Remote changes are never applied silently; conflicts are reported and do not advance the sync watermark.

## Current limitations

- **Browser mode has no database-at-rest encryption.** It gates the UI but IndexedDB remains readable by anything with access to the browser profile. Use desktop or Android builds for sensitive records.
- **A forgotten PIN cannot be recovered from the encrypted database.** Recovery requires a previously verified encrypted backup. If Android secure storage/Keystore data is cleared, the encrypted database is also unrecoverable.
- **Plain SQL dumps are unencrypted** and intended for advanced manual use only.
- **Supabase keys are client-side.** Only a public anon key may be used. Never put a service-role/secret key in `.env`, source code, or release artifacts. Configure row-level security and per-user access policy in your own Supabase project before enabling sync.
- **The Electron renderer still has an application SQL bridge.** It is sender-checked, lock-gated, and CSP-protected, but a complete renderer compromise is not equivalent to a hardened native app. Do not install untrusted extensions or browse untrusted sites with the same OS account.
- **Android SQLCipher/biometric flows are not hardware-verified in CI.** Automated builds and typechecks pass; on-device verification is a manual release step until test devices are available. Real-device offline verification was not performed.
- **Desktop offline behavior was not exercised in airplane mode.** The app uses a local SQLite file and has no required network dependency, but no automated offline UI test was run.
- **Release artifacts are unsigned until signing credentials are supplied.** Windows SmartScreen may warn and Android will require an explicit unknown-source install for unsigned builds. Release workflow drafts are never published automatically.
- The project has automated tests but has not undergone an independent penetration test or cryptographic audit.

## Reporting sensitive issues

Do not paste real financial data, credentials, passphrases, or private keys into issues or chat. Report security concerns with synthetic reproduction steps. Never commit `.env`, database files, backups, or signing material.
