import { nowIso, uuid } from './ids';
import { Money } from './money';
import { accountSchema, categorySchema, exchangeRateSchema, partySchema, projectSchema, obligationSchema, settlementSchema, transactionSchema, type AccountInput, type CategoryInput, type ExchangeRateInput, type ObligationInput, type PartyInput, type ProjectInput, type SettlementInput, type TransactionInput } from './schemas';
import { accountCode, assertBalanced, buildPostings, payableCode, receivableCode, type Posting } from './ledger';
import type { AccountRow, CategoryRow, JournalRow, ObligationRow, PartyRow, ProjectRow, SettlementRow, TransactionRow } from './types';
import { runMigrations, type DbAdapter, type SqlStatement } from '../db/adapter';

const EQUITY_OPENING = 'EQUITY:OPENING';

function audit(entityType: string, entityId: string, action: string, payload: unknown, statements: SqlStatement[]): void {
  statements.push({
    sql: 'INSERT INTO audit_logs(id, entity_type, entity_id, action, payload, device_id, created_at) VALUES (?,?,?,?,?,?,?)',
    params: [uuid(), entityType, entityId, action, JSON.stringify(payload ?? {}), null, nowIso()],
  });
}

function enqueue(entityType: string, entityId: string, operation: string, payload: unknown, statements: SqlStatement[]): void {
  const now = nowIso();
  statements.push({
    sql: `INSERT INTO sync_queue(id, entity_type, entity_id, operation, payload, status, attempts, created_at, updated_at)
          VALUES (?,?,?,?,?,'pending',0,?,?)
          ON CONFLICT(entity_type, entity_id, operation)
          DO UPDATE SET payload=excluded.payload, status='pending', updated_at=excluded.updated_at`,
    params: [uuid(), entityType, entityId, operation, JSON.stringify(payload ?? {}), now, now],
  });
}

function systemTransaction(statements: SqlStatement[], kind: string, date: string, postings: Posting[], description: string): string {
  const id = uuid();
  const now = nowIso();
  const base = postings[0]?.amount.toString() ?? '0';
  statements.push({
    sql: `INSERT INTO transactions(id, type, txn_date, amount, currency, exchange_rate, base_amount, rate_date,
          description, idempotency_key, is_system, created_at, updated_at)
          VALUES (?,?,?,?,?,'1',?,?,?,?,1,?,?)`,
    params: [id, kind, date, base, 'PKR', base, date, description, `system:${kind}:${id}`, now, now],
  });
  insertJournal(statements, id, postings, date);
  return id;
}

function insertJournal(statements: SqlStatement[], transactionId: string, postings: Posting[], date: string): void {
  assertBalanced(postings);
  for (const posting of postings) {
    statements.push({
      sql: `INSERT INTO journal_entries(id, transaction_id, account_code, party_id, direction, amount, currency, base_amount, created_at)
            VALUES (?,?,?,?,?,?,?,?,?)`,
      params: [uuid(), transactionId, posting.accountCode, posting.partyId, posting.direction, posting.amount.toString(), 'PKR', posting.amount.toString(), date],
    });
  }
}

export async function initializeDatabase(adapter: DbAdapter): Promise<void> {
  await runMigrations(adapter);
}

/* ------------------------------------------------------------------ parties */

export async function listParties(adapter: DbAdapter, includeArchived = false): Promise<PartyRow[]> {
  const sql = `SELECT * FROM parties ${includeArchived ? '' : 'WHERE deleted_at IS NULL AND is_active = 1'} ORDER BY name COLLATE NOCASE`;
  return adapter.all<PartyRow>(sql);
}

export async function getParty(adapter: DbAdapter, id: string): Promise<PartyRow | undefined> {
  return adapter.get<PartyRow>('SELECT * FROM parties WHERE id = ?', [id]);
}

