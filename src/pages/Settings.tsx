import { useEffect, useState, type ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { Database, Fingerprint, Languages, LockKeyhole, Moon, Save, ShieldCheck, Smartphone, Sun, Monitor } from 'lucide-react';
import { useAppStore, type Language, type Theme } from '../store/useAppStore';
import { getSetting } from '../core/services';
import { currentSchemaVersion } from '../db/adapter';
import { CURRENCIES } from '../core/money';
import { Button, Card, Field, Input, Modal, PageHeader, Select } from '../components/ui';
import { errorMessage } from '../lib/format';
import { validatePin } from '../security/pin';

export default function SettingsPage() {
  const {
    adapter, theme, language, setTheme, setLanguage, notify, parties, accounts, projects, transactions, obligations,
    securityState, lockTimeoutMinutes, baseCurrency, setBaseCurrency, setupLock, changePin, disableLock,
    setBiometric, setLockTimeout, refreshSecurity,
  } = useAppStore();
  const [version, setVersion] = useState(0);
  const [deviceId, setDeviceId] = useState('');
  const [platform, setPlatform] = useState('Browser (development)');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [securityModal, setSecurityModal] = useState<'setup' | 'change' | 'disable' | 'biometric' | null>(null);
  const [securityBusy, setSecurityBusy] = useState(false);
  const [securityError, setSecurityError] = useState('');

  useEffect(() => {
    if (!adapter) return;
    void Promise.all([
      getSetting(adapter, 'device_id', ''),
      currentSchemaVersion(adapter),
    ]).then(([device, schema]) => {
      setDeviceId(device);
      setVersion(schema);
    });
    if (window.electronAPI) setPlatform('Windows · Electron');
    else if (Capacitor.isNativePlatform()) setPlatform(`Android · Capacitor ${Capacitor.getPlatform()}`);
  }, [adapter]);

  const saveCurrency = async () => {
    if (!adapter) return;
    try { await setBaseCurrency(baseCurrency); }
    catch (error) { notify(errorMessage(error), 'error'); }
  };

  const closeSecurity = () => {
    setSecurityModal(null);
    setSecurityError('');
    setPin(''); setConfirmPin(''); setCurrentPin(''); setNewPin('');
    setSecurityBusy(false);
  };

  const runSecurity = async (action: () => Promise<void>) => {
    setSecurityBusy(true);
    setSecurityError('');
    try {
      await action();
      await refreshSecurity();
      closeSecurity();
    } catch (error) {
      setSecurityError(errorMessage(error));
      setSecurityBusy(false);
    }
  };

  const submitSetup = () => {
    const invalid = validatePin(pin);
    if (invalid) return setSecurityError(invalid);
    if (pin !== confirmPin) return setSecurityError('PINs do not match');
    void runSecurity(() => setupLock(pin));
  };

  const submitChange = () => {
    const invalid = validatePin(newPin);
    if (invalid) return setSecurityError(invalid);
    void runSecurity(() => changePin(currentPin, newPin));
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle="Local preferences. No account, no login, no personal data sent anywhere." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Appearance</h2>
          <p className="mt-1 text-xs text-slate-400">Theme and language are stored on this device.</p>
          <div className="mt-4 space-y-4">
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300"><Moon className="h-3.5 w-3.5" /> Theme</p>
              <div className="grid grid-cols-3 gap-2">
                <ChoiceButton active={theme === 'light'} onClick={() => void setTheme('light' as Theme)} icon={<Sun className="h-4 w-4" />} label="Light" />
                <ChoiceButton active={theme === 'dark'} onClick={() => void setTheme('dark' as Theme)} icon={<Moon className="h-4 w-4" />} label="Dark" />
                <div className="flex items-center justify-center gap-1 rounded-lg border border-slate-200 p-2 text-xs text-slate-400 dark:border-navy-700"><Monitor className="h-4 w-4" /> Auto</div>
              </div>
            </div>
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300"><Languages className="h-3.5 w-3.5" /> Language</p>
              <div className="grid grid-cols-2 gap-2">
                <ChoiceButton active={language === 'en'} onClick={() => void setLanguage('en' as Language)} label="English" />
                <ChoiceButton active={language === 'ur'} onClick={() => void setLanguage('ur' as Language)} label="اردو (RTL)" />
              </div>
            </div>
            <Field label="Base reporting currency" hint="All journal entries are posted in this currency using a snapshot rate.">
              <div className="flex gap-2">
                <Select value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)}>
                  {Object.values(CURRENCIES).map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
                </Select>
                <Button variant="outline" onClick={() => void saveCurrency()}><Save className="h-4 w-4" /> Save</Button>
              </div>
            </Field>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Application & database</h2>
          <div className="mt-4 space-y-2 text-sm">
            <InfoRow icon={<Smartphone className="h-4 w-4" />} label="Platform" value={platform} />
            <InfoRow icon={<Database className="h-4 w-4" />} label="Schema version" value={String(version)} />
            <InfoRow icon={<Database className="h-4 w-4" />} label="Parties" value={String(parties.length)} />
            <InfoRow icon={<Database className="h-4 w-4" />} label="Projects" value={String(projects.length)} />
            <InfoRow icon={<Database className="h-4 w-4" />} label="Accounts" value={String(accounts.length)} />
            <InfoRow icon={<Database className="h-4 w-4" />} label="Obligations" value={String(obligations.length)} />
            <InfoRow icon={<Database className="h-4 w-4" />} label="Transactions" value={String(transactions.length)} />
            <InfoRow icon={<ShieldCheck className="h-4 w-4" />} label="Device ID" value={deviceId || 'Not generated'} />
          </div>
          <p className="mt-5 text-xs leading-relaxed text-slate-400">MyKhata works fully offline. Cloud sync is opt-in and only activates when you configure Supabase credentials and explicitly approve an upload on the Backup & Sync page.</p>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100"><LockKeyhole className="h-4 w-4" /> Security &amp; encryption</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Locks the app and encrypts the local SQLite database on desktop and Android. Browser mode only gates the screen; it cannot encrypt IndexedDB.
          </p>
          <div className="mt-4 grid gap-x-6 sm:grid-cols-2">
            <InfoRow icon={<ShieldCheck className="h-4 w-4" />} label="At-rest encryption" value={
              !securityState?.supported ? 'Not available (browser)' : securityState.configured ? 'Enabled on this device' : 'Available, not enabled'
            } />
            <InfoRow icon={<LockKeyhole className="h-4 w-4" />} label="App lock" value={securityState?.configured ? 'Enabled' : 'Disabled'} />
            <InfoRow icon={<Fingerprint className="h-4 w-4" />} label="Biometric unlock" value={
              securityState?.biometricsEnabled ? 'On' : securityState?.biometricsAvailable ? 'Available, off' : 'Not available'
            } />
            <InfoRow icon={<Smartphone className="h-4 w-4" />} label="Platform" value={securityState?.platform ?? ' detecting…'} />
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Field label="Auto-lock after" className="w-40">
              <Select
                value={String(lockTimeoutMinutes)}
                onChange={(event) => void setLockTimeout(Number(event.target.value))}
                disabled={!securityState?.configured}
              >
                {[5, 10, 15, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
              </Select>
            </Field>
            {!securityState?.configured ? (
              <Button onClick={() => setSecurityModal('setup')} disabled={!securityState?.supported}>
                <LockKeyhole className="h-4 w-4" /> Enable app lock
              </Button>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setSecurityModal('change')}><Save className="h-4 w-4" /> Change PIN</Button>
                {securityState.biometricsAvailable && (
                  <Button variant="outline" onClick={() => setSecurityModal('biometric')}>
                    <Fingerprint className="h-4 w-4" /> {securityState.biometricsEnabled ? 'Disable biometrics' : 'Enable biometrics'}
                  </Button>
                )}
                <Button variant="danger" onClick={() => setSecurityModal('disable')}><ShieldCheck className="h-4 w-4" /> Disable lock</Button>
              </div>
            )}
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
            Keep a verified encrypted backup: a forgotten PIN cannot be recovered from the encrypted database. Disabling the lock converts the database back to plaintext and requires your PIN.
          </p>
        </Card>
      </div>

      <Modal open={securityModal === 'setup'} onClose={closeSecurity} title="Enable app lock">
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">Choose a 4–12 digit PIN, or a password of at least 8 characters with letters and numbers. The local database is migrated in place; no records are removed.</p>
          <Field label="New PIN or password"><Input type="password" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value)} /></Field>
          <Field label="Confirm PIN or password"><Input type="password" autoComplete="new-password" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)} /></Field>
          {securityError && <p role="alert" className="text-xs font-medium text-red-600">{securityError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={closeSecurity}>Cancel</Button>
            <Button onClick={submitSetup} loading={securityBusy}>Enable lock</Button>
          </div>
        </div>
      </Modal>

      <Modal open={securityModal === 'change'} onClose={closeSecurity} title="Change PIN">
        <div className="space-y-4">
          <Field label="Current PIN or password"><Input type="password" autoComplete="current-password" value={currentPin} onChange={(e) => setCurrentPin(e.target.value)} /></Field>
          <Field label="New PIN or password"><Input type="password" autoComplete="new-password" value={newPin} onChange={(e) => setNewPin(e.target.value)} /></Field>
          {securityError && <p role="alert" className="text-xs font-medium text-red-600">{securityError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={closeSecurity}>Cancel</Button>
            <Button onClick={submitChange} loading={securityBusy}>Change PIN</Button>
          </div>
        </div>
      </Modal>

      <Modal open={securityModal === 'disable'} onClose={closeSecurity} title="Disable app lock">
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">This converts the encrypted database back to plaintext on this device. Only continue if the device itself is protected.</p>
          <Field label="Current PIN or password"><Input type="password" autoComplete="current-password" value={currentPin} onChange={(e) => setCurrentPin(e.target.value)} /></Field>
          {securityError && <p role="alert" className="text-xs font-medium text-red-600">{securityError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={closeSecurity}>Cancel</Button>
            <Button variant="danger" onClick={() => void runSecurity(() => disableLock(currentPin))} loading={securityBusy}>Disable lock</Button>
          </div>
        </div>
      </Modal>

      <Modal open={securityModal === 'biometric'} onClose={closeSecurity} title="Biometric unlock">
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">Confirm your PIN to {securityState?.biometricsEnabled ? 'disable' : 'enable'} biometric convenience unlock.</p>
          <Field label="Current PIN or password"><Input type="password" autoComplete="current-password" value={currentPin} onChange={(e) => setCurrentPin(e.target.value)} /></Field>
          {securityError && <p role="alert" className="text-xs font-medium text-red-600">{securityError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={closeSecurity}>Cancel</Button>
            <Button onClick={() => void runSecurity(() => setBiometric(!securityState?.biometricsEnabled, currentPin))} loading={securityBusy}>
              {securityState?.biometricsEnabled ? 'Disable' : 'Enable'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ChoiceButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon?: ReactNode; label: string }) {
  return <button onClick={onClick} className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${active ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-navy-700 dark:hover:bg-navy-800'}`}>{icon}{label}</button>;
}

function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 last:border-0 dark:border-navy-800"><span className="flex items-center gap-2 text-slate-500">{icon}{label}</span><span className="font-medium text-slate-800 dark:text-slate-100">{value}</span></div>;
}
