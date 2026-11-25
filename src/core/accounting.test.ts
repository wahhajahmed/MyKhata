import { describe, expect, it } from 'vitest';
import { createTestDb } from '../test/helpers';
import {
  createObligation, createTransaction, getJournal, listSettlements, listTransactions,
  reverseTransaction, saveAccount, saveParty, settleObligation,
} from './services';
import { accountBalance, accountCode, obligationOutstanding, partyBalances, totalForType, verifyJournal, expenseCode, incomeCode } from './ledger';
import { Money } from './money';
import type { ObligationRow } from './types';
import { partyStatement } from './reports';

const party = (name: string) => ({ name, type: 'individual' as const, currency: 'PKR', openingBalance: '0', openingBalanceDirection: 'none' as const });
const account = (name: string, kind: 'bank' | 'cash' | 'wallet' = 'bank') => ({
  name, kind, currency: 'PKR', openingBalance: '0', bankName: '', nickname: '', notes: '',
});

async function seedPartyAndAccount() {
  const db = await createTestDb();
  const partyId = await saveParty(db, party('Hamza'));
  const accountId = await saveAccount(db, account('HBL'));
  return { db, partyId, accountId };
}

describe('Digital khata — receivables and payables', () => {
  it('Scenario A: 50,000 receivable with 20,000 received leaves 30,000', async () => {
    const { db, partyId, accountId } = await seedPartyAndAccount();
    const obligationId = await createObligation(db, {
      partyId, accountId, direction: 'receivable', totalAmount: '50000', currency: 'PKR', reference: 'Advance', notes: '',
      projectId: '', dueDate: '2026-12-31',
    });
    await settleObligation(db, { obligationId, amount: '20000', accountId, date: '2026-01-10', description: 'Partial payment', allowExcess: false });

    const obligation = (await db.get<{ id: string; total_amount: string }>('SELECT * FROM obligations WHERE id=?', [obligationId]))!;
    const settlements = await listSettlements(db, obligationId);
    expect(obligationOutstanding(obligation as ObligationRow, settlements).toString()).toBe('30000');
    expect(partyBalances(await getJournal(db), partyId).receivable.toString()).toBe('30000');

    const statement = await partyStatement(db, partyId);
    expect(statement.closing.toString()).toBe('30000');
    expect(statement.totalReceived.toString()).toBe('20000');
    expect(verifyJournal(await getJournal(db))).toBe(true);
  });

  it('Scenario B: 30,000 payable with 10,000 paid leaves 20,000, independently of receivables', async () => {
    const { db, partyId, accountId } = await seedPartyAndAccount();
    const obligationId = await createObligation(db, {
      partyId, accountId, direction: 'payable', totalAmount: '30000', currency: 'PKR', reference: 'Loan', notes: '', projectId: '', dueDate: '',
    });
    await settleObligation(db, { obligationId, amount: '10000', accountId, date: '2026-01-11', description: 'Installment 1', allowExcess: false });

    const obligation = (await db.get<{ id: string; total_amount: string }>('SELECT * FROM obligations WHERE id=?', [obligationId]))!;
    expect(obligationOutstanding(obligation as ObligationRow, await listSettlements(db, obligationId)).toString()).toBe('20000');
    const balances = partyBalances(await getJournal(db), partyId);
    expect(balances.payable.toString()).toBe('20000');
    expect(balances.receivable.toString()).toBe('0');
  });

  it('supports three installments and rejects overpayment unless explicitly allowed', async () => {
    const { db, partyId, accountId } = await seedPartyAndAccount();
    const obligationId = await createObligation(db, {
      partyId, accountId, direction: 'receivable', totalAmount: '100000', currency: 'PKR', reference: 'Project', notes: '', projectId: '', dueDate: '',
    });
    for (const [amount, date] of [['20000', '2026-02-01'], ['30000', '2026-02-02'], ['50000', '2026-02-03']] as const) {
      await settleObligation(db, { obligationId, amount, accountId, date, description: 'Installment', allowExcess: false });
    }
    const obligation = (await db.get<{ id: string; total_amount: string; status: string }>('SELECT * FROM obligations WHERE id=?', [obligationId]))!;
    expect(obligation.status).toBe('settled');
    expect(obligationOutstanding(obligation as ObligationRow, await listSettlements(db, obligationId)).isZero()).toBe(true);

    await expect(settleObligation(db, {
      obligationId, amount: '1000', accountId, date: '2026-02-04', description: 'Extra', allowExcess: false,
    })).rejects.toThrow(/exceeds outstanding/);
    await expect(settleObligation(db, {
      obligationId, amount: '1000', accountId, date: '2026-02-05', description: 'Advance', allowExcess: true,
    })).resolves.toHaveProperty('duplicate', false);
  });
});