export async function saveParty(adapter: DbAdapter, input: PartyInput, id?: string): Promise<string> {
  const data = partySchema.parse(input);
  const existing = id ? await getParty(adapter, id) : undefined;
  const partyId = id ?? uuid();
  if (id && !existing) throw new Error('Party not found');
  const now = nowIso();
  const statements: SqlStatement[] = [];
  if (existing) {
    statements.push({
      sql: `UPDATE parties SET name=?, type=?, phone=?, email=?, address=?, notes=?, opening_balance=?,
            opening_balance_direction=?, currency=?, updated_at=? WHERE id=?`,
      params: [data.name, data.type, data.phone || null, data.email || null, data.address || null, data.notes || null,
        data.openingBalance, data.openingBalanceDirection, data.currency, now, partyId],
    });
  } else {
    statements.push({
      sql: `INSERT INTO parties(id,name,type,phone,email,address,notes,opening_balance,opening_balance_direction,
            currency,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`,
      params: [partyId, data.name, data.type, data.phone || null, data.email || null, data.address || null, data.notes || null,
        data.openingBalance, data.openingBalanceDirection, data.currency, now, now],
    });
    const opening = Money.of(data.openingBalance);
    if (!opening.isZero() && data.openingBalanceDirection !== 'none') {
      const code = data.openingBalanceDirection === 'receivable' ? receivableCode(partyId) : payableCode(partyId);
      const postings: Posting[] = data.openingBalanceDirection === 'receivable'
        ? [{ accountCode: code, partyId, direction: 'debit', amount: opening }, { accountCode: EQUITY_OPENING, partyId: null, direction: 'credit', amount: opening }]
        : [{ accountCode: EQUITY_OPENING, partyId: null, direction: 'debit', amount: opening }, { accountCode: code, partyId, direction: 'credit', amount: opening }];
      systemTransaction(statements, 'adjustment', now.slice(0, 10), postings, `Opening balance — ${data.name}`);
    }
  }
  audit('party', partyId, existing ? 'update' : 'create', data, statements);
  enqueue('party', partyId, 'upsert', { ...data, id: partyId }, statements);
  await adapter.batch(statements);
  return partyId;
}

export async function setPartyActive(adapter: DbAdapter, id: string, active: boolean): Promise<void> {
  const statements: SqlStatement[] = [{
    sql: 'UPDATE parties SET is_active=?, deleted_at=?, updated_at=? WHERE id=?',
    params: [active ? 1 : 0, active ? null : nowIso(), nowIso(), id],
  }];
  audit('party', id, active ? 'restore' : 'archive', { active }, statements);
  enqueue('party', id, 'upsert', { id, is_active: active }, statements);
  await adapter.batch(statements);
}

/* ----------------------------------------------------------------- projects */

export async function listProjects(adapter: DbAdapter, partyId?: string): Promise<ProjectRow[]> {
  return adapter.all<ProjectRow>(
    `SELECT * FROM projects WHERE deleted_at IS NULL ${partyId ? 'AND party_id = ?' : ''} ORDER BY name COLLATE NOCASE`,
    partyId ? [partyId] : [],
  );
}

