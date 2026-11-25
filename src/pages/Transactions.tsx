import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type Resolver } from 'react-hook-form';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, FileText, Plus, RotateCcw, Search, Undo2 } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { transactionSchema, type TransactionInput } from '../core/schemas';
import { rateForDate, reverseTransaction } from '../core/services';
import type { TransactionRow } from '../core/types';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Table, Toolbar } from '../components/ui';
import { dateLabel, errorMessage, fmt, shortId, today, uniqueIdempotencyKey } from '../lib/format';

const TYPES = ['income', 'expense', 'transfer', 'refund', 'reversal'] as const;
type FormType = typeof TYPES[number];

export default function TransactionsPage({ kind }: { kind?: 'income' | 'expense' }) {
  const { transactions, parties, accounts, projects, categories, createTransaction, adapter, refresh, notify } = useAppStore();
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState(kind ?? 'all');
  const [open, setOpen] = useState(false);
  const [reversing, setReversing] = useState<TransactionRow | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return transactions.filter((t) => {
      if (typeFilter !== 'all' && t.type !== typeFilter) return false;
      if (!needle) return true;
      return [t.description ?? '', t.reference ?? '', t.currency, t.type].some((v) => v.toLowerCase().includes(needle));
    });
  }, [transactions, typeFilter, query]);

  const totals = useMemo(() => visible.reduce((acc, t) => {
    if (['income', 'receivable_settlement'].includes(t.type)) acc.in += Number(t.base_amount);
    if (['expense', 'payable_settlement'].includes(t.type)) acc.out += Number(t.base_amount);
    return acc;
  }, { in: 0, out: 0 }), [visible]);

  return (
    <div>
      <PageHeader
        title={kind === 'income' ? 'Income' : kind === 'expense' ? 'Expenses' : 'Transactions'}
        subtitle="Every posted entry, backed by a balanced double-entry journal."
        actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New transaction</Button>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-xs uppercase tracking-wide text-slate-500">Money in (base)</p><p className="num mt-2 text-xl font-semibold text-emerald-600">{fmt(String(totals.in))}</p></Card>
        <Card className="p-4"><p className="text-xs uppercase tracking-wide text-slate-500">Money out (base)</p><p className="num mt-2 text-xl font-semibold text-red-600">{fmt(String(totals.out))}</p></Card>
        <Card className="p-4"><p className="text-xs uppercase tracking-wide text-slate-500">Posted entries</p><p className="num mt-2 text-xl font-semibold text-slate-900 dark:text-white">{visible.length}</p></Card>
      </div>

      <Card className="overflow-hidden">
        <Toolbar>
          <Select aria-label="Filter type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-auto py-1.5">
            <option value="all">All types</option>
            {Array.from(new Set([...TYPES, ...transactions.map((t) => t.type)])).map((type) => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}
          </Select>
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input aria-label="Search transactions" placeholder="Search descriptions…" className="ps-8" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <span className="ms-auto text-xs text-slate-400">{visible.length} entries</span>
        </Toolbar>
        {visible.length ? (
          <Table headers={['Date', 'Description', 'Type', 'Party / project', 'Original amount', 'Base amount', 'Rate', 'Actions']}>
            {visible.map((txn) => (
              <tr key={txn.id} className="hover:bg-slate-50 dark:hover:bg-navy-800/60">
                <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{dateLabel(txn.txn_date)}</td>
                <td className="px-4 py-2.5">
                  <p className="max-w-56 truncate font-medium text-slate-800 dark:text-slate-100">{txn.description || txn.reference || txn.type.replace(/_/g, ' ')}</p>
                  <p className="text-xs text-slate-400">{shortId(txn.id)}{txn.reversal_of ? ' · reversal' : ''}</p>
                </td>
                <td className="px-4 py-2.5"><Badge tone={txn.type.includes('receivable') || txn.type === 'income' ? 'positive' : txn.type.includes('payable') || txn.type === 'expense' ? 'negative' : txn.type === 'transfer' ? 'info' : 'neutral'}>{txn.type.replace(/_/g, ' ')}</Badge></td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{parties.find((p) => p.id === txn.party_id)?.name ?? projects.find((p) => p.id === txn.project_id)?.name ?? '—'}</td>
                <td className="num whitespace-nowrap px-4 py-2.5">{fmt(txn.amount, txn.currency)}</td>
                <td className="num whitespace-nowrap px-4 py-2.5 font-semibold">{fmt(txn.base_amount)}</td>
                <td className="num px-4 py-2.5 text-xs text-slate-400">{txn.exchange_rate}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1">
                    {!txn.reversal_of && !['reversal', 'refund'].includes(txn.type) && (
                      <button title="Reverse" onClick={() => setReversing(txn)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"><Undo2 className="h-4 w-4" /></button>
                    )}
                    <LinkToStatement id={txn.party_id} />
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        ) : <EmptyState title="No transactions in this view" hint="Post an income, expense, transfer or payment to see it here." action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New transaction</Button>} />}
      </Card>

      <TransactionModal open={open} kind={kind} parties={parties} accounts={accounts} projects={projects} categories={categories} transactions={transactions} onClose={() => setOpen(false)} onSave={createTransaction} />
      <ConfirmDialog
        open={Boolean(reversing)}
        message={`Reverse this ${reversing?.type.replace(/_/g, ' ') ?? ''} of ${reversing ? fmt(reversing.amount, reversing.currency) : ''}? The original entry is preserved and a balanced reversing entry is posted.`}
        onCancel={() => setReversing(null)}
        onConfirm={() => {
          if (!reversing || !adapter) return;
          void reverseTransaction(adapter, reversing.id, `Reversal of ${reversing.description || reversing.type}`).then(() => {
            setReversing(null); void refresh(); notify('Reversal posted');
          }).catch((error) => notify(errorMessage(error), 'error'));
        }}
      />
    </div>
  );
}

function LinkToStatement({ id }: { id: string | null }) {
  if (!id) return <span className="inline-block w-6" />;
  return <a href={`#/statements?party=${id}`} title="Statement" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 dark:hover:bg-navy-800"><FileText className="h-4 w-4" /></a>;
}

function ConfirmDialog({ open, message, onCancel, onConfirm }: { open: boolean; message: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal open={open} onClose={onCancel} title="Confirm reversal">
      <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{message}</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm}>Reverse entry</Button>
      </div>
    </Modal>
  );
}

function TransactionModal({ open, kind, parties, accounts, projects, categories, transactions, onClose, onSave }: {
  open: boolean;
  kind?: 'income' | 'expense';
  parties: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string; kind: string }>;
  transactions: TransactionRow[];
  onClose: () => void;
  onSave: (input: TransactionInput) => Promise<{ duplicate: boolean }>;
}) {
  const { notify, adapter } = useAppStore();
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<FormType>(kind ?? 'income');
  const form = useForm<TransactionInput>({
    resolver: zodResolver(transactionSchema) as unknown as Resolver<TransactionInput>,
    defaultValues: {
      type: kind ?? 'income', date: today(), amount: '', currency: 'PKR', exchangeRate: '1',
      partyId: '', projectId: '', sourceAccountId: '', destinationAccountId: '', categoryId: '',
      obligationId: '', description: '', reference: '', reversalOf: '', allowExcess: false,
    },
  });
  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = form;
  const currency = watch('currency');
  const date = watch('date');

  useEffect(() => {
    if (!open) return;
    const nextType = kind ?? 'income';
    setType(nextType);
    reset({
      type: nextType, date: today(), amount: '', currency: 'PKR', exchangeRate: '1',
      partyId: '', projectId: '', sourceAccountId: '', destinationAccountId: '', categoryId: '',
      obligationId: '', description: '', reference: '', reversalOf: '', allowExcess: false,
    });
  }, [open, kind, reset]);

  useEffect(() => {
    if (!open || !adapter || currency === 'PKR') return;
    void rateForDate(adapter, currency, 'PKR', date).then((rate) => {
      if (rate) setValue('exchangeRate', rate.toString());
    });
  }, [open, adapter, currency, date, setValue]);

  const needsCategory = type === 'income' || type === 'expense' || type === 'refund';
  const needsSource = ['income', 'expense', 'transfer'].includes(type);
  const needsDestination = type === 'transfer';
  const needsOriginal = type === 'refund' || type === 'reversal';

  return (
    <Modal open={open} onClose={onClose} title="New transaction" wide>
      <form onSubmit={handleSubmit(async (values) => {
        setBusy(true);
        try {
          const result = await onSave({ ...values, idempotencyKey: values.idempotencyKey || uniqueIdempotencyKey() });
          onClose();
          if (result.duplicate) notify('This transaction was already posted — duplicate prevented', 'info');
        } catch (error) { notify(errorMessage(error), 'error'); }
        finally { setBusy(false); }
      })} className="space-y-4">
        <Field label="Transaction type">
          <Select value={type} onChange={(e) => {
            const value = e.target.value as FormType;
            setType(value);
            setValue('type', value);
            if (value === 'refund' || value === 'reversal') {
              const original = transactions.find((t) => !t.reversal_of);
              if (original) {
                setValue('reversalOf', original.id);
                setValue('amount', original.amount);
                setValue('currency', original.currency);
                setValue('exchangeRate', original.exchange_rate);
                setValue('categoryId', original.category_id ?? '');
              }
            }
          }}>
            <option value="income">Income received</option>
            <option value="expense">Expense paid</option>
            <option value="transfer">Transfer between accounts</option>
            <option value="refund">Refund (partial or full)</option>
            <option value="reversal">Full reversal</option>
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Date" error={errors.date?.message}><Input type="date" {...register('date')} /></Field>
          <Field label="Amount" error={errors.amount?.message}><Input inputMode="decimal" placeholder="0.00" {...register('amount')} /></Field>
          <Field label="Currency" error={errors.currency?.message}><Input {...register('currency')} /></Field>
          <Field label="Exchange rate to PKR" error={errors.exchangeRate?.message} hint="1 for PKR; snapshot of the rate on the date."><Input inputMode="decimal" {...register('exchangeRate')} /></Field>
        </div>

        {needsSource && (
          <Field label="Source account" error={errors.sourceAccountId?.message} hint="Money leaves this account.">
            <Select {...register('sourceAccountId')}><option value="">Select account</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          </Field>
        )}
        {needsDestination && (
          <Field label="Destination account" error={errors.destinationAccountId?.message}>
            <Select {...register('destinationAccountId')}><option value="">Select account</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          </Field>
        )}
        {needsCategory && (
          <Field label="Category" error={errors.categoryId?.message}>
            <Select {...register('categoryId')}>
              <option value="">Select category</option>
              {categories.filter((c) => type === 'income' ? c.kind === 'income' : c.kind === 'expense').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        )}
        {needsOriginal && (
          <Field label="Original transaction" error={errors.reversalOf?.message} hint="Select the posted entry to reverse. History is never deleted.">
            <Select {...register('reversalOf')}>
              <option value="">Select original entry</option>
              {transactions.filter((t) => !t.reversal_of && !['reversal', 'refund'].includes(t.type)).map((t) => <option key={t.id} value={t.id}>{dateLabel(t.txn_date)} · {t.description || t.type} · {fmt(t.amount, t.currency, false)}</option>)}
            </Select>
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Party (optional)"><Select {...register('partyId')}><option value="">None</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Project (optional)"><Select {...register('projectId')}><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Description"><Input placeholder="What was this for?" {...register('description')} /></Field>
          <Field label="Reference"><Input {...register('reference')} /></Field>
        </div>
        <Field label="Idempotency key (optional)" hint="Reusing a key prevents accidental double posting. A unique key is generated automatically.">
          <Input {...register('idempotencyKey')} placeholder="Auto-generated" />
        </Field>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {type === 'income' && <ArrowUpRight className="h-4 w-4 text-emerald-600" />}
          {type === 'expense' && <ArrowDownLeft className="h-4 w-4 text-red-600" />}
          {type === 'transfer' && <ArrowLeftRight className="h-4 w-4 text-blue-600" />}
          {(type === 'refund' || type === 'reversal') && <RotateCcw className="h-4 w-4 text-amber-600" />}
          <span>Posting creates balanced debit and credit entries. Amounts are stored exactly as entered.</span>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>Post transaction</Button>
        </div>
      </form>
    </Modal>
  );
}
