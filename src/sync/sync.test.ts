import { describe, expect, it } from 'vitest';
import { canApplyFinancialChange, detectConflict, isDuplicateChange, mergeSyncState, type VersionedRecord } from './conflict';

const record = (revision: number, payload: string, updatedAt = '2026-01-01T00:00:00Z'): VersionedRecord => ({
  id: 'txn-1', revision, payload, updatedAt,
});

describe('Optional sync engine', () => {
  it('detects concurrent edits from a common base', () => {
    const base = record(1, '{"amount":"100"}');
    expect(detectConflict(base, record(2, '{"amount":"100"}'), record(1, '{"amount":"100"}'))).toBe(false);
    expect(detectConflict(base, record(2, '{"amount":"100"}'), record(2, '{"amount":"150"}'))).toBe(true);
    expect(detectConflict(undefined, record(1, 'a'), record(1, 'a'))).toBe(true);
  });

  it('treats replayed operations as idempotent', () => {
    const applied = new Set(['party-1']);
    expect(isDuplicateChange(applied, 'party-1')).toBe(true);
    expect(isDuplicateChange(applied, 'party-2')).toBe(false);
    expect(mergeSyncState(['a', 'b', 'c'], ['a'], ['c'])).toEqual(['b']);
  });

  it('never silently overwrites a posted financial entry', () => {
    const local = record(1, '{"type":"income","amount":"500"}');
    const conflicting = record(2, '{"type":"income","amount":"900"}');
    expect(canApplyFinancialChange(local, conflicting)).toBe(false);
    expect(canApplyFinancialChange(local, record(2, '{"type":"income","amount":"500"}'))).toBe(true);
    expect(canApplyFinancialChange(undefined, conflicting)).toBe(true);
  });
});
