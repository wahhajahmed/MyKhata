import { Money, sumMoney, type MoneyInput } from './money';
import { accountBalance, accountCode, incomeCode, expenseCode, isOverdue, obligationOutstanding, partyBalances, totalForType } from './ledger';
import { getJournal, listAccounts, listCategories, listObligations, listParties, listProjects, listSettlements, listTransactions } from './services';
import type { AccountRow, JournalRow, ObligationRow, PartyRow, ProjectRow, TransactionRow } from './types';
import type { DbAdapter } from '../db/adapter';

export type RangePreset = 'today' | 'week' | 'month' | 'last_month' | 'year' | 'custom' | 'all';

export interface DateRange {
  from?: string;
  to?: string;
}

function iso(date: Date): string { return date.toISOString().slice(0, 10); }

export function resolveRange(preset: RangePreset, from?: string, to?: string): DateRange {
  const now = new Date();
  const today = iso(now);
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'week': {
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      return { from: iso(monday), to: today };
    }
    case 'month': return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'last_month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: iso(start), to: iso(end) };
    }
    case 'year': return { from: `${now.getFullYear()}-01-01`, to: today };
    case 'custom': return { from, to };
    case 'all': return {};
  }
}

function addDaysDays(date: Date, days: number): string {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return iso(copy);
}

export interface DashboardData {
  totalAssets: Money;
  totalReceivables: Money;
  totalPayables: Money;
  netPosition: Money;
  cashBalance: Money;
  bankBalance: Money;
  walletBalance: Money;
  incomeThisMonth: Money;
  expensesThisMonth: Money;
  recentTransactions: TransactionRow[];
  overdueReceivables: ObligationRow[];
  overduePayables: ObligationRow[];
  upcomingPayments: ObligationRow[];
  currencySummary: Array<{ code: string; amount: Money }>;
  monthlyChart: Array<{ month: string; income: number; expense: number }>;
  partyCount: number;
  projectCount: number;
  journalIsBalanced: boolean;
}

export async function getDashboard(adapter: DbAdapter, range: DateRange = {}): Promise<DashboardData> {
  const [accounts, parties, projects, obligations, journal, transactions] = await Promise.all([
    listAccounts(adapter), listParties(adapter), listProjects(adapter), listObligations(adapter),
    getJournal(adapter), listTransactions(adapter, { ...range, limit: 8 }),
  ]);

  const totalAssets = accounts.reduce((acc, account) => acc.add(accountBalance(journal, accountCode(account.id))), Money.zero());
  const totalReceivables = parties.reduce((acc, party) => acc.add(partyBalances(journal, party.id).receivable), Money.zero());
  const totalPayables = parties.reduce((acc, party) => acc.add(partyBalances(journal, party.id).payable), Money.zero());
  const balanceByKind = (kind: AccountRow['kind']) => accounts
    .filter((a) => a.kind === kind)
    .reduce((acc, account) => acc.add(accountBalance(journal, accountCode(account.id))), Money.zero());
  const today = iso(new Date());
  const monthStart = `${today.slice(0, 7)}-01`;
  const income = totalForType(journal.filter((e) => e.created_at >= monthStart), incomeCode('')).abs();
  const expense = totalForType(journal.filter((e) => e.created_at >= monthStart), expenseCode(''));
  const currencyMap = new Map<string, Money>();
  for (const txn of transactions) {
    currencyMap.set(txn.currency, (currencyMap.get(txn.currency) ?? Money.zero()).add(txn.amount));
  }

  const months: Array<{ month: string; income: number; expense: number }> = [];
  const cursor = new Date();
  cursor.setDate(1);
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
    const prefix = iso(d).slice(0, 7);
    const entries = journal.filter((e) => e.created_at.startsWith(prefix));
    months.push({
      month: new Intl.DateTimeFormat('en', { month: 'short' }).format(d),
      income: totalForType(entries, incomeCode('')).toNumber(),
      expense: totalForType(entries, expenseCode('')).abs().toNumber(),
    });
  }

  return {
    totalAssets,
    totalReceivables,
    totalPayables,
    netPosition: totalAssets.add(totalReceivables).sub(totalPayables),
    cashBalance: balanceByKind('cash'),
    bankBalance: balanceByKind('bank'),
    walletBalance: balanceByKind('wallet'),
    incomeThisMonth: income,
    expensesThisMonth: expense.abs(),
    recentTransactions: transactions,
    overdueReceivables: obligations.filter((o) => o.direction === 'receivable' && isOverdue(o, today)),
    overduePayables: obligations.filter((o) => o.direction === 'payable' && isOverdue(o, today)),
    upcomingPayments: obligations
      .filter((o) => o.status === 'open' && o.due_date && o.due_date >= today)
      .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
      .slice(0, 5),
    currencySummary: Array.from(currencyMap, ([code, amount]) => ({ code, amount })),
    monthlyChart: months,
    partyCount: parties.length,
    projectCount: projects.length,
    journalIsBalanced: verifyBalanced(journal),
  };
}

