import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Cloud, Database, Download, FileLock2, HardDriveDownload, RefreshCw, ShieldCheck, Upload, XCircle } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { dumpDatabase } from '../db/adapter';
import { createEncryptedBackup, restoreEncryptedBackup, verifyEncryptedBackup } from '../backup/encryptedBackup';
import { syncConfigFromEnv, SupabaseSync, type RemoteChange } from '../sync/supabase';
import { Badge, Button, Card, ConfirmDialog, Field, Input, PageHeader } from '../components/ui';
import { downloadBlob, errorMessage, today } from '../lib/format';

export default function BackupPage() {
  const { adapter, refresh, notify, syncStatus, lastSync, setSyncMeta } = useAppStore();
  const [passphrase, setPassphrase] = useState('');
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [pendingFile, setPendingFile] = useState<{ bytes: Uint8Array; name: string } | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [verification, setVerification] = useState<{ ok: boolean; reason: string } | null>(null);
  const [busy, setBusy] = useState<'backup' | 'restore' | 'sync' | null>(null);
  const [consent, setConsent] = useState(false);
  const [syncResult, setSyncResult] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);
  const syncConfig = syncConfigFromEnv();
  const isBusy = busy !== null;

  // Re-verify whenever the selected file or its passphrase changes, so the badge
  // always describes the passphrase that would actually be used for restore.
  useEffect(() => {
    if (!pendingFile) { setVerification(null); return; }
    if (restorePassphrase.length < 8) {
      setVerification({ ok: false, reason: 'Enter at least 8 characters to verify this backup' });
      return;
    }
    let cancelled = false;
    void verifyEncryptedBackup(pendingFile.bytes, restorePassphrase).then((result) => {
      if (cancelled) return;
      setVerification(result.ok ? { ok: true, reason: 'Backup file verified' } : { ok: false, reason: result.reason });
    });
    return () => { cancelled = true; };
  }, [pendingFile, restorePassphrase]);

  const doBackup = async () => {
    if (!adapter) return;
    setBusy('backup');
    try {
      const backup = await createEncryptedBackup(adapter, passphrase);
      const bytes = new TextEncoder().encode(JSON.stringify(backup));
      downloadBlob(bytes, `mykhata-backup-${today()}.mykhata`, 'application/json');
      notify('Encrypted backup downloaded — keep your passphrase safe');
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { setBusy(null); }
  };

  const doPlainDump = async () => {
    if (!adapter) return;
    setBusy('backup');
    try {
      const dump = await dumpDatabase(adapter);
      downloadBlob(new TextEncoder().encode(JSON.stringify(dump, null, 2)), `mykhata-sql-dump-${today()}.json`, 'application/json');
      notify('SQL dump downloaded (unencrypted)');
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { setBusy(null); }
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    setVerification(null);
    setPendingFile({ bytes, name: file.name });
  };

  const doRestore = async () => {
    if (!adapter || !pendingFile) return;
    setBusy('restore');
    try {
      await restoreEncryptedBackup(adapter, pendingFile.bytes, restorePassphrase);
      setPendingFile(null);
      await refresh();
      notify('Backup restored successfully');
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { setBusy(null); }
  };

  const doSync = async () => {
    if (!adapter || !syncConfig || !consent) return;
    setBusy('sync');
    try {
      const sync = new SupabaseSync(adapter, syncConfig);
      const result = await sync.sync(async (_change: RemoteChange) => {
        // Remote financial changes are deliberately not auto-applied.
        // They are reported for review so posted history is never silently overwritten.
        return 'conflict' as const;
      });
      const at = new Date().toLocaleString();
      await setSyncMeta(result.conflicts.length ? 'conflict' : 'ok', at);
      setSyncResult(`Pushed ${result.pushed} change(s), pulled ${result.pulled}, ${result.conflicts.length} conflict(s) require review.`);
      notify('Sync cycle completed');
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { setBusy(null); }
  };

  return (
    <div>
      <PageHeader title="Backup, Restore & Sync" subtitle="Your financial data stays on this device unless you explicitly export or sync it." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center gap-2"><span className="rounded-lg bg-emerald-50 p-2 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"><FileLock2 className="h-5 w-5" /></span><div><h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Encrypted backup</h2><p className="text-xs text-slate-400">AES-256-GCM · PBKDF2-SHA256 (310,000 iterations)</p></div></div>
          <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">Exports a complete logical SQL dump encrypted with your passphrase. The passphrase is never stored, sent anywhere, or recoverable — losing it means losing the backup.</p>
          <Field label="Backup passphrase (minimum 8 characters)" className="mt-4">
            <Input type="password" autoComplete="new-password" value={passphrase} disabled={isBusy} onChange={(e) => setPassphrase(e.target.value)} placeholder="Choose a strong passphrase" />
          </Field>
          <div className="mt-4 flex items-center gap-2"><Button onClick={() => void doBackup()} loading={busy === 'backup'} disabled={isBusy || passphrase.length < 8}><Download className="h-4 w-4" /> Create encrypted backup</Button><Badge tone="positive"><ShieldCheck className="me-1 inline h-3 w-3" />Offline</Badge></div>
          <div className="mt-5 border-t border-slate-200 pt-4 dark:border-navy-700">
            <Button variant="outline" onClick={() => void doPlainDump()} loading={busy === 'backup'} disabled={isBusy}><HardDriveDownload className="h-4 w-4" /> Download plain SQL dump</Button>
            <p className="mt-2 text-xs text-slate-400">For advanced use only. This file is not encrypted — store it securely.</p>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2"><span className="rounded-lg bg-blue-50 p-2 text-blue-700 dark:bg-blue-950 dark:text-blue-300"><Upload className="h-5 w-5" /></span><div><h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Restore from backup</h2><p className="text-xs text-slate-400">Replaces all current data after confirmation</p></div></div>
          <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">Select a MyKhata encrypted backup, enter its passphrase, then confirm. The restore happens in one atomic batch: either everything is restored or nothing changes.</p>
          <Field label="Backup passphrase" className="mt-4"><Input type="password" autoComplete="off" value={restorePassphrase} disabled={isBusy} onChange={(e) => setRestorePassphrase(e.target.value)} placeholder="Passphrase from export" /></Field>
          <input ref={fileRef} type="file" accept=".mykhata,.json,application/json" className="hidden" disabled={isBusy} onChange={(e) => void pickFile(e.target.files?.[0])} />
          <Button variant="outline" className="mt-4" onClick={() => fileRef.current?.click()} disabled={isBusy}><Database className="h-4 w-4" /> Choose backup file</Button>
          {pendingFile && (
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-navy-900">
              <p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" />Selected: {pendingFile.name}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {verification
                  ? <Badge tone={verification.ok ? 'positive' : 'negative'}>{verification.ok ? 'Verified' : 'Incorrect'}</Badge>
                  : <Badge tone="neutral">Not verified</Badge>}
                {verification && <span role={verification.ok ? undefined : 'alert'} className={verification.ok ? 'text-xs text-slate-500' : 'text-xs font-medium text-red-600'}>{verification.reason}</span>}
              </div>
            </div>
          )}
          <div className="mt-4"><Button variant="danger" onClick={() => setConfirmRestore(true)} disabled={isBusy || !pendingFile || restorePassphrase.length < 8}><Upload className="h-4 w-4" /> Restore backup</Button></div>
        </Card>
      </div>

      <Card className="mt-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2"><span className="rounded-lg bg-slate-100 p-2 text-slate-600 dark:bg-navy-800 dark:text-slate-300"><Cloud className="h-5 w-5" /></span><div><h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Optional cloud sync</h2><p className="text-xs text-slate-400">Disabled until you configure Supabase credentials explicitly</p></div></div>
          <Badge tone={syncConfig ? 'info' : 'neutral'}>{syncConfig ? 'Configured' : 'Not configured'}</Badge>
        </div>
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">Sync uses your own Supabase project and an anonymous key from <code className="rounded bg-slate-100 px-1 dark:bg-navy-800">.env</code>. It uploads only queued change records containing party names, contact details and notes; account names, bank names and notes; amounts; descriptions; and record ids. Nothing is uploaded without your explicit approval below.</p>
        <label className="mt-4 flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-navy-700">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-emerald-600" checked={consent} disabled={isBusy} onChange={(e) => setConsent(e.target.checked)} />
          <span>I explicitly approve uploading my local change queue (party names/contact details/notes, account names/bank names/notes, amounts, descriptions and ids) to my configured Supabase project.</span>
        </label>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => void doSync()} disabled={isBusy || !syncConfig || !consent} loading={busy === 'sync'}><RefreshCw className="h-4 w-4" /> Sync now</Button>
          <span className="text-xs text-slate-400">Status: <span className="capitalize">{syncStatus}</span> · Last sync: {lastSync}</span>
        </div>
        {syncResult && <p className="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-800 dark:bg-blue-950 dark:text-blue-200">{syncResult}</p>}
        <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-600"><XCircle className="h-3.5 w-3.5" />Conflicting financial edits are never applied automatically; they are reported for manual review.</p>
      </Card>

      <ConfirmDialog
        open={confirmRestore && Boolean(pendingFile)}
        message={`Restore ${pendingFile?.name ?? 'this backup'}? This replaces every current record, obligation and transaction. This cannot be undone except by restoring another backup.`}
        loading={busy === 'restore'}
        onCancel={() => setConfirmRestore(false)}
        onConfirm={() => { setConfirmRestore(false); void doRestore(); }}
      />
    </div>
  );
}
