export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    statements: [
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS currencies (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        symbol TEXT NOT NULL,
        minor_units INTEGER NOT NULL DEFAULT 2,
        is_base INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS exchange_rates (
        id TEXT PRIMARY KEY,
        from_code TEXT NOT NULL REFERENCES currencies(code),
        to_code TEXT NOT NULL REFERENCES currencies(code),
        rate TEXT NOT NULL,
        rate_date TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_exchange_rates_pair_date ON exchange_rates(from_code, to_code, rate_date)`,
      `CREATE TABLE IF NOT EXISTS parties (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('individual','company')),
        phone TEXT,
        email TEXT,
        address TEXT,
        notes TEXT,
        opening_balance TEXT NOT NULL DEFAULT '0',
        opening_balance_direction TEXT NOT NULL DEFAULT 'none',
        currency TEXT NOT NULL DEFAULT 'PKR',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_parties_name ON parties(name)`,
      `CREATE INDEX IF NOT EXISTS idx_parties_active ON parties(is_active, deleted_at)`,
      `CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        agreed_amount TEXT NOT NULL,
        currency TEXT NOT NULL,
        start_date TEXT NOT NULL,
        expected_completion TEXT,
        due_date TEXT,
        status TEXT NOT NULL DEFAULT 'planning',
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_projects_party ON projects(party_id, deleted_at)`,
      `CREATE INDEX IF NOT EXISTS idx_projects_due ON projects(due_date)`,
      `CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        bank_name TEXT,
        nickname TEXT,
        kind TEXT NOT NULL CHECK(kind IN ('bank','cash','wallet')),
        currency TEXT NOT NULL,
        opening_balance TEXT NOT NULL DEFAULT '0',
        notes TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_accounts_kind ON accounts(kind, deleted_at)`,
      `CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('income','expense')),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_categories_kind ON categories(kind, is_active)`,
      `CREATE TABLE IF NOT EXISTS obligations (
        id TEXT PRIMARY KEY,
        party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        direction TEXT NOT NULL CHECK(direction IN ('receivable','payable')),
        reference TEXT,
        total_amount TEXT NOT NULL,
        currency TEXT NOT NULL,
        due_date TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_obligations_party_dir ON obligations(party_id, direction, status)`,
      `CREATE INDEX IF NOT EXISTS idx_obligations_due ON obligations(due_date, status)`,
      `CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        txn_date TEXT NOT NULL,
        amount TEXT NOT NULL,
        currency TEXT NOT NULL,
        exchange_rate TEXT NOT NULL DEFAULT '1',
        base_amount TEXT NOT NULL,
        rate_date TEXT NOT NULL,
        party_id TEXT REFERENCES parties(id) ON DELETE RESTRICT,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        source_account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
        destination_account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
        category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
        obligation_id TEXT REFERENCES obligations(id) ON DELETE RESTRICT,
        description TEXT,
        reference TEXT,
        reversal_of TEXT REFERENCES transactions(id) ON DELETE RESTRICT,
        idempotency_key TEXT NOT NULL UNIQUE,
        is_system INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(txn_date)`,
      `CREATE INDEX IF NOT EXISTS idx_transactions_party ON transactions(party_id, txn_date)`,
      `CREATE INDEX IF NOT EXISTS idx_transactions_project ON transactions(project_id, txn_date)`,
      `CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type, txn_date)`,
      `CREATE INDEX IF NOT EXISTS idx_transactions_obligation ON transactions(obligation_id)`,
      `CREATE TABLE IF NOT EXISTS journal_entries (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
        account_code TEXT NOT NULL,
        party_id TEXT REFERENCES parties(id) ON DELETE RESTRICT,
        direction TEXT NOT NULL CHECK(direction IN ('debit','credit')),
        amount TEXT NOT NULL,
        currency TEXT NOT NULL,
        base_amount TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_journal_txn ON journal_entries(transaction_id)`,
      `CREATE INDEX IF NOT EXISTS idx_journal_account ON journal_entries(account_code)`,
      `CREATE INDEX IF NOT EXISTS idx_journal_party ON journal_entries(party_id)`,
      `CREATE TABLE IF NOT EXISTS settlements (
        id TEXT PRIMARY KEY,
        obligation_id TEXT NOT NULL REFERENCES obligations(id) ON DELETE RESTRICT,
        transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
        amount TEXT NOT NULL,
        currency TEXT NOT NULL,
        allow_excess INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_settlements_obligation ON settlements(obligation_id)`,
      `CREATE TABLE IF NOT EXISTS settlement_allocations (
        id TEXT PRIMARY KEY,
        settlement_id TEXT NOT NULL REFERENCES settlements(id) ON DELETE RESTRICT,
        obligation_id TEXT NOT NULL REFERENCES obligations(id) ON DELETE RESTRICT,
        amount TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        data BLOB NOT NULL,
        size INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        payload TEXT,
        device_id TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id, created_at)`,
      `CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        paired_at TEXT,
        public_key TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_queue_entity ON sync_queue(entity_type, entity_id, operation)`,
      `INSERT OR IGNORE INTO currencies(code, name, symbol, minor_units, is_base) VALUES
        ('PKR','Pakistani Rupee','₨',2,1),
        ('USD','US Dollar','$',2,0),
        ('EUR','Euro','€',2,0),
        ('GBP','British Pound','£',2,0),
        ('AED','UAE Dirham','د.إ',2,0),
        ('SAR','Saudi Riyal','﷼',2,0)`,
      `INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES
        ('base_currency','PKR', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ('schema_version','1', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    ],
  },
];
