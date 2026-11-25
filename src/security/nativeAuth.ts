import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
import {
  createPinVerifier,
  deriveKeyMaterial,
  toBase64,
  validatePin,
  verifyPinVerifier,
  type PinVerifier,
} from './pin';
import type { SecurityController, SecurityPlatform, SecurityState } from './types';

const DB_NAME = 'mykhata';

const KEYS = {
  configured: 'mykhata.security.configured',
  verifier: 'mykhata.security.verifier',
  dbKey: 'mykhata.security.dbKey',
  biometricDbKey: 'mykhata.security.biometricDbKey',
  biometricsEnabled: 'mykhata.security.biometricsEnabled',
} as const;

/**
 * Shared JS-side connection manager. Both this controller and CapacitorAdapter must use
 * the same instance so create/close/retrieve stay in sync with the native connection map.
 */
export const sqliteConnection = new SQLiteConnection(CapacitorSQLite);

let unlocked = false;
let dbKey: string | null = null;

/** Synchronous guard used by the adapter; avoids a plugin round-trip on every query. */
export function isNativeUnlocked(): boolean {
  return unlocked && Boolean(dbKey);
}

function isSupportedPlatform(platform: string): boolean {
  return platform === 'android' || platform === 'ios';
}

function randomDbKey(): string {
  const subtle = globalThis.crypto;
  if (!subtle?.getRandomValues) throw new Error('Secure random numbers are unavailable on this device');
  return Array.from(subtle.getRandomValues(new Uint8Array(32)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function secureGet(key: string): Promise<string | null> {
  try {
    const result = await SecureStoragePlugin.get({ key });
    return result.value ?? null;
  } catch {
    return null;
  }
}

async function secureSet(key: string, value: string): Promise<void> {
  await SecureStoragePlugin.set({ key, value });
}

async function secureRemove(key: string): Promise<void> {
  try {
    await SecureStoragePlugin.remove({ key });
  } catch {
    // Removing a missing key is not an error for our recovery paths.
  }
}

async function clearAllSecurityKeys(): Promise<void> {
  for (const key of Object.values(KEYS)) await secureRemove(key);
}

function parseVerifier(raw: string | null): PinVerifier | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PinVerifier>;
    if (
      parsed.version === 1
      && parsed.iterations === 310000
      && typeof parsed.salt === 'string'
      && typeof parsed.hash === 'string'
    ) return parsed as PinVerifier;
    return null;
  } catch {
    return null;
  }
}

async function readVerifier(): Promise<PinVerifier | null> {
  return parseVerifier(await secureGet(KEYS.verifier));
}

async function readConfigured(): Promise<boolean> {
  const raw = await secureGet(KEYS.configured);
  if (!raw) return false;
  try {
    const flag = JSON.parse(raw) as { encrypted?: unknown };
    return flag.encrypted === true;
  } catch {
    return raw === 'true';
  }
}

async function readBiometricsEnabled(): Promise<boolean> {
  return (await secureGet(KEYS.biometricsEnabled)) === 'true';
}

async function biometricsAvailable(platform: string): Promise<boolean> {
  if (!isSupportedPlatform(platform)) return false;
  try {
    const result = await BiometricAuth.checkBiometry();
    return result.isAvailable === true;
  } catch {
    return false;
  }
}

async function readState(): Promise<SecurityState> {
  const platformValue = Capacitor.getPlatform();
  const platform: SecurityPlatform = isSupportedPlatform(platformValue) ? 'native' :
    platformValue === 'electron' ? 'electron' : 'web';
  return {
    platform,
    supported: isSupportedPlatform(platformValue),
    configured: await readConfigured(),
    unlocked: isNativeUnlocked(),
    biometricsAvailable: await biometricsAvailable(platformValue),
    biometricsEnabled: await readBiometricsEnabled(),
  };
}

/** Close and remove any cached connection, including one left behind by a hot reload. */
export async function closeNativeConnection(): Promise<void> {
  try {
    await sqliteConnection.closeConnection(DB_NAME, false);
  } catch {
    // No connection exists (or it was already closed).
  }
}

/**
 * Create a fresh connection in the requested mode and open it.
 * 'encryption'/'decryption' are only used by the one-time migrate/disable flows.
 */
export async function openNativeConnection(encrypted: boolean, mode: string): Promise<SQLiteDBConnection> {
  await closeNativeConnection();
  let connection: SQLiteDBConnection;
  try {
    connection = await sqliteConnection.createConnection(DB_NAME, encrypted, mode, 1, false);
  } catch (error) {
    if (!/already exists/i.test(String(error))) throw error;
    await closeNativeConnection();
    connection = await sqliteConnection.createConnection(DB_NAME, encrypted, mode, 1, false);
  }
  try {
    await connection.open();
  } catch (error) {
    await closeNativeConnection();
    throw error;
  }
  return connection;
}

function assertSupported(): void {
  if (!isSupportedPlatform(Capacitor.getPlatform())) {
    throw new Error('Database encryption is only available on Android and iOS');
  }
}

async function assertPin(pin: string): Promise<PinVerifier> {
  const verifier = await readVerifier();
  if (!verifier) throw new Error('App lock is not configured');
  if (!(await verifyPinVerifier(pin, verifier))) throw new Error('Incorrect PIN');
  return verifier;
}

async function assertKey(key: string): Promise<void> {
  const check = await CapacitorSQLite.checkEncryptionSecret({ passphrase: key });
  if (!check.result) throw new Error('The stored database encryption key is no longer valid');
}

/** Best-effort, PIN-encrypted logical dump kept before returning the DB to plaintext. */
async function writePreDisableBackup(pin: string): Promise<void> {
  const exported = await CapacitorSQLite.exportToJson({
    database: DB_NAME,
    jsonexportmode: 'full',
    encrypted: true,
  });
  if (!exported.export) return;
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const keyMaterial = await deriveKeyMaterial(pin, salt);
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    keyMaterial as BufferSource,
    'AES-GCM',
    false,
    ['encrypt'],
  );
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(JSON.stringify(exported.export)),
  );
  const record = {
    format: 'mykhata-predisable-backup',
    version: 1,
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256-310000',
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    createdAt: new Date().toISOString(),
  };
  await Filesystem.writeFile({
    path: `statements/pre-disable-${Date.now()}.bak`,
    data: JSON.stringify(record),
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    recursive: true,
  });
}

