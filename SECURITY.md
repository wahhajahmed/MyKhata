# Security and privacy

This document describes what MyKhata 0.1.0 actually guarantees. It is not a claim of formal security audit or certification.

## Data ownership

- MyKhata has no account, login, or required network service. Normal use works offline.
- Financial records are stored in a local SQLite database: Electron user data on Windows, native app storage on Android, and IndexedDB-backed sql.js in browser development mode.
- The repository and test suite contain no real personal financial data. Local databases, backups, logs, environment files, and keystores are ignored by Git.
- No telemetry, analytics, crash reporting, or advertising SDKs are included.

## Verified protections

- **Encrypted backups:** exported backups use AES-256-GCM with a PBKDF2-SHA256 key derived using 310,000 iterations, a random 16-byte salt, and a random 12-byte IV. The passphrase is not persisted or transmitted. Authentication failure causes restore to fail rather than returning damaged data.
- **Atomic writes:** all financial mutations use parameterized SQL in a single adapter `batch` transaction. Restore deletes and reinserts all logical tables in one atomic batch.
- **Decimal accuracy:** `big.js`-backed immutable `Money` avoids binary floating-point arithmetic for stored amounts and journal calculations.
- **Balanced journals:** posting builds debit/credit pairs and rejects unbalanced entries before commit. Tests verify receivables, payables, installments, overpayment, refunds, reversals, transfers, and currency conversion.
- **Immutable history:** posted transactions are not edited in place. Corrections create linked reversal/refund records.
- **Duplicate prevention:** `idempotency_key` is unique at the database level and duplicate submissions are reported without posting.
- **Electron boundary:** `contextIsolation` is enabled, `nodeIntegration` is disabled, and the renderer receives a fixed preload API rather than raw Node access. External links opened through the bridge must be HTTPS. The database is stored in Electron's user data directory.
- **Optional sync:** sync is inert without Supabase configuration and explicit user approval. Remote financial changes are not applied automatically; conflicts are surfaced for review. Replaying a queue item uses a stable ID and upsert semantics.

## Current limitations

- **No database-at-rest encryption / SQLCipher.** A local attacker or malware with access to the user's storage can read the SQLite file. Use operating-system account protection and full-disk encryption where appropriate.
- **No app lock, biometrics, or role-based access.** Anyone who can open the app on the device can view its data.
- **Backups depend on the passphrase.** A lost passphrase cannot be recovered.
- **Plain SQL dump is unencrypted.** It is intended for advanced manual use only.
- **Supabase keys are client-side.** Only a public anon key may be used. Never put a service-role/secret key in `.env`, source code, or release artifacts. Configure row-level security and access policy in your own Supabase project.
- **Android debug APK is unsigned for distribution.** Generate a protected release keystore before public distribution; never commit keystore files or signing passwords.
- **Electron installer is not code-signed.** Windows SmartScreen may warn until a valid code-signing certificate is used.
- **Attachments table exists but no attachment UI is exposed in 0.1.0.**
- The project has automated tests but has not undergone an independent penetration test or cryptographic audit.

## Reporting sensitive issues

Do not paste real financial data, credentials, passphrases, or private keys into issues or chat. Report security concerns with synthetic reproduction steps. Never commit `.env`, database files, backups, or signing material.