function verifyBalanced(entries: JournalRow[]): boolean {
  const map = new Map<string, JournalRow[]>();
  for (const entry of entries) map.set(entry.transaction_id, [...(map.get(entry.transaction_id) ?? []), entry]);
  return Array.from(map.values()).every((list) => {
    const debit = list.filter((e) => e.direction === 'debit').reduce((a, e) => a.add(e.base_amount), Money.zero());
    const credit = list.filter((e) => e.direction === 'credit').reduce((a, e) => a.add(e.base_amount), Money.zero());
    return debit.equals(credit);
  });
}

export interface StatementLine {
  txn: TransactionRow;
  received: Money;
  paid: Money;
  balance: Money;
}

export interface Statement {
  title: string;
  subtitle: string;
  period: string;
  party?: PartyRow;
  opening: Money;
  lines: StatementLine[];
  totalReceived: Money;
  totalPaid: Money;
  closing: Money;
  currency: string;
  generatedAt: string;
}

export async function partyStatement(adapter: DbAdapter, partyId: string, range: DateRange = {}): Promise<Statement> {
  const [party, transactions, allJournal] = await Promise.all([
    listParties(adapter, true).then((p) => p.find((x) => x.id === partyId)),
    listTransactions(adapter, { ...range, limit: 5000 }),
    getJournal(adapter),
  ]);
  if (!party) throw new Error('Party not found');
  const partyEntries = allJournal.filter((e) => e.party_id === partyId);
  const beforeRange = partyEntries.filter((e) => (range.from ? e.created_at < range.from : false));
  const inRange = partyEntries.filter((e) => (
    (!range.from || e.created_at >= range.from) && (!range.to || e.created_at <= range.to)
  ));
  const openingBalances = partyBalances(beforeRange, partyId);
  const closingBalances = partyBalances(
    [...beforeRange, ...inRange],
    partyId,
  );
  const receivableMode = closingBalances.receivable.greaterOrEqual(closingBalances.payable);
  const net = (balances: { receivable: Money; payable: Money }) => receivableMode
    ? balances.receivable.sub(balances.payable)
    : balances.payable.sub(balances.receivable);
  const openingNet = net(openingBalances);
  const byTransaction = new Map<string, JournalRow[]>();
  for (const entry of inRange) byTransaction.set(entry.transaction_id, [...(byTransaction.get(entry.transaction_id) ?? []), entry]);
  const txnById = new Map(transactions.map((txn) => [txn.id, txn]));
  let running = openingNet;
  const lines: StatementLine[] = [];
  for (const [transactionId, entries] of byTransaction) {
    const txn = txnById.get(transactionId);
    if (!txn) continue;
    let received = Money.zero();
    let paid = Money.zero();
    for (const entry of entries) {
      const amount = Money.of(entry.base_amount);
      if (entry.direction === 'credit') received = received.add(amount);
      else paid = paid.add(amount);
    }
    running = running.add(receivableMode ? paid.sub(received) : received.sub(paid));
    lines.push({ txn, received, paid, balance: running });
  }
  lines.sort((a, b) => a.txn.txn_date.localeCompare(b.txn.txn_date));
  const closing = net(closingBalances);
  if (lines.length > 0) lines[lines.length - 1]!.balance = closing;
  return {
    title: 'Digital Khata Statement',
    subtitle: party.name,
    period: periodLabel(range),
    party,
    opening: openingNet,
    lines,
    totalReceived: lines.reduce((a, l) => a.add(l.received), Money.zero()),
    totalPaid: lines.reduce((a, l) => a.add(l.paid), Money.zero()),
    closing,
    currency: party.currency,
    generatedAt: new Date().toISOString(),
  };
}

export async function projectStatement(adapter: DbAdapter, projectId: string, range: DateRange = {}): Promise<Statement & { project?: ProjectRow; received: Money; remaining: Money }> {
  const [projects, transactions] = await Promise.all([
    listProjects(adapter),
    listTransactions(adapter, { ...range, projectId, limit: 5000 }),
  ]);
  const project = projects.find((p) => p.id === projectId);
  if (!project) throw new Error('Project not found');
  let running = Money.zero();
  const lines = transactions.map((txn) => {
    const delta = Money.of(txn.base_amount);
    const isIncome = ['income', 'receivable_settlement'].includes(txn.type);
    const net = isIncome ? delta : delta.negate();
    running = running.add(net);
    return { txn, received: isIncome ? delta : Money.zero(), paid: isIncome ? Money.zero() : delta, balance: running };
  });
  const received = lines.reduce((a, l) => a.add(l.received), Money.zero());
  return {
    title: 'Project Payment Statement',
    subtitle: project.name,
    period: periodLabel(range),
    opening: Money.zero(),
    lines,
    totalReceived: received,
    totalPaid: lines.reduce((a, l) => a.add(l.paid), Money.zero()),
    closing: running,
    currency: project.currency,
    generatedAt: new Date().toISOString(),
    project,
    received,
    remaining: Money.of(project.agreed_amount).sub(received),
  };
}

