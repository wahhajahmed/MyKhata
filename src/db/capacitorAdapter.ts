import { CapacitorSQLite, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import type { DbAdapter, DbRow, SqlParam, SqlStatement } from './adapter';

const DB_NAME = 'mykhata';

/**
 * Native Android adapter backed by the Capacitor SQLite plugin (real SQLite, not a WebView shim).
 * Reads return plain objects by deriving column names from our controlled SQL statements.
 */
export class CapacitorAdapter implements DbAdapter {
  private constructor(private readonly connection: SQLiteDBConnection) {}

  static async create(): Promise<CapacitorAdapter> {
    try {
      await CapacitorSQLite.createConnection({
        database: DB_NAME,
        version: 1,
        encrypted: false,
        mode: 'no-encryption',
      });
    } catch {
      // Connection already exists after a hot reload.
    }
    const connection = await (CapacitorSQLite as unknown as {
      retrieveConnection: (name: string, readOnly: boolean) => Promise<SQLiteDBConnection>;
    }).retrieveConnection(DB_NAME, false);
    await connection.open();
    return new CapacitorAdapter(connection);
  }

  private async columns(sql: string): Promise<string[]> {
    const starMatch = /^\s*SELECT\s+\*\s+FROM\s+["'`]?([a-zA-Z_][\w]*)["'`]?/i.exec(sql);
    if (starMatch) {
      const info = await this.connection.query(`PRAGMA table_info("${starMatch[1]}")`);
      return (info.values ?? []).map((row) => String((row as unknown[])[1] ?? ''));
    }
    const selectClause = /^\s*SELECT\s+([\s\S]+?)\s+FROM\s/i.exec(sql)?.[1] ?? '';
    return selectClause.split(',').map((part) => {
      const aliased = /\s+AS\s+["'`]?([\w]+)["'`]?\s*$/i.exec(part.trim());
      if (aliased) return aliased[1]!;
      const last = part.trim().split(/\s+/).at(-1) ?? '';
      return last.replace(/["'`]/g, '').split('.').at(-1) ?? last;
    });
  }

  async all<T = DbRow>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    const [columns, result] = await Promise.all([
      this.columns(sql),
      this.connection.query(sql, params as unknown[]),
    ]);
    return (result.values ?? []).map((row) => {
      const obj: DbRow = {};
      columns.forEach((column, index) => { obj[column] = (row as unknown[])[index] ?? null; });
      return obj as unknown as T;
    });
  }

  async get<T = DbRow>(sql: string, params: SqlParam[] = []): Promise<T | undefined> {
    const rows = await this.all<T>(sql, params);
    return rows[0];
  }

  async batch(statements: SqlStatement[]): Promise<void> {
    if (statements.length === 0) return;
    await this.connection.executeTransaction(
      statements.map((s) => ({ statement: s.sql, values: (s.params ?? []) as unknown[] })),
      true,
    );
  }

  async exportBytes(): Promise<Uint8Array> {
    // Native backup uses the logical dump path; raw bytes are not exposed by the plugin.
    return new Uint8Array();
  }

  async replaceBytes(): Promise<void> {
    throw new Error('Use logical restore on Android');
  }

  async close(): Promise<void> {
    await this.connection.close();
  }
}
