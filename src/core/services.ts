import { nowIso, uuid } from './ids';
import { convert, Money, type MoneyInput } from './money';
import { accountSchema, categorySchema, dateString, exchangeRateSchema, partySchema, projectSchema, obligationSchema, settlementSchema, transactionSchema, type AccountInput, type CategoryInput, type ExchangeRateInput, type ObligationInput, type PartyInput, type ProjectInput, type SettlementInput, type TransactionInput } from './schemas';
import { accountCode, assertBalanced, buildPostings, obligationOutstanding, payableCode, receivableCode, settlementStatus, type Posting } from './ledger';
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

/**
 * Serializes read-then-write validation per adapter. The renderer can fire two
 * clicks before the first promise resolves; without this chain both would pass
 * the idempotency/outstanding checks and race inside a single SQLite adapter.
 */
const adapterQueues = new WeakMap<DbAdapter, Promise<unknown>>();

function serialize<T>(adapter: DbAdapter, work: () => Promise<T>): Promise<T> {
  const previous = adapterQueues.get(adapter) ?? Promise.resolve();
  const next = previous.then(work, work);
  adapterQueues.set(adapter, next.then(() => undefined, () => undefined));
  return next;
}

const columnCache = new WeakMap<DbAdapter, Map<string, Promise<Set<string>>>>();

async function hasColumn(adapter: DbAdapter, table: string, column: string): Promise<boolean> {
  let tables = columnCache.get(adapter);
  if (!tables) {
    tables = new Map();
    columnCache.set(adapter, tables);
  }
  let columns = tables.get(table);
  if (!columns) {
    columns = adapter.all<{ name: string }>(`PRAGMA table_info(${table})`).then((rows) => new Set(rows.map((r) => r.name)));
    tables.set(table, columns);
  }
  return (await columns).has(column);
}

async function baseCurrency(adapter: DbAdapter): Promise<string> {
  return (await getSetting(adapter, 'base_currency', 'PKR')) || 'PKR';
}

/** Direct rate first, then the inverse of the opposite direction. */
export async function resolveRate(adapter: DbAdapter, from: string, to: string, date: string): Promise<Money> {
  if (from === to) return Money.of(1);
  const direct = await rateForDate(adapter, from, to, date);
  if (direct) return direct;
  const inverse = await rateForDate(adapter, to, from, date);
  if (inverse && !inverse.isZero()) return Money.of(1).div(inverse);
  throw new Error(`No exchange rate from ${from} to ${to} on or before ${date}. Save a rate for ${from} → ${to} (or its inverse) first.`);
}

async function convertToBase(adapter: DbAdapter, amount: MoneyInput, currency: string, date: string): Promise<Money> {
  return convert(amount, await resolveRate(adapter, currency, await baseCurrency(adapter), date));
}

interface SystemTransactionOptions {
  currency?: string;
  exchangeRate?: MoneyInput;
  amount?: MoneyInput;
  baseAmount?: Money;
}

async function systemTransaction(
  adapter: DbAdapter,
  statements: SqlStatement[],
  kind: string,
  date: string,
  postings: Posting[],
  description: string,
  options: SystemTransactionOptions = {},
): Promise<string> {
  const id = uuid();
  const now = nowIso();
  const currency = options.currency ?? await baseCurrency(adapter);
  const exchangeRate = Money.of(options.exchangeRate ?? 1);
  const base = options.baseAmount ?? (postings[0]?.amount ?? Money.zero());
  const amount = Money.of(options.amount ?? base);
  statements.push({
    sql: `INSERT INTO transactions(id, type, txn_date, amount, currency, exchange_rate, base_amount, rate_date,
          description, idempotency_key, is_system, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`,
    params: [id, kind, date, amount.toString(), currency, exchangeRate.toString(), base.toString(), date,
      description, `system:${kind}:${id}`, now, now],
  });
  await insertJournal(adapter, statements, id, postings, date, { currency, exchangeRate, amount });
  return id;
}

