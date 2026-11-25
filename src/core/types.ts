import type { Money } from './money';

export interface PartyRow {
  id: string;
  name: string;
  type: 'individual' | 'company';
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  opening_balance: string;
  opening_balance_direction: 'none' | 'receivable' | 'payable';
  currency: string;
  is_active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AccountRow {
  id: string;
  name: string;
  bank_name: string | null;
  nickname: string | null;
  kind: 'bank' | 'cash' | 'wallet';
  currency: string;
  opening_balance: string;
  notes: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ProjectRow {
  id: string;
  party_id: string;
  name: string;
  agreed_amount: string;
  currency: string;
  start_date: string;
  expected_completion: string | null;
  due_date: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CategoryRow {
  id: string;
  name: string;
  kind: 'income' | 'expense';
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface ObligationRow {
  id: string;
  party_id: string;
  project_id: string | null;
  /** Optional v2 column; older databases do not have it. */
  account_id?: string | null;
  direction: 'receivable' | 'payable';
  reference: string | null;
  total_amount: string;
  currency: string;
  due_date: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface TransactionRow {
  id: string;
  type: string;
  txn_date: string;
  amount: string;
  currency: string;
  exchange_rate: string;
  base_amount: string;
  rate_date: string;
  party_id: string | null;
  project_id: string | null;
  source_account_id: string | null;
  destination_account_id: string | null;
  category_id: string | null;
  obligation_id: string | null;
  description: string | null;
  reference: string | null;
  reversal_of: string | null;
  idempotency_key: string;
  is_system: number;
  created_at: string;
  updated_at: string;
}

export interface JournalRow {
  id: string;
  transaction_id: string;
  account_code: string;
  party_id: string | null;
  direction: 'debit' | 'credit';
  amount: string;
  currency: string;
  base_amount: string;
  created_at: string;
  /** Optional v2 columns; when absent, `amount`/`currency` carry the original values. */
  original_amount?: string | null;
  original_currency?: string | null;
}

export interface SettlementRow {
  id: string;
  obligation_id: string;
  transaction_id: string;
  amount: string;
  currency: string;
  allow_excess: number;
  created_at: string;
  /** Optional v2 reversal markers; compensating rows are stored with a negative amount. */
  reversed_at?: string | null;
  reversal_transaction_id?: string | null;
}

export interface Balances {
  receivable: Money;
  payable: Money;
}
