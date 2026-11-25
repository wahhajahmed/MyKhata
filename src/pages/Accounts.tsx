import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type Resolver } from 'react-hook-form';
import { Banknote, Landmark, Pencil, Plus, Search, Wallet } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { accountSchema, exchangeRateSchema, type AccountInput, type ExchangeRateInput } from '../core/schemas';
import { getJournal, listExchangeRates, saveExchangeRate, setAccountActive } from '../core/services';
import { accountBalance, accountCode } from '../core/ledger';
import { Money } from '../core/money';
import type { AccountRow } from '../core/types';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, PageHeader, Select, Table, Textarea, Toolbar } from '../components/ui';
import { dateLabel, errorMessage, fmt, today } from '../lib/format';

const emptyAccount = (baseCurrency = 'PKR'): AccountInput => ({
  name: '', bankName: '', nickname: '', kind: 'bank', currency: baseCurrency, openingBalance: '0', notes: '',
});

export default function AccountsPage() {
  const { accounts, saveAccount, adapter, refresh, notify, preset, from, to } = useAppStore();
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [toggling, setToggling] = useState<AccountRow | null>(null);

  useEffect(() => {
    if (!adapter) return;
    void getJournal(adapter).then((journal) => {
      const next: Record<string, string> = {};
      for (const account of accounts) next[account.id] = accountBalance(journal, accountCode(account.id)).toString();
      setBalances(next);
    });
  }, [adapter, accounts]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? accounts.filter((a) => [a.name, a.bank_name ?? '', a.nickname ?? ''].some((v) => v.toLowerCase().includes(needle))) : accounts;
  }, [accounts, query]);

  const total = visible.reduce((sum, a) => sum.add(balances[a.id] ?? '0'), Money.zero());
  const rangeQuery = `?from=${from}&to=${to}&preset=${preset}`;

  return (
    <div>
      <PageHeader
        title="Bank Accounts, Cash & Wallets"
        subtitle="Real balances derived from your ledger — never invented sample numbers."
        actions={<Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="h-4 w-4" /> Add account</Button>}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-xs uppercase tracking-wide text-slate-500">Total balance</p><p className="num mt-2 text-xl font-semibold text-slate-900 dark:text-white">{fmt(total)}</p></Card>
        <Card className="p-4"><p className="text-xs uppercase tracking-wide text-slate-500">Bank accounts</p><p className="num mt-2 text-xl font-semibold text-slate-900 dark:text-white">{accounts.filter((a) => a.kind === 'bank').length}</p></Card>
        <Card className="p-4"><p className="text-xs uppercase tracking-wide text-slate-500">Cash & wallets</p><p className="num mt-2 text-xl font-semibold text-slate-900 dark:text-white">{accounts.filter((a) => a.kind !== 'bank').length}</p></Card>
      </div>

      <Card className="overflow-hidden">
        <Toolbar>
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input aria-label="Search accounts" placeholder="Search accounts…" className="ps-8" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <span className="ms-auto text-xs text-slate-400">{visible.length} accounts</span>
        </Toolbar>
        {visible.length ? (
          <Table headers={['Account', 'Kind', 'Institution', 'Opening balance', 'Current balance', 'Currency', 'Actions']}>
            {visible.map((account) => (
              <tr key={account.id} className="hover:bg-slate-50 dark:hover:bg-navy-800/60">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-navy-800">
                      {account.kind === 'bank' ? <Landmark className="h-4 w-4" /> : account.kind === 'cash' ? <Banknote className="h-4 w-4" /> : <Wallet className="h-4 w-4" />}
                    </span>
                    <div><p className="font-medium text-slate-800 dark:text-slate-100">{account.name}</p>{account.nickname && <p className="text-xs text-slate-400">{account.nickname}</p>}</div>
                  </div>
                </td>
                <td className="px-4 py-3"><Badge tone="info">{account.kind}</Badge></td>
                <td className="px-4 py-3 text-sm text-slate-500">{account.bank_name || '—'}</td>
                <td className="num px-4 py-3 text-slate-500">{fmt(account.opening_balance, account.currency, false)}</td>
                <td className="num px-4 py-3 font-semibold">{fmt(balances[account.id] ?? '0', account.currency)}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{account.currency}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <Link to={`/statements?account=${account.id}${rangeQuery}`} className="rounded-lg px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-navy-800">Statement</Link>
                    <button title="Edit" onClick={() => { setEditing(account); setOpen(true); }} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 dark:hover:bg-navy-800"><Pencil className="h-4 w-4" /></button>
                    <button title={account.is_active ? 'Archive' : 'Restore'} onClick={() => setToggling(account)} className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950">{account.is_active ? 'Archive' : 'Restore'}</button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        ) : <EmptyState title="No accounts yet" hint="Add a bank, cash or wallet account to track balances." action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add account</Button>} />}
      </Card>

      <ExchangeRates />

      <AccountModal open={open} account={editing} onClose={() => setOpen(false)} onSave={saveAccount} />
      <ConfirmDialog
        open={Boolean(toggling)}
        message={`${toggling?.is_active ? 'Archive' : 'Restore'} ${toggling?.name ?? 'this account'}? Historical entries remain in the ledger.`}
        onCancel={() => setToggling(null)}
        onConfirm={() => {
          if (!toggling || !adapter) return;
          void setAccountActive(adapter, toggling.id, !toggling.is_active).then(() => {
            setToggling(null); void refresh(); notify(toggling.is_active ? 'Account archived' : 'Account restored');
          }).catch((error) => notify(errorMessage(error), 'error'));
        }}
      />
    </div>
  );
}

function ExchangeRates() {
  const { adapter, notify, baseCurrency } = useAppStore();
  const [rates, setRates] = useState<Array<{ id: string; from_code: string; to_code: string; rate: string; rate_date: string; source: string }>>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState('USD');
  const [to, setTo] = useState(baseCurrency);
  const [date, setDate] = useState(today());

  const load = () => { if (adapter) void listExchangeRates(adapter).then(setRates); };
  useEffect(load, [adapter]);

  const form = useForm<ExchangeRateInput>({
    resolver: zodResolver(exchangeRateSchema) as unknown as Resolver<ExchangeRateInput>,
    defaultValues: { fromCurrency: from, toCurrency: to, rate: '', rateDate: date, source: 'manual' },
  });
  const { setValue } = form;
  useEffect(() => { setTo(baseCurrency); setValue('toCurrency', baseCurrency); }, [baseCurrency, setValue]);

  return (
    <Card className="mt-4 overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-navy-700">
        <div><h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Exchange rates</h2><p className="text-xs text-slate-400">Manual rate snapshots — transactions store their own rate and date.</p></div>
        <Button variant="outline" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Add rate'}</Button>
      </div>
      {open && (
        <form className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-5 dark:border-navy-700" onSubmit={form.handleSubmit(async (values) => {
          if (!adapter) return;
          setBusy(true);
          try { await saveExchangeRate(adapter, values); form.reset({ fromCurrency: from, toCurrency: to, rate: '', rateDate: date, source: 'manual' }); load(); notify('Exchange rate saved'); }
          catch (error) { notify(errorMessage(error), 'error'); }
          finally { setBusy(false); }
        })}>
          <Field label="From"><Input {...form.register('fromCurrency')} onChange={(e) => { setFrom(e.target.value); form.setValue('fromCurrency', e.target.value); }} /></Field>
          <Field label="To"><Input {...form.register('toCurrency')} onChange={(e) => { setTo(e.target.value); form.setValue('toCurrency', e.target.value); }} /></Field>
          <Field label="Rate" error={form.formState.errors.rate?.message}><Input inputMode="decimal" {...form.register('rate')} /></Field>
          <Field label="Date"><Input type="date" {...form.register('rateDate')} onChange={(e) => { setDate(e.target.value); form.setValue('rateDate', e.target.value); }} /></Field>
          <div className="flex items-end"><Button type="submit" loading={busy} className="w-full">Save</Button></div>
        </form>
      )}
      {rates.length ? (
        <Table headers={['From', 'To', 'Rate', 'Date', 'Source']}>
          {rates.slice(0, 20).map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-2 text-sm font-medium">{r.from_code}</td>
              <td className="px-4 py-2 text-sm">{r.to_code}</td>
              <td className="num px-4 py-2 text-sm">{r.rate}</td>
              <td className="px-4 py-2 text-xs text-slate-500">{dateLabel(r.rate_date)}</td>
              <td className="px-4 py-2 text-xs text-slate-400">{r.source}</td>
            </tr>
          ))}
        </Table>
      ) : <p className="p-4 text-xs text-slate-400">No rates saved. {baseCurrency} is always 1:1.</p>}
    </Card>
  );
}

