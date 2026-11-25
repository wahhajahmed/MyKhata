import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { createSqlJsAdapter } from './sqlJsAdapter';

const DB_NAME = 'mykhata-local';
const STORE = 'database';
const KEY = 'primary';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function read(): Promise<Uint8Array | undefined> {
  if (typeof indexedDB === 'undefined') return undefined;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result ? new Uint8Array(req.result as ArrayBuffer) : undefined);
    req.onerror = () => reject(req.error);
  });
}

async function write(bytes: Uint8Array): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(bytes, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Browser development adapter. Financial data is kept in IndexedDB, never localStorage. */
export async function createWebAdapter() {
  const data = await read();
  return createSqlJsAdapter({
    locateFile: () => wasmUrl,
    data,
    persist: (bytes) => { void write(bytes); },
  });
}
