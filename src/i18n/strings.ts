import type { Language } from '../store/useAppStore';

export const STRINGS = {
  dashboard: { en: 'Dashboard', ur: 'ڈیش بورڈ' },
  khata: { en: 'Digital Khata', ur: 'ڈیجیٹل کھاتہ' },
  parties: { en: 'People & Companies', ur: 'افراد اور کمپنیاں' },
  projects: { en: 'Projects', ur: 'پروجیکٹس' },
  receivables: { en: 'Receivables', ur: 'قابل وصول' },
  payables: { en: 'Payables', ur: 'قابل ادائیگی' },
  transactions: { en: 'Transactions', ur: 'لین دین' },
  accounts: { en: 'Bank Accounts', ur: 'بینک اکاؤنٹس' },
  cashWallets: { en: 'Cash & Wallets', ur: 'نقد اور والٹس' },
  incomeExpenses: { en: 'Income & Expenses', ur: 'آمدنی اور اخراجات' },
  reports: { en: 'Reports', ur: 'رپورٹس' },
  statements: { en: 'PDF Statements', ur: 'پی ڈی ایف اسٹیٹمنٹس' },
  backup: { en: 'Backup & Sync', ur: 'بیک اپ اور سنک' },
  settings: { en: 'Settings', ur: 'سیٹنگز' },
  add: { en: 'Add', ur: 'شامل کریں' },
  save: { en: 'Save', ur: 'محفوظ کریں' },
  cancel: { en: 'Cancel', ur: 'منسوخ' },
  edit: { en: 'Edit', ur: 'ترمیم' },
  remove: { en: 'Remove', ur: 'حذف' },
  search: { en: 'Search', ur: 'تلاش' },
  all: { en: 'All', ur: 'سب' },
  today: { en: 'Today', ur: 'آج' },
  week: { en: 'This Week', ur: 'اس ہفتے' },
  month: { en: 'This Month', ur: 'اس ماہ' },
  lastMonth: { en: 'Last Month', ur: 'پچھلے ماہ' },
  year: { en: 'This Year', ur: 'اس سال' },
  custom: { en: 'Custom Range', ur: 'حسبِ خواہش' },
  noData: { en: 'Nothing here yet', ur: 'ابھی کچھ نہیں' },
  noDataHint: { en: 'Add your first record to get started.', ur: 'شروع کرنے کے لیے پہلا ریکارڈ شامل کریں۔' },
  totalAssets: { en: 'Total Assets', ur: 'کل اثاثے' },
  receivablesShort: { en: 'Total Receivables', ur: 'کل قابل وصول' },
  payablesShort: { en: 'Total Payables', ur: 'کل قابل ادائیگی' },
  netPosition: { en: 'Net Position', ur: 'خالص پوزیشن' },
  cash: { en: 'Cash in Hand', ur: 'ہاتھ میں نقد' },
  bank: { en: 'Bank Balance', ur: 'بینک بیلنس' },
  wallet: { en: 'Wallet Balance', ur: 'والٹ بیلنس' },
  monthlyIncome: { en: 'Monthly Income', ur: 'ماہانہ آمدنی' },
  monthlyExpenses: { en: 'Monthly Expenses', ur: 'ماہانہ اخراجات' },
  recentTransactions: { en: 'Recent Transactions', ur: 'حالیہ لین دین' },
  overdue: { en: 'Overdue', ur: 'مقررہ سے تجاوز' },
  upcoming: { en: 'Upcoming Payments', ur: 'آنے والی ادائیگیاں' },
  currencySummary: { en: 'Currency-wise Summary', ur: 'کرنسی کے حساب سے' },
} as const;

export type StringKey = keyof typeof STRINGS;

export function t(language: Language, key: StringKey): string {
  return STRINGS[key][language];
}
