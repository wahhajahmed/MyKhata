import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSqlJsAdapter, type SqlJsAdapter } from './sqlJsAdapter';
import { MIGRATIONS } from './migrations';
import { currentSchemaVersion, runMigrations } from './adapter';
import { rateForDate } from '../core/services';

async function createRawDb(): Promise<SqlJsAdapter> {
  const wasmBinary = new Uint8Array(readFileSync(join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')));
  return createSqlJsAdapter({ wasmBinary });
}

async function applyV1Only(db: SqlJsAdapter): Promise<void> {
  const v1 = MIGRATIONS.find((migration) => migration.version === 1)!;
  await db.batch([
    ...v1.statements.map((sql) => ({ sql })),
    {
      sql: 'INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)',
      params: [1, v1.name, '2026-01-01T00:00:00Z'],
    },
  ]);
}

async function columnNames(db: SqlJsAdapter, table: string): Promise<string[]> {
  const rows = await db.all<{ name: string }>(`PRAGMA table_info("${table}")`);
  return rows.map((row) => row.name);
}

async function rateIds(db: SqlJsAdapter): Promise<string[]> {
  const rows = await db.all<{ id: string }>('SELECT id FROM exchange_rates ORDER BY rowid');
  return rows.map((row) => row.id);
}

describe('Migration version 2', () => {
  it('applies only versions after the recorded schema version, once', async () => {
    const db = await createRawDb();
    await applyV1Only(db);
    expect(await currentSchemaVersion(db)).toBe(1);

    const now = '2026-01-01T00:00:00Z';
    await db.batch([
      { sql: `INSERT INTO exchange_rates(id,from_code,to_code,rate,rate_date,source,created_at)
              VALUES ('old','PKR','USD','280','2026-01-01','manual',?)`, params: [now] },
      { sql: `INSERT INTO exchange_rates(id,from_code,to_code,rate,rate_date,source,created_at)
              VALUES ('newer','PKR','USD','281','2026-01-01','manual',?)`, params: [now] },
      { sql: `INSERT INTO exchange_rates(id,from_code,to_code,rate,rate_date,source,created_at)
              VALUES ('other-pair','PKR','EUR','450','2026-01-01','manual',?)`, params: [now] },
    ]);

    await runMigrations(db);
    expect(await currentSchemaVersion(db)).toBe(2);

    expect(await columnNames(db, 'obligations')).toContain('account_id');
    expect(await columnNames(db, 'journal_entries')).toEqual(expect.arrayContaining(['original_amount', 'original_currency']));
    expect(await columnNames(db, 'settlements')).toEqual(expect.arrayContaining(['reversed_at', 'reversal_transaction_id']));
    // Legacy duplicate rates are preserved rather than deleted; the resolver
    // chooses the newest row deterministically when dates tie.
    expect(await rateIds(db)).toEqual(['old', 'newer', 'other-pair']);

    const indexes = await db.all<{ name: string; sql: string }>(
      "SELECT name, sql FROM sqlite_master WHERE type='index' AND name='idx_exchange_rates_pair_date'",
    );
    expect(indexes).toHaveLength(1);
    expect(indexes[0]?.sql).toMatch(/CREATE INDEX/i);

    const versions = await db.all<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version');
    expect(versions.map((row) => row.version)).toEqual([1, 2]);

    await runMigrations(db);
    expect((await db.all('SELECT version FROM schema_migrations ORDER BY version')).map((row) => row.version)).toEqual([1, 2]);
    expect(await rateIds(db)).toEqual(['old', 'newer', 'other-pair']);
    expect(((await columnNames(db, 'settlements')).filter((column) => column === 'reversed_at'))).toHaveLength(1);

    await expect(db.batch([{
      sql: `INSERT INTO exchange_rates(id,from_code,to_code,rate,rate_date,source,created_at)
            VALUES ('another','PKR','USD','282','2026-01-01','manual',?)`,
      params: [now],
    }])).resolves.toBeUndefined();
    expect(await rateIds(db)).toEqual(['old', 'newer', 'other-pair', 'another']);
    expect((await rateForDate(db, 'PKR', 'USD', '2026-01-02'))?.toString()).toBe('282');
  });

  it('guards ADD COLUMN statements when a v1 database is partially upgraded', async () => {
    const db = await createRawDb();
    await applyV1Only(db);
    await db.batch([
      { sql: 'ALTER TABLE obligations ADD COLUMN account_id TEXT' },
      { sql: 'INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)', params: [2, 'partial', '2026-01-01T00:00:00Z'] },
    ]);

    // The recorded version already includes v2, so no ALTER is replayed.
    await expect(runMigrations(db)).resolves.toBeUndefined();
    expect((await columnNames(db, 'obligations')).filter((column) => column === 'account_id')).toHaveLength(1);
    expect((await db.all('SELECT version FROM schema_migrations ORDER BY version')).map((row) => row.version)).toEqual([1, 2]);
  });
});
