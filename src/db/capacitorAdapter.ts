import { CapacitorSQLite, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import { isNativeUnlocked, nativeSecurity, openNativeConnection } from '../security/nativeAuth';
import type { DbAdapter, DbRow, SqlParam, SqlStatement } from './adapter';

type ColumnToken =
  | { kind: 'table'; table: string }
  | { kind: 'name'; name: string };

const PRAGMA_TABLE_INFO_COLUMNS = ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'];

interface TableRef {
  table: string;
  alias: string;
}

function parseTableRef(value: string): TableRef | null {
  const match = /^\s*(?:LEFT|RIGHT|INNER|OUTER|CROSS|FULL)?\s*(["'`[]?)([A-Za-z_]\w*)\1(?:\s+(?:AS\s+)?(["'`[]?)([A-Za-z_]\w*)\3)?/i.exec(value);
  if (!match) return null;
  const table = match[2]!;
  return { table, alias: match[4] ?? table };
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]!;
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`' || char === '[') {
      quote = char === '[' ? ']' : char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function expressionColumn(expression: string, aliases: Map<string, string>, baseTable: string): ColumnToken {
  const value = expression.trim();
  const aliasMatch = /\s+AS\s+(["'`[]?)([\w]+)\1\s*$/i.exec(value)
    ?? /\s+(["'`[]?)([\w]+)\1\s*$/i.exec(value);
  if (aliasMatch) return { kind: 'name', name: aliasMatch[2]! };
  if (value === '*') return baseTable ? { kind: 'table', table: baseTable } : { kind: 'name', name: '*' };

  const starMatch = /^(["'`[]?)([\w]+)\1\s*\.\s*\*$/.exec(value);
  if (starMatch) {
    const qualifier = starMatch[2]!;
    return { kind: 'table', table: aliases.get(qualifier.toLowerCase()) ?? qualifier };
  }

  const qualified = /(?:^|\.)(["'`[]?)([\w]+)\1\s*$/.exec(value);
  if (qualified) return { kind: 'name', name: qualified[2]! };
  if (/^[A-Za-z_]\w*\s*\(/.test(value)) return { kind: 'name', name: value.replace(/\s+/g, ' ') };
  return { kind: 'name', name: value.replace(/["'`[\]]/g, '') };
}

/**
 * Pure SQL-to-column plan. Kept separate from the connection so it can be unit tested
 * without an Android device. A 'table' token means: expand via PRAGMA table_info.
 */
export function planSelectColumns(sql: string): ColumnToken[] {
  if (/^\s*PRAGMA\s+table_info\s*\(/i.test(sql)) {
    return PRAGMA_TABLE_INFO_COLUMNS.map((name) => ({ kind: 'name', name }));
  }
  const selectMatch = /^\s*SELECT\s+([\s\S]+?)\s+FROM\b/i.exec(sql);
  if (!selectMatch) return [];

  const tail = sql.slice(selectMatch.index + selectMatch[0].length);
  const terminator = /\b(?:WHERE|ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT)\b/i.exec(tail);
  const fromClause = terminator ? tail.slice(0, terminator.index) : tail;
  const refs = fromClause.split(/\bJOIN\b/i).map((part) => parseTableRef(part));
  const baseTable = refs[0]?.table ?? '';
  const aliases = new Map<string, string>();
  for (const ref of refs) {
    if (!ref) continue;
    aliases.set(ref.alias.toLowerCase(), ref.table);
    aliases.set(ref.table.toLowerCase(), ref.table);
  }

  const selectList = selectMatch[1]!.trim().replace(/^DISTINCT\s+/i, '');
  return splitTopLevel(selectList).map((part) => expressionColumn(part, aliases, baseTable));
}

/**
 * Native Android/iOS adapter backed by the Capacitor SQLite plugin (real SQLite,
 * not a WebView shim). Reads return plain objects; column names are derived from
 * our controlled SQL, with PRAGMA expansion for star selects.
 */
export class CapacitorAdapter implements DbAdapter {
  private constructor(
    private readonly connection: SQLiteDBConnection,
    private readonly requiresUnlock = false,
  ) {}

  static async create(): Promise<CapacitorAdapter> {
    const state = await nativeSecurity.state();
    let encrypted = false;
    let mode = 'no-encryption';
    if (state.configured) {
      if (!state.unlocked) throw new Error('Unlock MyKhata before opening the database');
      const key = await nativeSecurity.databaseKey();
      if (!key) throw new Error('Database key is unavailable; unlock again');
      const check = await CapacitorSQLite.checkEncryptionSecret({ passphrase: key });
      if (!check.result) throw new Error('The stored database key does not match this database');
      encrypted = true;
      mode = 'secret';
    }
    const connection = await openNativeConnection(encrypted, mode);
    return new CapacitorAdapter(connection, state.configured);
  }

  private ensureUnlocked(): void {
    if (this.requiresUnlock && !isNativeUnlocked()) throw new Error('MyKhata is locked');
  }

  private async columns(sql: string): Promise<string[]> {
    const columns: string[] = [];
    for (const token of planSelectColumns(sql)) {
      if (token.kind === 'name') {
        columns.push(token.name);
        continue;
      }
      const info = await this.connection.query(`PRAGMA table_info("${token.table.replace(/"/g, '""')}")`);
      for (const row of info.values ?? []) {
        const name = (row as unknown[])[1];
        if (typeof name === 'string' || typeof name === 'number') columns.push(String(name));
      }
    }
    return columns;
  }

  async all<T = DbRow>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    this.ensureUnlocked();
    const columns = await this.columns(sql);
    const result = await this.connection.query(sql, params as unknown[]);
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
    this.ensureUnlocked();
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
