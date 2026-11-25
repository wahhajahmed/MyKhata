import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Download, FileText, Share2 } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { buildStatement, downloadStatementPdf, statementFileName, type StatementKind } from '../pdf/statements';
import { exportAndSharePdf } from '../pdf/share';
import type { DateRange } from '../core/reports';
import type { Statement } from '../core/reports';
import { Badge, Button, Card, EmptyState, Field, PageHeader, Select, Table } from '../components/ui';
import { dateLabel, errorMessage, fmt } from '../lib/format';

const KINDS: Array<{ value: StatementKind; label: string; needsId?: 'party' | 'project' | 'account' }> = [
  { value: 'person', label: 'Person statement', needsId: 'party' },
  { value: 'company', label: 'Company statement', needsId: 'party' },
  { value: 'project', label: 'Project statement', needsId: 'project' },
  { value: 'receivables', label: 'Receivables report' },
  { value: 'payables', label: 'Payables report' },
  { value: 'monthly', label: 'Monthly report' },
  { value: 'yearly', label: 'Yearly report' },
  { value: 'complete', label: 'Complete accounts' },
  { value: 'account', label: 'Bank / cash statement', needsId: 'account' },
];

export default function StatementsPage() {
  const { adapter, parties, projects, accounts, preset, from, to, notify } = useAppStore();
  const [params] = useSearchParams();
  const [kind, setKind] = useState<StatementKind>('person');
  const [entityId, setEntityId] = useState('');
  const [statement, setStatement] = useState<Statement | null>(null);
  const [busy, setBusy] = useState(false);
  const range: DateRange = { from: from || undefined, to: to || undefined };

  useEffect(() => {
    const party = params.get('party');
    const project = params.get('project');
    const account = params.get('account');
    if (party) { setKind('person'); setEntityId(party); }
    else if (project) { setKind('project'); setEntityId(project); }
    else if (account) { setKind('account'); setEntityId(account); }
  }, [params]);

  const selected = KINDS.find((k) => k.value === kind);
  const choices = selected?.needsId === 'party'
    ? parties.filter((p) => kind === 'company' ? p.type === 'company' : p.type === 'individual').map((p) => ({ id: p.id, name: p.name }))
    : selected?.needsId === 'project' ? projects.map((p) => ({ id: p.id, name: p.name }))
      : selected?.needsId === 'account' ? accounts.map((a) => ({ id: a.id, name: a.name })) : [];

  useEffect(() => {
    if (choices.length && !choices.some((c) => c.id === entityId)) setEntityId(choices[0]!.id);
  }, [choices, entityId]);

  useEffect(() => {
    setStatement(null);
  }, [kind, entityId, preset, from, to]);

  const build = async () => {
    if (!adapter) return null;
    setBusy(true);
    try {
      const result = await buildStatement(adapter, kind, {
        id: selected?.needsId ? entityId : undefined,
        range,
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 1,
      });
      setStatement(result);
      return result;
    } catch (error) {
      notify(errorMessage(error), 'error');
      return null;
    } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title="PDF Statements" subtitle="Professional statements generated locally from real, posted entries." />

      <Card className="p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Report type">
            <Select value={kind} onChange={(e) => { setKind(e.target.value as StatementKind); setEntityId(''); }}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </Select>
          </Field>
          {selected?.needsId && (
            <Field label="Select record">
              <Select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
                <option value="">Choose…</option>
                {choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="From date"><input type="date" value={from} readOnly className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-navy-700 dark:bg-navy-900 dark:text-white" /></Field>
          <Field label="To date"><input type="date" value={to} readOnly className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-navy-700 dark:bg-navy-900 dark:text-white" /></Field>
        </div>
        <p className="mt-3 text-xs text-slate-400">Change the reporting period on the Dashboard using the date filters.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void build()} loading={busy} disabled={Boolean(selected?.needsId && !entityId)}><FileText className="h-4 w-4" /> Generate preview</Button>
          {statement && <>
            <Button variant="outline" onClick={() => { downloadStatementPdf(statement, statementFileName(statement)); notify('PDF downloaded'); }}><Download className="h-4 w-4" /> Download PDF</Button>
            {Capacitor.isNativePlatform() && <Button variant="outline" onClick={() => void exportAndSharePdf(statement).then(() => notify('Ready to share')).catch((error) => notify(errorMessage(error), 'error'))}><Share2 className="h-4 w-4" /> Share</Button>}
          </>}
        </div>
      </Card>

      {statement && (
        <Card className="mt-4 overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-navy-700">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{statement.title}</h2>
              <p className="text-sm text-slate-500">{statement.subtitle} · {statement.period}</p>
            </div>
            <div className="text-end">
              <Badge tone="info">{statement.currency}</Badge>
              <p className="mt-2 text-xs text-slate-400">Generated {dateLabel(statement.generatedAt)}</p>
            </div>
          </div>
          <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-4 dark:border-navy-700">
            <div><p className="text-xs text-slate-500">Opening balance</p><p className="num font-semibold">{fmt(statement.opening, statement.currency)}</p></div>
            <div><p className="text-xs text-slate-500">Total received</p><p className="num font-semibold text-emerald-600">{fmt(statement.totalReceived, statement.currency)}</p></div>
            <div><p className="text-xs text-slate-500">Total paid</p><p className="num font-semibold text-red-600">{fmt(statement.totalPaid, statement.currency)}</p></div>
            <div><p className="text-xs text-slate-500">Closing balance</p><p className="num font-semibold">{fmt(statement.closing, statement.currency)}</p></div>
          </div>
          {statement.lines.length ? (
            <Table headers={['Date', 'Type', 'Description', 'Received', 'Paid', 'Balance']}>
              {statement.lines.slice(0, 100).map((line, index) => (
                <tr key={`${line.txn.id}-${index}`} className="hover:bg-slate-50 dark:hover:bg-navy-800/60">
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">{dateLabel(line.txn.txn_date)}</td>
                  <td className="px-4 py-2.5 text-xs capitalize">{line.txn.type.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-2.5 text-sm">{line.txn.description || line.txn.reference || line.txn.id.slice(0, 8)}</td>
                  <td className="num px-4 py-2.5 text-sm text-emerald-600">{line.received.isPositive() ? fmt(line.received, statement.currency, false) : '—'}</td>
                  <td className="num px-4 py-2.5 text-sm text-red-600">{line.paid.isPositive() ? fmt(line.paid, statement.currency, false) : '—'}</td>
                  <td className="num px-4 py-2.5 text-sm font-semibold">{fmt(line.balance, statement.currency, false)}</td>
                </tr>
              ))}
            </Table>
          ) : <EmptyState title="No rows in this statement" hint="The selected period has no posted entries for this record." />}
        </Card>
      )}
    </div>
  );
}