export async function obligationsReport(adapter: DbAdapter, direction: 'receivable' | 'payable', range: DateRange = {}): Promise<Statement> {
  const [obligations, settlements, parties] = await Promise.all([
    listObligations(adapter, { direction }), listSettlements(adapter), listParties(adapter, true),
  ]);
  const lines: StatementLine[] = [];
  let totalReceived = Money.zero();
  let totalPaid = Money.zero();
  let closing = Money.zero();
  for (const obligation of obligations) {
    const related = settlements.filter((s) => s.obligation_id === obligation.id);
    const outstanding = obligationOutstanding(obligation, related);
    closing = closing.add(outstanding);
    const party = parties.find((p) => p.id === obligation.party_id);
    lines.push({
      txn: {
        id: obligation.id, type: obligation.direction, txn_date: obligation.due_date ?? obligation.created_at.slice(0, 10),
        amount: obligation.total_amount, currency: obligation.currency, exchange_rate: '1', base_amount: obligation.total_amount,
        rate_date: obligation.created_at.slice(0, 10), party_id: obligation.party_id, project_id: obligation.project_id,
        source_account_id: null, destination_account_id: null, category_id: null, obligation_id: obligation.id,
        description: `${party?.name ?? 'Party'} — ${obligation.reference ?? outstanding.toString()}`, reference: obligation.reference,
        reversal_of: null, idempotency_key: '', is_system: 0, created_at: obligation.created_at, updated_at: obligation.updated_at,
      },
      received: direction === 'receivable' ? Money.of(obligation.total_amount).sub(outstanding) : Money.zero(),
      paid: direction === 'payable' ? Money.of(obligation.total_amount).sub(outstanding) : Money.zero(),
      balance: outstanding,
    });
  }
  totalReceived = lines.reduce((a, l) => a.add(l.received), Money.zero());
  totalPaid = lines.reduce((a, l) => a.add(l.paid), Money.zero());
  return {
    title: direction === 'receivable' ? 'Receivables Report' : 'Payables Report',
    subtitle: direction === 'receivable' ? 'Money owed to you' : 'Money you owe',
    period: periodLabel(range),
    opening: Money.zero(),
    lines,
    totalReceived,
    totalPaid,
    closing,
    currency: 'PKR',
    generatedAt: new Date().toISOString(),
  };
}

export function periodLabel(range: DateRange): string {
  if (!range.from && !range.to) return 'All time';
  return `${range.from ?? 'Beginning'} to ${range.to ?? 'Today'}`;
}

export interface SummaryStatement extends Statement {
  income: Money;
  expense: Money;
}

export async function monthlySummary(adapter: DbAdapter, year: number, month: number): Promise<Statement> {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = addDaysDays(new Date(year, month, 0), 0);
  const [journal, transactions] = await Promise.all([getJournal(adapter, from, to), listTransactions(adapter, { from, to, limit: 5000 })]);
  return summaryFromJournal('Monthly Financial Report', `${year}-${String(month).padStart(2, '0')}`, from, to, journal, transactions);
}

export async function yearlySummary(adapter: DbAdapter, year: number): Promise<Statement> {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const [journal, transactions] = await Promise.all([getJournal(adapter, from, to), listTransactions(adapter, { from, to, limit: 5000 })]);
  return summaryFromJournal('Yearly Financial Report', String(year), from, to, journal, transactions);
}

export async function completeSummary(adapter: DbAdapter, range: DateRange = {}): Promise<SummaryStatement> {
  const [journal, transactions] = await Promise.all([getJournal(adapter, range.from, range.to), listTransactions(adapter, { ...range, limit: 5000 })]);
  return summaryFromJournal('Complete Accounts Report', 'All accounts', range.from ?? '', range.to ?? '', journal, transactions);
}