async function insertJournal(
  adapter: DbAdapter,
  statements: SqlStatement[],
  transactionId: string,
  postings: Posting[],
  date: string,
  meta: { currency?: string; exchangeRate?: MoneyInput; amount?: MoneyInput } = {},
): Promise<void> {
  assertBalanced(postings);
  const currency = meta.currency ?? await baseCurrency(adapter);
  const hasOriginalColumns = await hasColumn(adapter, 'journal_entries', 'original_amount');
  for (const posting of postings) {
    const base = posting.amount.toString();
    const original = posting.originalAmount?.toString() ?? meta.amount?.toString() ?? base;
    const originalCurrency = posting.currency ?? currency;
    if (hasOriginalColumns) {
      statements.push({
        sql: `INSERT INTO journal_entries(id, transaction_id, account_code, party_id, direction, amount, currency,
              base_amount, original_amount, original_currency, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        params: [uuid(), transactionId, posting.accountCode, posting.partyId, posting.direction, base, currency,
          base, original, originalCurrency, date],
      });
    } else {
      // Legacy schema: amount/currency were always base before v2. Keep the
      // original values there as a compatible fallback; base_amount is unchanged.
      statements.push({
        sql: `INSERT INTO journal_entries(id, transaction_id, account_code, party_id, direction, amount, currency, base_amount, created_at)
              VALUES (?,?,?,?,?,?,?,?,?)`,
        params: [uuid(), transactionId, posting.accountCode, posting.partyId, posting.direction, original, originalCurrency, base, date],
      });
    }
  }
}

export function initializeDatabase(adapter: DbAdapter): Promise<void> {
  return serialize(adapter, async () => {
    await runMigrations(adapter);
    // The v2 columns may have just been added; force schema re-detection.
    columnCache.delete(adapter);
  });
}

/* ------------------------------------------------------------------ parties */

export async function listParties(adapter: DbAdapter, includeArchived = false): Promise<PartyRow[]> {
  const sql = `SELECT * FROM parties ${includeArchived ? '' : 'WHERE deleted_at IS NULL AND is_active = 1'} ORDER BY name COLLATE NOCASE`;
  return adapter.all<PartyRow>(sql);
}

export async function getParty(adapter: DbAdapter, id: string): Promise<PartyRow | undefined> {
  return adapter.get<PartyRow>('SELECT * FROM parties WHERE id = ?', [id]);
}

export function saveParty(adapter: DbAdapter, input: PartyInput, id?: string): Promise<string> {
  return serialize(adapter, () => savePartyUnlocked(adapter, input, id));
}

async function savePartyUnlocked(adapter: DbAdapter, input: PartyInput, id?: string): Promise<string> {
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
      const date = now.slice(0, 10);
      const base = await convertToBase(adapter, opening, data.currency, date);
      const rate = opening.isZero() ? Money.of(1) : base.div(opening);
      const postings: Posting[] = data.openingBalanceDirection === 'receivable'
        ? [{ accountCode: code, partyId, direction: 'debit', amount: base }, { accountCode: EQUITY_OPENING, partyId: null, direction: 'credit', amount: base }]
        : [{ accountCode: EQUITY_OPENING, partyId: null, direction: 'debit', amount: base }, { accountCode: code, partyId, direction: 'credit', amount: base }];
      await systemTransaction(adapter, statements, 'adjustment', date, postings, `Opening balance — ${data.name}`, {
        currency: data.currency, exchangeRate: rate, amount: opening, baseAmount: base,
      });
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

export function saveAccount(adapter: DbAdapter, input: AccountInput, id?: string): Promise<string> {
  return serialize(adapter, () => saveAccountUnlocked(adapter, input, id));
}

async function saveAccountUnlocked(adapter: DbAdapter, input: AccountInput, id?: string): Promise<string> {
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
      const date = now.slice(0, 10);
      const baseAmount = await convertToBase(adapter, opening.abs(), data.currency, date);
      const rate = baseAmount.div(opening.abs());
      const postings: Posting[] = opening.isPositive()
        ? [{ accountCode: asset, partyId: null, direction: 'debit', amount: baseAmount }, { accountCode: EQUITY_OPENING, partyId: null, direction: 'credit', amount: baseAmount }]
        : [{ accountCode: EQUITY_OPENING, partyId: null, direction: 'debit', amount: baseAmount }, { accountCode: asset, partyId: null, direction: 'credit', amount: baseAmount }];
      await systemTransaction(adapter, statements, 'adjustment', date, postings, `Opening balance — ${data.name}`, {
        currency: data.currency, exchangeRate: rate, amount: opening.abs(), baseAmount,
      });
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
    `SELECT rate FROM exchange_rates WHERE from_code=? AND to_code=? AND rate_date<=? ORDER BY rate_date DESC, created_at DESC, rowid DESC LIMIT 1`,
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

export function createObligation(adapter: DbAdapter, input: ObligationInput): Promise<string> {
  return serialize(adapter, () => createObligationUnlocked(adapter, input));
}

async function createObligationUnlocked(adapter: DbAdapter, input: ObligationInput): Promise<string> {
  const data = obligationSchema.parse(input);
  const account = await adapter.get<AccountRow>('SELECT * FROM accounts WHERE id=?', [data.accountId]);
  if (!account) throw new Error('Account not found');
  const id = uuid();
  const now = nowIso();
  const date = now.slice(0, 10);
  const reportingCurrency = await baseCurrency(adapter);
  const rate = await resolveRate(adapter, data.currency, reportingCurrency, date);
  // Both the account and the obligation must be expressible in the reporting currency.
  await resolveRate(adapter, account.currency, reportingCurrency, date);
  const amount = Money.of(data.totalAmount);
  const baseAmount = convert(amount, rate);
  const hasAccountColumn = await hasColumn(adapter, 'obligations', 'account_id');
  const statements: SqlStatement[] = [{
    sql: `INSERT INTO obligations(id,party_id,project_id,${hasAccountColumn ? 'account_id,' : ''}direction,reference,total_amount,
          currency,due_date,notes,status,created_at,updated_at) VALUES (?,?,?,${hasAccountColumn ? '?,' : ''}?,?,?,?,?,?,'open',?,?)`,
    params: [id, data.partyId, data.projectId || null, ...(hasAccountColumn ? [data.accountId] : []),
      data.direction, data.reference || null, data.totalAmount, data.currency, data.dueDate || null, data.notes || null, now, now],
  }];
  const partyCode = data.direction === 'receivable' ? receivableCode(data.partyId) : payableCode(data.partyId);
  const cashCode = accountCode(data.accountId);
  const postings: Posting[] = data.direction === 'receivable'
    ? [{ accountCode: partyCode, partyId: data.partyId, direction: 'debit', amount: baseAmount, originalAmount: amount, currency: data.currency },
      { accountCode: cashCode, partyId: null, direction: 'credit', amount: baseAmount, originalAmount: amount, currency: data.currency }]
    : [{ accountCode: cashCode, partyId: null, direction: 'debit', amount: baseAmount, originalAmount: amount, currency: data.currency },
      { accountCode: partyCode, partyId: data.partyId, direction: 'credit', amount: baseAmount, originalAmount: amount, currency: data.currency }];
  await systemTransaction(adapter, statements, data.direction === 'receivable' ? 'receivable_creation' : 'payable_creation', date, postings,
    `Obligation ${data.reference ?? id.slice(0, 8)}`, { currency: data.currency, exchangeRate: rate, amount, baseAmount });
  audit('obligation', id, 'create', data, statements);
  enqueue('obligation', id, 'upsert', { ...data, id }, statements);
  await adapter.batch(statements);
  return id;
}

export async function listSettlements(adapter: DbAdapter, obligationId?: string): Promise<SettlementRow[]> {
  return adapter.all<SettlementRow>(
    `SELECT * FROM settlements ${obligationId ? 'WHERE obligation_id=?' : ''} ORDER BY created_at, id`,
    obligationId ? [obligationId] : [],
  );
}

/* ------------------------------------------------------------- transactions */

export interface CreateTransactionResult {
  id: string;
  duplicate: boolean;
}

const SETTLEMENT_TYPES = new Set(['receivable_settlement', 'payable_settlement']);

function isSettlementType(type: string): boolean {
  return SETTLEMENT_TYPES.has(type);
}

function sameMoney(left: string, right: string): boolean {
  return Money.of(left).equals(Money.of(right));
}

/** An idempotency key may only be reused for a byte-for-byte equivalent posting. */
function matchesIdempotency(existing: TransactionRow, data: TransactionInput, base: Money): boolean {
  const same = (row: string | null | undefined, input: string | undefined) => (row ?? '') === (input ?? '');
  try {
    return existing.type === data.type
      && existing.txn_date === data.date
      && sameMoney(existing.amount, data.amount)
      && existing.currency === data.currency
      && sameMoney(existing.exchange_rate, data.exchangeRate)
      && sameMoney(existing.base_amount, base.toString())
      && existing.rate_date === data.date
      && same(existing.party_id, data.partyId)
      && same(existing.project_id, data.projectId)
      && same(existing.source_account_id, data.sourceAccountId)
      && same(existing.destination_account_id, data.destinationAccountId)
      && same(existing.category_id, data.categoryId)
      && same(existing.obligation_id, data.obligationId)
      && same(existing.description, data.description)
      && same(existing.reference, data.reference)
      && same(existing.reversal_of, data.reversalOf);
  } catch {
    return false;
  }
}

/** The audit payload is the logical request; it also covers flags with no column. */
function matchesAuditPayload(raw: string | undefined, data: TransactionInput): boolean {
  if (!raw) return true;
  let prior: Record<string, unknown>;
  try {
    prior = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return false;
  }
  const fields = ['type', 'date', 'amount', 'currency', 'exchangeRate', 'partyId', 'projectId',
    'sourceAccountId', 'destinationAccountId', 'categoryId', 'obligationId', 'description',
    'reference', 'reversalOf', 'allowExcess'] as const;
  const current = data as unknown as Record<string, unknown>;
  for (const field of fields) {
    const before = prior[field];
    const after = current[field];
    if (field === 'amount' || field === 'exchangeRate') {
      if (!sameMoney(String(before ?? '0'), String(after ?? '0'))) return false;
    } else if ((before ?? '') !== (after ?? '')) {
      return false;
    }
  }
  return true;
}

async function relatedReversals(adapter: DbAdapter, originalId: string): Promise<TransactionRow[]> {
  return adapter.all<TransactionRow>(
    "SELECT * FROM transactions WHERE reversal_of=? AND type IN ('reversal','refund')", [originalId],
  );
}

/** Refunds/reversals can never exceed the amount of the original transaction. */
async function remainingOriginal(adapter: DbAdapter, original: TransactionRow): Promise<Money> {
  const rows = await relatedReversals(adapter, original.id);
  return rows.reduce((acc, row) => {
    if (row.currency !== original.currency) {
      throw new Error(`Refund ${row.id} uses ${row.currency}; original transaction uses ${original.currency}`);
    }
    return acc.sub(row.amount);
  }, Money.of(original.amount));
}

export function createTransaction(adapter: DbAdapter, input: TransactionInput): Promise<CreateTransactionResult> {
  return serialize(adapter, () => createTransactionUnlocked(adapter, input));
}

async function createTransactionUnlocked(adapter: DbAdapter, input: TransactionInput): Promise<CreateTransactionResult> {
  const data = transactionSchema.parse(input);
  const key = data.idempotencyKey ?? uuid();
  const base = Money.of(data.amount).mul(data.exchangeRate).round(2);
  const existing = await adapter.get<TransactionRow>('SELECT * FROM transactions WHERE idempotency_key = ?', [key]);
  if (existing) {
    const auditRow = await adapter.get<{ payload: string }>(
      "SELECT payload FROM audit_logs WHERE entity_type='transaction' AND entity_id=? AND action='create' ORDER BY created_at DESC LIMIT 1",
      [existing.id],
    );
    if (!matchesIdempotency(existing, data, base) || !matchesAuditPayload(auditRow?.payload, data)) {
      throw new Error(`Idempotency key conflict: ${key} was already used with a different transaction payload`);
    }
    return { id: existing.id, duplicate: true };
  }

  const id = uuid();
  const now = nowIso();
  let original: TransactionRow | undefined;
  let originalPostings: JournalRow[] = [];
  if (data.type === 'reversal' || data.type === 'refund') {
    original = await adapter.get<TransactionRow>('SELECT * FROM transactions WHERE id=?', [data.reversalOf!]);
    if (!original) throw new Error('Original transaction not found');
    if (original.reversal_of) throw new Error('A reversal cannot itself be reversed');
    const prior = await relatedReversals(adapter, original.id);
    if (prior.length > 0 && (data.type === 'reversal' || isSettlementType(original.type))) {
      throw new Error('This transaction has already been reversed; only one compensating settlement is allowed');
    }
    if (data.currency !== original.currency || !sameMoney(data.exchangeRate, original.exchange_rate)) {
      throw new Error('Refunds and reversals must use the original currency and exchange rate (or supply matching explicit values)');
    }
    const remaining = await remainingOriginal(adapter, original);
    if (Money.of(data.amount).isGreaterThan(remaining)) {
      throw new Error(`Refund/reversal of ${data.amount} exceeds the remaining original amount ${remaining.toString()}`);
    }
    originalPostings = await adapter.all<JournalRow>('SELECT * FROM journal_entries WHERE transaction_id=?', [original.id]);
  }

  const postings = buildPostings({
    type: data.type,
    amount: data.amount,
    exchangeRate: data.exchangeRate,
    currency: data.currency,
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
  await insertJournal(adapter, statements, id, postings, data.date, { currency: data.currency, exchangeRate: data.exchangeRate, amount: data.amount });

  const isSettlement = isSettlementType(data.type);
  const compensatesSettlement = Boolean(original && isSettlementType(original.type)
    && (data.type === 'reversal' || data.type === 'refund'));
  if (isSettlement || compensatesSettlement) {
    const obligationId = isSettlement ? data.obligationId : original?.obligation_id;
    if (!obligationId) throw new Error('Select an obligation to settle');
    const obligation = await adapter.get<ObligationRow>('SELECT * FROM obligations WHERE id=?', [obligationId]);
    if (!obligation) throw new Error('Obligation not found');
    const settlements = await listSettlements(adapter, obligationId);
    const signedAmount = isSettlement ? Money.of(data.amount) : Money.of(data.amount).negate();
    const outstanding = obligationOutstanding(obligation, settlements);
    if (isSettlement && !data.allowExcess && signedAmount.isGreaterThan(outstanding)) {
      throw new Error(`Payment of ${data.amount} exceeds outstanding ${outstanding.toString()}. Enable advance/excess payment to override.`);
    }
    const settlementId = uuid();
    const hasReversalColumns = await hasColumn(adapter, 'settlements', 'reversed_at')
      && await hasColumn(adapter, 'settlements', 'reversal_transaction_id');
    statements.push({
      sql: `INSERT INTO settlements(id,obligation_id,transaction_id,amount,currency,allow_excess,created_at${hasReversalColumns ? ',reversal_transaction_id' : ''})
            VALUES (?,?,?,?,?,?,?${hasReversalColumns ? ',?' : ''})`,
      params: [settlementId, obligationId, id, signedAmount.toString(), obligation.currency, data.allowExcess ? 1 : 0, now,
        ...(hasReversalColumns ? [compensatesSettlement ? id : null] : [])],
    });
    statements.push({
      sql: `INSERT INTO settlement_allocations(id,settlement_id,obligation_id,amount,created_at) VALUES (?,?,?,?,?)`,
      params: [uuid(), settlementId, obligationId, signedAmount.toString(), now],
    });
    if (compensatesSettlement && hasReversalColumns) {
      statements.push({
        sql: 'UPDATE settlements SET reversed_at=?, reversal_transaction_id=? WHERE transaction_id=?',
        params: [now, id, original!.id],
      });
    }
    const projected: SettlementRow[] = [...settlements, {
      id: settlementId, obligation_id: obligationId, transaction_id: id, amount: signedAmount.toString(),
      currency: obligation.currency, allow_excess: data.allowExcess ? 1 : 0, created_at: now,
    }];
    const status = settlementStatus(obligation, projected);
    statements.push({
      sql: 'UPDATE obligations SET status=?, updated_at=? WHERE id=?',
      params: [status, now, obligationId],
    });
  }

  audit('transaction', id, 'create', { ...data, id }, statements);
  enqueue('transaction', id, 'insert', { ...data, id, base_amount: base.toString() }, statements);
  await adapter.batch(statements);
  return { id, duplicate: false };
}

export function reverseTransaction(adapter: DbAdapter, id: string, description = 'Reversal', effectiveDate?: string): Promise<CreateTransactionResult> {
  return serialize(adapter, () => reverseTransactionUnlocked(adapter, id, description, effectiveDate));
}

async function reverseTransactionUnlocked(adapter: DbAdapter, id: string, description: string, effectiveDate?: string): Promise<CreateTransactionResult> {
  const original = await adapter.get<TransactionRow>('SELECT * FROM transactions WHERE id=?', [id]);
  if (!original) throw new Error('Transaction not found');
  if (original.reversal_of) throw new Error('A reversal cannot itself be reversed');
  const prior = await relatedReversals(adapter, original.id);
  if (prior.some((row) => row.type === 'reversal')) throw new Error('This transaction has already been reversed');
  const remaining = await remainingOriginal(adapter, original);
  if (!remaining.isPositive()) throw new Error(`Transaction ${id} has no remaining amount to reverse`);
  let date = original.txn_date;
  if (effectiveDate !== undefined) {
    if (!dateString.safeParse(effectiveDate).success) throw new Error('Reversal effective date must be a valid calendar date');
    date = effectiveDate;
  }
  return createTransactionUnlocked(adapter, {
    type: 'reversal',
    date,
    amount: remaining.toString(),
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

export function settleObligation(adapter: DbAdapter, input: SettlementInput): Promise<CreateTransactionResult> {
  return serialize(adapter, () => settleObligationUnlocked(adapter, input));
}

async function settleObligationUnlocked(adapter: DbAdapter, input: SettlementInput): Promise<CreateTransactionResult> {
  const data = settlementSchema.parse(input);
  const obligation = await adapter.get<ObligationRow>('SELECT * FROM obligations WHERE id=?', [data.obligationId]);
  if (!obligation) throw new Error('Obligation not found');
  const account = await adapter.get<AccountRow>('SELECT * FROM accounts WHERE id=?', [data.accountId]);
  if (!account) throw new Error('Account not found');
  const currency = data.currency ?? obligation.currency;
  if (currency !== obligation.currency) {
    throw new Error(`Settlement currency ${currency} does not match obligation currency ${obligation.currency}`);
  }
  const reportingCurrency = await baseCurrency(adapter);
  const rate = data.exchangeRate ? Money.of(data.exchangeRate) : await resolveRate(adapter, obligation.currency, reportingCurrency, data.date);
  await resolveRate(adapter, account.currency, reportingCurrency, data.date);
  // Deterministic key: two identical clicks resolve to the same posting.
  const key = data.idempotencyKey ?? `settlement:${obligation.id}:${data.date}:${data.amount}:${data.accountId}:${data.allowExcess ? 1 : 0}:${currency}:${rate.toString()}`;
  return createTransactionUnlocked(adapter, {
    type: obligation.direction === 'receivable' ? 'receivable_settlement' : 'payable_settlement',
    date: data.date,
    amount: data.amount,
    currency,
    exchangeRate: rate.toString(),
    partyId: obligation.party_id,
    projectId: obligation.project_id ?? undefined,
    obligationId: obligation.id,
    destinationAccountId: obligation.direction === 'receivable' ? data.accountId : undefined,
    sourceAccountId: obligation.direction === 'payable' ? data.accountId : undefined,
    description: data.description || `Settlement ${obligation.reference ?? obligation.id.slice(0, 8)}`,
    allowExcess: data.allowExcess,
    idempotencyKey: key,
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
