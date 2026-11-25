import type { DbRow, SqlParam, SqlStatement } from '../db/adapter';

export interface ElectronDatabaseApi {
  all(sql: string, params?: SqlParam[]): Promise<DbRow[]>;
  get(sql: string, params?: SqlParam[]): Promise<DbRow | undefined>;
  batch(statements: SqlStatement[]): Promise<void>;
  exportBytes(): Promise<Uint8Array>;
  replaceBytes(data: Uint8Array): Promise<void>;
}

declare global {
  interface Window {
    electronAPI?: {
      platform: 'electron';
      isOnline: () => Promise<boolean>;
      db: ElectronDatabaseApi;
      chooseSavePath: (defaultName: string) => Promise<string | null>;
      chooseOpenPath: () => Promise<string | null>;
      writeFile: (path: string, data: Uint8Array) => Promise<void>;
      readFile: (path: string) => Promise<Uint8Array>;
      openExternal: (url: string) => Promise<void>;
    };
  }
}

export {};