function summaryFromJournal(title: string, subtitle: string, from: string, to: string, journal: JournalRow[], transactions: TransactionRow[]): SummaryStatement {
  const income = totalForType(journal, incomeCode('')).abs();
  const expense = totalForType(journal, expenseCode('')).abs();
  const received = transactions.filter((t) => ['receivable_settlement', 'income'].includes(t.type)).reduce((a, t) => a.add(t.base_amount), Money.zero());
  const paid = transactions.filter((t) => ['payable_settlement', 'expense'].includes(t.type)).reduce((a, t) => a.add(t.base_amount), Money.zero());
  const balance = received.sub(paid);
  const lines: StatementLine[] = transactions.map((txn) => ({
    txn,
    received: Money.of(['income', 'receivable_settlement', 'payable_creation', 'reversal'].includes(txn.type) ? txn.base_amount : 0),
    paid: Money.of(['expense', 'payable_settlement', 'receivable_creation'].includes(txn.type) ? txn.base_amount : 0),
    balance: Money.zero(),
  }));
  let running = Money.zero();
  lines.forEach((line) => { running = running.add(line.received).sub(line.paid); line.balance = running; });
  return {
    title,
    subtitle,
    period: periodLabel({ from: from || undefined, to: to || undefined }),
    opening: Money.zero(),
    lines,
    totalReceived: received,
    totalPaid: paid,
    closing: balance,
    currency: 'PKR',
    generatedAt: new Date().toISOString(),
    income,
    expense,
  };
}

export async function categoryReport(adapter: DbAdapter, kind: 'income' | 'expense', range: DateRange): Promise<Array<{ name: string; amount: Money }>> {
  const [journal, categories] = await Promise.all([
    getJournal(adapter, range.from, range.to),
    listCategories(adapter, kind),
  ]);
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const prefix = kind === 'income' ? incomeCode('') : expenseCode('');
  const totals = new Map<string, Money>();
  for (const entry of journal.filter((e) => e.account_code.startsWith(prefix))) {
    const code = entry.account_code.slice(prefix.length);
    totals.set(code, (totals.get(code) ?? Money.zero()).add(entry.base_amount));
  }
  const result = Array.from(totals, ([id, amount]) => ({ name: names.get(id) ?? id.slice(0, 8), amount: amount.abs() }));
  return result.sort((a, b) => b.amount.toNumber() - a.amount.toNumber());
}

export async function currencyReport(adapter: DbAdapter, range: DateRange = {}): Promise<Array<{ code: string; amount: Money; base: Money }>> {
  const transactions = await listTransactions(adapter, { ...range, limit: 5000 });
  const grouped = new Map<string, { amount: MoneyInput; base: MoneyInput }[]>();
  for (const txn of transactions) {
    grouped.set(txn.currency, [...(grouped.get(txn.currency) ?? []), { amount: txn.amount, base: txn.base_amount }]);
  }
  return Array.from(grouped, ([code, rows]) => ({
    code,
    amount: sumMoney(rows.map((r) => r.amount)),
    base: sumMoney(rows.map((r) => r.base)),
  }));
}

export async function accountStatement(adapter: DbAdapter, accountId: string, range: DateRange = {}): Promise<Statement> {
  const accounts = await listAccounts(adapter, true);
  const account = accounts.find((a) => a.id === accountId);
  if (!account) throw new Error('Account not found');
  const opening = accountBalance(await getJournal(adapter, undefined, range.from ? addDaysDays(new Date(`${range.from}T00:00:00Z`), -1) : undefined), accountCode(account.id));
  let running = opening;
  const transactions = await listTransactions(adapter, { ...range, limit: 5000 });
  const lines: StatementLine[] = transactions
    .filter((txn) => txn.source_account_id === accountId || txn.destination_account_id === accountId)
    .map((txn) => {
      const incoming = txn.destination_account_id === accountId;
      const delta = Money.of(txn.base_amount);
      running = running.add(incoming ? delta : delta.negate());
      return { txn, received: incoming ? delta : Money.zero(), paid: incoming ? Money.zero() : delta, balance: running };
    });
  return {
    title: account.kind === 'bank' ? 'Bank Account Report' : account.kind === 'wallet' ? 'Wallet Report' : 'Cash Account Report',
    subtitle: account.name,
    period: periodLabel(range),
    opening,
    lines,
    totalReceived: lines.reduce((a, l) => a.add(l.received), Money.zero()),
    totalPaid: lines.reduce((a, l) => a.add(l.paid), Money.zero()),
    closing: lines.at(-1)?.balance ?? opening,
    currency: account.currency,
    generatedAt: new Date().toISOString(),
  };
}

export function statementTotals(statement: Statement): { received: Money; paid: Money; closing: Money } {
  return { received: statement.totalReceived, paid: statement.totalPaid, closing: statement.closing };
}

export function statementBalanced(statement: Statement): boolean {
  return statement.opening.add(statement.totalReceived).sub(statement.totalPaid).equals(statement.closing);
}
