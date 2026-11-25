import type { DbRow, SqlParam, SqlStatement } from '../db/adapter';

export interface ElectronDatabaseApi {
  all(sql: string, params?: SqlParam[]): Promise<DbRow[]>;
  get(sql: string, params?: SqlParam[]): Promise<DbRow | undefined>;
  batch(statements: SqlStatement[]): Promise<void>;
  exportBytes(): Promise<Uint8Array>;
  replaceBytes(data: Uint8Array): Promise<void>;
}

export interface ElectronAuthStatus {
  platform: 'electron';
  supported: true;
  configured: boolean;
  unlocked: boolean;
  biometricsAvailable: false;
  biometricsEnabled: false;
}

export interface ElectronAuthApi {
  status(): Promise<ElectronAuthStatus>;
  setup(pin: string): Promise<void>;
  unlock(pin: string): Promise<boolean>;
  lock(): Promise<void>;
  changePin(currentPin: string, newPin: string): Promise<void>;
  disable(pin: string): Promise<void>;
  setBiometric(enabled: boolean, pin: string): Promise<void>;
}

declare global {
  interface Window {
    electronAPI?: {
      platform: 'electron';
      isOnline: () => Promise<boolean>;
      db: ElectronDatabaseApi;
      auth: ElectronAuthApi;
      openExternal: (url: string) => Promise<void>;
    };
  }
}

export {};
