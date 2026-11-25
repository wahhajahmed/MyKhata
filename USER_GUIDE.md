# User guide

MyKhata starts with an empty local database. There are no demo users, example companies, or invented balances. Every number you see is calculated from entries you create.

## First steps

1. Open MyKhata on Windows or Android.
2. Go to **Settings → Security & encryption** and enable **App lock** on desktop or Android. Choose a PIN/password you can remember; keep a verified encrypted backup as your only recovery path. Browser mode can gate the screen but cannot encrypt its local database.
3. In **Settings**, confirm the base reporting currency (PKR by default).
4. Add at least one **Account** (bank, cash, or wallet). This gives transactions somewhere to post.
5. Add a **Party** (individual or company).
6. Create a **Project** if the work is tied to a client and a delivery date.
7. Enter your first transaction or digital khata obligation.

Use the sidebar on desktop/tablet and the bottom navigation on phones. The header toggles light/dark mode, language, and (when enabled) **Lock now**. Urdu switches the whole interface to RTL.

## App lock and biometrics

- Once enabled, the app asks for your PIN/password at startup and after the configured idle timeout (5–60 minutes, default 15). While locked, the database is closed and no financial screen is rendered.
- On Android, if the device has enrolled biometrics, **Enable biometrics** in Settings lets you unlock with fingerprint/face instead of typing the PIN. Biometrics are a convenience; the PIN remains the recovery credential.
- **Change PIN** requires the current PIN. **Disable lock** also requires the current PIN and converts the database back to plaintext; only do this on a protected device.
- A forgotten PIN cannot be recovered from the encrypted database. Restore from an encrypted backup instead.

## Dashboard

The dashboard shows assets, receivables, payables, net position, cash/bank/wallet balances, income and expenses in the selected range, recent transactions, overdue items, upcoming due dates, and a six-month activity chart. Use the date presets (today, week, month, last month, year, custom, all) to change the reporting period.

A **Journal balanced** badge means every posted transaction has equal debits and credits.

## Parties and projects

- **Parties** stores people and companies with contact details, currency, and optional opening balance/direction.
- **Projects** are linked to a party and track agreed amount, start/due dates, status, and notes.
- Archive a party or account instead of deleting it. Historical ledger entries remain intact.

## Digital khata (receivables and payables)

Use **Khata** to see both directions, or the Receivables/Payables views.

1. Click **New obligation**.
2. Choose person/company, direction (receivable = they owe you; payable = you owe them), account, total amount, currency, optional project/reference/due date.
3. Save. The original double-entry record is posted immediately, using the selected account/currency and a resolved exchange rate.

### Installments and payments

Open an obligation and record a payment against a chosen account and date. The payment modal shows both the **outstanding** amount and the **total obligation**. Partial payments are supported and outstanding is recalculated from active settlements. Overpayment is rejected unless you explicitly allow it, and an exact payment is always marked settled. Duplicate settlement submissions are ignored so a double-click cannot pay twice.

### Reversals and refunds

Use **Reverse** on a transaction when it was posted incorrectly, or on a settlement payment that must be undone. MyKhata creates a compensating record linked to `reversal_of`, preserves the original, restores the obligation to open, and caps reversals/refunds to the original amount. You cannot edit a posted original entry in place.

## Transactions and attachments

Use **Transactions**, **Income**, or **Expenses** to post entries. Supported types include income, expense, receivable/payable creation and settlement, transfer between accounts, refund, adjustment, and reversal.

Each entry records its original amount/currency, exchange rate, rate date, and converted base amount. Give each external payment attempt a stable reference/idempotency key when needed; the same key with a different payload is rejected instead of silently reusing the original.

Transfers require different source and destination accounts. Income/expense transactions require a category. Party-linked types require a party.

Use the paperclip **Attachments** action on a transaction to attach local PDF, PNG, JPEG or WebP files (up to 10 MiB each). Files are stored inside the encrypted database, appear in encrypted backups, and can be opened, downloaded, or deleted from the same panel. Nothing is uploaded.

## Accounts and exchange rates

**Bank Accounts, Cash & Wallets** lists real balances derived from the ledger. You can add, edit, archive/restore, and open an account statement. Opening balances are posted as balanced adjustments when the account is created.

The **Exchange rates** panel stores manual rate snapshots. Rates must be positive and dates must be real calendar dates. Transactions capture their own rate and date, so changing a saved rate later never rewrites history. PKR is the default base currency and is 1:1 with itself.

## Reports and PDF statements

**Reports** shows a complete accounts summary, category breakdown, per-currency breakdown, and locally generated PDFs for monthly, yearly, receivables, payables, custom range, and all-time activity. Mixed-currency figures are grouped by currency or explicitly labelled as base-currency equivalents.

**PDF Statements** supports person, company, project, receivables, payables, monthly, yearly, complete accounts, and bank/cash statements. Choose a report type, select the record where required, generate a preview, then download or share it. On Android, **Share** opens the native share sheet. Nothing is uploaded to generate a PDF.

## Backup and restore

Go to **Backup, Restore & Sync**.

- Choose a passphrase of at least 8 characters and click **Create encrypted backup**. The `.mykhata` file contains an AES-256-GCM encrypted logical SQL dump, including attachments.
- Keep the passphrase somewhere safe. It is not stored anywhere and cannot be recovered.
- To restore, choose the backup file, enter its passphrase, and confirm. The page shows a specific reason for failures: unsupported version, corrupt header, wrong passphrase, corrupt data, or invalid payload. Restore replaces all current data only after validation succeeds.
- A plain SQL dump is available for advanced use; it is **not encrypted**.

Back up before upgrades, before restoring, and regularly if the device may be lost or replaced.

## Optional cloud sync

Sync is off by default. It requires Supabase URL and anon key in a local `.env`, a `mykhata_changes` table (or the configured table name), explicit checkbox approval, and clicking **Sync now**.

The consent text lists exactly what is uploaded: record ids, party names/contact details/notes, account names/bank names/notes, amounts, descriptions, and operation metadata. Remote changes are never silently applied to posted financial records; conflicts are reported for manual review and do not advance the sync watermark.

## Settings

Settings stores theme and language locally, shows the base currency, schema version, platform, record counts, and device ID, and manages app lock, biometrics, change PIN, disable lock, and the auto-lock timeout. There is no login account or cloud identity requirement.

## Safe operating habits

- Verify balances and statements before relying on them for decisions.
- Record reversals instead of deleting posted entries.
- Keep at least one recent encrypted backup outside the device.
- Never share backup passphrases or `.env` files.
- Lock the app whenever you step away, and keep the device itself protected.
- Keep the app updated, and review the changelog before upgrades.
