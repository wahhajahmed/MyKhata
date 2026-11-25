import { describe, expect, it } from 'vitest';
import { createTestDb } from '../test/helpers';
import { dumpDatabase, restoreDump, validateDump, type DatabaseDump, type DbRow } from './adapter';
import type { SqlJsAdapter } from './sqlJsAdapter';

const NOW = '2026-01-01T00:00:00Z';

async function seedRelatedRows(db: SqlJsAdapter): Promise<void> {
  await db.batch([
    {
      sql: `INSERT INTO parties(id,name,type,currency,opening_balance,opening_balance_direction,created_at,updated_at)
            VALUES ('party-1','Restore Party','individual','PKR','0','none',?,?)`,
      params: [NOW, NOW],
    },
    {
      sql: `INSERT INTO transactions(id,type,txn_date,amount,currency,base_amount,rate_date,party_id,
            idempotency_key,created_at,updated_at)
            VALUES ('txn-1','expense','2026-01-01','100','PKR','100','2026-01-01','party-1','restore-txn',?,?)`,
      params: [NOW, NOW],
    },
    {
      sql: `INSERT INTO journal_entries(id,transaction_id,account_code,party_id,direction,amount,currency,base_amount,created_at)
            VALUES ('journal-1','txn-1','CASH:1','party-1','credit','100','PKR','100',?)`,
      params: [NOW],
    },
    {
      sql: `INSERT INTO attachments(id,transaction_id,file_name,mime_type,data,size,created_at)
            VALUES ('attachment-1','txn-1','receipt.pdf','application/pdf',?,?,?)`,
      params: [new TextEncoder().encode('%PDF receipt'), 12, NOW],
    },
  ]);
}

function clone(dump: DatabaseDump): DatabaseDump {
  return JSON.parse(JSON.stringify(dump)) as DatabaseDump;
}

describe('restoreDump', () => {
  it('deletes children before parents and inserts parents before children with foreign keys on', async () => {
    const db = await createTestDb();
    await db.all('PRAGMA foreign_keys = ON');
    await seedRelatedRows(db);
    const dump = await dumpDatabase(db);
    expect(() => validateDump(dump)).not.toThrow();

    await restoreDump(db, dump);

    expect((await db.all('SELECT * FROM parties')).map((row) => row.name)).toEqual(['Restore Party']);
    expect((await db.all('SELECT id FROM transactions')).map((row) => row.id)).toEqual(['txn-1']);
    expect((await db.all('SELECT id FROM journal_entries')).map((row) => row.id)).toEqual(['journal-1']);
    expect((await db.all('SELECT id FROM attachments')).map((row) => row.id)).toEqual(['attachment-1']);
    const attachment = await db.get<{ data: Uint8Array }>('SELECT data FROM attachments WHERE id=?', ['attachment-1']);
    expect(Array.from(attachment?.data ?? [])).toEqual(Array.from(new TextEncoder().encode('%PDF receipt')));
    const fk = await db.all<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(fk[0]?.foreign_keys).toBe(1);
  });

  it('rejects missing tables, unknown columns, duplicate keys and unsupported versions before writing', async () => {
    const db = await createTestDb();
    await seedRelatedRows(db);
    const good = await dumpDatabase(db);

    const missing = clone(good);
    delete (missing.tables as Record<string, DbRow[]>).parties;
    await expect(restoreDump(db, missing)).rejects.toThrow(/missing table "parties"/i);

    const unknownColumn = clone(good);
    const partyRow = unknownColumn.tables.parties?.[0];
    if (!partyRow) throw new Error('Expected a party row in the dump');
    (partyRow as DbRow)['injected" column'] = 'bad';
    await expect(restoreDump(db, unknownColumn)).rejects.toThrow(/Unknown column/);

    const duplicateKey = clone(good);
    const parties = duplicateKey.tables.parties ?? [];
    parties.push({ ...parties[0]! });
    duplicateKey.tables.parties = parties;
    await expect(restoreDump(db, duplicateKey)).rejects.toThrow(/Duplicate primary key/);

    const unsupported = clone(good);
    unsupported.version = 99;
    await expect(restoreDump(db, unsupported)).rejects.toThrow(/Unsupported backup format version/);

    // A rejected dump never reaches the delete phase.
    expect((await db.all('SELECT * FROM parties')).map((row) => row.name)).toEqual(['Restore Party']);
  });
});
