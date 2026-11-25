# MyKhata

Professional Offline-First Personal Finance and Digital Khata Management Application.

MyKhata is a cross-platform personal accounting system for people and companies, digital khata (receivables and payables), projects, bank accounts, cash, wallets, income, expenses, multi-currency transactions, reports, and PDF statements. It works fully offline with a local SQLite database; cloud synchronization is optional and disabled by default. Every dashboard figure and statement is calculated from real posted entries — there are no demo users, sample balances, or hardcoded financial numbers.

> **Version 0.1.0:** implementation and verification complete. See [CHANGELOG.md](CHANGELOG.md) and [SECURITY.md](SECURITY.md) for exact guarantees and limitations.

## Core principles

- Offline first — local CRUD never requires an internet connection
- Local data ownership — records live in a local SQLite database
- Financial accuracy — immutable decimal arithmetic and balanced double-entry journals
- Immutable history — corrections are posted as reversals/refunds, not silent edits
- Optional cloud synchronization — never required or activated automatically
- Cross-platform — Windows (Electron), Android (Capacitor), and browser development share one TypeScript codebase

## Implemented features

- People and companies with individual digital khata ledgers
- Receivables and payables with partial payments, installments, and overpayment controls
- Projects and clients with per-project statements and progress tracking
- Bank accounts, cash, wallets, account transfers, and derived real balances
- Income, expenses, categories, refunds, adjustments, and reversals
- Multi-currency support with manual rate snapshots stored on each transaction
- Dashboard, date presets, analytics, category/currency reports, and complete summaries
- Local PDF statements with native Android sharing
- Encrypted backup/restore, audit tables, duplicate prevention, and optional Supabase sync
- Responsive light/dark interface with English and Urdu RTL modes

## Technology stack

React 18, TypeScript 5.6, Vite 5, Tailwind CSS 3, Zustand, React Router, React Hook Form, Zod, Lucide, Recharts, SQLite (`better-sqlite3` on desktop, Capacitor SQLite on Android, sql.js in the browser), Electron 33, Capacitor 6, pdfmake, Big.js, and Vitest.

## Repository layout

- `src/` — shared React application, business logic, database layer, and tests
- `electron/` — Electron main process and secure preload bridge
- `android/` — generated Capacitor Android project
- Root documentation files — installation, architecture, schema, user guide, security, and changelog

## Quick start

```bash
npm install
npm run dev          # browser development mode
npm test             # 25 automated engine/database/PDF/sync tests
npm run typecheck    # application typecheck
npm run desktop:dev  # Electron desktop application
```

See [INSTALLATION.md](INSTALLATION.md) for Windows installer and Android APK build instructions.

## Verification artifacts

| Target | Output |
| --- | --- |
| Windows NSIS installer | `release/MyKhata Setup 0.1.0.exe` |
| Android debug APK | `android/app/build/outputs/apk/debug/app-debug.apk` |
| Web application | `dist/` |

Build outputs, local databases, backups, environment files, and credentials are ignored by Git.

## Documentation

- [INSTALLATION.md](INSTALLATION.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)
- [USER_GUIDE.md](USER_GUIDE.md)
- [SECURITY.md](SECURITY.md)
- [CHANGELOG.md](CHANGELOG.md)
- [.env.example](.env.example)

## Security

Never commit local database files, backups, credentials, API keys, or real financial data. Backups are encrypted with a passphrase that is never stored. Cloud sync uses only a public anon key from a local environment file and requires explicit user approval. Database-at-rest encryption, app lock, and release/code signing are not included in 0.1.0; see [SECURITY.md](SECURITY.md).
