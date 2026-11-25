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
  init: () => Promise<void>;
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

export const useAppStore = create<AppState>((set, get) => ({
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

  init: async () => {
    if (get().initializing || get().ready) return;
    set({ initializing: true, error: null });
    try {
      const [theme, language] = await Promise.all([pref('mykhata.theme'), pref('mykhata.language')]);
      const adapter = await createAdapter();
      await initializeDatabase(adapter);
      await seedDefaultCategories(adapter);
      set({ adapter, theme: theme === 'dark' ? 'dark' : 'light', language: language === 'ur' ? 'ur' : 'en' });
      await get().refresh();
      const [status, lastSync] = await Promise.all([
        getSetting(adapter, 'sync_status', 'local'),
        getSetting(adapter, 'last_sync_at', 'Never'),
      ]);
      set({ ready: true, syncStatus: status, lastSync });
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
}));
