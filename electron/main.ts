import { app, BrowserWindow, ipcMain, net, shell, type IpcMainInvokeEvent } from 'electron';
import Database from 'better-sqlite3-multiple-ciphers';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

interface SqlStatementMessage {
  sql: string;
  params?: Array<string | number | null | Uint8Array>;
}

interface AuthRecord {
  version: 1;
  salt: string;
  verifierHash: string;
  encrypted: true;
  createdAt: string;
}

interface AuthStatus {
  platform: 'electron';
  supported: true;
  configured: boolean;
  unlocked: boolean;
  biometricsAvailable: false;
  biometricsEnabled: false;
}

interface SchemaFingerprint {
  tables: number;
  rows: number;
  version: number;
}

const VERIFIER_SUFFIX = Buffer.from('verify', 'utf8');
const DB_KEY_BYTES = 32;

let database: Database.Database | null = null;
let mainWindow: BrowserWindow | null = null;
let allowedWebContentsId: number | null = null;
let authConfigured = false;
let authRecord: AuthRecord | null = null;
/** The only in-memory copy of the database key; held while unlocked. */
let dbKeyHex: string | null = null;

function userDataDirectory(): string {
  const directory = app.getPath('userData');
  mkdirSync(directory, { recursive: true });
  return directory;
}

function databasePath(): string {
  return join(userDataDirectory(), 'mykhata.sqlite');
}

function authPath(): string {
  return join(userDataDirectory(), 'auth.json');
}

function preEncryptionBackupPath(): string {
  return join(userDataDirectory(), 'mykhata.pre-encryption.bak');
}

function lockedError(): Error {
  const error = new Error('The application is locked');
  (error as NodeJS.ErrnoException).code = 'APP_LOCKED';
  return error;
}

function assertTrusted(event: IpcMainInvokeEvent): void {
  const expected = mainWindow?.webContents;
  if (
    !expected
    || expected.isDestroyed()
    || event.sender !== expected
    || allowedWebContentsId === null
    || event.sender.id !== allowedWebContentsId
  ) {
    throw new Error('Rejected IPC call from an untrusted sender');
  }
}

function assertPin(pin: unknown): string {
  if (typeof pin !== 'string' || pin.trim().length < 4 || pin.length > 256) {
    throw new Error('A valid PIN or password is required');
  }
  return pin;
}

/** scrypt(pin, salt, 32), returned as 64 hex chars for SQLCipher. */
function deriveDbKey(pin: string, salt: Buffer): string {
  const material = scryptSync(pin, salt, DB_KEY_BYTES);
  const hex = material.toString('hex');
  material.fill(0);
  return hex;
}

/** scrypt(pin, salt + 'verify'), stored as a non-secret PIN verifier. */
function deriveVerifierHash(pin: string, salt: Buffer): Buffer {
  return scryptSync(pin, Buffer.concat([salt, VERIFIER_SUFFIX]), DB_KEY_BYTES);
}

function readAuthRecord(): AuthRecord | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(authPath(), 'utf8'));
    if (parsed && typeof parsed === 'object') {
      const candidate = parsed as Partial<AuthRecord>;
      if (
        candidate.version === 1
        && typeof candidate.salt === 'string'
        && typeof candidate.verifierHash === 'string'
        && candidate.encrypted === true
        && typeof candidate.createdAt === 'string'
      ) {
        return candidate as AuthRecord;
      }
    }
  } catch (error) {
    console.error('MyKhata could not read the auth record', error);
  }
  return null;
}

function loadAuthState(): void {
  authConfigured = existsSync(authPath());
  authRecord = authConfigured ? readAuthRecord() : null;
  if (authConfigured && !authRecord) {
    console.error('MyKhata found an unreadable auth record; unlock is disabled until it is repaired');
  }
}

function writeAuthRecord(record: AuthRecord): void {
  const temporary = join(userDataDirectory(), `auth.json.tmp-${randomUUID()}`);
  writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 });
  renameSync(temporary, authPath());
  authRecord = record;
  authConfigured = true;
}

function removeAuthFile(): void {
  rmSync(authPath(), { force: true });
  authRecord = null;
  authConfigured = false;
}

