import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { create } from 'zustand';
import {
  listAccounts, listCategories, listObligations, listParties, listProjects, listTransactions,
  initializeDatabase, seedDefaultCategories, setSetting, getSetting,
  type CreateTransactionResult,
} from '../core/services';
import type { AccountInput, CategoryInput, ObligationInput, PartyInput, ProjectInput, TransactionInput } from '../core/schemas';
import type { AccountRow, CategoryRow, ObligationRow, PartyRow, ProjectRow, TransactionRow } from '../core/types';
import type { DbAdapter } from '../db/adapter';
import { CapacitorAdapter } from '../db/capacitorAdapter';
import { ElectronAdapter } from '../db/electronAdapter';
import { createWebAdapter } from '../db/webAdapter';
import type { DateRange, RangePreset } from '../core/reports';
import { resolveRange } from '../core/reports';
import { securityController } from '../security';
import { validatePin } from '../security/pin';
import type { SecurityController, SecurityState } from '../security/types';
import { setDefaultCurrency } from '../lib/format';

export type Language = 'en' | 'ur';
export type Theme = 'light' | 'dark';

export interface Toast {
  id: string;
  kind: 'success' | 'error' | 'info';
  message: string;
}

interface AppState {
  adapter: DbAdapter | null;
  ready: boolean;
  initializing: boolean;
  error: string | null;
  parties: PartyRow[];
  accounts: AccountRow[];
  projects: ProjectRow[];
  categories: CategoryRow[];
  obligations: ObligationRow[];
  transactions: TransactionRow[];
  theme: Theme;
  language: Language;
  preset: RangePreset;
  from: string;
  to: string;
  toasts: Toast[];
  syncStatus: string;
  lastSync: string;
  securityState: SecurityState | null;
  locked: boolean;
  lockTimeoutMinutes: number;
  baseCurrency: string;
  setBaseCurrency: (currency: string) => Promise<void>;
  init: (force?: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  notify: (message: string, kind?: Toast['kind']) => void;
  dismissToast: (id: string) => void;
  setTheme: (theme: Theme) => Promise<void>;
  setLanguage: (language: Language) => Promise<void>;
  setRange: (preset: RangePreset, from?: string, to?: string) => void;
  currentRange: () => DateRange;
  saveParty: (input: PartyInput, id?: string) => Promise<string>;
  saveAccount: (input: AccountInput, id?: string) => Promise<string>;
  saveProject: (input: ProjectInput, id?: string) => Promise<string>;
  saveCategory: (input: CategoryInput, id?: string) => Promise<string>;
  createObligation: (input: ObligationInput) => Promise<string>;
  createTransaction: (input: TransactionInput) => Promise<CreateTransactionResult>;
  settle: (obligationId: string, amount: string, accountId: string, date: string, description: string, allowExcess: boolean) => Promise<CreateTransactionResult>;
  reverse: (id: string) => Promise<CreateTransactionResult>;
  setSyncMeta: (status: string, lastSync: string) => Promise<void>;
  refreshSecurity: () => Promise<void>;
  setupLock: (pin: string) => Promise<void>;
  unlock: (pin: string) => Promise<boolean>;
  unlockWithBiometric: () => Promise<boolean>;
  lock: () => Promise<void>;
  changePin: (currentPin: string, newPin: string) => Promise<void>;
  disableLock: (pin: string) => Promise<void>;
  setBiometric: (enabled: boolean, pin: string) => Promise<void>;
  setLockTimeout: (minutes: number) => Promise<void>;
}

async function pref(key: string): Promise<string | null> {
  if (Capacitor.isNativePlatform()) return (await Preferences.get({ key })).value;
  return localStorage.getItem(key);
}

async function setPref(key: string, value: string): Promise<void> {
  if (Capacitor.isNativePlatform()) await Preferences.set({ key, value });
  else localStorage.setItem(key, value);
}

async function createAdapter(): Promise<DbAdapter> {
  if (window.electronAPI) return new ElectronAdapter();
  if (Capacitor.isNativePlatform()) return CapacitorAdapter.create();
  return createWebAdapter();
}

function currentMonth(): { from: string; to: string } {
  const now = new Date();
  return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, to: now.toISOString().slice(0, 10) };
}

