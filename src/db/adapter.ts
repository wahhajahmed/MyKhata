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

const TABLES = [
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
];

function encodeBinary(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    let binary = '';
    value.forEach((b) => { binary += String.fromCharCode(b); });
    return { __binary__: btoa(binary) };
  }
  return value;
}

function decodeBinary(value: unknown): unknown {
  if (value && typeof value === 'object' && '__binary__' in (value as Record<string, unknown>)) {
    const base64 = (value as Record<string, unknown>)['__binary__'];
    const binary = atob(String(base64));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return value;
}

export async function dumpDatabase(adapter: DbAdapter): Promise<DatabaseDump> {
  const tables: Record<string, DbRow[]> = {};
  for (const table of TABLES) {
    const rows = await adapter.all(`SELECT * FROM "${table}"`);
    tables[table] = rows.map((row) => {
      const copy: DbRow = {};
      for (const [key, value] of Object.entries(row)) copy[key] = encodeBinary(value);
      return copy;
    });
  }
  return {
    format: 'mykhata-sqlite-dump',
    version: 1,
    exportedAt: nowIso(),
    tables,
  };
}

export async function restoreDump(adapter: DbAdapter, dump: DatabaseDump): Promise<void> {
  if (dump.format !== 'mykhata-sqlite-dump' || !dump.tables) throw new Error('Unsupported backup format');
  const statements: SqlStatement[] = [];
  // Delete children before parents so referential integrity holds during restore.
  for (const table of [...TABLES].reverse()) {
    statements.push({ sql: `DELETE FROM "${table}"` });
    const rows = dump.tables[table] ?? [];
    for (const row of rows) {
      const keys = Object.keys(row);
      const values = keys.map((k) => decodeBinary(row[k]));
      const placeholders = keys.map(() => '?').join(', ');
      statements.push({
        sql: `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${placeholders})`,
        params: values as SqlParam[],
      });
    }
  }
  await adapter.batch(statements);
}

export async function runMigrations(adapter: DbAdapter): Promise<void> {
  await adapter.batch(MIGRATIONS.flatMap((m) => m.statements.map((sql) => ({ sql }))));
  for (const migration of MIGRATIONS) {
    await adapter.batch([{
      sql: 'INSERT OR IGNORE INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)',
      params: [migration.version, migration.name, nowIso()],
    }]);
  }
}

export async function currentSchemaVersion(adapter: DbAdapter): Promise<number> {
  const row = await adapter.get<{ version: number }>('SELECT MAX(version) AS version FROM schema_migrations');
  return Number(row?.version ?? 0);
}
