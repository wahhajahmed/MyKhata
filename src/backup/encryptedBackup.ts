import { dumpDatabase, restoreDump, type DatabaseDump } from '../db/adapter';
import type { DbAdapter } from '../db/adapter';

export interface EncryptedBackup {
  format: 'mykhata-encrypted-backup';
  version: 1;
  algorithm: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256-310000';
  salt: string;
  iv: string;
  ciphertext: string;
  createdAt: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 310000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function createEncryptedBackup(adapter: DbAdapter, passphrase: string): Promise<EncryptedBackup> {
  if (!passphrase || passphrase.length < 8) throw new Error('Backup passphrase must be at least 8 characters');
  const dump = await dumpDatabase(adapter);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, encoder.encode(JSON.stringify(dump)));
  return {
    format: 'mykhata-encrypted-backup',
    version: 1,
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256-310000',
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    createdAt: new Date().toISOString(),
  };
}

export async function decodeBackup(bytes: Uint8Array): Promise<EncryptedBackup> {
  const parsed = JSON.parse(decoder.decode(bytes)) as EncryptedBackup;
  if (parsed.format !== 'mykhata-encrypted-backup' || parsed.algorithm !== 'AES-256-GCM') {
    throw new Error('This is not a valid MyKhata encrypted backup');
  }
  return parsed;
}

export async function verifyEncryptedBackup(bytes: Uint8Array, passphrase: string): Promise<{ ok: true; dump: DatabaseDump } | { ok: false; reason: string }> {
  try {
    const backup = await decodeBackup(bytes);
    const key = await deriveKey(passphrase, fromBase64(backup.salt));
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(backup.iv) as BufferSource },
      key,
      fromBase64(backup.ciphertext) as BufferSource,
    );
    const dump = JSON.parse(decoder.decode(plain)) as DatabaseDump;
    if (dump.format !== 'mykhata-sqlite-dump' || !dump.tables) return { ok: false, reason: 'Backup payload is invalid' };
    return { ok: true, dump };
  } catch {
    return { ok: false, reason: 'Incorrect passphrase or damaged backup' };
  }
}

export async function restoreEncryptedBackup(adapter: DbAdapter, bytes: Uint8Array, passphrase: string): Promise<void> {
  const result = await verifyEncryptedBackup(bytes, passphrase);
  if (!result.ok) throw new Error(result.reason);
  await restoreDump(adapter, result.dump);
}