export const useAppStore = create<AppState>((set, get) => {
  let security: SecurityController | null = null;

  const controller = async (): Promise<SecurityController> => {
    if (!security) security = await securityController();
    return security;
  };

  const publishSecurity = async (value: SecurityController): Promise<SecurityState> => {
    const state = await value.state();
    set({ securityState: state });
    return state;
  };

  const openData = async (): Promise<void> => {
    const adapter = await createAdapter();
    await initializeDatabase(adapter);
    await seedDefaultCategories(adapter);
    set({ adapter });
    await get().refresh();
    const [status, lastSync, currency] = await Promise.all([
      getSetting(adapter, 'sync_status', 'local'),
      getSetting(adapter, 'last_sync_at', 'Never'),
      getSetting(adapter, 'base_currency', 'PKR'),
    ]);
    setDefaultCurrency(currency);
    set({ syncStatus: status, lastSync, baseCurrency: currency });
  };

  return {
    adapter: null,
    ready: false,
    initializing: false,
    error: null,
    parties: [],
    accounts: [],
    projects: [],
    categories: [],
    obligations: [],
    transactions: [],
    theme: 'light',
    language: 'en',
    preset: 'month',
    ...currentMonth(),
    toasts: [],
    syncStatus: 'local',
    lastSync: 'Never',
    securityState: null,
    locked: false,
    lockTimeoutMinutes: 15,
    baseCurrency: 'PKR',

    init: async (force = false) => {
      if ((get().initializing || get().ready) && !force) return;
      set({ initializing: true, error: null });
      try {
        const [theme, language, timeout] = await Promise.all([
          pref('mykhata.theme'), pref('mykhata.language'), pref('mykhata.lockTimeoutMinutes'),
        ]);
        const state = await publishSecurity(await controller());
        const minutes = Number(timeout ?? 15);
        set({
          theme: theme === 'dark' ? 'dark' : 'light',
          language: language === 'ur' ? 'ur' : 'en',
          lockTimeoutMinutes: Number.isFinite(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : 15,
          locked: state.configured && !state.unlocked,
        });
        if (state.configured && !state.unlocked) {
          // The database is not opened at all until the user unlocks it.
          set({ ready: true });
          return;
        }
        await openData();
        set({ ready: true });
      } catch (error) {
        set({ error: error instanceof Error ? error.message : 'Failed to initialize database', initializing: false });
      } finally {
        set({ initializing: false });
      }
    },

    refresh: async () => {
      const adapter = get().adapter;
      if (!adapter) return;
      try {
        const [parties, accounts, projects, categories, obligations, transactions] = await Promise.all([
          listParties(adapter), listAccounts(adapter), listProjects(adapter), listCategories(adapter),
          listObligations(adapter), listTransactions(adapter, { limit: 5000 }),
        ]);
        set({ parties, accounts, projects, categories, obligations, transactions });
      } catch (error) {
        get().notify(error instanceof Error ? error.message : 'Could not refresh data', 'error');
      }
    },

    notify: (message, kind = 'success') => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      set((state) => ({ toasts: [...state.toasts, { id, kind, message }] }));
      setTimeout(() => get().dismissToast(id), 4500);
    },

    dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

    setTheme: async (theme) => {
      await setPref('mykhata.theme', theme);
      set({ theme });
    },

    setLanguage: async (language) => {
      await setPref('mykhata.language', language);
      set({ language });
    },

    setRange: (preset, from, to) => {
      const resolved = resolveRange(preset, from, to);
      set({ preset, from: resolved.from ?? '', to: resolved.to ?? '' });
    },

    currentRange: () => {
      const { preset, from, to } = get();
      return resolveRange(preset, from, to);
    },

    setBaseCurrency: async (currency) => {
      const adapter = get().adapter;
      if (!adapter) return;
      await setSetting(adapter, 'base_currency', currency);
      setDefaultCurrency(currency);
      set({ baseCurrency: currency });
      get().notify('Base currency saved');
    },

    saveParty: async (input, id) => {
      const { saveParty } = await import('../core/services');
      const result = await saveParty(get().adapter!, input, id);
      await get().refresh();
      get().notify(id ? 'Party updated' : 'Party saved');
      return result;
    },

    saveAccount: async (input, id) => {
      const { saveAccount } = await import('../core/services');
      const result = await saveAccount(get().adapter!, input, id);
      await get().refresh();
      get().notify(id ? 'Account updated' : 'Account saved');
      return result;
    },

    saveProject: async (input, id) => {
      const { saveProject } = await import('../core/services');
      const result = await saveProject(get().adapter!, input, id);
      await get().refresh();
      get().notify(id ? 'Project updated' : 'Project saved');
      return result;
    },

    saveCategory: async (input, id) => {
      const { saveCategory } = await import('../core/services');
      const result = await saveCategory(get().adapter!, id ? { ...input } : input, id);
      await get().refresh();
      get().notify('Category saved');
      return result;
    },

    createObligation: async (input) => {
      const { createObligation } = await import('../core/services');
      const result = await createObligation(get().adapter!, input);
      await get().refresh();
      get().notify('Obligation created and posted to ledger');
      return result;
    },

    createTransaction: async (input) => {
      const { createTransaction } = await import('../core/services');
      const result = await createTransaction(get().adapter!, input);
      await get().refresh();
      get().notify(result.duplicate ? 'Duplicate prevented — transaction already exists' : 'Transaction posted');
      return result;
    },

    settle: async (obligationId, amount, accountId, date, description, allowExcess) => {
      const { settleObligation } = await import('../core/services');
      const result = await settleObligation(get().adapter!, { obligationId, amount, accountId, date, description, allowExcess });
      await get().refresh();
      get().notify('Payment recorded');
      return result;
    },

    reverse: async (id) => {
      const { reverseTransaction } = await import('../core/services');
      const result = await reverseTransaction(get().adapter!, id);
      await get().refresh();
      get().notify('Reversal posted — original entry preserved');
      return result;
    },

    setSyncMeta: async (status, lastSync) => {
      const adapter = get().adapter;
      if (adapter) await setSetting(adapter, 'sync_status', status);
      set({ syncStatus: status, lastSync });
    },

    refreshSecurity: async () => {
      await publishSecurity(await controller());
    },

    setupLock: async (pin) => {
      const invalid = validatePin(pin);
      if (invalid) throw new Error(invalid);
      const value = await controller();
      await value.setup(pin);
      const state = await publishSecurity(value);
      set({ adapter: null, ready: false, locked: false });
      await get().init(true);
      get().notify(state.platform === 'web'
        ? 'App lock enabled (browser UI only; IndexedDB is not encrypted)'
        : 'App lock enabled and local database encrypted');
    },

    unlock: async (pin) => {
      const value = await controller();
      const ok = await value.unlock(pin);
      const state = await publishSecurity(value);
      set({ locked: !state.unlocked });
      if (state.unlocked && !get().adapter) await openData();
      return ok;
    },

    unlockWithBiometric: async () => {
      const value = await controller();
      const ok = await value.unlockWithBiometric();
      const state = await publishSecurity(value);
      set({ locked: !state.unlocked });
      if (state.unlocked && !get().adapter) await openData();
      return ok;
    },

    lock: async () => {
      const value = await controller();
      await value.lock();
      await publishSecurity(value);
      set({
        locked: true,
        adapter: null,
        parties: [], accounts: [], projects: [], categories: [], obligations: [], transactions: [],
      });
    },

    changePin: async (currentPin, newPin) => {
      const invalid = validatePin(newPin);
      if (invalid) throw new Error(invalid);
      const value = await controller();
      await value.changePin(currentPin, newPin);
      await publishSecurity(value);
      get().notify('PIN changed');
    },

    disableLock: async (pin) => {
      const value = await controller();
      await value.disable(pin);
      await publishSecurity(value);
      set({ adapter: null, ready: false, locked: false });
      await get().init(true);
      get().notify('App lock disabled');
    },

    setBiometric: async (enabled, pin) => {
      const value = await controller();
      await value.setBiometric(enabled, pin);
      await publishSecurity(value);
      get().notify(enabled ? 'Biometric unlock enabled' : 'Biometric unlock disabled');
    },

    setLockTimeout: async (minutes) => {
      const value = Number(minutes);
      const safe = Number.isFinite(value) && value >= 1 && value <= 1440 ? value : 15;
      await setPref('mykhata.lockTimeoutMinutes', String(safe));
      set({ lockTimeoutMinutes: safe });
    },
  };
});
