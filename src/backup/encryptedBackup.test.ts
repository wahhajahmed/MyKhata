import { describe, expect, it } from 'vitest';
import { createTestDb } from '../test/helpers';
import { createEncryptedBackup, encryptDump, restoreEncryptedBackup, verifyEncryptedBackup, BACKUP_ERRORS, MAX_BACKUP_BYTES, type EncryptedBackup } from './encryptedBackup';
import { dumpDatabase } from '../db/adapter';
import type { DbRow } from '../db/adapter';

const PASSPHRASE = 'strong-passphrase';
const BLOB = new TextEncoder().encode('%PDF-1.4 encrypted receipt');

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
const cloneEnvelope = (backup: EncryptedBackup): Record<string, unknown> =>
  JSON.parse(JSON.stringify(backup)) as Record<string, unknown>;

async function seedAttachment(db: Awaited<ReturnType<typeof createTestDb>>): Promise<void> {
  const now = '2026-01-01T00:00:00Z';
  await db.batch([
    {
      sql: `INSERT INTO transactions(id,type,txn_date,amount,currency,base_amount,rate_date,idempotency_key,created_at,updated_at)
            VALUES ('txn-1','expense','2026-01-01','100','PKR','100','2026-01-01','encrypted-txn',?,?)`,
      params: [now, now],
    },
    {
      sql: `INSERT INTO attachments(id,transaction_id,file_name,mime_type,data,size,created_at)
            VALUES ('attachment-1','txn-1','receipt.pdf','application/pdf',?,?,?)`,
      params: [BLOB, BLOB.length, now],
    },
  ]);
}

describe('Encrypted backup verification', () => {
  it('round-trips an attachment BLOB and validates the decrypted dump', async () => {
    const db = await createTestDb();
    await seedAttachment(db);
    const backup = await createEncryptedBackup(db, PASSPHRASE);
    const bytes = encode(backup);

    const verified = await verifyEncryptedBackup(bytes, PASSPHRASE);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      const attachments = verified.dump.tables.attachments ?? [];
      expect(attachments[0]?.['data']).toMatchObject({ __binary__: expect.any(String) });
    }

    await db.batch([
      { sql: 'DELETE FROM attachments' },
      { sql: 'DELETE FROM transactions' },
    ]);
    expect((await db.all('SELECT * FROM attachments')).length).toBe(0);

    await restoreEncryptedBackup(db, bytes, PASSPHRASE);
    const restored = await db.get<{ data: Uint8Array }>('SELECT data FROM attachments WHERE id=?', ['attachment-1']);
    expect(Array.from(restored?.data ?? [])).toEqual(Array.from(BLOB));
  });

  it('reports a wrong passphrase distinctly from ciphertext damage', async () => {
    const db = await createTestDb();
    const backup = await createEncryptedBackup(db, PASSPHRASE);

    const wrongPassphrase = await verifyEncryptedBackup(encode(backup), 'wrong-passphrase');
    expect(wrongPassphrase).toMatchObject({ ok: false, reason: BACKUP_ERRORS.incorrectPassphrase });

    const corrupted = cloneEnvelope(backup);
    const bytes = Buffer.from(backup.ciphertext, 'base64');
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    corrupted.ciphertext = bytes.toString('base64');
    expect(await verifyEncryptedBackup(encode(corrupted), PASSPHRASE))
      .toMatchObject({ ok: false, reason: BACKUP_ERRORS.corruptData });

    const truncated = cloneEnvelope(backup);
    truncated.ciphertext = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]).toString('base64');
    expect(await verifyEncryptedBackup(encode(truncated), PASSPHRASE))
      .toMatchObject({ ok: false, reason: BACKUP_ERRORS.corruptData });
  });

  it('detects a tampered header and an unsupported version', async () => {
    const db = await createTestDb();
    const backup = await createEncryptedBackup(db, PASSPHRASE);

    const tampered = cloneEnvelope(backup);
    tampered.createdAt = new Date(Date.parse(backup.createdAt) + 60_000).toISOString();
    expect(await verifyEncryptedBackup(encode(tampered), PASSPHRASE))
      .toMatchObject({ ok: false, reason: BACKUP_ERRORS.corruptHeader });

    const future = cloneEnvelope(backup);
    future.version = 2;
    expect(await verifyEncryptedBackup(encode(future), PASSPHRASE))
      .toMatchObject({ ok: false, reason: BACKUP_ERRORS.unsupportedVersion });
  });

  it('rejects a decrypted dump that is missing a required table', async () => {
    const db = await createTestDb();
    const dump = await dumpDatabase(db);
    const broken = JSON.parse(JSON.stringify(dump)) as typeof dump;
    delete (broken.tables as Record<string, DbRow[]>).parties;
    const backup = await encryptDump(broken, PASSPHRASE);

    expect(await verifyEncryptedBackup(encode(backup), PASSPHRASE))
      .toMatchObject({ ok: false, reason: BACKUP_ERRORS.invalidPayload });
    await expect(restoreEncryptedBackup(db, encode(backup), PASSPHRASE))
      .rejects.toThrow(BACKUP_ERRORS.invalidPayload);
  });

  it('caps oversized envelopes', async () => {
    expect(await verifyEncryptedBackup(new Uint8Array(MAX_BACKUP_BYTES + 1), PASSPHRASE))
      .toMatchObject({ ok: false, reason: BACKUP_ERRORS.invalidPayload });
  });
});
