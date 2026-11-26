# Changelog

All notable changes to MyKhata are documented here. The format follows Keep a Changelog-style categories.

## [Unreleased]

### Changed

- The manual release workflow is now deny-by-default: Windows and Android signing credentials must exist and validate before any build starts; missing or invalid credentials fail the workflow.
- Windows installers are verified with SignTool Authenticode verification and product/version identity checks. Android APKs are verified with `apksigner`, AABs with `jarsigner`/`keytool` plus `bundletool` manifest parsing, and both are checked against `com.mykhata.app`, versionName and versionCode.
- SHA-256 checksums are generated for every release artifact, and only verified, signed artifacts are uploaded. GitHub drafts are created only after all verification jobs pass and are never published automatically. Signed artifacts are staged under the production names `MyKhata Setup 0.2.0.exe`, `MyKhata-0.2.0.apk` and `MyKhata-0.2.0.aab`, with their checksums merged into one verified `SHA256SUMS.txt` so no release asset names collide.
- Android production builds require a complete existing keystore through protected environment variables and pin its certificate SHA-256 fingerprint so a replacement keystore cannot be used silently.

### Fixed

- Windows release fingerprint validation now hashes the signing certificate's DER-encoded bytes with SHA-256 instead of comparing `X509Certificate2.Thumbprint`, which is SHA-1. Tests prove correct, colon-separated lowercase and incorrect fingerprints are handled correctly by both signing scripts.
- Windows builds now pass `-p never` to `electron-builder`, so CI and release builds cannot auto-publish or require a `GH_TOKEN`. Android CI no longer uses `android-actions/setup-android@v3`, which fails on current runners because it installs the removed `sdkmanager tools` package; the preinstalled SDK and explicit license acceptance are used instead. Regression tests guard both behaviours.
- Android keystore and AAB certificate fingerprint parsing now tolerates the leading whitespace emitted by current `keytool` versions; an indented `SHA256:` line previously caused valid signing material to be rejected.
- Windows SHA-256 DER certificate pinning is now mandatory in both pre-build validation and signed-installer verification, must be 64 hexadecimal characters, and fails closed when missing or malformed.

### Verification

- Workflow YAML passes `actionlint 1.7.12`; PowerShell and Bash helper scripts pass syntax checks. Negative-path checks confirm missing secrets, unsigned Windows installers, and missing signed Android outputs are rejected. Deleted temporary test fixtures confirmed Windows PFX and Android keystore credential validation. A deleted self-signed test certificate proved both Windows scripts accept the correct SHA-256 DER fingerprint and reject an incorrect one. Full signed verification with production credentials has not been run locally.

### Manual release checks

- Physical Android SQLCipher unlock-after-restart, physical biometric unlock, and airplane-mode offline operation on Android and Windows remain manual release checks until device evidence is provided.

## [0.1.0] — 2026-11-26

### Added

- Shared React 18 / TypeScript 18 application with Vite 5 and Tailwind CSS 3.
- Offline SQLite persistence through three adapters: Electron + better-sqlite3, Android Capacitor SQLite, and browser sql.js + IndexedDB.
- Versioned migration system with decimal-string currency storage, foreign keys, indexes, and idempotent seed data.
- Immutable `Money` arithmetic based on big.js and multi-currency snapshots with PKR as seeded base currency.
- Double-entry ledger engine with balanced postings, account/receivable/payable/income/expense codes, and journal verification.
- Parties, companies, projects, accounts, categories, obligations, installments, settlements, transfers, refunds, adjustments, and reversals.
- Atomic posting services with unique idempotency keys and duplicate prevention.
- Dashboard, date presets, receivables/payables views, real-data charts, category/currency reports, and complete summaries.
- Responsive light/dark UI with English/Urdu RTL switching and mobile bottom navigation.
- Local PDF generation for person, company, project, receivables, payables, monthly, yearly, account, custom-range, and complete-account statements; native Android share support.
- Logical database dump/restore plus AES-256-GCM encrypted backup files with PBKDF2-SHA256 key derivation.
- Optional Supabase change-queue sync with explicit consent, idempotent upserts, and conflict reporting without silent remote application.
- Electron main process, secure preload bridge, and Windows NSIS installer configuration.
- Capacitor Android project and debug APK build configuration.
- Automated Vitest suite covering money, accounting scenarios, currency, migrations, backups, sync, and PDF generation.
- Documentation: README, INSTALLATION, ARCHITECTURE, DATABASE_SCHEMA, USER_GUIDE, SECURITY, and `.env.example`.

### Verification

- TypeScript application and Electron main-process typechecks pass.
- `npm test`: 25 tests pass.
- Web production build succeeds.
- Windows NSIS installer builds successfully.
- Android debug APK builds successfully with Gradle 8.2.1 and JDK 21.

