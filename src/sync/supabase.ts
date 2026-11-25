import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { nowIso, uuid } from '../core/ids';
import { setSetting } from '../core/services';
import type { DbAdapter } from '../db/adapter';

export interface SyncConfig {
  url: string;
  anonKey: string;
  deviceId: string;
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

  async lastSync(): Promise<string> {
    const row = await this.adapter.get<{ value: string }>("SELECT value FROM settings WHERE key='last_sync_at'");
    return row?.value ?? 'Never';
  }

  /**
   * Pushes queued local changes and pulls remote changes since the last sync.
   * Remote records are keyed by their stable UUID, so replaying an operation is idempotent.
   * Conflicting financial edits are reported and never silently applied.
   */
  async sync(applyRemote: (change: RemoteChange) => Promise<'applied' | 'duplicate' | 'conflict'>): Promise<SyncResult> {
    const client = this.getClient();
    const table = this.config.table ?? 'mykhata_changes';
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
        device_id: this.config.deviceId,
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
      .neq('device_id', this.config.deviceId)
      .order('created_at', { ascending: true });
    const { data, error } = since === 'Never' ? await query : await query.gt('created_at', since);
    if (error) throw new Error(error.message);

    let pulled = 0;
    let skippedDuplicates = 0;
    const conflicts: string[] = [];
    const appliedIds = new Set<string>();
    for (const change of (data ?? []) as RemoteChange[]) {
      if (isDuplicateId(appliedIds, change.entity_id)) {
        skippedDuplicates += 1;
        continue;
      }
      const outcome = await applyRemote(change);
      if (outcome === 'duplicate') skippedDuplicates += 1;
      else if (outcome === 'conflict') conflicts.push(change.entity_id);
      else if (outcome === 'applied') { pulled += 1; appliedIds.add(change.entity_id); }
    }

    const completedAt = nowIso();
    await setSetting(this.adapter, 'last_sync_at', completedAt);
    await setSetting(this.adapter, 'sync_status', conflicts.length ? 'conflict' : 'ok');
    return { pushed, pulled, conflicts, skippedDuplicates, lastSync: completedAt };
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
    deviceId: uuid(),
    table: (import.meta.env.VITE_SYNC_TABLE as string | undefined) ?? 'mykhata_changes',
  };
}
