# User guide

MyKhata starts with an empty local database. There are no demo users, example companies, or invented balances. Every number you see is calculated from entries you create.

## First steps

1. Open MyKhata on Windows or Android.
2. Go to **Settings** and confirm the base reporting currency (PKR by default).
3. Add at least one **Account** (bank, cash, or wallet). This gives transactions somewhere to post.
4. Add a **Party** (individual or company).
5. Create a **Project** if the work is tied to a client and a delivery date.
6. Enter your first transaction or digital khata obligation.

Use the sidebar on desktop/tablet and the bottom navigation on phones. The header toggles light/dark mode and English/Urdu; Urdu switches the whole interface to RTL.

## Dashboard

The dashboard shows assets, receivables, payables, net position, cash/bank/wallet balances, income and expenses, recent transactions, overdue items, upcoming due dates, and a six-month activity chart. Use the date presets (today, week, month, last month, year, custom, all) to change the reporting period.

A **Journal balanced** badge means every posted transaction has equal debits and credits.

## Parties and projects

- **Parties** stores people and companies with contact details, currency, and optional opening balance/direction.
- **Projects** are linked to a party and track agreed amount, start/due dates, status, and notes.
- Archive a party or account instead of deleting it. Historical ledger entries remain intact.

## Digital khata (receivables and payables)

Use **Khata** to see both directions, or the Receivables/Payables views.

1. Click **New obligation**.
2. Choose person/company, direction (receivable = they owe you; payable = you owe them), account, total amount, currency, optional project/reference/due date.
3. Save. The original double-entry record is posted immediately.

### Installments and payments

Open an obligation and record a payment against a chosen account and date. Partial payments are supported; remaining outstanding is recalculated from settlement allocations. Overpayment is rejected unless you explicitly allow it. You cannot edit a posted original entry — use a reversal or refund instead.

### Reversals and refunds

Use **Reverse** on a transaction when it was posted incorrectly. MyKhata creates a compensating transaction linked to `reversal_of` and preserves the original for audit. Refunds work the same way with a category.

## Transactions

Use **Transactions**, **Income**, or **Expenses** to post entries. Supported types include income, expense, receivable/payable creation and settlement, transfer between accounts, refund, adjustment, and reversal.

Each entry records its original amount/currency, exchange rate, rate date, and converted base amount. Give each external payment attempt a stable reference/idempotency key when needed; duplicate keys are rejected rather than posting twice.

Transfers require different source and destination accounts. Income/expense transactions require a category. Party-linked types require a party.

## Accounts and exchange rates

**Bank Accounts, Cash & Wallets** lists real balances derived from the ledger. You can add, edit, archive/restore, and open an account statement. Opening balances are posted as balanced adjustments when the account is created.

The **Exchange rates** panel stores manual rate snapshots. Transactions capture their own rate and date, so changing a saved rate later never rewrites history. PKR is always 1:1 as the base currency.

## Reports and PDF statements

**Reports** shows a complete accounts summary, category breakdown, currency breakdown, and locally generated PDFs for monthly, yearly, receivables, payables, custom range, and all-time activity.

**PDF Statements** supports person, company, project, receivables, payables, monthly, yearly, complete accounts, and bank/cash statements. Choose a report type, select the record where required, generate a preview, then download or share it. On Android, **Share** opens the native share sheet. Nothing is uploaded to generate a PDF.

## Backup and restore

Go to **Backup, Restore & Sync**.

- Choose a passphrase of at least 8 characters and click **Create encrypted backup**. The `.mykhata` file contains an AES-256-GCM encrypted logical SQL dump.
- Keep the passphrase somewhere safe. It is not stored anywhere and cannot be recovered.
- To restore, choose the backup file, enter its passphrase, and confirm. Restore replaces all current data in one atomic batch.
- A plain SQL dump is available for advanced use; it is **not encrypted**.

Back up before upgrades, before restoring, and regularly if the device may be lost or replaced.

## Optional cloud sync

Sync is off by default. It requires Supabase URL and anon key in a local `.env`, a `mykhata_changes` table (or the configured table name), explicit checkbox approval, and clicking **Sync now**.

The app uploads only queued change metadata/payloads. Remote changes are never silently applied to posted financial records; conflicts are reported for manual review.

## Settings

Settings stores theme and language locally, shows the base currency, schema version, platform, record counts, and device ID. There is no login account or cloud identity requirement.

## Safe operating habits

- Verify balances and statements before relying on them for decisions.
- Record reversals instead of deleting posted entries.
- Keep at least one recent encrypted backup outside the device.
- Never share backup passphrases or `.env` files.
- Keep the app updated, and review the changelog before upgrades.
