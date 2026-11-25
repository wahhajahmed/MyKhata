# MyKhata

Professional Offline-First Personal Finance and Digital Khata Management Application.

MyKhata is a cross-platform personal accounting system for maintaining every financial relationship in one place: people and companies, digital khata (receivables and payables), projects, bank accounts, cash, digital wallets, income and expenses, multi-currency transactions, reports, and PDF statements. It works fully offline with a local SQLite database; cloud synchronization is optional.

> **Status:** under active development. See [CHANGELOG.md](CHANGELOG.md) for implemented features and [SECURITY.md](SECURITY.md) for verified security guarantees.

## Core principles

- Offline first — local CRUD never requires an internet connection
- Local data ownership — your financial data lives in your local SQLite database
- Financial accuracy — decimal arithmetic and balanced ledger entries
- Optional cloud synchronization — never required for normal use
- Cross-platform — Windows (Electron) and Android (Capacitor) share one TypeScript codebase

## Planned feature set

- People & companies with individual digital ledgers
- Receivables and payables tracked independently, with partial payments and installments
- Project and client management with per-project statements
- Bank accounts, cash in hand, Easypaisa/JazzCash/custom wallets and account transfers
- Income, expenses and customizable categories
- Multi-currency support with offline manual exchange rates and rate snapshots
- Dashboard, analytics and printable reports
- Offline PDF statements
- Encrypted backup/restore, audit history, optional Supabase sync

## Technology stack

React, TypeScript, Vite, Tailwind CSS, Zustand, React Router, React Hook Form, Zod, Lucide, Recharts, SQLite (better-sqlite3 on desktop, Capacitor SQLite on Android), Electron, Capacitor, pdfmake, Vitest.

## Repository layout

- `src/` — shared React application, business logic, database layer and tests
- `electron/` — Electron main process and secure preload bridge
- `android/` — Capacitor Android project (generated during setup)
- `docs` files at root — installation, architecture, database schema, user guide and security notes

## Getting started

See [INSTALLATION.md](INSTALLATION.md) for prerequisites and setup, and [ARCHITECTURE.md](ARCHITECTURE.md) for design details.

```bash
npm install
npm run dev          # browser development mode
npm run test         # automated financial-engine tests
npm run desktop:dev  # Electron desktop application
```

## Security

Never commit local database files, backups, credentials, API keys or real financial data. Cloud sync is opt-in and uses only public anon/client keys from an environment template; service-role keys must never be shipped in the client.

## License

See repository settings. Do not publish release artifacts or screenshots before they are actually generated and verified.
