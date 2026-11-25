import { useEffect, useState, type ComponentType } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import {
  ArrowLeftRight, BookCopy, Cloud, DatabaseBackup, FileText, HandCoins, Landmark,
  LayoutDashboard, Menu, Moon, ReceiptText, Settings, Sun, Users, X, Languages, RefreshCw, ShieldCheck,
} from 'lucide-react';
import { useAppStore } from './store/useAppStore';
import { t, type StringKey } from './i18n/strings';
import { Button, Spinner, ToastHost } from './components/ui';
import Dashboard from './pages/Dashboard';
import PartiesPage from './pages/Parties';
import ProjectsPage from './pages/Projects';
import ObligationsPage from './pages/Obligations';
import TransactionsPage from './pages/Transactions';
import AccountsPage from './pages/Accounts';
import ReportsPage from './pages/Reports';
import StatementsPage from './pages/Statements';
import BackupPage from './pages/Backup';
import SettingsPage from './pages/Settings';

interface NavItem {
  to: string;
  key: StringKey;
  icon: ComponentType<{ className?: string }>;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', key: 'dashboard', icon: LayoutDashboard, end: true },
  { to: '/khata', key: 'khata', icon: BookCopy },
  { to: '/parties', key: 'parties', icon: Users },
  { to: '/projects', key: 'projects', icon: BriefcaseIcon },
  { to: '/accounts', key: 'accounts', icon: Landmark },
  { to: '/transactions', key: 'transactions', icon: ArrowLeftRight },
  { to: '/reports', key: 'reports', icon: FileText },
  { to: '/statements', key: 'statements', icon: ReceiptText },
  { to: '/backup', key: 'backup', icon: DatabaseBackup },
  { to: '/settings', key: 'settings', icon: Settings },
];

function BriefcaseIcon({ className }: { className?: string }) {
  return <HandCoins className={className} />;
}

function Shell() {
  const { ready, initializing, error, theme, language, syncStatus, lastSync, init, setTheme, setLanguage } = useAppStore();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { void init(); }, [init]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    document.documentElement.dir = language === 'ur' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [language]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-navy-900">
        {error ? (
          <div className="mx-4 max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-card dark:border-red-900 dark:bg-navy-850">
            <ShieldCheck className="mx-auto h-9 w-9 text-red-500" />
            <h1 className="mt-3 text-lg font-semibold text-slate-900 dark:text-white">Could not start MyKhata</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{error}</p>
            <Button className="mt-5" onClick={() => { useAppStore.setState({ error: null, initializing: false, ready: false }); void init(); }}>
              <RefreshCw className="h-4 w-4" /> Try again
            </Button>
          </div>
        ) : (
          <Spinner label={initializing ? 'Opening your offline database' : 'Starting MyKhata'} />
        )}
      </div>
    );
  }

  const navItems = NAV.map((item) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      onClick={() => setMenuOpen(false)}
      className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        isActive
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-navy-800'
      }`}
    >
      <item.icon className="h-4 w-4 shrink-0" />
      <span>{t(language, item.key)}</span>
    </NavLink>
  ));

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-navy-900">
      <aside className={`no-print fixed inset-y-0 z-40 w-64 border-e border-slate-200 bg-white p-4 transition-transform dark:border-navy-700 dark:bg-navy-850 lg:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full'}`}>
        <div className="flex items-center justify-between px-2 pb-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white"><BookCopy className="h-5 w-5" /></span>
            <div>
              <p className="text-base font-bold tracking-tight text-slate-900 dark:text-white">MyKhata</p>
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Offline finance</p>
            </div>
          </div>
          <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-navy-800 lg:hidden" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X className="h-4 w-4" /></button>
        </div>
        <nav className="space-y-1">{navItems}</nav>
        <div className="absolute inset-x-4 bottom-4 rounded-lg bg-slate-50 p-3 text-xs dark:bg-navy-900">
          <div className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-200">
            <Cloud className={`h-3.5 w-3.5 ${syncStatus === 'ok' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span className="capitalize">{syncStatus === 'ok' ? 'Synced' : syncStatus === 'conflict' ? 'Review conflicts' : 'Offline only'}</span>
          </div>
          <p className="mt-1 text-slate-400">Last sync: {lastSync}</p>
          <p className="mt-1 text-emerald-700 dark:text-emerald-400">100% local-first</p>
        </div>
      </aside>

      {menuOpen && <button className="no-print fixed inset-0 z-30 bg-slate-950/40 lg:hidden" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}

      <div className="lg:ps-64">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-navy-700 dark:bg-navy-850/90 sm:px-6">
          <div className="flex items-center gap-2">
            <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-navy-800 lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
            <span className="hidden text-sm font-medium text-slate-500 sm:inline dark:text-slate-400">Your private, offline financial workspace</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void setLanguage(language === 'en' ? 'ur' : 'en')}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-navy-800"
              aria-label="Switch language"
              title="English / اردو"
            >
              <Languages className="h-4 w-4" /> {language === 'en' ? 'UR' : 'EN'}
            </button>
            <button
              onClick={() => void setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-navy-800"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-[1500px] px-4 pb-24 pt-6 sm:px-6 lg:pb-10">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/khata" element={<ObligationsPage mode="all" />} />
            <Route path="/parties" element={<PartiesPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/receivables" element={<ObligationsPage mode="receivable" />} />
            <Route path="/payables" element={<ObligationsPage mode="payable" />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/income" element={<TransactionsPage kind="income" />} />
            <Route path="/expenses" element={<TransactionsPage kind="expense" />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/statements" element={<StatementsPage />} />
            <Route path="/backup" element={<BackupPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

      <nav className="no-print fixed inset-x-0 bottom-0 z-20 flex items-center justify-around border-t border-slate-200 bg-white/95 px-1 py-1.5 backdrop-blur dark:border-navy-700 dark:bg-navy-850/95 lg:hidden">
        {NAV.slice(0, 5).map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `flex min-w-14 flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-[10px] ${isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
            <item.icon className="h-5 w-5" />
            <span className="max-w-16 truncate">{t(language, item.key)}</span>
          </NavLink>
        ))}
      </nav>

      <ToastHost />
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
