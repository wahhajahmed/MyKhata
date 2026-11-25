import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type Resolver } from 'react-hook-form';
import { ArrowDownLeft, ArrowUpRight, FileText, Plus, RotateCcw, Search, Wallet } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { obligationSchema, settlementSchema, type ObligationInput, type SettlementInput } from '../core/schemas';
import { listSettlements, reverseTransaction } from '../core/services';
import { isOverdue, obligationOutstanding } from '../core/ledger';
import { Money } from '../core/money';
import type { ObligationRow, SettlementRow, TransactionRow } from '../core/types';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, PageHeader, Select, Table, Textarea, Toolbar } from '../components/ui';
import { dateLabel, errorMessage, fmt, shortId, today } from '../lib/format';

const emptyObligation = (direction: 'receivable' | 'payable', partyId: string, accountId: string, baseCurrency = 'PKR'): ObligationInput => ({
  partyId, accountId, projectId: '', direction, reference: '', totalAmount: '', currency: baseCurrency, dueDate: '', notes: '',
});

export default function ObligationsPage({ mode = 'all' }: { mode?: 'all' | 'receivable' | 'payable' }) {
  const { obligations, parties, projects, accounts, transactions, createObligation, settle, adapter, refresh, notify } = useAppStore();
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState<'all' | 'receivable' | 'payable'>(mode === 'all' ? 'all' : mode);
  const [openNew, setOpenNew] = useState(false);
  const [paying, setPaying] = useState<ObligationRow | null>(null);
  const [reversing, setReversing] = useState<TransactionRow | null>(null);

  useEffect(() => {
    if (!adapter) return;
    void listSettlements(adapter).then(setSettlements).catch(() => setSettlements([]));
  }, [adapter, obligations, transactions]);

  const partyName = (id: string) => parties.find((p) => p.id === id)?.name ?? shortId(id);
  const projectName = (id: string | null) => id ? projects.find((p) => p.id === id)?.name ?? shortId(id) : '—';

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return obligations.filter((o) => {
      if (direction !== 'all' && o.direction !== direction) return false;
      if (!needle) return true;
      return [partyName(o.party_id), o.reference ?? '', projectName(o.project_id)].some((v) => v.toLowerCase().includes(needle));
    });
  }, [obligations, direction, query, parties, projects]);

  const total = visible.reduce((sum, o) => sum.add(obligationOutstanding(o, settlements)), Money.zero());

  return (
    <div>
      <PageHeader
        title={mode === 'receivable' ? 'Receivables' : mode === 'payable' ? 'Payables' : 'Digital Khata'}
        subtitle={mode === 'payable' ? 'Money you owe, with every payment recorded as a posting.' : 'Money owed to you, with installments and complete payment history.'}
        actions={<Button onClick={() => setOpenNew(true)} disabled={!parties.length || !accounts.length}><Plus className="h-4 w-4" /> New {mode === 'payable' ? 'payable' : 'entry'}</Button>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-xs uppercase tracking-wide text-slate-500">Outstanding in view</p><p className="num mt-2 text-xl font-semibold text-slate-900 dark:text-white">{fmt(total)}</p></Card>
        <Card className="p-4"><p className="text-xs uppercase tracking-wide text-slate-500">Receivables</p><p className="num mt-2 text-xl font-semibold text-emerald-600">{fmt(obligations.filter((o) => o.direction === 'receivable').reduce((a, o) => a.add(obligationOutstanding(o, settlements)), Money.zero()))}</p></Card>
        <Card className="p-4"><p className="text-xs uppercase tracking-wide text-slate-500">Payables</p><p className="num mt-2 text-xl font-semibold text-red-600">{fmt(obligations.filter((o) => o.direction === 'payable').reduce((a, o) => a.add(obligationOutstanding(o, settlements)), Money.zero()))}</p></Card>
      </div>

      <Card className="overflow-hidden">
        <Toolbar>
          {mode === 'all' && (
            <Select aria-label="Filter direction" value={direction} onChange={(e) => setDirection(e.target.value as 'all' | 'receivable' | 'payable')} className="w-auto py-1.5">
              <option value="all">All entries</option><option value="receivable">Receivables</option><option value="payable">Payables</option>
            </Select>
          )}
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input aria-label="Search khata" placeholder="Search party, reference or project…" className="ps-8" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <span className="ms-auto text-xs text-slate-400">{visible.length} entries</span>
        </Toolbar>
        {visible.length ? (
          <Table headers={['Party / project', 'Direction', 'Total', 'Settled', 'Outstanding', 'Due date', 'Status', 'Actions']}>
            {visible.map((o) => {
              const outstanding = obligationOutstanding(o, settlements);
              const settled = Number(o.total_amount) - Number(outstanding.toString());
              const overdue = isOverdue(o, today());
              return (
                <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-navy-800/60">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800 dark:text-slate-100">{partyName(o.party_id)}</p>
                    <p className="text-xs text-slate-400">{o.reference || projectName(o.project_id)}</p>
                  </td>
                  <td className="px-4 py-3"><Badge tone={o.direction === 'receivable' ? 'positive' : 'negative'}>{o.direction === 'receivable' ? <ArrowUpRight className="me-1 inline h-3 w-3" /> : <ArrowDownLeft className="me-1 inline h-3 w-3" />}{o.direction}</Badge></td>
                  <td className="num px-4 py-3">{fmt(o.total_amount, o.currency)}</td>
                  <td className="num px-4 py-3 text-emerald-600">{fmt(String(settled), o.currency, false)}</td>
                  <td className="num px-4 py-3 font-semibold">{fmt(outstanding, o.currency)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{dateLabel(o.due_date)}</td>
                  <td className="px-4 py-3"><Badge tone={overdue ? 'negative' : o.status === 'settled' ? 'positive' : o.status === 'overpaid' ? 'warning' : 'info'}>{overdue ? 'overdue' : o.status}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button variant="outline" className="px-2 py-1 text-xs" onClick={() => setPaying(o)}><Wallet className="h-3.5 w-3.5" /> Pay</Button>
                      <Link to={`/statements?party=${o.party_id}`} title="Statement" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 dark:hover:bg-navy-800"><FileText className="h-4 w-4" /></Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>
        ) : <EmptyState title="No khata entries" hint="Create a receivable or payable to start tracking installments." action={<Button onClick={() => setOpenNew(true)}><Plus className="h-4 w-4" /> New entry</Button>} />}
      </Card>

      <div className="mt-4">
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3 dark:border-navy-700">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Payment history</h2>
            <p className="text-xs text-slate-400">Settlements are immutable postings. Use a reversal to correct a mistake.</p>
          </div>
          {transactions.filter((t) => ['receivable_settlement', 'payable_settlement'].includes(t.type)).slice(0, 20).map((txn) => (
            <div key={txn.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 text-sm last:border-0 dark:border-navy-800">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-700 dark:text-slate-200">{txn.description || transactionTypeLabel(txn.type)}</p>
                <p className="text-xs text-slate-400">{dateLabel(txn.txn_date)} · {txn.type.replace(/_/g, ' ')}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="num font-semibold">{fmt(txn.amount, txn.currency)}</span>
                <button title="Reverse payment" onClick={() => setReversing(txn)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"><RotateCcw className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
          {!transactions.some((t) => ['receivable_settlement', 'payable_settlement'].includes(t.type)) && <EmptyState title="No payments recorded" />}
        </Card>
      </div>

      <ObligationModal open={openNew} direction={direction === 'all' ? 'receivable' : direction} parties={parties} accounts={accounts} projects={projects} onClose={() => setOpenNew(false)} onSave={createObligation} />
      <PaymentModal obligation={paying} accounts={accounts} onClose={() => setPaying(null)} onSave={settle} />
      <ConfirmDialog
        open={Boolean(reversing)}
        message={`Reverse payment of ${reversing ? fmt(reversing.amount, reversing.currency) : ''} dated ${dateLabel(reversing?.txn_date)}? The original entry stays in history and a balanced reversing entry is posted.`}
        onCancel={() => setReversing(null)}
        onConfirm={() => {
          if (!reversing) return;
          void reverseTransaction(adapter!, reversing.id, `Reversal of ${reversing.description || transactionTypeLabel(reversing.type)}`).then(() => {
            setReversing(null); void refresh(); notify('Payment reversed');
          }).catch((error) => notify(errorMessage(error), 'error'));
        }}
      />
    </div>
  );
}

function transactionTypeLabel(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function ObligationModal({ open, direction, parties, accounts, projects, onClose, onSave }: {
  open: boolean;
  direction: 'receivable' | 'payable';
  parties: Array<{ id: string; name: string; currency: string }>;
  accounts: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSave: (input: ObligationInput) => Promise<string>;
}) {
  const { notify, baseCurrency } = useAppStore();
  const [busy, setBusy] = useState(false);
  const form = useForm<ObligationInput>({
    resolver: zodResolver(obligationSchema) as unknown as Resolver<ObligationInput>,
    defaultValues: emptyObligation(direction, parties[0]?.id ?? '', accounts[0]?.id ?? '', baseCurrency),
  });
  const { register, handleSubmit, reset, formState: { errors } } = form;
  const [chosenDirection, setChosenDirection] = useState(direction);

  useEffect(() => {
    if (!open) return;
    setChosenDirection(direction);
    reset(emptyObligation(direction, parties[0]?.id ?? '', accounts[0]?.id ?? '', baseCurrency));
  }, [open, direction, parties, accounts, reset, baseCurrency]);

  return (
    <Modal open={open} onClose={onClose} title={chosenDirection === 'payable' ? 'New payable' : 'New receivable'}>
      <form onSubmit={handleSubmit(async (values) => {
        setBusy(true);
        try { await onSave(values); onClose(); }
        catch (error) { notify(errorMessage(error), 'error'); }
        finally { setBusy(false); }
      })} className="space-y-4">
        <Field label="Type">
          <Select value={chosenDirection} onChange={(e) => { const value = e.target.value as 'receivable' | 'payable'; setChosenDirection(value); reset({ ...form.getValues(), direction: value }); }}>
            <option value="receivable">Receivable — they owe me</option>
            <option value="payable">Payable — I owe them</option>
          </Select>
        </Field>
        <input type="hidden" {...register('direction')} value={chosenDirection} />
        <Field label="Person or company" error={errors.partyId?.message}>
          <Select {...register('partyId')}>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        </Field>
        <Field label="Account used" error={errors.accountId?.message} hint="The bank, cash or wallet account this obligation is recorded against.">
          <Select {...register('accountId')}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        </Field>
        <Field label="Project (optional)">
          <Select {...register('projectId')}><option value="">No project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Amount" error={errors.totalAmount?.message}><Input inputMode="decimal" autoFocus placeholder="0.00" {...register('totalAmount')} /></Field>
          <Field label="Currency"><Input {...register('currency')} /></Field>
          <Field label="Due date"><Input type="date" {...register('dueDate')} /></Field>
        </div>
        <Field label="Reference"><Input placeholder="e.g. Invoice #12" {...register('reference')} /></Field>
        <Field label="Notes"><Textarea {...register('notes')} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>Post to ledger</Button>
        </div>
      </form>
    </Modal>
  );
}

function PaymentModal({ obligation, accounts, onClose, onSave }: {
  obligation: ObligationRow | null;
  accounts: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSave: (obligationId: string, amount: string, accountId: string, date: string, description: string, allowExcess: boolean) => Promise<unknown>;
}) {
  const { notify, baseCurrency } = useAppStore();
  const [busy, setBusy] = useState(false);
  const form = useForm<SettlementInput>({
    resolver: zodResolver(settlementSchema) as unknown as Resolver<SettlementInput>,
    defaultValues: { obligationId: '', amount: '', accountId: accounts[0]?.id ?? '', date: today(), description: '', allowExcess: false },
  });
  const { register, handleSubmit, reset, formState: { errors } } = form;

  useEffect(() => {
    if (!obligation) return;
    reset({ obligationId: obligation.id, amount: '', accountId: accounts[0]?.id ?? '', date: today(), description: '', allowExcess: false });
  }, [obligation, accounts, reset]);

  return (
    <Modal open={Boolean(obligation)} onClose={onClose} title={`Record payment · ${obligation?.direction ?? ''}`}>
      <form onSubmit={handleSubmit(async (values) => {
        setBusy(true);
        try { await onSave(values.obligationId, values.amount, values.accountId, values.date, values.description ?? '', values.allowExcess); onClose(); }
        catch (error) { notify(errorMessage(error), 'error'); }
        finally { setBusy(false); }
      })} className="space-y-4">
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-navy-900 dark:text-slate-300">
          Outstanding: <strong className="num">{fmt(obligation?.total_amount ?? '0', obligation?.currency ?? baseCurrency)}</strong> total obligation.
        </p>
        <input type="hidden" {...register('obligationId')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount" error={errors.amount?.message}><Input inputMode="decimal" autoFocus placeholder="0.00" {...register('amount')} /></Field>
          <Field label="Date" error={errors.date?.message}><Input type="date" {...register('date')} /></Field>
        </div>
        <Field label="Account" error={errors.accountId?.message}>
          <Select {...register('accountId')}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        </Field>
        <Field label="Description"><Input placeholder="e.g. Installment 2" {...register('description')} /></Field>
        <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-xs text-slate-600 dark:border-navy-700 dark:text-slate-300">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-emerald-600" {...register('allowExcess')} />
          <span>Allow advance / excess payment. By default a payment larger than the outstanding amount is rejected.</span>
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>Record payment</Button>
        </div>
      </form>
    </Modal>
  );
}
