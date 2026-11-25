import type { DbAdapter, DbRow, SqlParam, SqlStatement } from './adapter';

/** Renderer-side adapter; SQL runs in the isolated Electron main process. */
export class ElectronAdapter implements DbAdapter {
  private readonly api: NonNullable<Window['electronAPI']>['db'];

  constructor() {
    if (!window.electronAPI) throw new Error('Electron database bridge is unavailable');
    this.api = window.electronAPI.db;
  }

  all<T = DbRow>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    return this.api.all(sql, params) as Promise<T[]>;
  }

  get<T = DbRow>(sql: string, params: SqlParam[] = []): Promise<T | undefined> {
    return this.api.get(sql, params) as Promise<T | undefined>;
  }

  batch(statements: SqlStatement[]): Promise<void> {
    return this.api.batch(statements);
  }

  exportBytes(): Promise<Uint8Array> {
    return this.api.exportBytes();
  }

  replaceBytes(data: Uint8Array): Promise<void> {
    return this.api.replaceBytes(data);
  }

  async close(): Promise<void> {
    // The main process owns the connection for the lifetime of the app.
  }
}
