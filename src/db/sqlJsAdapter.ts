import initSqlJs, { type Database, type SqlJsConfig } from 'sql.js';
import type { DbAdapter, DbRow, SqlParam, SqlStatement } from './adapter';

/** SQLite adapter for browser development, tests, and Capacitor web fallback. */
export class SqlJsAdapter implements DbAdapter {
  private db: Database;
  private readonly persist?: (bytes: Uint8Array) => void;
  private readonly databaseClass: new (data?: Uint8Array) => Database;

  constructor(db: Database, persist?: (bytes: Uint8Array) => void, databaseClass?: new (data?: Uint8Array) => Database) {
    this.db = db;
    this.persist = persist;
    this.databaseClass = databaseClass ?? (db.constructor as new (data?: Uint8Array) => Database);
  }

  async all<T = DbRow>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    const results = this.db.exec(sql, params as never[]);
    if (results.length === 0) return [];
    const { columns, values } = results[results.length - 1]!;
    return values.map((row) => {
      const obj: DbRow = {};
      columns.forEach((column, index) => { obj[column] = row[index] ?? null; });
      return obj as unknown as T;
    });
  }

  async get<T = DbRow>(sql: string, params: SqlParam[] = []): Promise<T | undefined> {
    const rows = await this.all<T>(sql, params);
    return rows[0];
  }

  async batch(statements: SqlStatement[]): Promise<void> {
    this.db.run('BEGIN');
    try {
      for (const statement of statements) this.db.run(statement.sql, (statement.params ?? []) as never[]);
      this.db.run('COMMIT');
      this.persist?.(this.db.export());
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  }

  async exportBytes(): Promise<Uint8Array> {
    return this.db.export();
  }

  async replaceBytes(data: Uint8Array): Promise<void> {
    this.db.close();
    this.db = new this.databaseClass(data);
    this.persist?.(this.db.export());
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

export async function createSqlJsAdapter(options: {
  wasmBinary?: Uint8Array;
  locateFile?: (file: string) => string;
  data?: Uint8Array;
  persist?: (bytes: Uint8Array) => void;
} = {}): Promise<SqlJsAdapter> {
  const config: SqlJsConfig = {};
  if (options.wasmBinary) config.wasmBinary = options.wasmBinary;
  if (options.locateFile) config.locateFile = options.locateFile;
  const SQL = await initSqlJs(config);
  return new SqlJsAdapter(new SQL.Database(options.data), options.persist, SQL.Database);
}