function AccountModal({ open, account, onClose, onSave }: {
  open: boolean;
  account: AccountRow | null;
  onClose: () => void;
  onSave: (input: AccountInput, id?: string) => Promise<string>;
}) {
  const { notify, baseCurrency } = useAppStore();
  const [busy, setBusy] = useState(false);
  const form = useForm<AccountInput>({
    resolver: zodResolver(accountSchema) as unknown as Resolver<AccountInput>,
    defaultValues: emptyAccount(baseCurrency),
  });
  const { register, handleSubmit, reset, formState: { errors } } = form;

  useEffect(() => {
    if (!open) return;
    reset(account ? {
      name: account.name, bankName: account.bank_name ?? '', nickname: account.nickname ?? '',
      kind: account.kind, currency: account.currency, openingBalance: account.opening_balance, notes: account.notes ?? '',
    } : emptyAccount(baseCurrency));
  }, [open, account, reset, baseCurrency]);

  return (
    <Modal open={open} onClose={onClose} title={account ? 'Edit account' : 'Add account'}>
      <form onSubmit={handleSubmit(async (values) => {
        setBusy(true);
        try { await onSave(values, account?.id); onClose(); }
        catch (error) { notify(errorMessage(error), 'error'); }
        finally { setBusy(false); }
      })} className="space-y-4">
        <Field label="Account name" error={errors.name?.message}><Input autoFocus placeholder="e.g. HBL Current Account" {...register('name')} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kind">
            <Select {...register('kind')}><option value="bank">Bank</option><option value="cash">Cash</option><option value="wallet">Wallet</option></Select>
          </Field>
          <Field label="Currency"><Input {...register('currency')} /></Field>
          <Field label="Bank / institution"><Input {...register('bankName')} /></Field>
          <Field label="Nickname"><Input {...register('nickname')} /></Field>
        </div>
        <Field label="Opening balance" error={errors.openingBalance?.message} hint="Posted as a balanced opening adjustment when the account is created.">
          <Input inputMode="decimal" {...register('openingBalance')} />
        </Field>
        <Field label="Notes"><Textarea {...register('notes')} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>{account ? 'Save changes' : 'Add account'}</Button>
        </div>
      </form>
    </Modal>
  );
}
