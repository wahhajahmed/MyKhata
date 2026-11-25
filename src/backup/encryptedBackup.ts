import { dumpDatabase, restoreDump, validateDump, type DatabaseDump } from '../db/adapter';
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
  /** Optional verification aids; absent on backups made before they were added. */
  keyCheck?: string;
  headerHash?: string;
}

export const BACKUP_ERRORS = {
  unsupportedVersion: 'Unsupported backup version',
  corruptHeader: 'Corrupt backup header',
  incorrectPassphrase: 'Incorrect backup passphrase',
  corruptData: 'Corrupt backup data',
  invalidPayload: 'Backup payload is invalid',
  ambiguous: 'Incorrect backup passphrase or damaged backup data',
} as const;

export type BackupFailureReason = (typeof BACKUP_ERRORS)[keyof typeof BACKUP_ERRORS];
export type VerifyResult = { ok: true; dump: DatabaseDump } | { ok: false; reason: BackupFailureReason };

export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;

const ITERATIONS = 310000;
const PAYLOAD_MARKER = 'mykhata-encrypted-backup-payload-v1';
const KEY_CHECK_LABEL = encoderLabel();

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ALLOWED_FIELDS = new Set([
  'format', 'version', 'algorithm', 'kdf', 'salt', 'iv', 'ciphertext', 'createdAt', 'keyCheck', 'headerHash',
]);

function encoderLabel(): Uint8Array {
  // Kept in a function so TextEncoder is initialized before the label is built.
  return new TextEncoder().encode('mykhata-key-check-v1');
}

interface ParsedBackup {
  backup: EncryptedBackup;
  header: string;
  headerBytes: Uint8Array;
  salt: Uint8Array;
  iv: Uint8Array;
  ciphertext: Uint8Array;
  keyCheck?: Uint8Array;
  headerHash?: Uint8Array;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function decodeBase64(value: unknown): Uint8Array | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false;
  return true;
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

/**
 * AES-GCM additionalData is the canonical seven-field header below. Verification
 * aids (keyCheck/headerHash) are deliberately excluded so legacy v1 envelopes
 * decrypt identically. The header hash covers these same bytes.
 */
function canonicalHeader(backup: EncryptedBackup): string {
  return JSON.stringify({
    format: backup.format,
    version: backup.version,
    algorithm: backup.algorithm,
    kdf: backup.kdf,
    salt: backup.salt,
    iv: backup.iv,
    createdAt: backup.createdAt,
  });
}

async function digest(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

async function keyCheckFor(material: Uint8Array): Promise<Uint8Array> {
  const tagged = new Uint8Array(KEY_CHECK_LABEL.length + material.length);
  tagged.set(KEY_CHECK_LABEL, 0);
  tagged.set(material, KEY_CHECK_LABEL.length);
  return (await digest(tagged)).slice(0, 16);
}

async function deriveMaterial(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    256,
  ));
}

async function importAesKey(material: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', material as BufferSource, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function parseEnvelope(bytes: Uint8Array): { ok: true; parsed: ParsedBackup } | { ok: false; reason: BackupFailureReason } {
  if (bytes.byteLength > MAX_BACKUP_BYTES) return { ok: false, reason: BACKUP_ERRORS.invalidPayload };
  let json: string;
  try { json = decoder.decode(bytes); } catch { return { ok: false, reason: BACKUP_ERRORS.corruptHeader }; }
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return { ok: false, reason: BACKUP_ERRORS.corruptHeader }; }
  if (!isRecord(parsed)) return { ok: false, reason: BACKUP_ERRORS.corruptHeader };
  if (parsed.version !== 1) return { ok: false, reason: BACKUP_ERRORS.unsupportedVersion };
  if (parsed.format !== 'mykhata-encrypted-backup'
    || parsed.algorithm !== 'AES-256-GCM'
    || parsed.kdf !== 'PBKDF2-SHA256-310000'
    || !isValidTimestamp(parsed.createdAt)) {
    return { ok: false, reason: BACKUP_ERRORS.corruptHeader };
  }
  for (const field of Object.keys(parsed)) {
    if (!ALLOWED_FIELDS.has(field)) return { ok: false, reason: BACKUP_ERRORS.corruptHeader };
  }

  const salt = decodeBase64(parsed.salt);
  const iv = decodeBase64(parsed.iv);
  if (!salt || salt.length !== 16 || !iv || iv.length !== 12) return { ok: false, reason: BACKUP_ERRORS.corruptHeader };
  const ciphertext = decodeBase64(parsed.ciphertext);
  if (!ciphertext || ciphertext.length < 16) return { ok: false, reason: BACKUP_ERRORS.corruptData };

  const backup = parsed as unknown as EncryptedBackup;
  const header = canonicalHeader(backup);
  const headerBytes = encoder.encode(header);

  let keyCheck: Uint8Array | undefined;
  if (parsed.keyCheck !== undefined) {
    const decoded = decodeBase64(parsed.keyCheck);
    if (!decoded || decoded.length !== 16) return { ok: false, reason: BACKUP_ERRORS.corruptHeader };
    keyCheck = decoded;
  }
  let headerHash: Uint8Array | undefined;
  if (parsed.headerHash !== undefined) {
    const decoded = decodeBase64(parsed.headerHash);
    if (!decoded || decoded.length !== 32) return { ok: false, reason: BACKUP_ERRORS.corruptHeader };
    headerHash = decoded;
  }

  return { ok: true, parsed: { backup, header, headerBytes, salt, iv, ciphertext, keyCheck, headerHash } };
}

