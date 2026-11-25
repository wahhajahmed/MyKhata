import { useState, type FormEvent } from 'react';
import { AlertCircle, Fingerprint, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { Button, Card, Input } from './ui';

/** Full-screen gate shown before any financial data is rendered. */
export default function LockScreen() {
  const { securityState, unlock, unlockWithBiometric } = useAppStore();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !pin) return;
    setBusy(true);
    setError('');
    try {
      const ok = await unlock(pin);
      if (!ok) setError('Incorrect PIN or password');
      else setPin('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not unlock');
    } finally {
      setBusy(false);
    }
  };

  const biometric = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const ok = await unlockWithBiometric();
      if (!ok) setError('Biometric unlock was cancelled or failed');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Biometric unlock failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-navy-900">
      <Card className="w-full max-w-sm p-6 text-center shadow-lg">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300">
          <LockKeyhole className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">MyKhata is locked</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          Enter your PIN or password to unlock the encrypted local database. Nothing is sent anywhere.
        </p>
        <form onSubmit={(event) => void submit(event)} className="mt-5 space-y-3 text-left">
          <Input
            autoFocus
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            aria-label="PIN or password"
            placeholder="PIN or password"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            disabled={busy}
          />
          {error && (
            <p role="alert" className="flex items-center gap-1.5 text-xs font-medium text-red-600">
              <AlertCircle className="h-3.5 w-3.5" /> {error}
            </p>
          )}
          <Button type="submit" className="w-full" loading={busy} disabled={!pin}>
            <ShieldCheck className="h-4 w-4" /> Unlock
          </Button>
        </form>
        {securityState?.biometricsAvailable && (
          <Button variant="outline" className="mt-3 w-full" onClick={() => void biometric()} disabled={busy}>
            <Fingerprint className="h-4 w-4" /> Unlock with biometrics
          </Button>
        )}
        <p className="mt-5 text-[11px] leading-relaxed text-slate-400">
          Repeated failed attempts slow down further tries. If you forget the PIN, restore from an encrypted backup.
        </p>
      </Card>
    </div>
  );
}