describe('Transactions and the balanced ledger', () => {
  it('records income and expense with balanced journal entries', async () => {
    const { db, accountId } = await seedPartyAndAccount();
    const expenses = await db.get<{ id: string }>("SELECT id FROM categories WHERE kind='expense' LIMIT 1");
    const incomes = await db.get<{ id: string }>("SELECT id FROM categories WHERE kind='income' LIMIT 1");
    await createTransaction(db, {
      type: 'income', date: '2026-03-01', amount: '15000', currency: 'PKR', exchangeRate: '1',
      sourceAccountId: accountId, categoryId: incomes!.id, description: 'Freelance', allowExcess: false,
    });
    await createTransaction(db, {
      type: 'expense', date: '2026-03-02', amount: '2500', currency: 'PKR', exchangeRate: '1',
      sourceAccountId: accountId, categoryId: expenses!.id, description: 'Transport', allowExcess: false,
    });
    const journal = await getJournal(db);
    expect(verifyJournal(journal)).toBe(true);
    expect(totalForType(journal, incomeCode('')).abs().toString()).toBe('15000');
    expect(totalForType(journal, expenseCode('')).abs().toString()).toBe('2500');
    expect(accountBalance(journal, accountCode(accountId)).toString()).toBe('12500');
  });

  it('treats account transfers as movement, not income or expense', async () => {
    const db = await createTestDb();
    const from = await saveAccount(db, account('HBL'));
    const to = await saveAccount(db, account('Cash', 'cash'));
    await createTransaction(db, {
      type: 'transfer', date: '2026-04-01', amount: '10000', currency: 'PKR', exchangeRate: '1',
      sourceAccountId: from, destinationAccountId: to, description: 'Withdrawal', allowExcess: false,
    });
    const journal = await getJournal(db);
    expect(verifyJournal(journal)).toBe(true);
    expect(totalForType(journal, incomeCode('')).isZero()).toBe(true);
    expect(totalForType(journal, expenseCode('')).isZero()).toBe(true);
    expect(accountBalance(journal, accountCode(from)).toString()).toBe('-10000');
    expect(accountBalance(journal, accountCode(to)).toString()).toBe('10000');
  });

  it('reverses a posted transaction with a balanced reversing entry', async () => {
    const { db, accountId } = await seedPartyAndAccount();
    const incomes = await db.get<{ id: string }>("SELECT id FROM categories WHERE kind='income' LIMIT 1");
    const first = await createTransaction(db, {
      type: 'income', date: '2026-05-01', amount: '5000', currency: 'PKR', exchangeRate: '1',
      sourceAccountId: accountId, categoryId: incomes!.id, description: 'Original', allowExcess: false,
    });
    const reversed = await reverseTransaction(db, first.id, 'Customer refund');
    expect(reversed.duplicate).toBe(false);
    expect(verifyJournal(await getJournal(db))).toBe(true);
    expect(totalForType(await getJournal(db), incomeCode('')).isZero()).toBe(true);
    const original = (await db.get<{ id: string }>('SELECT id FROM transactions WHERE id=?', [first.id]))!;
    expect(original.id).toBe(first.id);
  });

  it('preserves accounting history when refunding partially', async () => {
    const { db, accountId } = await seedPartyAndAccount();
    const expenses = await db.get<{ id: string }>("SELECT id FROM categories WHERE kind='expense' LIMIT 1");
    const original = await createTransaction(db, {
      type: 'expense', date: '2026-06-01', amount: '1000', currency: 'PKR', exchangeRate: '1',
      sourceAccountId: accountId, categoryId: expenses!.id, description: 'Purchase', allowExcess: false,
    });
    await createTransaction(db, {
      type: 'refund', date: '2026-06-05', amount: '400', currency: 'PKR', exchangeRate: '1',
      sourceAccountId: accountId, categoryId: expenses!.id, reversalOf: original.id, description: 'Partial refund', allowExcess: false,
    });
    expect(totalForType(await getJournal(db), expenseCode('')).abs().toString()).toBe('600');
    expect(verifyJournal(await getJournal(db))).toBe(true);
    expect((await listTransactions(db)).length).toBe(2);
  });

  it('prevents duplicate creation for the same idempotency key', async () => {
    const { db, accountId } = await seedPartyAndAccount();
    const incomes = await db.get<{ id: string }>("SELECT id FROM categories WHERE kind='income' LIMIT 1");
    const input = {
      type: 'income' as const, date: '2026-07-01', amount: '7000', currency: 'PKR', exchangeRate: '1',
      sourceAccountId: accountId, categoryId: incomes!.id, description: 'Salary', allowExcess: false,
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    };
    const first = await createTransaction(db, input);
    const second = await createTransaction(db, input);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);
    expect((await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM transactions'))?.count).toBe(0 + 1);
  });

  it('keeps every journal entry balanced with opening balances included', async () => {
    const db = await createTestDb();
    await saveAccount(db, { ...account('Opening Bank'), openingBalance: '50000' });
    await saveParty(db, { ...party('Opening Party'), openingBalance: '12000', openingBalanceDirection: 'receivable' });
    const journal = await getJournal(db);
    expect(verifyJournal(journal)).toBe(true);
    expect(accountBalance(journal, 'EQUITY:OPENING').toString()).toBe('-62000');
    expect(Money.of(accountBalance(journal, 'EQUITY:OPENING').toString()).isNegative()).toBe(true);
  });
});