### Notes

- Cloud sync remains disabled until Supabase credentials and explicit user approval are provided.
- Database-at-rest encryption, app lock, release signing, and code signing are not included in this version; see SECURITY.md.

## [0.2.0] — 2026-11-26

### Added

- Opt-in app lock with PIN/password policy, idle auto-lock, manual lock, change PIN and disable flows.
- Encrypted local SQLite on Windows (SQLCipher-compatible cipher via `better-sqlite3-multiple-ciphers`) and Android (Capacitor SQLite SQLCipher), migrated in place from plaintext without deleting records.
- Optional Android biometric unlock using OS-protected secret storage.
- Receipt/invoice attachments stored as validated BLOBs inside the encrypted database, with per-transaction picker, open/download and delete UI.
- Strict encrypted-backup envelope validation with distinct wrong-password/corrupt/unsupported/invalid reasons, dump validation before restore, and FK-safe restore ordering.
- GitHub Actions CI for typechecks, tests, web build, Windows installer and Android debug verification; manual draft-gate release workflow with release-tag-derived Android versioning (mandatory signing is enforced in the Unreleased gate above).
- Regression tests for settlement reversals, idempotency conflicts, statement sign/date handling, multi-currency postings, backup failure modes, migration versioning, PIN policy and the lock screen.

### Changed

- Electron main process now owns SQLite encryption keys, gates all database IPC while locked, validates IPC senders, removes arbitrary filesystem IPC, ships a strict production CSP, and disables production source maps.
- Android backup of app data is disabled and FileProvider paths are restricted to specific subdirectories.
- Sync consent text now enumerates the fields uploaded; device identity is stable and conflicts no longer advance the sync watermark.
- Reports and dashboards aggregate over the full selected range and label mixed-currency figures explicitly.

### Fixed

- Settlement reversal now produces a compensating settlement, restores obligation status and keeps reports consistent.
- Duplicate settlement submissions are prevented by a deterministic idempotency key; reusing a transaction key with a different payload is a conflict.
- Party statement sign convention, all-time account statement double counting, reverse chronological running balances, and dashboard currency/income aggregates.
- Multi-currency postings, settlements and journal rows no longer hardcode PKR/rate 1; refunds and reversals are capped to the original amount and dated from the original transaction.
- Invalid calendar dates, non-positive exchange rates, incomplete dumps, identifier injection in restore, and re-application of old migrations.
- Legacy exchange-rate rows are preserved during migration; duplicate rates are resolved deterministically instead of silently deleted.
- Base-currency labels, summaries, and form defaults now follow the saved setting instead of hardcoding PKR.

### Verification

Commands run locally on Windows before release preparation:

- `npx tsc --noEmit -p tsconfig.json` — passed.
- `npx tsc --noEmit -p tsconfig.electron.json` — passed.
- `npm test` — 14 test files, 60 tests passed.
- `npm run desktop:build` — built `release/MyKhata Setup 0.2.0.exe`; `Get-AuthenticodeSignature` reports `NotSigned` because no certificate was supplied.
- `npx cap sync android` — completed with seven Capacitor plugins.
- `./android/gradlew -p android assembleDebug --no-daemon` — `BUILD SUCCESSFUL`, exit 0.
- `./android/gradlew -p android assembleRelease bundleRelease --no-daemon -PmykhataVersionCode=200 -PmykhataVersionName=0.2.0` — `BUILD SUCCESSFUL`, exit 0. Outputs are unsigned.
- `dist/` contains zero `.map` files, confirming production source maps are disabled.
- An isolated SQLCipher check rekeyed a plaintext database in place, preserved all rows with `integrity_check = ok`, and rejected a wrong key with `file is not a database`.
- Encrypted-backup tests cover wrong passphrase, corrupt/truncated ciphertext, tampered header, unsupported version, invalid dump, oversized input, and attachment BLOB round-trip.
- Restore tests cover FK-safe ordering with parties, transactions, journal entries, and attachments.
- Migration tests cover version gating, one-time v2 columns, preservation of legacy duplicate rates, deterministic rate selection, and partially upgraded databases.
- No Supabase URL/key was present; sync remained inert during verification.

### Notes

- Cloud sync remains opt-in and disabled by default.
- At commit `e1475fd`, unsigned production builds were still possible; the Unreleased release gate above now supersedes that behaviour and requires signed, verified artifacts.
- Android SQLCipher/biometric on-device testing, real-device offline testing, and independent security review remain manual follow-ups; automated builds and typechecks are not device verification.
- The Windows and Android artifacts are unsigned and were not published.