/** Encrypt a logical dump. Exported so failure-mode tests can build invalid payloads. */
export async function encryptDump(dump: DatabaseDump, passphrase: string): Promise<EncryptedBackup> {
  if (!passphrase || passphrase.length < 8) throw new Error('Backup passphrase must be at least 8 characters');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await deriveMaterial(passphrase, salt);
  const key = await importAesKey(material);
  const header: EncryptedBackup = {
    format: 'mykhata-encrypted-backup',
    version: 1,
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256-310000',
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: '',
    createdAt: new Date().toISOString(),
  };
  const headerBytes = encoder.encode(canonicalHeader(header));
  const payload = JSON.stringify({ marker: PAYLOAD_MARKER, dump });
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: headerBytes as BufferSource },
    key,
    encoder.encode(payload),
  );
  return {
    ...header,
    ciphertext: toBase64(new Uint8Array(encrypted)),
    keyCheck: toBase64(await keyCheckFor(material)),
    headerHash: toBase64(await digest(headerBytes)),
  };
}

export async function createEncryptedBackup(adapter: DbAdapter, passphrase: string): Promise<EncryptedBackup> {
  return encryptDump(await dumpDatabase(adapter), passphrase);
}

export async function decodeBackup(bytes: Uint8Array): Promise<EncryptedBackup> {
  const parsed = parseEnvelope(bytes);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.parsed.backup;
}

function extractDump(plain: unknown): unknown {
  if (!isRecord(plain)) return undefined;
  // New payloads carry a marker so a decryptable-but-foreign payload is not
  // mistaken for a database dump. Pre-marker backups stored the dump directly.
  if (plain.marker === PAYLOAD_MARKER) return plain.dump;
  if (plain.format === 'mykhata-sqlite-dump') return plain;
  return undefined;
}

export async function verifyEncryptedBackup(bytes: Uint8Array, passphrase: string): Promise<VerifyResult> {
  const parsed = parseEnvelope(bytes);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const { headerBytes, salt, iv, ciphertext, keyCheck, headerHash } = parsed.parsed;

  if (headerHash && !bytesEqual(headerHash, await digest(headerBytes))) {
    return { ok: false, reason: BACKUP_ERRORS.corruptHeader };
  }

  const material = await deriveMaterial(passphrase, salt);
  const expectedKeyCheck = await keyCheckFor(material);
  const passphraseMatches = keyCheck ? bytesEqual(keyCheck, expectedKeyCheck) : undefined;
  if (passphraseMatches === false) return { ok: false, reason: BACKUP_ERRORS.incorrectPassphrase };

  const key = await importAesKey(material);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: headerBytes as BufferSource },
      key,
      ciphertext as BufferSource,
    );
  } catch {
    // With a matching keyCheck the header and passphrase are both sound, so the
    // ciphertext was modified. Without it, GCM cannot distinguish a wrong
    // passphrase from modified ciphertext; report the combined case only then.
    return { ok: false, reason: passphraseMatches ? BACKUP_ERRORS.corruptData : BACKUP_ERRORS.ambiguous };
  }

  let payload: unknown;
  try { payload = JSON.parse(decoder.decode(plain)); } catch { return { ok: false, reason: BACKUP_ERRORS.corruptData }; }
  const dump = extractDump(payload);
  if (dump === undefined) return { ok: false, reason: BACKUP_ERRORS.corruptData };
  try {
    validateDump(dump);
  } catch {
    return { ok: false, reason: BACKUP_ERRORS.invalidPayload };
  }
  return { ok: true, dump: dump as DatabaseDump };
}

export async function restoreEncryptedBackup(adapter: DbAdapter, bytes: Uint8Array, passphrase: string): Promise<void> {
  const result = await verifyEncryptedBackup(bytes, passphrase);
  if (!result.ok) throw new Error(result.reason);
  await restoreDump(adapter, result.dump);
}
