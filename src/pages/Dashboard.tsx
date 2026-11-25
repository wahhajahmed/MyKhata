import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownRight, ArrowUpRight, Banknote, BriefcaseBusiness, Landmark, Plus, ReceiptText,
  ShieldCheck, TrendingUp, Users, Wallet,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAppStore } from '../store/useAppStore';
import { getDashboard, type DashboardData } from '../core/reports';
import { t } from '../i18n/strings';
import { Badge, Button, Card, EmptyState, PageHeader, StatCard, Table } from '../components/ui';
import { dateLabel, errorMessage, fmt, shortId, transactionLabel } from '../lib/format';

export default function Dashboard() {
  const { adapter, parties, projects, transactions, obligations, preset, from, to, setRange, language, notify, baseCurrency } = useAppStore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [busy, setBusy] = useState(true);

  const range = useMemo(() => ({ from: from || undefined, to: to || undefined }), [from, to]);

  useEffect(() => {
    if (!adapter) return;
    let active = true;
    setBusy(true);
    void getDashboard(adapter, range)
      .then((result) => { if (active) setData(result); })
      .catch((error) => { if (active) notify(errorMessage(error), 'error'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [adapter, range, transactions, obligations, parties, projects, notify]);

  return (
    <div>
      <PageHeader
        title={t(language, 'dashboard')}
        subtitle="A clear, private view of your money — calculated from posted ledger entries."
        actions={<RangeSelector preset={preset} from={from} to={to} onChange={setRange} />}
      />

      {data && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label={t(language, 'totalAssets')} value={fmt(data.totalAssets)} icon={<Landmark className="h-4 w-4" />} />
          <StatCard label={t(language, 'receivablesShort')} value={fmt(data.totalReceivables)} icon={<ArrowUpRight className="h-4 w-4" />} tone="positive" />
          <StatCard label={t(language, 'payablesShort')} value={fmt(data.totalPayables)} icon={<ArrowDownRight className="h-4 w-4" />} tone="negative" />
          <StatCard label={t(language, 'netPosition')} value={fmt(data.netPosition)} icon={<TrendingUp className="h-4 w-4" />} tone="info" />
          <StatCard label={t(language, 'cash')} value={fmt(data.cashBalance, baseCurrency, false)} icon={<Banknote className="h-4 w-4" />} />
          <StatCard label={t(language, 'bank')} value={fmt(data.bankBalance, baseCurrency, false)} icon={<Landmark className="h-4 w-4" />} />
          <StatCard label={t(language, 'wallet')} value={fmt(data.walletBalance, baseCurrency, false)} icon={<Wallet className="h-4 w-4" />} />
          <StatCard label={t(language, 'monthlyIncome')} value={fmt(data.incomeThisMonth, baseCurrency, false)} icon={<Plus className="h-4 w-4" />} tone="positive" hint={`Expenses ${fmt(data.expensesThisMonth, baseCurrency, false)}`} />
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Income vs expenses</h2>
              <p className="text-xs text-slate-400">Last six months, in base currency ({baseCurrency})</p>
            </div>
            <Badge tone={data?.journalIsBalanced ? 'positive' : 'negative'}>
              <ShieldCheck className="me-1 inline h-3 w-3" />{data?.journalIsBalanced ? 'Ledger balanced' : 'Check ledger'}
            </Badge>
          </div>
          <div className="h-64" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.monthlyChart ?? []} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => fmt(String(value), baseCurrency, false)} contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 12 }} />
                <Bar dataKey="income" name="Income" fill="#10B981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expense" name="Expenses" fill="#F97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t(language, 'overdue')}</h2>
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">{(data?.overdueReceivables.length ?? 0) + (data?.overduePayables.length ?? 0)}</span>
          </div>
          <div className="mt-3 space-y-2">
            {[...(data?.overdueReceivables ?? []), ...(data?.overduePayables ?? [])].slice(0, 5).map((item) => (
              <Link key={item.id} to={item.direction === 'receivable' ? '/receivables' : '/payables'} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm hover:bg-slate-50 dark:border-navy-800 dark:hover:bg-navy-800">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-700 dark:text-slate-200">{item.reference || shortId(item.id)}</p>
                  <p className="text-xs text-slate-400">Due {dateLabel(item.due_date)} · {item.direction}</p>
                </div>
                <span className="num shrink-0 text-sm font-semibold text-red-600">{fmt(item.total_amount, item.currency, false)}</span>
              </Link>
            ))}
            {(data?.overdueReceivables.length ?? 0) + (data?.overduePayables.length ?? 0) === 0 && (
              <EmptyState title="Nothing overdue" hint="All obligations are within their due dates." />
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-navy-700">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t(language, 'recentTransactions')}</h2>
            <Link to="/transactions" className="text-xs font-medium text-emerald-600 hover:underline">View all</Link>
          </div>
          {data?.recentTransactions.length ? (
            <Table headers={['Date', 'Description', 'Type', 'Amount', 'Currency']}>
              {data.recentTransactions.map((txn) => (
                <tr key={txn.id} className="hover:bg-slate-50 dark:hover:bg-navy-800/60">
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{dateLabel(txn.txn_date)}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-100"><span className="block max-w-52 truncate">{transactionLabel(txn)}</span></td>
                  <td className="px-4 py-2.5"><Badge tone={txn.type.includes('receivable') ? 'positive' : txn.type.includes('payable') ? 'negative' : 'neutral'}>{txn.type.replace(/_/g, ' ')}</Badge></td>
                  <td className="num whitespace-nowrap px-4 py-2.5 font-semibold">{fmt(txn.amount, txn.currency, false)}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{txn.currency}</td>
                </tr>
              ))}
            </Table>
          ) : <EmptyState title={t(language, 'noData')} hint={t(language, 'noDataHint')} action={<Link to="/transactions"><Button>Add transaction</Button></Link>} />}
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Quick actions</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link to="/khata" className="flex flex-col items-start gap-1 rounded-lg border border-slate-200 p-3 text-xs font-medium hover:border-emerald-400 hover:bg-emerald-50 dark:border-navy-700 dark:hover:bg-navy-800"><ReceiptText className="h-4 w-4 text-emerald-600" />New khata entry</Link>
              <Link to="/parties" className="flex flex-col items-start gap-1 rounded-lg border border-slate-200 p-3 text-xs font-medium hover:border-emerald-400 hover:bg-emerald-50 dark:border-navy-700 dark:hover:bg-navy-800"><Users className="h-4 w-4 text-emerald-600" />Add person / company</Link>
              <Link to="/projects" className="flex flex-col items-start gap-1 rounded-lg border border-slate-200 p-3 text-xs font-medium hover:border-emerald-400 hover:bg-emerald-50 dark:border-navy-700 dark:hover:bg-navy-800"><BriefcaseBusiness className="h-4 w-4 text-emerald-600" />New project</Link>
              <Link to="/statements" className="flex flex-col items-start gap-1 rounded-lg border border-slate-200 p-3 text-xs font-medium hover:border-emerald-400 hover:bg-emerald-50 dark:border-navy-700 dark:hover:bg-navy-800"><ReceiptText className="h-4 w-4 text-emerald-600" />Export PDF</Link>
            </div>
          </Card>
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t(language, 'currencySummary')}</h2>
            <div className="mt-3 space-y-2">
              {(data?.currencySummary ?? []).map((item) => (
                <div key={item.code} className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">{item.code}</span>
                  <span className="num font-semibold">{fmt(item.amount, item.code)}</span>
                </div>
              ))}
              {(data?.currencySummary.length ?? 0) === 0 && <p className="text-xs text-slate-400">No transactions yet.</p>}
            </div>
          </Card>
        </div>
      </div>
      {busy && !data && <p className="mt-6 text-center text-xs text-slate-400">Calculating your balances…</p>}
    </div>
  );
}

const PRESETS = [
  { value: 'today', key: 'today' as const },
  { value: 'week', key: 'week' as const },
  { value: 'month', key: 'month' as const },
  { value: 'last_month', key: 'lastMonth' as const },
  { value: 'year', key: 'year' as const },
  { value: 'all', key: 'all' as const },
];

function RangeSelector({ preset, from, to, onChange }: {
  preset: string;
  from: string;
  to: string;
  onChange: (preset: 'today' | 'week' | 'month' | 'last_month' | 'year' | 'custom' | 'all', from?: string, to?: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PRESETS.map((item) => (
        <button
          key={item.value}
          onClick={() => onChange(item.value as 'today')}
          className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${preset === item.value ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'border-slate-200 text-slate-500 hover:bg-white dark:border-navy-700 dark:hover:bg-navy-800'}`}
        >
          {t('en', item.key)}
        </button>
      ))}
      <input type="date" aria-label="From date" value={from} onChange={(e) => onChange('custom', e.target.value, to)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-navy-700 dark:bg-navy-850" />
      <input type="date" aria-label="To date" value={to} onChange={(e) => onChange('custom', from, e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-navy-700 dark:bg-navy-850" />
    </div>
  );
}
