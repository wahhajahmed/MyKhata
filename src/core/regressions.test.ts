import { describe, expect, it } from 'vitest';
import { createTestDb } from '../test/helpers';
import {
  createObligation, createTransaction, getJournal, initializeDatabase, listParties, listSettlements,
  listTransactions, reverseTransaction, saveAccount, saveExchangeRate, saveParty, settleObligation,
} from './services';
import { obligationOutstanding, verifyJournal } from './ledger';
import { accountStatement, currencyReport, getDashboard, obligationsReport, partyStatement, statementBalanced } from './reports';
import { dateString, exchangeRateSchema, settlementSchema } from './schemas';
import { Money } from './money';
import type { ObligationRow, TransactionRow } from './types';
import type { SqlJsAdapter } from '../db/sqlJsAdapter';

const partyInput = (name: string, currency = 'PKR', opening = '0', direction: 'none' | 'receivable' | 'payable' = 'none') => ({
  name, type: 'individual' as const, currency, openingBalance: opening, openingBalanceDirection: direction,
});
const accountInput = (name: string, currency = 'PKR', opening = '0') => ({
  name, kind: 'bank' as const, currency, openingBalance: opening, bankName: '', nickname: '', notes: '',
});

async function seed(partyCurrency = 'PKR', accountCurrency = 'PKR'): Promise<{ db: SqlJsAdapter; partyId: string; accountId: string }> {
  const db = await createTestDb();
  const partyId = await saveParty(db, partyInput('Test Party', partyCurrency));
  const accountId = await saveAccount(db, accountInput('Test Account', accountCurrency));
  return { db, partyId, accountId };
}

async function getObligation(db: SqlJsAdapter, id: string): Promise<ObligationRow> {
  const row = await db.get<ObligationRow>('SELECT * FROM obligations WHERE id=?', [id]);
  if (!row) throw new Error('Obligation missing');
  return row;
}

function incomeCategoryId(db: SqlJsAdapter): Promise<string | undefined> {
  return db.get<{ id: string }>("SELECT id FROM categories WHERE kind='income' LIMIT 1").then((r) => r?.id);
}

