import { formatMoney, Money } from '../core/money';
import type { ObligationRow, TransactionRow } from '../core/types';
import { obligationOutstanding } from '../core/ledger';
import type { SettlementRow } from '../core/types';

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function fmt(amount: string | Money, currency = 'PKR', withCode = true): string {
  return formatMoney(amount, currency, withCode);
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function dateLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value.length > 10 ? value : `${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

export function downloadBlob(data: Blob | Uint8Array, fileName: string, type = 'application/octet-stream'): void {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function outstanding(obligation: ObligationRow, settlements: SettlementRow[]): Money {
  return obligationOutstanding(obligation, settlements);
}

export function transactionLabel(txn: TransactionRow): string {
  return txn.description || txn.reference || txn.type.replace(/_/g, ' ');
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Something went wrong. Please try again.';
}

export function uniqueIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
