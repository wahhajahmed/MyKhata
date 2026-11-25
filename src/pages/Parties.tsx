import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type Resolver } from 'react-hook-form';
import { Archive, Building2, FileText, Pencil, Plus, Search, User, UserRoundPlus } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { partySchema, type PartyInput } from '../core/schemas';
import { setPartyActive } from '../core/services';
import type { PartyRow } from '../core/types';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, PageHeader, Select, Table, Textarea, Toolbar } from '../components/ui';
import { errorMessage, fmt } from '../lib/format';

const emptyParty: PartyInput = {
  name: '', type: 'individual', phone: '', email: '', address: '', notes: '',
  openingBalance: '0', openingBalanceDirection: 'none', currency: 'PKR',
};

export default function PartiesPage() {
  const { parties, saveParty, adapter, refresh, notify } = useAppStore();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<PartyRow | null>(null);
  const [open, setOpen] = useState(false);
  const [archiving, setArchiving] = useState<PartyRow | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return parties;
    return parties.filter((p) => [p.name, p.phone, p.email, p.address].some((v) => v?.toLowerCase().includes(needle)));
  }, [parties, query]);

  return (
    <div>
      <PageHeader
        title="People & Companies"
        subtitle="Everyone you lend to, borrow from, or work with — one ledger per party."
        actions={<Button onClick={() => { setEditing(null); setOpen(true); }}><UserRoundPlus className="h-4 w-4" /> Add party</Button>}
      />
      <Card className="overflow-hidden">
        <Toolbar>
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input aria-label="Search parties" placeholder="Search name, phone or email…" className="ps-8" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <span className="ms-auto text-xs text-slate-400">{visible.length} of {parties.length} records</span>
        </Toolbar>
        {visible.length ? (
          <Table headers={['Name', 'Type', 'Contact', 'Opening balance', 'Currency', 'Actions']}>
            {visible.map((party) => (
              <tr key={party.id} className="hover:bg-slate-50 dark:hover:bg-navy-800/60">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-navy-800">
                      {party.type === 'company' ? <Building2 className="h-4 w-4" /> : <User className="h-4 w-4" />}
                    </span>
                    <div>
                      <p className="font-medium text-slate-800 dark:text-slate-100">{party.name}</p>
                      {party.notes && <p className="max-w-48 truncate text-xs text-slate-400">{party.notes}</p>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3"><Badge tone={party.type === 'company' ? 'info' : 'neutral'}>{party.type}</Badge></td>
                <td className="px-4 py-3 text-xs text-slate-500">{party.phone || '—'}<br />{party.email || ''}</td>
                <td className="num px-4 py-3 text-sm">{fmt(party.opening_balance, party.currency)}<span className="block text-xs text-slate-400">{party.opening_balance_direction}</span></td>
                <td className="px-4 py-3 text-xs text-slate-500">{party.currency}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <Link to={`/statements?party=${party.id}`} title="Statement" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 dark:hover:bg-navy-800"><FileText className="h-4 w-4" /></Link>
                    <button title="Edit" onClick={() => { setEditing(party); setOpen(true); }} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 dark:hover:bg-navy-800"><Pencil className="h-4 w-4" /></button>
                    <button title="Archive" onClick={() => setArchiving(party)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"><Archive className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        ) : <EmptyState title="No parties yet" hint="Add a person or company to start your digital khata." action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add party</Button>} />}
      </Card>

      <PartyModal open={open} party={editing} onClose={() => setOpen(false)} onSave={saveParty} />
      <ConfirmDialog
        open={Boolean(archiving)}
        message={`Archive ${archiving?.name ?? 'this party'}? Historical transactions stay intact; the party is hidden from new forms.`}
        onCancel={() => setArchiving(null)}
        onConfirm={() => {
          if (!archiving || !adapter) return;
          void setPartyActive(adapter, archiving.id, false).then(() => {
            setArchiving(null);
            void refresh();
            notify('Party archived');
          }).catch((error) => notify(errorMessage(error), 'error'));
        }}
      />
    </div>
  );
}

function PartyModal({ open, party, onClose, onSave }: {
  open: boolean;
  party: PartyRow | null;
  onClose: () => void;
  onSave: (input: PartyInput, id?: string) => Promise<string>;
}) {
  const { notify } = useAppStore();
  const [busy, setBusy] = useState(false);
  const form = useForm<PartyInput>({
    resolver: zodResolver(partySchema) as unknown as Resolver<PartyInput>,
    defaultValues: emptyParty,
  });
  const { register, handleSubmit, reset, formState: { errors } } = form;

  useEffect(() => {
    if (!open) return;
    reset(party ? {
      name: party.name, type: party.type, phone: party.phone ?? '', email: party.email ?? '',
      address: party.address ?? '', notes: party.notes ?? '', openingBalance: party.opening_balance,
      openingBalanceDirection: party.opening_balance_direction, currency: party.currency,
    } : emptyParty);
  }, [open, party, reset]);

  return (
    <Modal open={open} onClose={onClose} title={party ? 'Edit party' : 'Add person or company'}>
      <form onSubmit={handleSubmit(async (values) => {
        setBusy(true);
        try { await onSave(values, party?.id); onClose(); }
        catch (error) { notify(errorMessage(error), 'error'); }
        finally { setBusy(false); }
      })} className="space-y-4">
        <Field label="Name" error={errors.name?.message}>
          <Input autoFocus placeholder="e.g. Hamza Ahmed" {...register('name')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">
            <Select {...register('type')}><option value="individual">Individual</option><option value="company">Company</option></Select>
          </Field>
          <Field label="Currency" error={errors.currency?.message}>
            <Input placeholder="PKR" {...register('currency')} />
          </Field>
          <Field label="Phone" error={errors.phone?.message}>
            <Input placeholder="03xx-xxxxxxx" {...register('phone')} />
          </Field>
          <Field label="Email" error={errors.email?.message}>
            <Input type="email" placeholder="name@example.com" {...register('email')} />
          </Field>
        </div>
        <Field label="Address">
          <Input {...register('address')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Opening balance" error={errors.openingBalance?.message} hint="Posted to the ledger as an opening adjustment.">
            <Input inputMode="decimal" {...register('openingBalance')} />
          </Field>
          <Field label="Balance direction">
            <Select {...register('openingBalanceDirection')}>
              <option value="none">None</option>
              <option value="receivable">They owe me (receivable)</option>
              <option value="payable">I owe them (payable)</option>
            </Select>
          </Field>
        </div>
        <Field label="Notes">
          <Textarea {...register('notes')} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>{party ? 'Save changes' : 'Save party'}</Button>
        </div>
      </form>
    </Modal>
  );
}