describe('financial correctness regressions', () => {
  it('reversing a settlement posts a compensating settlement and reopens the obligation', async () => {
    const { db, partyId, accountId } = await seed();
    const obligationId = await createObligation(db, {
      partyId, accountId, direction: 'receivable', totalAmount: '50000', currency: 'PKR',
      reference: 'Invoice', notes: '', projectId: '', dueDate: '',
    });
    const settlement = await settleObligation(db, {
      obligationId, amount: '20000', accountId, date: '2026-01-10', description: 'Payment', allowExcess: false,
    });
    expect((await getObligation(db, obligationId)).status).toBe('open');

    const reversal = await reverseTransaction(db, settlement.id, 'Refund of payment');
    expect(reversal.duplicate).toBe(false);
    const settlements = await listSettlements(db, obligationId);
    expect(settlements).toHaveLength(2);
    expect(Money.of(settlements[1]!.amount).toString()).toBe('-20000');
    const obligation = await getObligation(db, obligationId);
    expect(obligation.status).toBe('open');
    expect(obligationOutstanding(obligation, settlements).toString()).toBe('50000');

    const journal = await getJournal(db);
    expect(verifyJournal(journal)).toBe(true);
    const statement = await partyStatement(db, partyId);
    expect(statementBalanced(statement)).toBe(true);
    expect(statement.closing.toString()).toBe('50000');
    expect(statement.lines.at(-1)?.balance.toString()).toBe('50000');
    await expect(reverseTransaction(db, settlement.id)).rejects.toThrow(/already been reversed/i);
  });

  it('rejects idempotency key reuse with a different payload and de-duplicates concurrent settlements', async () => {
    const { db, accountId } = await seed();
    const categoryId = await incomeCategoryId(db);
    const input = {
      type: 'income' as const, date: '2026-07-01', amount: '7000', currency: 'PKR', exchangeRate: '1',
      sourceAccountId: accountId, categoryId, description: 'Salary', allowExcess: false,
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    };
    const first = await createTransaction(db, input);
    const second = await createTransaction(db, input);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    await expect(createTransaction(db, { ...input, amount: '8000' })).rejects.toThrow(/conflict/i);
    await expect(createTransaction(db, { ...input, allowExcess: true })).rejects.toThrow(/conflict/i);

    const { db: db2, partyId: partyId2, accountId: accountId2 } = await seed();
    const obligationId = await createObligation(db2, {
      partyId: partyId2, accountId: accountId2, direction: 'receivable', totalAmount: '10000', currency: 'PKR',
      reference: '', notes: '', projectId: '', dueDate: '',
    });
    const payment = {
      obligationId, amount: '2500', accountId: accountId2, date: '2026-07-02', description: '', allowExcess: false,
    };
    const results = await Promise.all([settleObligation(db2, payment), settleObligation(db2, payment)]);
    expect(results.map((r) => r.duplicate).sort()).toEqual([false, true]);
    expect(await listSettlements(db2, obligationId)).toHaveLength(1);
  });

  it('sets exact overpayment statuses from the signed remaining amount', async () => {
    const { db, partyId, accountId } = await seed();
    const obligationId = await createObligation(db, {
      partyId, accountId, direction: 'receivable', totalAmount: '10000', currency: 'PKR',
      reference: '', notes: '', projectId: '', dueDate: '',
    });
    await settleObligation(db, { obligationId, amount: '10000', accountId, date: '2026-08-01', description: '', allowExcess: true });
    let obligation = await getObligation(db, obligationId);
    expect(obligationOutstanding(obligation, await listSettlements(db, obligationId)).toString()).toBe('0');
    expect(obligation.status).toBe('settled');

    await settleObligation(db, { obligationId, amount: '500', accountId, date: '2026-08-02', description: '', allowExcess: true });
    obligation = await getObligation(db, obligationId);
    expect(obligation.status).toBe('overpaid');
    expect(obligationOutstanding(obligation, await listSettlements(db, obligationId)).toString()).toBe('-500');
  });

  it('keeps receivable and payable party statements balanced with signed lines', async () => {
    const db = await createTestDb();
    const partyId = await saveParty(db, partyInput('Payable Party', 'PKR', '5000', 'payable'));
    const accountId = await saveAccount(db, accountInput('Test Account'));
    const obligationId = await createObligation(db, {
      partyId, accountId, direction: 'payable', totalAmount: '3000', currency: 'PKR',
      reference: '', notes: '', projectId: '', dueDate: '',
    });
    const payment = await settleObligation(db, {
      obligationId, amount: '1000', accountId, date: '2026-06-01', description: '', allowExcess: false,
    });
    const statement = await partyStatement(db, partyId);
    expect(statementBalanced(statement)).toBe(true);
    expect(statement.closing.toString()).toBe('7000');
    expect(statement.totalPaid.toString()).toBe('1000');

    const reversal = await reverseTransaction(db, payment.id);
    expect(reversal.duplicate).toBe(false);
    const afterReversal = await partyStatement(db, partyId);
    expect(statementBalanced(afterReversal)).toBe(true);
    expect(afterReversal.closing.toString()).toBe('8000');
  });

  it('computes accountStatement opening strictly before from and never double counts', async () => {
    const db = await createTestDb();
    const accountId = await saveAccount(db, accountInput('Test Account', 'PKR', '10000'));
    const categoryId = await incomeCategoryId(db);
    await createTransaction(db, {
      type: 'income', date: '2026-01-05', amount: '2000', currency: 'PKR', exchangeRate: '1',
      sourceAccountId: accountId, categoryId, description: '', allowExcess: false,
    });
    await createTransaction(db, {
      type: 'expense', date: '2026-01-06', amount: '500', currency: 'PKR', exchangeRate: '1',
      sourceAccountId: accountId, categoryId, description: '', allowExcess: false,
    });

    const allTime = await accountStatement(db, accountId);
    expect(allTime.opening.toString()).toBe('0');
    expect(statementBalanced(allTime)).toBe(true);
    expect(allTime.closing.toString()).toBe('11500');

    const strictlyBefore = await accountStatement(db, accountId, { from: '2026-01-06' });
    expect(strictlyBefore.opening.toString()).toBe('2000');
    expect(strictlyBefore.totalPaid.toString()).toBe('500');
    expect(strictlyBefore.closing.toString()).toBe('11500');
    expect(statementBalanced(strictlyBefore)).toBe(true);
    expect(strictlyBefore.lines.at(-1)?.balance.toString()).toBe(strictlyBefore.closing.toString());
  });

  it('aggregates the dashboard currency summary over every transaction in range', async () => {
    const { db, accountId } = await seed();
    const categoryId = await incomeCategoryId(db);
    const today = new Date().toISOString().slice(0, 10);
    for (let i = 0; i < 12; i += 1) {
      await createTransaction(db, {
        type: 'income', date: today, amount: '100', currency: 'USD', exchangeRate: '280',
        sourceAccountId: accountId, categoryId, description: '', allowExcess: false,
      });
    }
    for (let i = 0; i < 3; i += 1) {
      await createTransaction(db, {
        type: 'income', date: today, amount: '50', currency: 'PKR', exchangeRate: '1',
        sourceAccountId: accountId, categoryId, description: '', allowExcess: false,
      });
    }
    const dashboard = await getDashboard(db);
    expect(dashboard.recentTransactions).toHaveLength(8);
    expect(dashboard.currencySummary.find((c) => c.code === 'USD')?.amount.toString()).toBe('1200');
    expect(dashboard.currencySummary.find((c) => c.code === 'PKR')?.amount.toString()).toBe('150');
    expect(dashboard.currencySummary.find((c) => c.code === 'USD')?.label).toContain('not converted');
    expect(dashboard.incomeThisMonth.toString()).toBe('336150');
  });

  it('posts cross-currency obligations and settlements with original and base amounts', async () => {
    const { db, partyId, accountId } = await seed('USD', 'PKR');
    await saveExchangeRate(db, { fromCurrency: 'USD', toCurrency: 'PKR', rate: '280', rateDate: '2026-01-01', source: 'manual' });
    const obligationId = await createObligation(db, {
      partyId, accountId, direction: 'receivable', totalAmount: '100', currency: 'USD',
      reference: 'USD work', notes: '', projectId: '', dueDate: '2026-01-15',
    });
    await settleObligation(db, {
      obligationId, amount: '40', accountId, date: '2026-01-20', description: '', allowExcess: false,
    });

    const settlementTxn = (await listTransactions(db, { type: 'receivable_settlement' }))[0]!;
    expect(settlementTxn.exchange_rate).toBe('280');
    expect(settlementTxn.base_amount).toBe('11200');
    const rows = await getJournal(db);
    const settlementRows = rows.filter((r) => r.transaction_id === settlementTxn.id);
    const hasOriginalColumns = Object.prototype.hasOwnProperty.call(settlementRows[0] ?? {}, 'original_amount');
    for (const row of settlementRows) {
      expect(hasOriginalColumns ? row.original_amount : row.amount).toBe('40');
      expect(hasOriginalColumns ? row.original_currency : row.currency).toBe('USD');
      expect(row.base_amount).toBe('11200');
    }

    const report = await obligationsReport(db, 'receivable');
    expect(report.currency).toBe('MIXED');
    expect(report.baseCurrency).toBe('PKR');
    expect(report.closing.toString()).toBe('16800');
    expect((await currencyReport(db))[0]?.label).toContain('base');
  });

  it('caps refunds and reversals at the remaining original amount and uses the original date', async () => {
    const { db, accountId } = await seed();
    const categoryId = await incomeCategoryId(db);
    const original = await createTransaction(db, {
      type: 'income', date: '2026-05-01', amount: '1000', currency: 'PKR', exchangeRate: '1',
      sourceAccountId: accountId, categoryId, description: '', allowExcess: false,
    });
    await createTransaction(db, {
      type: 'refund', date: '2026-05-02', amount: '400', currency: 'PKR', exchangeRate: '1',
      sourceAccountId: accountId, categoryId, reversalOf: original.id, description: '', allowExcess: false,
      idempotencyKey: 'refund-1',
    });
    await expect(createTransaction(db, {
      type: 'refund', date: '2026-05-03', amount: '700', currency: 'PKR', exchangeRate: '1',
      sourceAccountId: accountId, categoryId, reversalOf: original.id, description: '', allowExcess: false,
      idempotencyKey: 'refund-2',
    })).rejects.toThrow(/remaining original amount/i);
    await createTransaction(db, {
      type: 'refund', date: '2026-05-04', amount: '600', currency: 'PKR', exchangeRate: '1',
      sourceAccountId: accountId, categoryId, reversalOf: original.id, description: '', allowExcess: false,
      idempotencyKey: 'refund-3',
    });
    const second = await createTransaction(db, {
      type: 'income', date: '2026-05-05', amount: '250', currency: 'PKR', exchangeRate: '1',
      sourceAccountId: accountId, categoryId, description: '', allowExcess: false,
    });
    const reversed = await reverseTransaction(db, second.id);
    expect(reversed.duplicate).toBe(false);
    const reversalTxn = await db.get<TransactionRow>('SELECT * FROM transactions WHERE id=?', [reversed.id]);
    expect(reversalTxn?.txn_date).toBe('2026-05-05');
    expect((await getJournal(db)).filter((r) => r.transaction_id === reversed.id)[0]?.created_at).toBe('2026-05-05');
    expect(verifyJournal(await getJournal(db))).toBe(true);
  });

  it('validates calendar dates, positive rates and explicit settlement currency', () => {
    expect(dateString.safeParse('2026-02-30').success).toBe(false);
    expect(dateString.safeParse('2026-02-28').success).toBe(true);
    expect(dateString.safeParse('2024-02-29').success).toBe(true);
    expect(exchangeRateSchema.safeParse({
      fromCurrency: 'USD', toCurrency: 'PKR', rate: '0', rateDate: '2026-01-01',
    }).success).toBe(false);
    expect(settlementSchema.safeParse({
      obligationId: '11111111-1111-4111-8111-111111111111', amount: '10',
      accountId: '22222222-2222-4222-8222-222222222222', date: '2026-01-01',
      currency: 'USD', exchangeRate: '280', allowExcess: false,
    }).success).toBe(true);
  });

  it('does not corrupt data when initializeDatabase is run repeatedly', async () => {
    const db = await createTestDb();
    const partyId = await saveParty(db, partyInput('Persistent Party'));
    const accountId = await saveAccount(db, accountInput('Persistent Account', 'PKR', '1000'));
    await initializeDatabase(db);
    await initializeDatabase(db);
    expect((await listParties(db)).map((p) => p.id)).toContain(partyId);
    expect((await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM accounts'))?.count).toBe(1);
    expect((await accountStatement(db, accountId)).closing.toString()).toBe('1000');
  });
});
