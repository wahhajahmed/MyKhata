import { z } from 'zod';
import { Money } from './money';

export const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/, 'Enter a valid decimal amount')
  .refine((v) => !Number.isNaN(Number(v)), 'Amount must be a valid number');

export const positiveDecimal = decimalString.refine((v) => Money.of(v).isPositive(), 'Amount must be greater than zero');

export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid date')
  .refine((value) => {
    const [year, month, day] = value.split('-').map((part) => Number(part));
    if (year === undefined || month === undefined || day === undefined) return false;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  }, 'Choose a valid calendar date');

export const partyTypeSchema = z.enum(['individual', 'company']);

export const partySchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  type: partyTypeSchema,
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  email: z.union([z.string().trim().email('Enter a valid email'), z.literal('')]).optional(),
  address: z.string().trim().max(300).optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
  openingBalance: decimalString.default('0'),
  openingBalanceDirection: z.enum(['none', 'receivable', 'payable']).default('none'),
  currency: z.string().trim().min(3).max(10).default('PKR'),
});

export const projectSchema = z.object({
  partyId: z.string().uuid('Select a client'),
  name: z.string().trim().min(2, 'Project name is required').max(160),
  agreedAmount: positiveDecimal,
  currency: z.string().min(3).max(10),
  startDate: dateString,
  expectedCompletion: dateString.optional().or(z.literal('')),
  dueDate: dateString.optional().or(z.literal('')),
  status: z.enum(['planning', 'active', 'on_hold', 'completed', 'cancelled']),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
});

export const accountSchema = z.object({
  name: z.string().trim().min(2, 'Account name is required').max(120),
  bankName: z.string().trim().max(120).optional().or(z.literal('')),
  nickname: z.string().trim().max(80).optional().or(z.literal('')),
  kind: z.enum(['bank', 'cash', 'wallet']),
  currency: z.string().min(3).max(10),
  openingBalance: decimalString.default('0'),
  notes: z.string().trim().max(1000).optional().or(z.literal('')),
});

export const categorySchema = z.object({
  name: z.string().trim().min(2, 'Category name is required').max(100),
  kind: z.enum(['income', 'expense']),
});

export const obligationSchema = z.object({
  partyId: z.string().uuid('Select a person or company'),
  accountId: z.string().uuid('Select the account used for this obligation'),
  projectId: z.string().uuid().optional().or(z.literal('')),
  direction: z.enum(['receivable', 'payable']),
  reference: z.string().trim().max(120).optional().or(z.literal('')),
  totalAmount: positiveDecimal,
  currency: z.string().min(3).max(10),
  dueDate: dateString.optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
});

export const settlementSchema = z.object({
  obligationId: z.string().uuid(),
  amount: positiveDecimal,
  accountId: z.string().uuid('Select an account'),
  date: dateString,
  description: z.string().trim().max(300).optional().or(z.literal('')),
  allowExcess: z.boolean().default(false),
  /** Optional explicit currency/rate for cross-currency settlements. */
  currency: z.string().trim().min(3).max(10).optional(),
  exchangeRate: decimalString.refine((v) => Money.of(v).isPositive(), 'Exchange rate must be greater than zero').optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

export const exchangeRateSchema = z.object({
  fromCurrency: z.string().min(3).max(10),
  toCurrency: z.string().min(3).max(10),
  rate: positiveDecimal,
  rateDate: dateString,
  source: z.string().trim().max(80).default('manual'),
});

export const transactionTypes = [
  'income',
  'expense',
  'receivable_creation',
  'receivable_settlement',
  'payable_creation',
  'payable_settlement',
  'transfer',
  'refund',
  'adjustment',
  'reversal',
] as const;

export const transactionSchema = z
  .object({
    type: z.enum(transactionTypes),
    date: dateString,
    amount: positiveDecimal,
    currency: z.string().min(3).max(10),
    exchangeRate: decimalString.refine((v) => Money.of(v).isPositive(), 'Exchange rate must be greater than zero').default('1'),
    partyId: z.string().uuid().optional().or(z.literal('')),
    projectId: z.string().uuid().optional().or(z.literal('')),
    sourceAccountId: z.string().uuid().optional().or(z.literal('')),
    destinationAccountId: z.string().uuid().optional().or(z.literal('')),
    categoryId: z.string().uuid().optional().or(z.literal('')),
    obligationId: z.string().uuid().optional().or(z.literal('')),
    description: z.string().trim().max(400).optional().or(z.literal('')),
    reference: z.string().trim().max(120).optional().or(z.literal('')),
    reversalOf: z.string().uuid().optional().or(z.literal('')),
    allowExcess: z.boolean().default(false),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .superRefine((t, ctx) => {
    const needsParty = [
      'receivable_creation',
      'receivable_settlement',
      'payable_creation',
      'payable_settlement',
    ].includes(t.type);
    const needsSource = ['income', 'expense', 'receivable_creation', 'payable_settlement', 'transfer', 'adjustment'].includes(t.type);
    const needsDestination = ['receivable_settlement', 'payable_creation', 'transfer', 'adjustment'].includes(t.type);
    const needsCategory = ['income', 'expense', 'refund', 'adjustment'].includes(t.type);

    if (needsParty && !t.partyId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['partyId'], message: 'Select a person or company' });
    if (needsSource && !t.sourceAccountId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceAccountId'], message: 'Select a source account' });
    if (needsDestination && !t.destinationAccountId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['destinationAccountId'], message: 'Select a destination account' });
    if (needsCategory && !t.categoryId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['categoryId'], message: 'Select a category' });
    if (t.type === 'transfer' && t.sourceAccountId && t.sourceAccountId === t.destinationAccountId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['destinationAccountId'], message: 'Source and destination must be different' });
    }
    if ((t.type === 'reversal' || t.type === 'refund') && !t.reversalOf) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reversalOf'], message: 'Select the original transaction' });
    }
  });

export type PartyInput = z.infer<typeof partySchema>;
export type ProjectInput = z.infer<typeof projectSchema>;
export type AccountInput = z.infer<typeof accountSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type ObligationInput = z.infer<typeof obligationSchema>;
export type SettlementInput = z.infer<typeof settlementSchema>;
export type ExchangeRateInput = z.infer<typeof exchangeRateSchema>;
export type TransactionInput = z.infer<typeof transactionSchema>;

export const dateRangeSchema = z.object({
  from: dateString,
  to: dateString,
});
