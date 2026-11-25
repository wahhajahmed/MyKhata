import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initializeDatabase, seedDefaultCategories } from '../core/services';
import { createSqlJsAdapter, type SqlJsAdapter } from '../db/sqlJsAdapter';

export async function createTestDb(): Promise<SqlJsAdapter> {
  const wasmBinary = new Uint8Array(readFileSync(join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')));
  const adapter = await createSqlJsAdapter({ wasmBinary });
  await initializeDatabase(adapter);
  await seedDefaultCategories(adapter);
  return adapter;
}

export function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
