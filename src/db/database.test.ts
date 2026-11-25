import { describe, expect, it } from 'vitest';
import { createTestDb } from '../test/helpers';
import { initializeDatabase, saveParty } from '../core/services';
import { currentSchemaVersion } from './adapter';
import { createEncryptedBackup, restoreEncryptedBackup, verifyEncryptedBackup } from '../backup/encryptedBackup';
import { dumpDatabase } from './adapter';

const TABLES = ['parties', 'projects', 'accounts', 'categories', 'obligations', 'transactions', 'journal_entries',
  'settlements', 'settlement_allocations', 'attachments', 'audit_logs', 'devices', 'sync_queue', 'exchange_rates'];

describe('Database migrations', () => {
  it('creates all normalized tables, indexes and seed currencies', async () => {
    const db = await createTestDb();
    const names = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")).map((r) => r.name);
    for (const table of TABLES) expect(names).toContain(table);
    const indexes = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index'")).map((r) => r.name);
    expect(indexes).toContain('idx_transactions_date');
    expect(indexes).toContain('idx_obligations_party_dir');
    expect(indexes).toContain('idx_exchange_rates_pair_date');
    const currencies = await db.all<{ code: string }>('SELECT code FROM currencies');
    expect(currencies.map((c) => c.code)).toContain('PKR');
    expect(await currentSchemaVersion(db)).toBe(2);
  });

  it('is safe to initialize twice', async () => {
    const db = await createTestDb();
    await expect(initializeDatabase(db)).resolves.toBeUndefined();
    expect((await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM schema_migrations'))?.count).toBe(2);
    expect(await currentSchemaVersion(db)).toBe(2);
  });

  it('enforces foreign keys and unique idempotency keys', async () => {
    const db = await createTestDb();
    await expect(db.batch([{ sql: 'INSERT INTO transactions(id,type,txn_date,amount,currency,base_amount,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', params: ['x', 'income', '2026-01-01', '1', 'PKR', '1', 'dup', 'now', 'now'] }, { sql: 'INSERT INTO transactions(id,type,txn_date,amount,currency,base_amount,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', params: ['y', 'income', '2026-01-01', '1', 'PKR', '1', 'dup', 'now', 'now'] }])).rejects.toThrow();
  });
});

describe('Encrypted backup and restore', () => {
  it('round-trips real data and rejects a wrong passphrase', async () => {
    const db = await createTestDb();
    await saveParty(db, { name: 'Backup Party', type: 'individual', currency: 'PKR', openingBalance: '0', openingBalanceDirection: 'none' });
    const backup = await createEncryptedBackup(db, 'strong-passphrase');
    const bytes = new TextEncoder().encode(JSON.stringify(backup));

    const verified = await verifyEncryptedBackup(bytes, 'strong-passphrase');
    expect(verified.ok).toBe(true);
    expect((await verifyEncryptedBackup(bytes, 'wrong-passphrase')).ok).toBe(false);

    await db.batch([{ sql: 'DELETE FROM parties' }]);
    expect((await db.all('SELECT * FROM parties')).length).toBe(0);
    await restoreEncryptedBackup(db, bytes, 'strong-passphrase');
    const parties = await db.all<{ name: string }>('SELECT * FROM parties');
    expect(parties.map((p) => p.name)).toContain('Backup Party');

    const dump = await dumpDatabase(db);
    expect(dump.format).toBe('mykhata-sqlite-dump');
    expect(dump.tables.transactions).toBeDefined();
  });
});
