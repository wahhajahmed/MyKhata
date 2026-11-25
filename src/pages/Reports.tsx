import { useEffect, useState } from 'react';
import { Download, FileBarChart, Loader2 } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import {
  categoryReport, completeSummary, currencyReport, monthlySummary, obligationsReport,
  statementBalanced, yearlySummary, type DateRange, type Statement, type SummaryStatement,
} from '../core/reports';
import { downloadStatementPdf, statementFileName } from '../pdf/statements';
import { Badge, Button, Card, PageHeader } from '../components/ui';
import { dateLabel, errorMessage, fmt } from '../lib/format';

export default function ReportsPage() {
  const { adapter, preset, from, to, notify, baseCurrency } = useAppStore();
  const range: DateRange = { from: from || undefined, to: to || undefined };
  const [summary, setSummary] = useState<SummaryStatement | null>(null);
  const [categories, setCategories] = useState<Array<{ name: string; amount: { toString(): string } }>>([]);
  const [currencies, setCurrencies] = useState<Array<{ code: string; amount: { toString(): string }; base: { toString(): string } }>>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!adapter) return;
    let active = true;
    setBusy(true);
    void Promise.all([
      completeSummary(adapter, range),
      categoryReport(adapter, 'income', range),
      categoryReport(adapter, 'expense', range),
      currencyReport(adapter, range),
    ]).then(([s, income, expense, currency]) => {
      if (!active) return;
      setSummary(s);
      setCategories([...income, ...expense]);
      setCurrencies(currency);
    }).catch((error) => notify(errorMessage(error), 'error')).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [adapter, preset, from, to, notify]);

  const exportSummary = (statement: Statement) => {
    downloadStatementPdf(statement, statementFileName(statement));
    notify('PDF generated from your database', 'success');
  };

  const now = new Date();

  return (
    <div>
      <PageHeader
        title="Financial Reports"
        subtitle={`${dateLabel(range.from)} — ${dateLabel(range.to)} · built entirely from posted ledger data`}
        actions={<span className="text-xs text-slate-400">{busy ? 'Calculating…' : 'Up to date'}</span>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div><h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Complete accounts summary</h2><p className="text-xs text-slate-400">Income, expenses and net movement</p></div>
            {summary && <Badge tone={statementBalanced(summary) ? 'positive' : 'negative'}>{statementBalanced(summary) ? 'Balanced' : 'Needs review'}</Badge>}
          </div>
          {summary && (
            <div className="grid gap-3 sm:grid-cols-4">
              <Metric label="Income" value={fmt(summary.income, baseCurrency)} tone="text-emerald-600" />
              <Metric label="Expenses" value={fmt(summary.expense, baseCurrency)} tone="text-red-600" />
              <Metric label="Net movement" value={fmt(summary.closing, baseCurrency)} tone="text-slate-900 dark:text-white" />
              <Metric label="Transactions" value={String(summary.lines.length)} tone="text-slate-900 dark:text-white" />
            </div>
          )}
          {summary && <div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" onClick={() => exportSummary(summary)}><Download className="h-4 w-4" /> Download PDF</Button></div>}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Currency breakdown</h2>
          <p className="mt-1 text-xs text-slate-400">Original amounts vs base ({baseCurrency}) — never mixed without conversion.</p>
          <div className="mt-3 space-y-2">
            {currencies.map((c) => (
              <div key={c.code} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-navy-900">
                <span className="font-medium">{c.code}</span>
                <span className="num text-xs text-slate-500">{fmt(c.amount.toString(), c.code, false)} → <span className="font-semibold text-slate-800 dark:text-slate-100">{fmt(c.base.toString(), baseCurrency)}</span></span>
              </div>
            ))}
            {!currencies.length && <p className="text-xs text-slate-400">No transactions in this range.</p>}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3 dark:border-navy-700"><h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">By category</h2></div>
          <div className="divide-y divide-slate-100 dark:divide-navy-800">
            {categories.slice(0, 20).map((c, index) => (
              <div key={`${c.name}-${index}`} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-slate-600 dark:text-slate-300">{c.name}</span>
                <span className="num font-semibold">{fmt(c.amount.toString())}</span>
              </div>
            ))}
            {!categories.length && <p className="p-4 text-xs text-slate-400">No categorized activity in this range.</p>}
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Generate report</h2>
          <p className="mt-1 text-xs text-slate-400">PDF files are generated locally on your device. Nothing is uploaded.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <ReportButton label="Monthly summary" onError={notify} onClick={async () => { if (adapter) exportSummary(await monthlySummary(adapter, now.getFullYear(), now.getMonth() + 1)); }} />
            <ReportButton label="Yearly summary" onError={notify} onClick={async () => { if (adapter) exportSummary(await yearlySummary(adapter, now.getFullYear())); }} />
            <ReportButton label="Receivables" onError={notify} onClick={async () => { if (adapter) exportSummary(await obligationsReport(adapter, 'receivable', range)); }} />
            <ReportButton label="Payables" onError={notify} onClick={async () => { if (adapter) exportSummary(await obligationsReport(adapter, 'payable', range)); }} />
            <ReportButton label="All-time accounts" onError={notify} onClick={async () => { if (adapter) exportSummary(await completeSummary(adapter, {})); }} />
            <ReportButton label="Custom range" onError={notify} onClick={async () => { if (adapter) exportSummary(await completeSummary(adapter, range)); }} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className="rounded-lg border border-slate-200 p-3 dark:border-navy-700"><p className="text-xs text-slate-500">{label}</p><p className={`num mt-1.5 text-lg font-semibold ${tone}`}>{value}</p></div>;
}

function ReportButton({ label, onClick, onError }: {
  label: string;
  onClick: () => Promise<void>;
  onError: (message: string, kind?: 'success' | 'error' | 'info') => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="outline" className="justify-start" loading={busy} onClick={() => {
      setBusy(true);
      void onClick().catch((error) => onError(errorMessage(error), 'error')).finally(() => setBusy(false));
    }}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileBarChart className="h-4 w-4" />}{label}
    </Button>
  );
}
