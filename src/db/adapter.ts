import { nowIso } from '../core/ids';
import { MIGRATIONS } from './migrations';

export type SqlParam = string | number | null | Uint8Array;
export type DbRow = Record<string, unknown>;

export interface SqlStatement {
  sql: string;
  params?: SqlParam[];
}

/** Platform-neutral database port. Every write goes through atomic batches. */
export interface DbAdapter {
  all<T = DbRow>(sql: string, params?: SqlParam[]): Promise<T[]>;
  get<T = DbRow>(sql: string, params?: SqlParam[]): Promise<T | undefined>;
  /** All statements are applied in one SQLite transaction, or none are. */
  batch(statements: SqlStatement[]): Promise<void>;
  /** Raw database bytes, used for verification and platform-native backups. */
  exportBytes(): Promise<Uint8Array>;
  replaceBytes(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface DatabaseDump {
  format: 'mykhata-sqlite-dump';
  version: number;
  exportedAt: string;
  tables: Record<string, DbRow[]>;
}

/** Parent-to-child order. Deletes use the reverse; inserts use this order. */
export const TABLES = [
  'schema_migrations',
  'settings',
  'currencies',
  'exchange_rates',
  'parties',
  'projects',
  'accounts',
  'categories',
  'obligations',
  'transactions',
  'journal_entries',
  'settlements',
  'settlement_allocations',
  'attachments',
  'audit_logs',
  'devices',
  'sync_queue',
] as const;

/** Fixed allowlist: a dump may never introduce columns the schema does not know. */
export const TABLE_COLUMNS: Record<string, readonly string[]> = {
  schema_migrations: ['version', 'name', 'applied_at'],
  settings: ['key', 'value', 'updated_at'],
  currencies: ['code', 'name', 'symbol', 'minor_units', 'is_base'],
  exchange_rates: ['id', 'from_code', 'to_code', 'rate', 'rate_date', 'source', 'created_at'],
  parties: ['id', 'name', 'type', 'phone', 'email', 'address', 'notes', 'opening_balance', 'opening_balance_direction', 'currency', 'is_active', 'created_at', 'updated_at', 'deleted_at'],
  projects: ['id', 'party_id', 'name', 'agreed_amount', 'currency', 'start_date', 'expected_completion', 'due_date', 'status', 'notes', 'created_at', 'updated_at', 'deleted_at'],
  accounts: ['id', 'name', 'bank_name', 'nickname', 'kind', 'currency', 'opening_balance', 'notes', 'is_active', 'created_at', 'updated_at', 'deleted_at'],
  categories: ['id', 'name', 'kind', 'is_active', 'created_at', 'updated_at'],
  obligations: ['id', 'party_id', 'project_id', 'direction', 'reference', 'total_amount', 'currency', 'due_date', 'notes', 'status', 'created_at', 'updated_at', 'account_id'],
  transactions: ['id', 'type', 'txn_date', 'amount', 'currency', 'exchange_rate', 'base_amount', 'rate_date', 'party_id', 'project_id', 'source_account_id', 'destination_account_id', 'category_id', 'obligation_id', 'description', 'reference', 'reversal_of', 'idempotency_key', 'is_system', 'created_at', 'updated_at'],
  journal_entries: ['id', 'transaction_id', 'account_code', 'party_id', 'direction', 'amount', 'currency', 'base_amount', 'created_at', 'original_amount', 'original_currency'],
  settlements: ['id', 'obligation_id', 'transaction_id', 'amount', 'currency', 'allow_excess', 'created_at', 'reversed_at', 'reversal_transaction_id'],
  settlement_allocations: ['id', 'settlement_id', 'obligation_id', 'amount', 'created_at'],
  attachments: ['id', 'transaction_id', 'file_name', 'mime_type', 'data', 'size', 'created_at'],
  audit_logs: ['id', 'entity_type', 'entity_id', 'action', 'payload', 'device_id', 'created_at'],
  devices: ['id', 'name', 'platform', 'paired_at', 'public_key', 'created_at'],
  sync_queue: ['id', 'entity_type', 'entity_id', 'operation', 'payload', 'status', 'attempts', 'last_error', 'created_at', 'updated_at'],
};

const PRIMARY_KEYS: Record<string, string> = {
  schema_migrations: 'version',
  settings: 'key',
  currencies: 'code',
};

/** The logical dump format is still v1; schema migrations are a separate version line. */
const SUPPORTED_DUMP_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Quote any identifier by doubling embedded quotes, including table/column names. */
function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function encodeBinary(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    let binary = '';
    value.forEach((b) => { binary += String.fromCharCode(b); });
    return { __binary__: btoa(binary) };
  }
  return value;
}

function decodeBinary(value: unknown): unknown {
  if (isRecord(value) && '__binary__' in value) {
    const base64 = value['__binary__'];
    if (typeof base64 !== 'string') throw new Error('Backup payload is invalid: binary value');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return value;
}

/**
 * Validate a logical dump before any SQL is generated. Rejects unsupported
 * versions, missing tables, unknown columns and duplicate primary keys.
 */
export function validateDump(dump: unknown): void {
  if (!isRecord(dump)) throw new Error('Unsupported backup format');
  if (dump.format !== 'mykhata-sqlite-dump') throw new Error('Unsupported backup format');
  if (dump.version !== SUPPORTED_DUMP_VERSION) throw new Error(`Unsupported backup format version ${String(dump.version)}`);
  if (typeof dump.exportedAt !== 'string') throw new Error('Backup payload is invalid: exportedAt');
  if (!isRecord(dump.tables)) throw new Error('Backup payload is invalid: tables');

  for (const table of TABLES) {
    if (!Object.prototype.hasOwnProperty.call(dump.tables, table) || !Array.isArray(dump.tables[table])) {
      throw new Error(`Backup is missing table "${table}"`);
    }
  }

  for (const table of TABLES) {
    const rows = dump.tables[table] as unknown[];
    const allowed = new Set(TABLE_COLUMNS[table] ?? []);
    const primaryKey = PRIMARY_KEYS[table] ?? 'id';
    const seen = new Set<string>();
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (!isRecord(row)) throw new Error(`Invalid row ${index} in table "${table}"`);
      for (const column of Object.keys(row)) {
        if (!allowed.has(column)) throw new Error(`Unknown column "${column}" in table "${table}"`);
      }
      if (!Object.prototype.hasOwnProperty.call(row, primaryKey) || row[primaryKey] === null || row[primaryKey] === undefined) {
        throw new Error(`Missing primary key "${primaryKey}" in table "${table}"`);
      }
      const key = JSON.stringify(row[primaryKey]);
      if (seen.has(key)) throw new Error(`Duplicate primary key "${primaryKey}=${String(row[primaryKey])}" in table "${table}"`);
      seen.add(key);
    }
  }
}

export async function dumpDatabase(adapter: DbAdapter): Promise<DatabaseDump> {
  const tables: Record<string, DbRow[]> = {};
  for (const table of TABLES) {
    const rows = await adapter.all(`SELECT * FROM ${quoteIdentifier(table)}`);
    tables[table] = rows.map((row) => {
      const copy: DbRow = {};
      for (const [key, value] of Object.entries(row)) copy[key] = encodeBinary(value);
      return copy;
    });
  }
  return {
    format: 'mykhata-sqlite-dump',
    version: SUPPORTED_DUMP_VERSION,
    exportedAt: nowIso(),
    tables,
  };
}

export async function restoreDump(adapter: DbAdapter, dump: DatabaseDump): Promise<void> {
  validateDump(dump);
  const statements: SqlStatement[] = [];
  // With foreign_keys=ON, every child must be gone before its parent is deleted.
  for (const table of [...TABLES].reverse()) {
    statements.push({ sql: `DELETE FROM ${quoteIdentifier(table)}` });
  }
  // Insert parents first so each foreign key resolves when the row is inserted.
  for (const table of TABLES) {
    const rows = dump.tables[table] as DbRow[];
    for (const row of rows) {
      const keys = Object.keys(row);
      const values = keys.map((key) => decodeBinary(row[key]));
      const placeholders = keys.map(() => '?').join(', ');
      statements.push({
        sql: `INSERT INTO ${quoteIdentifier(table)} (${keys.map(quoteIdentifier).join(', ')}) VALUES (${placeholders})`,
        params: values as SqlParam[],
      });
    }
  }
  await adapter.batch(statements);
}

const ADD_COLUMN = /^\s*ALTER\s+TABLE\s+("(?:[^"]|"")+"|[A-Za-z_][\w$]*)\s+ADD\s+(?:COLUMN\s+)?("(?:[^"]|"")+"|[A-Za-z_][\w$]*)\b/i;

function unquoteIdentifier(token: string): string {
  const trimmed = token.trim();
  return trimmed.startsWith('"') ? trimmed.slice(1, -1).replace(/""/g, '"') : trimmed;
}

async function columnExists(adapter: DbAdapter, table: string, column: string): Promise<boolean> {
  const rows = await adapter.all<{ name: string }>(`PRAGMA table_info(${quoteIdentifier(table)})`);
  return rows.some((row) => row.name === column);
}

/**
 * SQLite cannot express ADD COLUMN IF NOT EXISTS. Guard those statements with
 * PRAGMA table_info so a replay cannot produce "duplicate column name".
 */
async function guardedStatements(adapter: DbAdapter, statements: readonly string[]): Promise<SqlStatement[]> {
  const guarded: SqlStatement[] = [];
  for (const sql of statements) {
    const match = ADD_COLUMN.exec(sql);
    if (match) {
      const table = unquoteIdentifier(match[1] ?? '');
      const column = unquoteIdentifier(match[2] ?? '');
      if (await columnExists(adapter, table, column)) continue;
    }
    guarded.push({ sql });
  }
  return guarded;
}

function assertMigrationDefinitions(): void {
  if (MIGRATIONS.length === 0) throw new Error('No database migrations are defined');
  const seen = new Set<number>();
  MIGRATIONS.forEach((migration, index) => {
    if (!Number.isInteger(migration.version) || migration.version < 1) {
      throw new Error(`Invalid migration version ${String(migration.version)}`);
    }
    if (seen.has(migration.version)) throw new Error(`Duplicate migration version ${migration.version}`);
    if (migration.version !== index + 1) throw new Error(`Missing migration version ${index + 1}`);
    seen.add(migration.version);
  });
}

function assertAppliedVersions(versions: number[]): void {
  const seen = new Set<number>();
  for (const version of versions) {
    if (!Number.isInteger(version) || version < 1) throw new Error(`Invalid schema_migrations version ${String(version)}`);
    if (seen.has(version)) throw new Error(`Duplicate schema_migrations version ${version}`);
    seen.add(version);
  }
  const max = versions.length ? Math.max(...versions) : 0;
  for (let version = 1; version <= max; version += 1) {
    if (!seen.has(version)) throw new Error(`Missing schema_migrations version ${version}`);
  }
}

async function migrationTableExists(adapter: DbAdapter): Promise<boolean> {
  const rows = await adapter.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
  );
  return rows.length > 0;
}

export async function runMigrations(adapter: DbAdapter): Promise<void> {
  assertMigrationDefinitions();
  const hasTable = await migrationTableExists(adapter);
  const current = hasTable ? await currentSchemaVersion(adapter) : 0;
  const latest = MIGRATIONS[MIGRATIONS.length - 1]!.version;
  if (current > latest) throw new Error(`Database schema version ${current} is newer than supported version ${latest}`);

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    const statements = await guardedStatements(adapter, migration.statements);
    // The schema_migrations row and the migration DDL share one atomic batch.
    statements.push({
      sql: `INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)
            ON CONFLICT(version) DO UPDATE SET name=excluded.name, applied_at=excluded.applied_at`,
      params: [migration.version, migration.name, nowIso()],
    });
    await adapter.batch(statements);
  }
}

export async function currentSchemaVersion(adapter: DbAdapter): Promise<number> {
  if (!(await migrationTableExists(adapter))) return 0;
  const rows = await adapter.all<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version');
  const versions = rows.map((row) => Number(row.version));
  assertAppliedVersions(versions);
  return versions.length ? Math.max(...versions) : 0;
}
