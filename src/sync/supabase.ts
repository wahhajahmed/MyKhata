import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { nowIso, uuid } from '../core/ids';
import { getSetting, setSetting } from '../core/services';
import type { DbAdapter } from '../db/adapter';

export interface SyncConfig {
  url: string;
  anonKey: string;
  /** Optional override. Left unset by env config so the persisted device id is used. */
  deviceId?: string;
  table?: string;
}

export interface RemoteChange {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  payload: string;
  device_id: string;
  created_at: string;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: string[];
  skippedDuplicates: number;
  lastSync: string;
}

const DEVICE_ID_KEY = 'device_id';
const LAST_SYNC_KEY = 'last_sync_at';
const APPLIED_IDS_KEY = 'sync_applied_change_ids';
const CONFLICT_IDS_KEY = 'sync_conflict_ids';
const SYNC_STATUS_KEY = 'sync_status';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate remote rows before treating them as financial change records. */
export function isRemoteChange(value: unknown): value is RemoteChange {
  if (!isRecord(value)) return false;
  const strings = ['id', 'entity_type', 'entity_id', 'operation', 'payload', 'device_id', 'created_at'];
  if (!strings.every((key) => typeof value[key] === 'string')) return false;
  if (!value.id || !value.entity_type || !value.entity_id || !value.operation || !value.device_id) return false;
  return Number.isFinite(Date.parse(value.created_at as string));
}

async function readIds(adapter: DbAdapter, key: string): Promise<string[]> {
  const raw = await getSetting(adapter, key);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

async function writeIds(adapter: DbAdapter, key: string, ids: Iterable<string>): Promise<void> {
  await setSetting(adapter, key, JSON.stringify([...new Set(ids)]));
}

export class SupabaseSync {
  private client: SupabaseClient | null = null;

  constructor(private readonly adapter: DbAdapter, private readonly config: SyncConfig) {}

  enabled(): boolean {
    return Boolean(this.config.url && this.config.anonKey);
  }

  private getClient(): SupabaseClient {
    if (!this.enabled()) throw new Error('Cloud synchronization is not configured');
    this.client ??= createClient(this.config.url, this.config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    return this.client;
  }

  /** A stable id persisted in settings; never generate a new one per construction. */
  async deviceId(): Promise<string> {
    if (this.config.deviceId) return this.config.deviceId;
    const existing = await getSetting(this.adapter, DEVICE_ID_KEY);
    if (existing) return existing;
    const generated = uuid();
    await setSetting(this.adapter, DEVICE_ID_KEY, generated);
    return generated;
  }

  async lastSync(): Promise<string> {
    const row = await this.adapter.get<{ value: string }>('SELECT value FROM settings WHERE key=?', [LAST_SYNC_KEY]);
    return row?.value ?? 'Never';
  }

  /**
   * Pushes queued local changes and pulls remote changes since the last sync.
   * Remote records are keyed by their stable UUID, so replaying an operation is idempotent.
   * Conflicting financial edits are reported and never silently applied; the
   * watermark is not advanced past them, and applied ids are persisted so a
   * retry can skip work already completed.
   */
  async sync(applyRemote: (change: RemoteChange) => Promise<'applied' | 'duplicate' | 'conflict'>): Promise<SyncResult> {
    const client = this.getClient();
    const table = this.config.table ?? 'mykhata_changes';
    const deviceId = await this.deviceId();
    const pending = await this.adapter.all<{ id: string; entity_type: string; entity_id: string; operation: string; payload: string }>(
      "SELECT id, entity_type, entity_id, operation, payload FROM sync_queue WHERE status IN ('pending','failed') ORDER BY created_at",
    );

    let pushed = 0;
    const now = nowIso();
    for (const change of pending) {
      const row = {
        id: change.id,
        entity_type: change.entity_type,
        entity_id: change.entity_id,
        operation: change.operation,
        payload: change.payload,
        device_id: deviceId,
        created_at: now,
      };
      const { error } = await client.from(table).upsert(row, { onConflict: 'id' });
      if (error) {
        await this.adapter.batch([{
          sql: "UPDATE sync_queue SET status='failed', attempts=attempts+1, last_error=?, updated_at=? WHERE id=?",
          params: [error.message, now, change.id],
        }]);
      } else {
        await this.adapter.batch([{
          sql: "UPDATE sync_queue SET status='synced', updated_at=? WHERE id=?",
          params: [now, change.id],
        }]);
        pushed += 1;
      }
    }

    const since = await this.lastSync();
    const query = client.from(table).select('id, entity_type, entity_id, operation, payload, device_id, created_at')
      .neq('device_id', deviceId)
      .order('created_at', { ascending: true });
    const { data, error } = since === 'Never' ? await query : await query.gt('created_at', since);
    if (error) throw new Error(error.message);

    let pulled = 0;
    let skippedDuplicates = 0;
    const conflicts: string[] = [];
    const conflictIds = new Set<string>();
    const appliedIds = new Set(await readIds(this.adapter, APPLIED_IDS_KEY));
    const entityIds = new Set<string>();
    const rows: unknown[] = data ?? [];
    for (const raw of rows) {
      // Never cast an unvalidated remote row into a financial change record.
      if (!isRemoteChange(raw)) { skippedDuplicates += 1; continue; }
      const change = raw;
      if (appliedIds.has(change.id) || isDuplicateId(entityIds, change.entity_id)) {
        skippedDuplicates += 1;
        continue;
      }
      const outcome = await applyRemote(change);
      if (outcome === 'duplicate') { skippedDuplicates += 1; appliedIds.add(change.id); }
      else if (outcome === 'conflict') { conflicts.push(change.entity_id); conflictIds.add(change.id); }
      else if (outcome === 'applied') { pulled += 1; appliedIds.add(change.id); }
    }

    let lastSync = nowIso();
    if (conflicts.length === 0) {
      // No conflicts: it is safe to advance the watermark and forget retry ids.
      await setSetting(this.adapter, LAST_SYNC_KEY, lastSync);
      await writeIds(this.adapter, APPLIED_IDS_KEY, []);
      await writeIds(this.adapter, CONFLICT_IDS_KEY, []);
    } else {
      // Conflicts remain at the old watermark; this run's successful ids are
      // remembered so the retry does not re-apply them.
      lastSync = await this.lastSync();
      await writeIds(this.adapter, APPLIED_IDS_KEY, appliedIds);
      await writeIds(this.adapter, CONFLICT_IDS_KEY, conflictIds);
    }
    await setSetting(this.adapter, SYNC_STATUS_KEY, conflicts.length ? 'conflict' : 'ok');
    return { pushed, pulled, conflicts, skippedDuplicates, lastSync };
  }
}

function isDuplicateId(ids: Set<string>, id: string): boolean {
  if (ids.has(id)) return true;
  ids.add(id);
  return false;
}

export function syncConfigFromEnv(): SyncConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anonKey) return null;
  return {
    url,
    anonKey,
    table: (import.meta.env.VITE_SYNC_TABLE as string | undefined) ?? 'mykhata_changes',
  };
}
