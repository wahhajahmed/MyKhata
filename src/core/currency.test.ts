import { describe, expect, it } from 'vitest';
import { createTestDb } from '../test/helpers';
import { createTransaction, getJournal, listTransactions, rateForDate, saveAccount, saveExchangeRate } from './services';
import { incomeCode, totalForType } from './ledger';

describe('Multi-currency accounting', () => {
  it('uses explicit exchange-rate snapshots and never retrodates historical rates', async () => {
    const db = await createTestDb();
    await saveExchangeRate(db, { fromCurrency: 'USD', toCurrency: 'PKR', rate: '280', rateDate: '2026-01-01', source: 'manual' });
    await saveExchangeRate(db, { fromCurrency: 'USD', toCurrency: 'PKR', rate: '285', rateDate: '2026-06-01', source: 'manual' });

    expect((await rateForDate(db, 'USD', 'PKR', '2025-12-31'))).toBeUndefined();
    expect((await rateForDate(db, 'USD', 'PKR', '2026-02-01'))?.toString()).toBe('280');
    expect((await rateForDate(db, 'USD', 'PKR', '2026-07-01'))?.toString()).toBe('285');
  });

  it('Scenario D: never sums PKR and USD without conversion', async () => {
    const db = await createTestDb();
    const accountId = await saveAccount(db, {
      name: 'HBL USD', kind: 'bank', currency: 'PKR', openingBalance: '0', bankName: '', nickname: '', notes: '',
    });
    const categoryId = (await db.get<{ id: string }>("SELECT id FROM categories WHERE kind='income' LIMIT 1"))!.id;

    await createTransaction(db, {
      type: 'income', date: '2026-02-01', amount: '100', currency: 'USD', exchangeRate: '280',
      sourceAccountId: accountId, categoryId, description: 'Freelance USD', allowExcess: false,
    });
    await createTransaction(db, {
      type: 'income', date: '2026-02-02', amount: '10000', currency: 'PKR', exchangeRate: '1',
      sourceAccountId: accountId, categoryId, description: 'Local income', allowExcess: false,
    });

    const txns = await listTransactions(db);
    const byCurrency = new Map(txns.map((t) => [t.currency, t.amount]));
    expect(byCurrency.get('USD')).toBe('100');
    expect(byCurrency.get('PKR')).toBe('10000');
    expect(totalForType(await getJournal(db), incomeCode('')).abs().toString()).toBe('38000');
    expect(txns.find((t) => t.currency === 'USD')?.rate_date).toBe('2026-02-01');
  });
});
