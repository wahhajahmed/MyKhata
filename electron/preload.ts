import { contextBridge, ipcRenderer } from 'electron';

type SqlParam = string | number | null | Uint8Array;
type DbRow = Record<string, unknown>;
interface SqlStatement { sql: string; params?: SqlParam[] }

const db = {
  all: (sql: string, params: SqlParam[] = []): Promise<DbRow[]> => ipcRenderer.invoke('db:all', sql, params),
  get: (sql: string, params: SqlParam[] = []): Promise<DbRow | undefined> => ipcRenderer.invoke('db:get', sql, params),
  batch: (statements: SqlStatement[]): Promise<void> => ipcRenderer.invoke('db:batch', statements),
  exportBytes: (): Promise<Uint8Array> => ipcRenderer.invoke('db:exportBytes'),
  replaceBytes: (data: Uint8Array): Promise<void> => ipcRenderer.invoke('db:replaceBytes', data),
};

contextBridge.exposeInMainWorld('electronAPI', {
  platform: 'electron',
  isOnline: (): Promise<boolean> => ipcRenderer.invoke('app:isOnline'),
  db,
  chooseSavePath: (defaultName: string): Promise<string | null> => ipcRenderer.invoke('dialog:savePath', defaultName),
  chooseOpenPath: (): Promise<string | null> => ipcRenderer.invoke('dialog:openPath'),
  writeFile: (path: string, data: Uint8Array): Promise<void> => ipcRenderer.invoke('fs:writeFile', path, data),
  readFile: (path: string): Promise<Uint8Array> => ipcRenderer.invoke('fs:readFile', path),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
});
