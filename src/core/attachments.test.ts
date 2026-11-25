import { describe, expect, it } from 'vitest';
import { createTestDb } from '../test/helpers';
import type { SqlJsAdapter } from '../db/sqlJsAdapter';
import {
  MAX_ATTACHMENT_BYTES, deleteAttachment, getAttachment, listAttachments, saveAttachment,
} from './attachments';

async function seedTransaction(db: SqlJsAdapter, id: string): Promise<string> {
  const now = new Date().toISOString();
  await db.batch([{
    sql: `INSERT INTO transactions(id,type,txn_date,amount,currency,base_amount,rate_date,idempotency_key,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
    params: [id, 'expense', '2026-01-01', '100', 'PKR', '100', '2026-01-01', `attachment-test-${id}`, now, now],
  }]);
  return id;
}

function file(name = 'receipt.pdf', mimeType = 'application/pdf', data = new TextEncoder().encode('%PDF-1.4 receipt')) {
  return { name, mimeType, data };
}

describe('Offline attachments', () => {
  it('saves, lists, reads and deletes attachments inside the database', async () => {
    const db = await createTestDb();
    const txnA = await seedTransaction(db, 'txn-a');
    const txnB = await seedTransaction(db, 'txn-b');
    const bytesA = new TextEncoder().encode('%PDF-1.4 invoice A');
    const bytesB = new TextEncoder().encode('fake png bytes');

    const idA = await saveAttachment(db, txnA, file('invoice.pdf', 'application/pdf', bytesA));
    const idB = await saveAttachment(db, txnA, file('photo.png', 'image/png', bytesB));
    await saveAttachment(db, txnB, file('other.pdf'));

    expect(idA).toBeTruthy();
    expect(idB).not.toBe(idA);

    const forA = await listAttachments(db, txnA);
    expect(forA).toHaveLength(2);
    expect(forA.map((a) => a.fileName).sort()).toEqual(['invoice.pdf', 'photo.png']);
    expect(forA.every((a) => a.transactionId === txnA)).toBe(true);
    expect(forA.every((a) => !('data' in a))).toBe(true);
    expect(forA.find((a) => a.id === idA)).toMatchObject({ fileName: 'invoice.pdf', mimeType: 'application/pdf', size: bytesA.length });

    expect(await listAttachments(db)).toHaveLength(3);
    expect(await listAttachments(db, txnB)).toHaveLength(1);

    const found = await getAttachment(db, idA);
    expect(found?.meta).toEqual(forA.find((a) => a.id === idA));
    expect(Array.from(found!.data)).toEqual(Array.from(bytesA));
    expect(await getAttachment(db, 'missing-id')).toBeUndefined();

    await deleteAttachment(db, idA);
    expect(await getAttachment(db, idA)).toBeUndefined();
    expect((await listAttachments(db, txnA)).map((a) => a.id)).toEqual([idB]);
  });

  it('stores only the basename of a local path', async () => {
    const db = await createTestDb();
    const txn = await seedTransaction(db, 'txn-path');
    const id = await saveAttachment(db, txn, file('C:\\receipts\\subdir\\invoice.pdf'));
    expect((await getAttachment(db, id))?.meta.fileName).toBe('invoice.pdf');

    const unixId = await saveAttachment(db, txn, file('../../etc/receipt.webp', 'image/webp'));
    expect((await getAttachment(db, unixId))?.meta.fileName).toBe('receipt.webp');
  });

  it('rejects empty files and files over 10 MiB', async () => {
    const db = await createTestDb();
    const txn = await seedTransaction(db, 'txn-size');
    await expect(saveAttachment(db, txn, file('empty.pdf', 'application/pdf', new Uint8Array())))
      .rejects.toThrow(/empty/i);
    await expect(saveAttachment(db, txn, file('huge.pdf', 'application/pdf', new Uint8Array(MAX_ATTACHMENT_BYTES + 1))))
      .rejects.toThrow(/10 MiB/i);
    expect(await listAttachments(db, txn)).toHaveLength(0);
  });

  it('rejects unsupported MIME types, unsafe octet-stream extensions and bad filenames', async () => {
    const db = await createTestDb();
    const txn = await seedTransaction(db, 'txn-validation');
    const bytes = new TextEncoder().encode('data');

    await expect(saveAttachment(db, txn, file('scan.pdf', 'image/gif', bytes))).rejects.toThrow(/unsupported attachment type/i);
    await expect(saveAttachment(db, txn, file('virus.exe', 'application/octet-stream', bytes))).rejects.toThrow(/unsupported attachment/i);
    await expect(saveAttachment(db, txn, file('payload.exe', 'application/pdf', bytes))).rejects.toThrow(/extension/i);
    await expect(saveAttachment(db, txn, file('..', 'application/pdf', bytes))).rejects.toThrow(/file name/i);
    await expect(saveAttachment(db, txn, file('a'.repeat(201) + '.pdf', 'application/pdf', bytes))).rejects.toThrow(/at most 200/i);
    expect(await listAttachments(db, txn)).toHaveLength(0);
  });

  it('accepts octet-stream only with a safe extension', async () => {
    const db = await createTestDb();
    const txn = await seedTransaction(db, 'txn-octet');
    const id = await saveAttachment(db, txn, file('scan.pdf', 'application/octet-stream; charset=binary'));
    expect((await getAttachment(db, id))?.meta.mimeType).toBe('application/octet-stream');
  });

  it('requires an existing transaction and enforces the attachment foreign key', async () => {
    const db = await createTestDb();
    await expect(saveAttachment(db, 'missing-txn', file())).rejects.toThrow(/Transaction not found/i);

    // Turn SQLite FK checks on for this connection; the schema declares
    // attachments.transaction_id REFERENCES transactions(id) ON DELETE RESTRICT.
    await db.all('PRAGMA foreign_keys = ON');
    await expect(db.batch([{
      sql: `INSERT INTO attachments(id,transaction_id,file_name,mime_type,data,size,created_at)
            VALUES (?,?,?,?,?,?,?)`,
      params: ['raw-id', 'missing-txn', 'a.pdf', 'application/pdf', new Uint8Array([1]), 1, new Date().toISOString()],
    }])).rejects.toThrow(/foreign key/i);
    expect(await listAttachments(db)).toHaveLength(0);
  });
});
