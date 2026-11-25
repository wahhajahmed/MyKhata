import { useEffect, useState, type ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { Database, Languages, Moon, Save, ShieldCheck, Smartphone, Sun, Monitor } from 'lucide-react';
import { useAppStore, type Language, type Theme } from '../store/useAppStore';
import { getSetting, setSetting } from '../core/services';
import { currentSchemaVersion } from '../db/adapter';
import { CURRENCIES } from '../core/money';
import { Button, Card, Field, PageHeader, Select } from '../components/ui';
import { errorMessage } from '../lib/format';

export default function SettingsPage() {
  const { adapter, theme, language, setTheme, setLanguage, notify, parties, accounts, projects, transactions, obligations } = useAppStore();
  const [baseCurrency, setBaseCurrency] = useState('PKR');
  const [version, setVersion] = useState(0);
  const [deviceId, setDeviceId] = useState('');
  const [platform, setPlatform] = useState('Browser (development)');

  useEffect(() => {
    if (!adapter) return;
    void Promise.all([
      getSetting(adapter, 'base_currency', 'PKR'),
      getSetting(adapter, 'device_id', ''),
      currentSchemaVersion(adapter),
    ]).then(([currency, device, schema]) => {
      setBaseCurrency(currency);
      setDeviceId(device);
      setVersion(schema);
    });
    if (window.electronAPI) setPlatform('Windows · Electron');
    else if (Capacitor.isNativePlatform()) setPlatform(`Android · Capacitor ${Capacitor.getPlatform()}`);
  }, [adapter]);

  const saveCurrency = async () => {
    if (!adapter) return;
    try { await setSetting(adapter, 'base_currency', baseCurrency); notify('Base currency saved'); }
    catch (error) { notify(errorMessage(error), 'error'); }
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
      </div>
    </div>
  );
}

function ChoiceButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon?: ReactNode; label: string }) {
  return <button onClick={onClick} className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${active ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-navy-700 dark:hover:bg-navy-800'}`}>{icon}{label}</button>;
}

function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 last:border-0 dark:border-navy-800"><span className="flex items-center gap-2 text-slate-500">{icon}{label}</span><span className="font-medium text-slate-800 dark:text-slate-100">{value}</span></div>;
}
