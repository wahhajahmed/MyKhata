import { contextBridge, ipcRenderer } from 'electron';

type SqlParam = string | number | null | Uint8Array;
type DbRow = Record<string, unknown>;
interface SqlStatement { sql: string; params?: SqlParam[] }

interface AuthStatus {
  platform: 'electron';
  supported: true;
  configured: boolean;
  unlocked: boolean;
  biometricsAvailable: false;
  biometricsEnabled: false;
}

const db = {
  all: (sql: string, params: SqlParam[] = []): Promise<DbRow[]> => ipcRenderer.invoke('db:all', sql, params),
  get: (sql: string, params: SqlParam[] = []): Promise<DbRow | undefined> => ipcRenderer.invoke('db:get', sql, params),
  batch: (statements: SqlStatement[]): Promise<void> => ipcRenderer.invoke('db:batch', statements),
  exportBytes: (): Promise<Uint8Array> => ipcRenderer.invoke('db:exportBytes'),
  replaceBytes: (data: Uint8Array): Promise<void> => ipcRenderer.invoke('db:replaceBytes', data),
};

const auth = {
  status: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:status'),
  setup: (pin: string): Promise<void> => ipcRenderer.invoke('auth:setup', pin),
  unlock: (pin: string): Promise<boolean> => ipcRenderer.invoke('auth:unlock', pin),
  lock: (): Promise<void> => ipcRenderer.invoke('auth:lock'),
  changePin: (currentPin: string, newPin: string): Promise<void> => ipcRenderer.invoke('auth:changePin', currentPin, newPin),
  disable: (pin: string): Promise<void> => ipcRenderer.invoke('auth:disable', pin),
  setBiometric: async (_enabled: boolean, _pin: string): Promise<void> => {
    throw new Error('Biometric unlock is not available on desktop');
  },
};

contextBridge.exposeInMainWorld('electronAPI', {
  platform: 'electron',
  isOnline: (): Promise<boolean> => ipcRenderer.invoke('app:isOnline'),
  db,
  auth,
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
});
