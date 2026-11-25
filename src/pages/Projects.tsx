import { useEffect, useMemo, useState } from 'react';
import type { SettlementRow } from '../core/types';
import { Link } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type Resolver } from 'react-hook-form';
import { FileText, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { projectSchema, type ProjectInput } from '../core/schemas';
import { archiveProject, listSettlements } from '../core/services';
import type { ProjectRow } from '../core/types';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, PageHeader, Select, Table, Textarea, Toolbar } from '../components/ui';
import { dateLabel, errorMessage, fmt, shortId, today } from '../lib/format';

const emptyProject = (partyId: string, baseCurrency = 'PKR'): ProjectInput => ({
  partyId, name: '', agreedAmount: '', currency: baseCurrency, startDate: today(),
  expectedCompletion: '', dueDate: '', status: 'planning', notes: '',
});

export default function ProjectsPage() {
  const { projects, parties, saveProject, adapter, refresh, notify, obligations } = useAppStore();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectRow | null>(null);
  const [removing, setRemoving] = useState<ProjectRow | null>(null);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);

  useEffect(() => {
    if (!adapter) return;
    void listSettlements(adapter).then(setSettlements).catch(() => setSettlements([]));
  }, [adapter, obligations]);

  const nameOf = (id: string) => parties.find((p) => p.id === id)?.name ?? shortId(id);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? projects.filter((p) => p.name.toLowerCase().includes(needle) || nameOf(p.party_id).toLowerCase().includes(needle)) : projects;
  }, [projects, parties, query]);

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle="Track agreed amounts, deadlines, and payments against each project."
        actions={<Button onClick={() => { setEditing(null); setOpen(true); }} disabled={!parties.length}><Plus className="h-4 w-4" /> New project</Button>}
      />
      <Card className="overflow-hidden">
        <Toolbar>
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input aria-label="Search projects" placeholder="Search projects…" className="ps-8" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <span className="ms-auto text-xs text-slate-400">{visible.length} projects</span>
        </Toolbar>
        {visible.length ? (
          <Table headers={['Project', 'Client', 'Agreed amount', 'Received', 'Remaining', 'Due', 'Status', 'Actions']}>
            {visible.map((project) => {
              const related = obligations.filter((o) => o.project_id === project.id && o.direction === 'receivable');
              const ids = new Set(related.map((o) => o.id));
              const received = settlements
                .filter((s) => ids.has(s.obligation_id))
                .reduce((sum, s) => sum + Number(s.amount), 0);
              const remaining = Number(project.agreed_amount) - received;
              return (
                <tr key={project.id} className="hover:bg-slate-50 dark:hover:bg-navy-800/60">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800 dark:text-slate-100">{project.name}</p>
                    <p className="text-xs text-slate-400">Start {dateLabel(project.start_date)}</p>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{nameOf(project.party_id)}</td>
                  <td className="num px-4 py-3 font-semibold">{fmt(project.agreed_amount, project.currency)}</td>
                  <td className="num px-4 py-3 text-emerald-600">{fmt(String(received), project.currency, false)}</td>
                  <td className="num px-4 py-3 text-amber-600">{fmt(String(remaining), project.currency, false)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{dateLabel(project.due_date ?? project.expected_completion)}</td>
                  <td className="px-4 py-3"><Badge tone={project.status === 'completed' ? 'positive' : project.status === 'on_hold' ? 'warning' : 'info'}>{project.status.replace('_', ' ')}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Link to={`/statements?project=${project.id}`} title="Statement" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 dark:hover:bg-navy-800"><FileText className="h-4 w-4" /></Link>
                      <button title="Edit" onClick={() => { setEditing(project); setOpen(true); }} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 dark:hover:bg-navy-800"><Pencil className="h-4 w-4" /></button>
                      <button title="Archive" onClick={() => setRemoving(project)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>
        ) : <EmptyState title="No projects yet" hint="Create a project once you have at least one person or company." action={<Button onClick={() => setOpen(true)} disabled={!parties.length}><Plus className="h-4 w-4" /> New project</Button>} />}
      </Card>

      <ProjectModal open={open} project={editing} parties={parties} onClose={() => setOpen(false)} onSave={saveProject} />
      <ConfirmDialog
        open={Boolean(removing)}
        message={`Archive ${removing?.name ?? 'this project'}? Its transactions remain in the ledger.`}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing || !adapter) return;
          void archiveProject(adapter, removing.id).then(() => {
            setRemoving(null); void refresh(); notify('Project archived');
          }).catch((error) => notify(errorMessage(error), 'error'));
        }}
      />
    </div>
  );
}

function ProjectModal({ open, project, parties, onClose, onSave }: {
  open: boolean;
  project: ProjectRow | null;
  parties: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSave: (input: ProjectInput, id?: string) => Promise<string>;
}) {
  const { notify, baseCurrency } = useAppStore();
  const [busy, setBusy] = useState(false);
  const form = useForm<ProjectInput>({
    resolver: zodResolver(projectSchema) as unknown as Resolver<ProjectInput>,
    defaultValues: emptyProject(parties[0]?.id ?? '', baseCurrency),
  });
  const { register, handleSubmit, reset, formState: { errors } } = form;

  useEffect(() => {
    if (!open) return;
    reset(project ? {
      partyId: project.party_id, name: project.name, agreedAmount: project.agreed_amount,
      currency: project.currency, startDate: project.start_date,
      expectedCompletion: project.expected_completion ?? '', dueDate: project.due_date ?? '',
      status: project.status as ProjectInput['status'], notes: project.notes ?? '',
    } : emptyProject(parties[0]?.id ?? '', baseCurrency));
  }, [open, project, parties, reset, baseCurrency]);

  return (
    <Modal open={open} onClose={onClose} title={project ? 'Edit project' : 'New project'}>
      <form onSubmit={handleSubmit(async (values) => {
        setBusy(true);
        try { await onSave(values, project?.id); onClose(); }
        catch (error) { notify(errorMessage(error), 'error'); }
        finally { setBusy(false); }
      })} className="space-y-4">
        <Field label="Client" error={errors.partyId?.message}>
          <Select {...register('partyId')}>
            {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Project name" error={errors.name?.message}>
          <Input autoFocus placeholder="e.g. Website redesign" {...register('name')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Agreed amount" error={errors.agreedAmount?.message}>
            <Input inputMode="decimal" {...register('agreedAmount')} />
          </Field>
          <Field label="Currency">
            <Input {...register('currency')} />
          </Field>
          <Field label="Status">
            <Select {...register('status')}>
              <option value="planning">Planning</option><option value="active">Active</option>
              <option value="on_hold">On hold</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Start date" error={errors.startDate?.message}><Input type="date" {...register('startDate')} /></Field>
          <Field label="Expected completion"><Input type="date" {...register('expectedCompletion')} /></Field>
          <Field label="Final due date"><Input type="date" {...register('dueDate')} /></Field>
        </div>
        <Field label="Notes"><Textarea {...register('notes')} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>{project ? 'Save changes' : 'Create project'}</Button>
        </div>
      </form>
    </Modal>
  );
}