export const nativeSecurity: SecurityController = {
  state: readState,

  async setup(pin: string): Promise<void> {
    const problem = validatePin(pin);
    if (problem) throw new Error(problem);
    assertSupported();
    if (await readConfigured()) throw new Error('App lock is already configured');

    const key = randomDbKey();
    const verifier = await createPinVerifier(pin);
    let verifierStored = false;
    let secretSet = false;
    let encrypted = false;
    let configuredStored = false;

    try {
      await secureSet(KEYS.verifier, JSON.stringify(verifier));
      verifierStored = true;
      await CapacitorSQLite.setEncryptionSecret({ passphrase: key });
      secretSet = true;
      await assertKey(key);

      const connection = await openNativeConnection(true, 'encryption');
      encrypted = true;
      const encryptionCheck = await CapacitorSQLite.isDatabaseEncrypted({ database: DB_NAME });
      const probe = await connection.query('SELECT 1 AS ok');
      if (!encryptionCheck.result || (probe.values?.length ?? 0) < 1) {
        throw new Error('Database encryption could not be verified');
      }
      await closeNativeConnection();

      // Store the key for PIN unlock after a restart; biometric unlock reads it only
      // after a successful platform biometric prompt.
      await secureSet(KEYS.dbKey, key);
      await secureSet(KEYS.configured, JSON.stringify({ encrypted: true }));
      configuredStored = true;
      dbKey = key;
      unlocked = true;
    } catch (error) {
      if (configuredStored) await secureRemove(KEYS.configured);
      if (verifierStored) await secureRemove(KEYS.verifier);
      await secureRemove(KEYS.dbKey);
      await secureRemove(KEYS.biometricDbKey);
      await secureRemove(KEYS.biometricsEnabled);
      dbKey = null;
      unlocked = false;

      if (encrypted) {
        // The in-place migration may already have changed the file header. Decrypt it
        // with the same passphrase so the existing plaintext database stays usable.
        try {
          const connection = await openNativeConnection(true, 'decryption');
          await connection.query('SELECT 1 AS ok');
          const check = await CapacitorSQLite.isDatabaseEncrypted({ database: DB_NAME });
          await closeNativeConnection();
          if (!check.result) {
            await CapacitorSQLite.clearEncryptionSecret();
            await openNativeConnection(false, 'no-encryption');
          }
        } catch {
          // Keep the encrypted database and its secret so the data is not lost.
        }
      } else if (secretSet) {
        try {
          await CapacitorSQLite.clearEncryptionSecret();
          await openNativeConnection(false, 'no-encryption');
        } catch {
          // Best effort: the database was never encrypted.
        }
      } else {
        try {
          await openNativeConnection(false, 'no-encryption');
        } catch {
          // Nothing was changed.
        }
      }
      throw error;
    }
  },

  async unlock(pin: string): Promise<boolean> {
    const verifier = await readVerifier();
    if (!verifier) {
      dbKey = null;
      unlocked = false;
      return !(await readConfigured());
    }
    if (!(await verifyPinVerifier(pin, verifier))) {
      dbKey = null;
      unlocked = false;
      return false;
    }
    const key = await secureGet(KEYS.dbKey);
    if (!key) throw new Error('The database key is missing; reconfigure the app lock');
    try {
      await assertKey(key);
    } catch {
      dbKey = null;
      unlocked = false;
      return false;
    }
    dbKey = key;
    unlocked = true;
    return true;
  },

  async unlockWithBiometric(): Promise<boolean> {
    if (!(await readBiometricsEnabled())) return false;
    try {
      await BiometricAuth.authenticate({
        reason: 'Unlock MyKhata',
        allowDeviceCredential: true,
      });
    } catch {
      return false;
    }
    const key = (await secureGet(KEYS.biometricDbKey)) ?? (await secureGet(KEYS.dbKey));
    if (!key) return false;
    try {
      await assertKey(key);
    } catch {
      dbKey = null;
      unlocked = false;
      return false;
    }
    dbKey = key;
    unlocked = true;
    return true;
  },

  async lock(): Promise<void> {
    dbKey = null;
    unlocked = false;
  },

  async setBiometric(enabled: boolean, pin: string): Promise<void> {
    assertSupported();
    if (!(await readConfigured())) throw new Error('App lock is not configured');
    await assertPin(pin);

    if (!enabled) {
      await secureRemove(KEYS.biometricDbKey);
      await secureSet(KEYS.biometricsEnabled, 'false');
      return;
    }

    if (!(await biometricsAvailable(Capacitor.getPlatform()))) {
      throw new Error('Biometric authentication is not available on this device');
    }
    let key = isNativeUnlocked() ? dbKey : await secureGet(KEYS.dbKey);
    if (!key) {
      if (!(await nativeSecurity.unlock(pin))) throw new Error('Incorrect PIN');
      key = dbKey;
    }
    if (!key) throw new Error('The database key is missing; reconfigure the app lock');
    await secureSet(KEYS.biometricDbKey, key);
    await secureSet(KEYS.biometricsEnabled, 'true');
  },

  async changePin(currentPin: string, newPin: string): Promise<void> {
    const problem = validatePin(newPin);
    if (problem) throw new Error(problem);
    await assertPin(currentPin);
    // The database key is deliberately unchanged: no SQLCipher rekey is needed.
    await secureSet(KEYS.verifier, JSON.stringify(await createPinVerifier(newPin)));
  },

  async disable(pin: string): Promise<void> {
    assertSupported();
    await assertPin(pin);
    const key = dbKey ?? await secureGet(KEYS.dbKey);
    if (!key) throw new Error('The database key is missing; reconfigure the app lock');
    await assertKey(key);

    try {
      await writePreDisableBackup(pin);
    } catch {
      // A backup is best effort; decryption must not be blocked by a backup failure.
    }

    const connection = await openNativeConnection(true, 'decryption');
    const check = await CapacitorSQLite.isDatabaseEncrypted({ database: DB_NAME });
    await connection.query('SELECT 1 AS ok');
    await closeNativeConnection();
    if (check.result) throw new Error('Database decryption could not be verified');

    await CapacitorSQLite.clearEncryptionSecret();
    await clearAllSecurityKeys();
    dbKey = null;
    unlocked = false;
    await openNativeConnection(false, 'no-encryption');
  },

  async databaseKey(): Promise<string | null> {
    return isNativeUnlocked() ? dbKey : null;
  },
};
