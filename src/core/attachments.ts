import type { DbAdapter } from '../db/adapter';
import { nowIso, uuid } from './ids';

/** Attachments live in the SQLite `attachments` table — never on a remote service.
 * They are therefore part of encrypted backups and encrypted at rest when DB
 * encryption is enabled. */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_FILENAME_LENGTH = 200;

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
const SAFE_EXTENSIONS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp']);
const OCTET_STREAM = 'application/octet-stream';

export interface AttachmentMeta {
  id: string;
  transactionId: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface AttachmentFile {
  name: string;
  mimeType: string;
  data: Uint8Array;
}

export interface Attachment {
  meta: AttachmentMeta;
  data: Uint8Array;
}

interface AttachmentRow {
  id: string;
  transaction_id: string;
  file_name: string;
  mime_type: string;
  size: number;
  created_at: string;
}

function normalizeFileName(name: string): string {
  const base = name.trim().split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, '').trim() ?? '';
  if (!base || base === '.' || base === '..') throw new Error('Invalid attachment file name');
  if (base.length > MAX_ATTACHMENT_FILENAME_LENGTH) {
    throw new Error(`Attachment file name must be at most ${MAX_ATTACHMENT_FILENAME_LENGTH} characters`);
  }
  const dot = base.lastIndexOf('.');
  const extension = dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
  if (extension && !SAFE_EXTENSIONS.has(extension)) throw new Error('Unsupported attachment file extension');
  return base;
}

function normalizeMimeType(mimeType: string, fileName: string): string {
  const normalized = mimeType.trim().toLowerCase().split(';')[0]?.trim() ?? '';
  if (ALLOWED_MIME_TYPES.has(normalized)) return normalized;
  if (normalized === OCTET_STREAM) {
    const dot = fileName.lastIndexOf('.');
    const extension = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
    if (!SAFE_EXTENSIONS.has(extension)) throw new Error('Unsupported attachment file type');
    return normalized;
  }
  throw new Error('Unsupported attachment type. Only PDF, PNG, JPEG and WebP files are allowed.');
}

function toMeta(row: AttachmentRow): AttachmentMeta {
  return {
    id: String(row.id),
    transactionId: String(row.transaction_id),
    fileName: String(row.file_name),
    mimeType: String(row.mime_type),
    size: Number(row.size),
    createdAt: String(row.created_at),
  };
}

/** Stores a local receipt/invoice inside the database. Returns the new attachment id. */
export async function saveAttachment(adapter: DbAdapter, transactionId: string, file: AttachmentFile): Promise<string> {
  const fileName = normalizeFileName(file.name);
  const mimeType = normalizeMimeType(file.mimeType, fileName);
  const data = new Uint8Array(file.data);
  if (data.length === 0) throw new Error('Attachment is empty');
  if (data.length > MAX_ATTACHMENT_BYTES) throw new Error('Attachment exceeds the 10 MiB limit');

  // The database FK is the final guard; check explicitly so the error is clear
  // on adapters/platforms where SQLite foreign keys are disabled.
  const transaction = await adapter.get<{ id: string }>('SELECT id FROM transactions WHERE id = ?', [transactionId]);
  if (!transaction) throw new Error('Transaction not found');

  const id = uuid();
  await adapter.batch([{
    sql: `INSERT INTO attachments(id, transaction_id, file_name, mime_type, data, size, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    params: [id, transactionId, fileName, mimeType, data, data.length, nowIso()],
  }]);
  return id;
}

/** Metadata only — the BLOB is deliberately not selected. */
export async function listAttachments(adapter: DbAdapter, transactionId?: string): Promise<AttachmentMeta[]> {
  const columns = 'id, transaction_id, file_name, mime_type, size, created_at';
  const rows = transactionId
    ? await adapter.all<AttachmentRow>(`SELECT ${columns} FROM attachments WHERE transaction_id = ? ORDER BY created_at, id`, [transactionId])
    : await adapter.all<AttachmentRow>(`SELECT ${columns} FROM attachments ORDER BY created_at, id`);
  return rows.map(toMeta);
}

export async function getAttachment(adapter: DbAdapter, id: string): Promise<Attachment | undefined> {
  const row = await adapter.get<AttachmentRow & { data: Uint8Array }>(
    'SELECT id, transaction_id, file_name, mime_type, data, size, created_at FROM attachments WHERE id = ?', [id],
  );
  if (!row) return undefined;
  const data = row.data instanceof Uint8Array ? new Uint8Array(row.data) : new Uint8Array(row.data as unknown as ArrayBuffer);
  return { meta: toMeta(row), data };
}

export async function deleteAttachment(adapter: DbAdapter, id: string): Promise<void> {
  await adapter.batch([{ sql: 'DELETE FROM attachments WHERE id = ?', params: [id] }]);
}
