# Changelog

All notable changes to MyKhata are documented here. The format follows Keep a Changelog-style categories.

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

## [Unreleased]

### Planned

- Independent security review and database-at-rest encryption evaluation.
- Release signing configuration for Android and code signing for Windows.
- Attachment UI and richer audit-log browsing.
