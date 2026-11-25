import { describe, expect, it } from 'vitest';
import { createTestDb } from '../test/helpers';
import { createObligation, saveParty, settleObligation, saveAccount } from '../core/services';
import { partyStatement, obligationsReport, completeSummary } from '../core/reports';
import { buildStatementDocument, generatePdfBuffer, statementFileName } from './statements';

describe('Offline PDF statements', () => {
  it('builds a real statement from database rows and produces a PDF buffer', async () => {
    const db = await createTestDb();
    const partyId = await saveParty(db, { name: 'Hamza Bhai', type: 'individual', currency: 'PKR', openingBalance: '0', openingBalanceDirection: 'none' });
    const accountId = await saveAccount(db, { name: 'HBL', kind: 'bank', currency: 'PKR', openingBalance: '0', bankName: '', nickname: '', notes: '' });
    const obligationId = await createObligation(db, {
      partyId, accountId, direction: 'receivable', totalAmount: '50000', currency: 'PKR', reference: 'Work', notes: '', projectId: '', dueDate: '',
    });
    await settleObligation(db, { obligationId, amount: '20000', accountId, date: '2026-01-05', description: 'Payment', allowExcess: false });

    const statement = await partyStatement(db, partyId);
    const doc = buildStatementDocument(statement) as { content: unknown[] };
    const serialized = JSON.stringify(doc);
    expect(serialized).toContain('Digital Khata Statement');
    expect(serialized).toContain('Hamza Bhai');
    expect(serialized).toContain('20,000.00');
    expect(serialized).toContain('30,000.00');
    expect(statementFileName(statement)).toMatch(/^mykhata-.*\.pdf$/);

    const buffer = await generatePdfBuffer(statement);
    expect(new TextDecoder().decode(buffer.slice(0, 4))).toBe('%PDF');
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it('builds receivables, payables and complete summary reports', async () => {
    const db = await createTestDb();
    const receivables = await obligationsReport(db, 'receivable');
    const payables = await obligationsReport(db, 'payable');
    const summary = await completeSummary(db);
    expect(receivables.title).toBe('Receivables Report');
    expect(payables.title).toBe('Payables Report');
    expect(summary.title).toBe('Complete Accounts Report');
    expect(JSON.stringify(buildStatementDocument(summary))).toContain('Opening balance');
  });
});