export async function saveProject(adapter: DbAdapter, input: ProjectInput, id?: string): Promise<string> {
  const data = projectSchema.parse(input);
  const projectId = id ?? uuid();
  const now = nowIso();
  const statements: SqlStatement[] = [{
    sql: id
      ? `UPDATE projects SET party_id=?, name=?, agreed_amount=?, currency=?, start_date=?, expected_completion=?,
         due_date=?, status=?, notes=?, updated_at=? WHERE id=?`
      : `INSERT INTO projects(id,party_id,name,agreed_amount,currency,start_date,expected_completion,due_date,status,notes,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    params: id
      ? [data.partyId, data.name, data.agreedAmount, data.currency, data.startDate, data.expectedCompletion || null, data.dueDate || null, data.status, data.notes || null, now, projectId]
      : [projectId, data.partyId, data.name, data.agreedAmount, data.currency, data.startDate, data.expectedCompletion || null, data.dueDate || null, data.status, data.notes || null, now, now],
  }];
  audit('project', projectId, id ? 'update' : 'create', data, statements);
  enqueue('project', projectId, 'upsert', { ...data, id: projectId }, statements);
  await adapter.batch(statements);
  return projectId;
}

export async function archiveProject(adapter: DbAdapter, id: string): Promise<void> {
  await adapter.batch([{
    sql: 'UPDATE projects SET deleted_at=?, updated_at=? WHERE id=?',
    params: [nowIso(), nowIso(), id],
  }]);
}

/* ----------------------------------------------------------------- accounts */

export async function listAccounts(adapter: DbAdapter, includeArchived = false): Promise<AccountRow[]> {
  return adapter.all<AccountRow>(
    `SELECT * FROM accounts ${includeArchived ? '' : 'WHERE deleted_at IS NULL AND is_active = 1'} ORDER BY kind, name COLLATE NOCASE`,
  );
}

export async function saveAccount(adapter: DbAdapter, input: AccountInput, id?: string): Promise<string> {
  const data = accountSchema.parse(input);
  const accountId = id ?? uuid();
  const now = nowIso();
  const statements: SqlStatement[] = [];
  if (id) {
    statements.push({
      sql: `UPDATE accounts SET name=?, bank_name=?, nickname=?, kind=?, currency=?, opening_balance=?, notes=?, updated_at=? WHERE id=?`,
      params: [data.name, data.bankName || null, data.nickname || null, data.kind, data.currency, data.openingBalance, data.notes || null, now, accountId],
    });
  } else {
    statements.push({
      sql: `INSERT INTO accounts(id,name,bank_name,nickname,kind,currency,opening_balance,notes,is_active,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,1,?,?)`,
      params: [accountId, data.name, data.bankName || null, data.nickname || null, data.kind, data.currency, data.openingBalance, data.notes || null, now, now],
    });
    const opening = Money.of(data.openingBalance);
    if (!opening.isZero()) {
      const asset = accountCode(accountId);
      const postings: Posting[] = opening.isPositive()
        ? [{ accountCode: asset, partyId: null, direction: 'debit', amount: opening }, { accountCode: EQUITY_OPENING, partyId: null, direction: 'credit', amount: opening }]
        : [{ accountCode: EQUITY_OPENING, partyId: null, direction: 'debit', amount: opening.abs() }, { accountCode: asset, partyId: null, direction: 'credit', amount: opening.abs() }];
      systemTransaction(statements, 'adjustment', now.slice(0, 10), postings, `Opening balance — ${data.name}`);
    }
  }
  audit('account', accountId, id ? 'update' : 'create', data, statements);
  enqueue('account', accountId, 'upsert', { ...data, id: accountId }, statements);
  await adapter.batch(statements);
  return accountId;
}

export async function setAccountActive(adapter: DbAdapter, id: string, active: boolean): Promise<void> {
  await adapter.batch([{
    sql: 'UPDATE accounts SET is_active=?, deleted_at=?, updated_at=? WHERE id=?',
    params: [active ? 1 : 0, active ? null : nowIso(), nowIso(), id],
  }]);
}

/* --------------------------------------------------------------- categories */

export async function listCategories(adapter: DbAdapter, kind?: 'income' | 'expense'): Promise<CategoryRow[]> {
  return adapter.all<CategoryRow>(
    `SELECT * FROM categories WHERE is_active = 1 ${kind ? 'AND kind = ?' : ''} ORDER BY name COLLATE NOCASE`,
    kind ? [kind] : [],
  );
}

export async function saveCategory(adapter: DbAdapter, input: CategoryInput, id?: string): Promise<string> {
  const data = categorySchema.parse(input);
  const categoryId = id ?? uuid();
  const now = nowIso();
  const statements: SqlStatement[] = [{
    sql: id ? 'UPDATE categories SET name=?, kind=?, updated_at=? WHERE id=?' : 'INSERT INTO categories(id,name,kind,created_at,updated_at) VALUES (?,?,?,?,?)',
    params: id ? [data.name, data.kind, now, categoryId] : [categoryId, data.name, data.kind, now, now],
  }];
  enqueue('category', categoryId, 'upsert', { ...data, id: categoryId }, statements);
  await adapter.batch(statements);
  return categoryId;
}

export async function seedDefaultCategories(adapter: DbAdapter): Promise<void> {
  const existing = await adapter.get<{ count: number }>('SELECT COUNT(*) AS count FROM categories');
  if (Number(existing?.count ?? 0) > 0) return;
  const names: Array<[string, 'income' | 'expense']> = [
    ['Freelance Income', 'income'], ['Salary', 'income'], ['Business Income', 'income'], ['Other Income', 'income'],
    ['Food', 'expense'], ['Transport', 'expense'], ['Shopping', 'expense'], ['Utilities', 'expense'],
    ['Education', 'expense'], ['Medical', 'expense'], ['Rent', 'expense'], ['Other Expenses', 'expense'],
  ];
  const now = nowIso();
  await adapter.batch(names.map(([name, kind]) => ({
    sql: 'INSERT INTO categories(id,name,kind,created_at,updated_at) VALUES (?,?,?,?,?)',
    params: [uuid(), name, kind, now, now],
  })));
}

/* ----------------------------------------------------------- exchange rates */

export async function saveExchangeRate(adapter: DbAdapter, input: ExchangeRateInput): Promise<string> {
  const data = exchangeRateSchema.parse(input);
  if (data.fromCurrency === data.toCurrency) throw new Error('Currencies must be different');
  const id = uuid();
  await adapter.batch([{
    sql: `INSERT INTO exchange_rates(id,from_code,to_code,rate,rate_date,source,created_at) VALUES (?,?,?,?,?,?,?)`,
    params: [id, data.fromCurrency, data.toCurrency, data.rate, data.rateDate, data.source, nowIso()],
  }]);
  return id;
}

export async function listExchangeRates(adapter: DbAdapter): Promise<Array<{ id: string; from_code: string; to_code: string; rate: string; rate_date: string; source: string }>> {
  return adapter.all('SELECT id, from_code, to_code, rate, rate_date, source FROM exchange_rates ORDER BY rate_date DESC');
}

/** Returns the exact-date rate when available, otherwise the latest rate on or before the date. */
export async function rateForDate(adapter: DbAdapter, from: string, to: string, date: string): Promise<Money | undefined> {
  if (from === to) return Money.of(1);
  const row = await adapter.get<{ rate: string }>(
    `SELECT rate FROM exchange_rates WHERE from_code=? AND to_code=? AND rate_date<=? ORDER BY rate_date DESC LIMIT 1`,
    [from, to, date],
  );
  return row ? Money.of(row.rate) : undefined;
}

/* -------------------------------------------------------------- obligations */

export async function listObligations(adapter: DbAdapter, filters: { partyId?: string; direction?: 'receivable' | 'payable'; openOnly?: boolean } = {}): Promise<ObligationRow[]> {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filters.partyId) { clauses.push('party_id = ?'); params.push(filters.partyId); }
  if (filters.direction) { clauses.push('direction = ?'); params.push(filters.direction); }
  if (filters.openOnly) clauses.push("status != 'settled'");
  return adapter.all<ObligationRow>(
    `SELECT * FROM obligations ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at DESC`,
    params,
  );
}

export async function createObligation(adapter: DbAdapter, input: ObligationInput): Promise<string> {
  const data = obligationSchema.parse(input);
  const id = uuid();
  const now = nowIso();
  const statements: SqlStatement[] = [{
    sql: `INSERT INTO obligations(id,party_id,project_id,direction,reference,total_amount,currency,due_date,notes,status,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,'open',?,?)`,
    params: [id, data.partyId, data.projectId || null, data.direction, data.reference || null, data.totalAmount, data.currency, data.dueDate || null, data.notes || null, now, now],
  }];
  const amount = Money.of(data.totalAmount);
  const partyCode = data.direction === 'receivable' ? receivableCode(data.partyId) : payableCode(data.partyId);
  const cashCode = accountCode(data.accountId);
  const postings: Posting[] = data.direction === 'receivable'
    ? [{ accountCode: partyCode, partyId: data.partyId, direction: 'debit', amount }, { accountCode: cashCode, partyId: null, direction: 'credit', amount }]
    : [{ accountCode: cashCode, partyId: null, direction: 'debit', amount }, { accountCode: partyCode, partyId: data.partyId, direction: 'credit', amount }];
  systemTransaction(statements, data.direction === 'receivable' ? 'receivable_creation' : 'payable_creation', now.slice(0, 10), postings, `Obligation ${data.reference ?? id.slice(0, 8)}`);
  audit('obligation', id, 'create', data, statements);
  enqueue('obligation', id, 'upsert', { ...data, id }, statements);
  await adapter.batch(statements);
  return id;
}

export async function listSettlements(adapter: DbAdapter, obligationId?: string): Promise<SettlementRow[]> {
  return adapter.all<SettlementRow>(
    `SELECT * FROM settlements ${obligationId ? 'WHERE obligation_id=?' : ''} ORDER BY created_at`,
    obligationId ? [obligationId] : [],
  );
}

/* ------------------------------------------------------------- transactions */

export interface CreateTransactionResult {
  id: string;
  duplicate: boolean;
}

export async function createTransaction(adapter: DbAdapter, input: TransactionInput): Promise<CreateTransactionResult> {
  const data = transactionSchema.parse(input);
  const key = data.idempotencyKey ?? uuid();
  const existing = await adapter.get<TransactionRow>('SELECT * FROM transactions WHERE idempotency_key = ?', [key]);
  if (existing) return { id: existing.id, duplicate: true };

  const id = uuid();
  const now = nowIso();
  let original: TransactionRow | undefined;
  let originalPostings: JournalRow[] = [];
  if (data.type === 'reversal' || data.type === 'refund') {
    original = await adapter.get<TransactionRow>('SELECT * FROM transactions WHERE id=?', [data.reversalOf!]);
    if (!original) throw new Error('Original transaction not found');
    if (original.reversal_of) throw new Error('A reversal cannot itself be reversed');
    originalPostings = await adapter.all<JournalRow>('SELECT * FROM journal_entries WHERE transaction_id=?', [original.id]);
  }

  const base = Money.of(data.amount).mul(data.exchangeRate).round(2);
  const postings = buildPostings({
    type: data.type,
    amount: data.amount,
    exchangeRate: data.exchangeRate,
    partyId: data.partyId || undefined,
    sourceAccountId: data.sourceAccountId || undefined,
    destinationAccountId: data.destinationAccountId || undefined,
    categoryId: data.categoryId || undefined,
  }, { original, originalPostings });

  const statements: SqlStatement[] = [{
    sql: `INSERT INTO transactions(id,type,txn_date,amount,currency,exchange_rate,base_amount,rate_date,party_id,project_id,
          source_account_id,destination_account_id,category_id,obligation_id,description,reference,reversal_of,idempotency_key,is_system,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
    params: [id, data.type, data.date, data.amount, data.currency, data.exchangeRate, base.toString(), data.date,
      data.partyId || null, data.projectId || null, data.sourceAccountId || null, data.destinationAccountId || null,
      data.categoryId || null, data.obligationId || null, data.description || null, data.reference || null,
      data.reversalOf || null, key, now, now],
  }];
  insertJournal(statements, id, postings, data.date);

  if (['receivable_settlement', 'payable_settlement'].includes(data.type)) {
    const obligationId = data.obligationId;
    if (!obligationId) throw new Error('Select an obligation to settle');
    const obligation = await adapter.get<ObligationRow>('SELECT * FROM obligations WHERE id=?', [obligationId]);
    if (!obligation) throw new Error('Obligation not found');
    const settlements = await listSettlements(adapter, obligationId);
    const outstanding = Money.of(obligation.total_amount).sub(settlements.reduce((a, s) => a.add(s.amount), Money.zero()));
    if (!data.allowExcess && Money.of(data.amount).isGreaterThan(outstanding)) {
      throw new Error(`Payment of ${data.amount} exceeds outstanding ${outstanding.toString()}. Enable advance/excess payment to override.`);
    }
    const settlementId = uuid();
    statements.push({
      sql: `INSERT INTO settlements(id,obligation_id,transaction_id,amount,currency,allow_excess,created_at) VALUES (?,?,?,?,?,?,?)`,
      params: [settlementId, obligationId, id, data.amount, obligation.currency, data.allowExcess ? 1 : 0, now],
    });
    statements.push({
      sql: `INSERT INTO settlement_allocations(id,settlement_id,obligation_id,amount,created_at) VALUES (?,?,?,?,?)`,
      params: [uuid(), settlementId, obligationId, data.amount, now],
    });
    const remaining = Money.of(obligation.total_amount).sub(outstanding.add(data.amount));
    statements.push({
      sql: 'UPDATE obligations SET status=?, updated_at=? WHERE id=?',
      params: [remaining.isPositive() ? 'open' : (data.allowExcess ? 'overpaid' : 'settled'), now, obligationId],
    });
  }

  audit('transaction', id, 'create', { ...data, id }, statements);
  enqueue('transaction', id, 'insert', { ...data, id, base_amount: base.toString() }, statements);
  await adapter.batch(statements);
  return { id, duplicate: false };
}

export async function reverseTransaction(adapter: DbAdapter, id: string, description = 'Reversal'): Promise<CreateTransactionResult> {
  const original = await adapter.get<TransactionRow>('SELECT * FROM transactions WHERE id=?', [id]);
  if (!original) throw new Error('Transaction not found');
  if (original.reversal_of) throw new Error('A reversal cannot itself be reversed');
  return createTransaction(adapter, {
    type: 'reversal',
    date: nowIso().slice(0, 10),
    amount: original.amount,
    currency: original.currency,
    exchangeRate: original.exchange_rate,
    partyId: original.party_id ?? undefined,
    projectId: original.project_id ?? undefined,
    sourceAccountId: original.source_account_id ?? undefined,
    destinationAccountId: original.destination_account_id ?? undefined,
    categoryId: original.category_id ?? undefined,
    obligationId: original.obligation_id ?? undefined,
    description,
    reversalOf: original.id,
    idempotencyKey: `reversal:${id}`,
    allowExcess: false,
  });
}

export async function settleObligation(adapter: DbAdapter, input: SettlementInput): Promise<CreateTransactionResult> {
  const data = settlementSchema.parse(input);
  const obligation = await adapter.get<ObligationRow>('SELECT * FROM obligations WHERE id=?', [data.obligationId]);
  if (!obligation) throw new Error('Obligation not found');
  return createTransaction(adapter, {
    type: obligation.direction === 'receivable' ? 'receivable_settlement' : 'payable_settlement',
    date: data.date,
    amount: data.amount,
    currency: obligation.currency,
    exchangeRate: '1',
    partyId: obligation.party_id,
    projectId: obligation.project_id ?? undefined,
    obligationId: obligation.id,
    destinationAccountId: obligation.direction === 'receivable' ? data.accountId : undefined,
    sourceAccountId: obligation.direction === 'payable' ? data.accountId : undefined,
    description: data.description || `Settlement ${obligation.reference ?? obligation.id.slice(0, 8)}`,
    allowExcess: data.allowExcess,
  });
}

export async function listTransactions(adapter: DbAdapter, filters: {
  from?: string; to?: string; partyId?: string; projectId?: string; type?: string; currency?: string; categoryId?: string; limit?: number;
} = {}): Promise<TransactionRow[]> {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filters.from) { clauses.push('txn_date >= ?'); params.push(filters.from); }
  if (filters.to) { clauses.push('txn_date <= ?'); params.push(filters.to); }
  if (filters.partyId) { clauses.push('party_id = ?'); params.push(filters.partyId); }
  if (filters.projectId) { clauses.push('project_id = ?'); params.push(filters.projectId); }
  if (filters.type) { clauses.push('type = ?'); params.push(filters.type); }
  if (filters.currency) { clauses.push('currency = ?'); params.push(filters.currency); }
  if (filters.categoryId) { clauses.push('category_id = ?'); params.push(filters.categoryId); }
  const limit = Math.min(Math.max(filters.limit ?? 500, 1), 5000);
  return adapter.all<TransactionRow>(
    `SELECT * FROM transactions ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY txn_date DESC, created_at DESC LIMIT ?`,
    [...params, limit],
  );
}

export async function getTransaction(adapter: DbAdapter, id: string): Promise<TransactionRow | undefined> {
  return adapter.get<TransactionRow>('SELECT * FROM transactions WHERE id=?', [id]);
}

export async function getJournal(adapter: DbAdapter, from?: string, to?: string): Promise<JournalRow[]> {
  const clauses: string[] = [];
  const params: string[] = [];
  if (from) { clauses.push('t.txn_date >= ?'); params.push(from); }
  if (to) { clauses.push('t.txn_date <= ?'); params.push(to); }
  return adapter.all<JournalRow>(
    `SELECT j.* FROM journal_entries j JOIN transactions t ON t.id=j.transaction_id
     ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY j.created_at`,
    params,
  );
}

export async function getSetting(adapter: DbAdapter, key: string, fallback = ''): Promise<string> {
  const row = await adapter.get<{ value: string }>('SELECT value FROM settings WHERE key=?', [key]);
  return row?.value ?? fallback;
}

export async function setSetting(adapter: DbAdapter, key: string, value: string): Promise<void> {
  await adapter.batch([{
    sql: `INSERT INTO settings(key,value,updated_at) VALUES (?,?,?)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    params: [key, value, nowIso()],
  }]);
}
