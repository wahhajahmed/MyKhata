import { app, BrowserWindow, dialog, ipcMain, net, shell } from 'electron';
import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

interface SqlStatementMessage {
  sql: string;
  params?: Array<string | number | null | Uint8Array>;
}

let database: Database.Database | null = null;
let mainWindow: BrowserWindow | null = null;

function databasePath(): string {
  const directory = app.getPath('userData');
  mkdirSync(directory, { recursive: true });
  return join(directory, 'mykhata.sqlite');
}

function openDatabase(): Database.Database {
  if (database?.open) return database;
  const db = new Database(databasePath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  database = db;
  return db;
}

function asParams(params: SqlStatementMessage['params']): unknown[] {
  return (params ?? []).map((value) => (value instanceof Uint8Array ? Buffer.from(value) : value));
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
      sandbox: false,
      spellcheck: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL ?? process.env.MYKHATA_DEV_URL;
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(resolve(__dirname, '..', 'dist', 'index.html'));

  mainWindow.on('closed', () => { mainWindow = null; });
}

function registerIpc(): void {
  ipcMain.handle('db:all', (_event, sql: string, params?: SqlStatementMessage['params']) => {
    return openDatabase().prepare(sql).all(...asParams(params));
  });

  ipcMain.handle('db:get', (_event, sql: string, params?: SqlStatementMessage['params']) => {
    return openDatabase().prepare(sql).get(...asParams(params)) ?? null;
  });

  ipcMain.handle('db:batch', (_event, statements: SqlStatementMessage[]) => {
    const db = openDatabase();
    const transaction = db.transaction((items: SqlStatementMessage[]) => {
      for (const item of items) db.prepare(item.sql).run(...asParams(item.params));
    });
    transaction(statements);
  });

  ipcMain.handle('db:exportBytes', () => {
    if (database?.open) database.pragma('wal_checkpoint(TRUNCATE)');
    return new Uint8Array(readFileSync(databasePath()));
  });

  ipcMain.handle('db:replaceBytes', async (_event, data: Uint8Array) => {
    const path = databasePath();
    if (database?.open) database.close();
    database = null;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(data));
    openDatabase();
  });

  ipcMain.handle('app:isOnline', () => net.isOnline());

  ipcMain.handle('dialog:savePath', async (_event, defaultName: string) => {
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save MyKhata backup',
      defaultPath: defaultName,
      filters: [{ name: 'MyKhata backup', extensions: ['mykhata', 'json'] }],
    });
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle('dialog:openPath', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open MyKhata backup',
      properties: ['openFile'],
      filters: [{ name: 'MyKhata backup', extensions: ['mykhata', 'json'] }],
    });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('fs:writeFile', async (_event, path: string, data: Uint8Array) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(data));
  });

  ipcMain.handle('fs:readFile', async (_event, path: string) => new Uint8Array(readFileSync(path)));

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (!/^https:\/\//.test(url)) throw new Error('Only HTTPS links are allowed');
    await shell.openExternal(url);
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
    registerIpc();
    openDatabase();
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
    if (database?.open) database.close();
    database = null;
  });
}
