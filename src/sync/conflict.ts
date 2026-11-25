export interface VersionedRecord {
  id: string;
  updatedAt: string;
  revision: number;
  payload?: string;
}

export type ConflictResolution = 'use_local' | 'use_remote' | 'manual';

/** Three-way conflict detection using a common base revision. */
export function detectConflict(base: VersionedRecord | undefined, local: VersionedRecord, remote: VersionedRecord): boolean {
  if (!base) return true;
  const localChanged = local.revision !== base.revision || local.updatedAt !== base.updatedAt;
  const remoteChanged = !base || remote.revision !== base.revision || remote.updatedAt !== base.updatedAt;
  return localChanged && remoteChanged && (local.revision !== remote.revision || local.payload !== remote.payload);
}

/** Sync operations are idempotent when keyed by the stable UUID of the entity. */
export function isDuplicateChange(appliedIds: Set<string>, changeId: string): boolean {
  return appliedIds.has(changeId);
}

export function canApplyFinancialChange(local: VersionedRecord | undefined, remote: VersionedRecord): boolean {
  // Posted transactions are immutable: a remote correction must arrive as a new reversal entry.
  if (local && local.payload && remote.payload && local.payload !== remote.payload) return false;
  return true;
}

export function mergeSyncState(pending: string[], inFlight: string[], applied: string[]): string[] {
  const done = new Set([...inFlight, ...applied]);
  return pending.filter((id) => !done.has(id));
}