function verifyPin(pin: string): boolean {
  if (!authRecord) return false;
  try {
    const expected = Buffer.from(authRecord.verifierHash, 'base64');
    const actual = deriveVerifierHash(pin, Buffer.from(authRecord.salt, 'base64'));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function authStatus(): AuthStatus {
  return {
    platform: 'electron',
    supported: true,
    configured: authConfigured,
    unlocked: authConfigured && dbKeyHex !== null,
    biometricsAvailable: false,
    biometricsEnabled: false,
  };
}

function configureEncryption(db: Database.Database, keyHex: string): void {
  db.pragma("cipher = 'sqlcipher'");
  db.pragma('legacy = 4');
  db.pragma(`key = '${keyHex}'`);
}

function integrityIsOk(db: Database.Database): boolean {
  return db.pragma('integrity_check', { simple: true }) === 'ok';
}

function schemaFingerprint(db: Database.Database): SchemaFingerprint {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all() as Array<{ name: string }>;
  let rows = 0;
  for (const table of tables) {
    const quoted = `"${table.name.replace(/"/g, '""')}"`;
    const count = db.prepare(`SELECT COUNT(*) AS n FROM ${quoted}`).get() as { n: number };
    rows += Number(count.n ?? 0);
  }
  let version = 0;
  if (tables.some((table) => table.name === 'schema_migrations')) {
    const result = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
    version = Number(result.v ?? 0);
  }
  return { tables: tables.length, rows, version };
}

function fingerprintsMatch(before: SchemaFingerprint, after: SchemaFingerprint): boolean {
  return before.tables === after.tables && before.rows === after.rows && before.version === after.version;
}

function openPlainDatabase(): Database.Database {
  const db = new Database(databasePath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  database = db;
  return db;
}

function openEncryptedDatabase(keyHex: string): Database.Database {
  const db = new Database(databasePath());
  configureEncryption(db, keyHex);
  if (!integrityIsOk(db)) {
    db.close();
    throw new Error('The encrypted database failed its integrity check');
  }
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  database = db;
  return db;
}

function closeDatabase(): void {
  if (database?.open) {
    try {
      database.pragma('wal_checkpoint(TRUNCATE)');
    } catch (error) {
      console.error('MyKhata could not checkpoint the database', error);
    }
    database.close();
  }
  database = null;
}

function lockDatabase(): void {
  closeDatabase();
  dbKeyHex = null;
}

function accessibleDatabase(): { db: Database.Database; keyHex: string | null } {
  if (authConfigured && dbKeyHex === null) throw lockedError();
  if (database?.open) return { db: database, keyHex: dbKeyHex };
  const db = dbKeyHex !== null ? openEncryptedDatabase(dbKeyHex) : openPlainDatabase();
  return { db, keyHex: dbKeyHex };
}

function removeDatabaseSideFiles(path = databasePath()): void {
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
}

function restoreDatabaseFile(backup: string): void {
  closeDatabase();
  removeDatabaseSideFiles();
  copyFileSync(backup, databasePath());
}

/** Rekey a database in place; WAL must be checkpointed and journal switched first. */
function rekeyDatabase(path: string, currentKeyHex: string | null, nextKeyHex: string | null): void {
  const db = new Database(path);
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.pragma('journal_mode = DELETE');
    db.pragma("cipher = 'sqlcipher'");
    db.pragma('legacy = 4');
    if (currentKeyHex) configureEncryption(db, currentKeyHex);
    const result = db.pragma(`rekey = '${nextKeyHex ?? ''}'`, { simple: true });
    if (result !== 'ok') throw new Error('SQLCipher rekey was rejected');
  } finally {
    if (db.open) db.close();
  }
}

function setupAuth(pin: string): void {
  if (authConfigured) throw new Error('App lock is already configured');

  const salt = randomBytes(16);
  const keyHex = deriveDbKey(pin, salt);
  const verifierHash = deriveVerifierHash(pin, salt).toString('base64');
  const path = databasePath();
  const backup = preEncryptionBackupPath();
  mkdirSync(dirname(path), { recursive: true });
  closeDatabase();

  if (!existsSync(path)) writeFileSync(path, Buffer.alloc(0));
  copyFileSync(path, backup);

  let before: SchemaFingerprint | null = null;
  try {
    const plaintext = new Database(path);
    try {
      plaintext.pragma('wal_checkpoint(TRUNCATE)');
      plaintext.pragma('journal_mode = DELETE');
      if (!integrityIsOk(plaintext)) throw new Error('The existing database failed its integrity check');
      before = schemaFingerprint(plaintext);
      plaintext.pragma("cipher = 'sqlcipher'");
      plaintext.pragma('legacy = 4');
      const result = plaintext.pragma(`rekey = '${keyHex}'`, { simple: true });
      if (result !== 'ok') throw new Error('SQLCipher rekey was rejected');
    } finally {
      if (plaintext.open) plaintext.close();
    }

    const encrypted = new Database(path);
    try {
      configureEncryption(encrypted, keyHex);
      if (!integrityIsOk(encrypted)) throw new Error('The rekeyed database failed its integrity check');
      if (!before || !fingerprintsMatch(before, schemaFingerprint(encrypted))) {
        throw new Error('The rekeyed database no longer matches the original schema and rows');
      }
      encrypted.pragma('journal_mode = WAL');
      encrypted.pragma('foreign_keys = ON');
      encrypted.pragma('busy_timeout = 5000');
    } catch (error) {
      if (encrypted.open) encrypted.close();
      throw error;
    }
    database = encrypted;
    dbKeyHex = keyHex;
    writeAuthRecord({
      version: 1,
      salt: salt.toString('base64'),
      verifierHash,
      encrypted: true,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    database = null;
    dbKeyHex = null;
    restoreDatabaseFile(backup);
    removeAuthFile();
    throw error;
  }
}

function unlock(pin: string): boolean {
  if (!authConfigured || !authRecord) return false;
  if (!verifyPin(pin)) return false;
  if (dbKeyHex !== null) return true;
  const keyHex = deriveDbKey(pin, Buffer.from(authRecord.salt, 'base64'));
  try {
    const db = openEncryptedDatabase(keyHex);
    if (!integrityIsOk(db)) throw new Error('The database failed its integrity check');
    dbKeyHex = keyHex;
    // The pre-encryption safety copy is only needed until one successful unlock.
    rmSync(preEncryptionBackupPath(), { force: true });
    return true;
  } catch {
    closeDatabase();
    dbKeyHex = null;
    return false;
  }
}

function changePin(currentPin: string, newPin: string): void {
  if (!authConfigured || !authRecord || dbKeyHex === null) throw lockedError();
  if (!verifyPin(currentPin)) throw new Error('The current PIN is incorrect');

  const oldKeyHex = dbKeyHex;
  const { db } = accessibleDatabase();
  const before = schemaFingerprint(db);
  const salt = randomBytes(16);
  const newKeyHex = deriveDbKey(newPin, salt);
  const verifierHash = deriveVerifierHash(newPin, salt).toString('base64');
  const backup = join(userDataDirectory(), 'mykhata.pre-pin-change.bak');
  copyFileSync(databasePath(), backup);

  try {
    rekeyDatabase(databasePath(), oldKeyHex, newKeyHex);
    database = openEncryptedDatabase(newKeyHex);
    if (!integrityIsOk(database) || !fingerprintsMatch(before, schemaFingerprint(database))) {
      throw new Error('The rekeyed database failed verification');
    }
    dbKeyHex = newKeyHex;
    writeAuthRecord({
      version: 1,
      salt: salt.toString('base64'),
      verifierHash,
      encrypted: true,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    restoreDatabaseFile(backup);
    database = openEncryptedDatabase(oldKeyHex);
    dbKeyHex = oldKeyHex;
    throw error;
  }
}

function disableAuth(pin: string): void {
  if (!authConfigured || !authRecord || dbKeyHex === null) throw lockedError();
  if (!verifyPin(pin)) throw new Error('The PIN is incorrect');

  const keyHex = dbKeyHex;
  const { db } = accessibleDatabase();
  const before = schemaFingerprint(db);
  const backup = join(userDataDirectory(), 'mykhata.pre-decryption.bak');
  copyFileSync(databasePath(), backup);

  try {
    rekeyDatabase(databasePath(), keyHex, null);
    database = openPlainDatabase();
    if (!integrityIsOk(database) || !fingerprintsMatch(before, schemaFingerprint(database))) {
      throw new Error('The decrypted database failed verification');
    }
    dbKeyHex = null;
    removeAuthFile();
  } catch (error) {
    restoreDatabaseFile(backup);
    database = openEncryptedDatabase(keyHex);
    dbKeyHex = keyHex;
    throw error;
  }
}

function validateRestoreCandidate(path: string, keyHex: string | null): void {
  const candidate = new Database(path);
  try {
    if (keyHex) configureEncryption(candidate, keyHex);
    if (!integrityIsOk(candidate)) throw new Error('Restored database failed integrity_check');
    const version = schemaFingerprint(candidate).version;
    if (!Number.isSafeInteger(version) || version <= 0) {
      throw new Error('Restored database has no supported schema version');
    }
  } finally {
    if (candidate.open) candidate.close();
  }
}

function replaceDatabaseBytes(data: Uint8Array, keyHex: string | null): void {
  const directory = userDataDirectory();
  const path = databasePath();
  const temporary = join(directory, `mykhata-restore-${randomUUID()}.sqlite`);
  const backup = join(directory, 'mykhata.pre-restore.bak');
  writeFileSync(temporary, Buffer.from(data), { flag: 'wx', mode: 0o600 });
  try {
    validateRestoreCandidate(temporary, keyHex);
    closeDatabase();
    if (existsSync(path)) copyFileSync(path, backup);
    removeDatabaseSideFiles(path);
    renameSync(temporary, path);
    try {
      if (keyHex) openEncryptedDatabase(keyHex);
      else openPlainDatabase();
    } catch (error) {
      restoreDatabaseFile(backup);
      if (keyHex) openEncryptedDatabase(keyHex);
      else openPlainDatabase();
      throw error;
    }
  } finally {
    rmSync(temporary, { force: true });
    rmSync(`${temporary}-wal`, { force: true });
    rmSync(`${temporary}-shm`, { force: true });
  }
}

function asParams(params: SqlStatementMessage['params']): unknown[] {
  return (params ?? []).map((value) => (value instanceof Uint8Array ? Buffer.from(value) : value));
}

function devServerUrl(): string | null {
  if (app.isPackaged) return null;
  const candidate = process.env.VITE_DEV_SERVER_URL ?? process.env.MYKHATA_DEV_URL;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    const port = Number(url.port);
    if (
      url.protocol === 'http:'
      && url.hostname === 'localhost'
      && url.port !== ''
      && Number.isInteger(port)
      && port > 0
      && port <= 65535
      && !url.username
      && !url.password
    ) {
      return url.toString();
    }
  } catch {
    return null;
  }
  console.error('MyKhata ignored an unsafe development server URL');
  return null;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 360,
    minHeight: 600,
    backgroundColor: '#0b1528',
    title: 'MyKhata',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  allowedWebContentsId = mainWindow.webContents.id;

  const url = devServerUrl();
  if (url) void mainWindow.loadURL(url);
  else void mainWindow.loadFile(resolve(__dirname, '..', 'dist', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
    allowedWebContentsId = null;
    lockDatabase();
  });
}

function registerIpc(): void {
  ipcMain.handle('auth:status', (event): AuthStatus => {
    assertTrusted(event);
    return authStatus();
  });

  ipcMain.handle('auth:setup', (event, pin: string): void => {
    assertTrusted(event);
    setupAuth(assertPin(pin));
  });

  ipcMain.handle('auth:unlock', (event, pin: string): boolean => {
    assertTrusted(event);
    return unlock(assertPin(pin));
  });

  ipcMain.handle('auth:lock', (event): void => {
    assertTrusted(event);
    lockDatabase();
  });

  ipcMain.handle('auth:changePin', (event, currentPin: string, newPin: string): void => {
    assertTrusted(event);
    changePin(assertPin(currentPin), assertPin(newPin));
  });

  ipcMain.handle('auth:disable', (event, pin: string): void => {
    assertTrusted(event);
    disableAuth(assertPin(pin));
  });

  ipcMain.handle('db:all', (event, sql: string, params?: SqlStatementMessage['params']) => {
    assertTrusted(event);
    return accessibleDatabase().db.prepare(sql).all(...asParams(params));
  });

  ipcMain.handle('db:get', (event, sql: string, params?: SqlStatementMessage['params']) => {
    assertTrusted(event);
    return accessibleDatabase().db.prepare(sql).get(...asParams(params)) ?? null;
  });

  ipcMain.handle('db:batch', (event, statements: SqlStatementMessage[]) => {
    assertTrusted(event);
    if (!Array.isArray(statements)) throw new Error('Invalid statement batch');
    const db = accessibleDatabase().db;
    const transaction = db.transaction((items: SqlStatementMessage[]) => {
      for (const item of items) db.prepare(item.sql).run(...asParams(item.params));
    });
    transaction(statements);
  });

  ipcMain.handle('db:exportBytes', (event) => {
    assertTrusted(event);
    const db = accessibleDatabase().db;
    if (db.open) db.pragma('wal_checkpoint(TRUNCATE)');
    return new Uint8Array(readFileSync(databasePath()));
  });

  ipcMain.handle('db:replaceBytes', (event, data: Uint8Array) => {
    assertTrusted(event);
    if (!(data instanceof Uint8Array)) throw new Error('Invalid database payload');
    const { keyHex } = accessibleDatabase();
    replaceDatabaseBytes(data, keyHex);
  });

  ipcMain.handle('app:isOnline', (event) => {
    assertTrusted(event);
    return net.isOnline();
  });

  ipcMain.handle('shell:openExternal', async (event, url: string) => {
    assertTrusted(event);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Invalid URL');
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new Error('Only HTTPS links are allowed');
    }
    await shell.openExternal(parsed.toString());
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    loadAuthState();
    registerIpc();
    // An encrypted database is never opened at startup; unlock must happen first.
    if (!authConfigured) openPlainDatabase();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch((error) => {
    console.error('MyKhata failed to start', error);
    app.quit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    lockDatabase();
  });
}
