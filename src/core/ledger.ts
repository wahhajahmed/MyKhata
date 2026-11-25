import { Money, sumMoney } from './money';
import type { JournalRow, ObligationRow, SettlementRow, TransactionRow } from './types';

export interface Posting {
  accountCode: string;
  partyId: string | null;
  direction: 'debit' | 'credit';
  amount: Money;
}

export const accountCode = (accountId: string): string => `ASSET:ACCOUNT:${accountId}`;
export const receivableCode = (partyId: string): string => `ASSET:RECEIVABLE:${partyId}`;
export const payableCode = (partyId: string): string => `LIABILITY:PAYABLE:${partyId}`;
export const incomeCode = (categoryId: string): string => `INCOME:${categoryId}`;
export const expenseCode = (categoryId: string): string => `EXPENSE:${categoryId}`;

function pair(debit: Posting, credit: Posting): Posting[] {
  return [debit, credit];
}

export function assertBalanced(postings: Posting[]): void {
  const debits = sumMoney(postings.filter((p) => p.direction === 'debit').map((p) => p.amount));
  const credits = sumMoney(postings.filter((p) => p.direction === 'credit').map((p) => p.amount));
  if (!debits.equals(credits)) {
    throw new Error(`Unbalanced journal entry: debits ${debits.toString()} != credits ${credits.toString()}`);
  }
}

export interface PostingContext {
  original?: TransactionRow;
  originalPostings?: JournalRow[];
}

/**
 * Builds a balanced double-entry posting set for every supported transaction type.
 * Amounts are converted to the base reporting currency before posting.
 */
export function buildPostings(
  input: {
    type: TransactionRow['type'];
    amount: string;
    exchangeRate: string;
    partyId?: string;
    sourceAccountId?: string;
    destinationAccountId?: string;
    categoryId?: string;
  },
  context: PostingContext = {},
): Posting[] {
  const base = Money.of(input.amount).mul(input.exchangeRate).round(2);
  const party = input.partyId ?? null;
  const source = input.sourceAccountId ?? null;
  const destination = input.destinationAccountId ?? null;
  const category = input.categoryId ?? null;

  const make = (code: string, direction: 'debit' | 'credit', owner: string | null = null): Posting => ({
    accountCode: code,
    partyId: owner,
    direction,
    amount: base,
  });

  let postings: Posting[];
  switch (input.type) {
    case 'income':
      postings = pair(make(accountCode(source!), 'debit'), make(incomeCode(category!), 'credit'));
      break;
    case 'expense':
      postings = pair(make(expenseCode(category!), 'debit'), make(accountCode(source!), 'credit'));
      break;
    case 'receivable_creation':
      postings = pair(make(receivableCode(party!), 'debit', party), make(accountCode(source!), 'credit'));
      break;
    case 'receivable_settlement':
      postings = pair(make(accountCode(destination!), 'debit'), make(receivableCode(party!), 'credit', party));
      break;
    case 'payable_creation':
      postings = pair(make(accountCode(destination!), 'debit'), make(payableCode(party!), 'credit', party));
      break;
    case 'payable_settlement':
      postings = pair(make(payableCode(party!), 'debit', party), make(accountCode(source!), 'credit'));
      break;
    case 'transfer':
      postings = pair(make(accountCode(destination!), 'debit'), make(accountCode(source!), 'credit'));
      break;
    case 'adjustment':
      postings = pair(make(accountCode(source!), 'debit'), make(accountCode(destination!), 'credit'));
      break;
    case 'refund':
    case 'reversal': {
      if (!context.original || !context.originalPostings?.length) {
        throw new Error('Original transaction is required for refunds and reversals');
      }
      postings = context.originalPostings.map((entry) => ({
        accountCode: entry.account_code,
        partyId: entry.party_id,
        direction: entry.direction === 'debit' ? 'credit' : 'debit',
        amount: Money.of(input.amount).mul(input.exchangeRate).round(2),
      } as Posting));
      break;
    }
    default:
      throw new Error(`Unsupported transaction type: ${String(input.type)}`);
  }
  assertBalanced(postings);
  return postings;
}

export function accountBalance(entries: JournalRow[], code: string): Money {
  return entries
    .filter((entry) => entry.account_code === code)
    .reduce((acc, entry) => (
      entry.direction === 'debit' ? acc.add(entry.base_amount) : acc.sub(entry.base_amount)
    ), Money.zero());
}

export function partyBalances(entries: JournalRow[], partyId: string): { receivable: Money; payable: Money } {
  const receivable = entries
    .filter((e) => e.party_id === partyId && e.account_code === receivableCode(partyId))
    .reduce((acc, e) => (e.direction === 'debit' ? acc.add(e.base_amount) : acc.sub(e.base_amount)), Money.zero());
  const payable = entries
    .filter((e) => e.party_id === partyId && e.account_code === payableCode(partyId))
    .reduce((acc, e) => (e.direction === 'credit' ? acc.add(e.base_amount) : acc.sub(e.base_amount)), Money.zero());
  return { receivable, payable };
}

export function obligationOutstanding(obligation: ObligationRow, settlements: SettlementRow[]): Money {
  const paid = settlements
    .filter((s) => s.obligation_id === obligation.id)
    .reduce((acc, s) => acc.add(s.amount), Money.zero());
  return Money.of(obligation.total_amount).sub(paid);
}

export function totalForType(entries: JournalRow[], prefix: string): Money {
  return entries
    .filter((e) => e.account_code.startsWith(prefix))
    .reduce((acc, e) => (e.direction === 'debit' ? acc.add(e.base_amount) : acc.sub(e.base_amount)), Money.zero());
}

export function cashFlow(entries: JournalRow[]): Money {
  return entries
    .filter((e) => e.account_code.startsWith('ASSET:ACCOUNT:'))
    .reduce((acc, e) => (e.direction === 'debit' ? acc.add(e.base_amount) : acc.sub(e.base_amount)), Money.zero());
}

export function verifyJournal(entries: JournalRow[]): boolean {
  const byTransaction = new Map<string, JournalRow[]>();
  for (const entry of entries) {
    const list = byTransaction.get(entry.transaction_id) ?? [];
    list.push(entry);
    byTransaction.set(entry.transaction_id, list);
  }
  for (const list of byTransaction.values()) {
    const debits = list.filter((e) => e.direction === 'debit').reduce((a, e) => a.add(e.base_amount), Money.zero());
    const credits = list.filter((e) => e.direction === 'credit').reduce((a, e) => a.add(e.base_amount), Money.zero());
    if (!debits.equals(credits)) return false;
  }
  return true;
}

export function isOverdue(obligation: ObligationRow, today: string): boolean {
  return Boolean(obligation.due_date && obligation.due_date < today && obligation.status === 'open');
}

export function isReversal(transaction: Pick<TransactionRow, 'type' | 'reversal_of'>): boolean {
  return transaction.type === 'reversal' || Boolean(transaction.reversal_of);
}
