import pdfMake from 'pdfmake/build/pdfmake';
import vfs from 'pdfmake/build/vfs_fonts.js';
import { formatMoney } from '../core/money';
import type { DbAdapter } from '../db/adapter';
import {
  completeSummary, monthlySummary, obligationsReport, partyStatement, periodLabel,
  projectStatement, yearlySummary, type DateRange, type Statement,
} from '../core/reports';

pdfMake.addVirtualFileSystem(vfs);

const COLORS = {
  navy: '#0B1528',
  slate: '#475569',
  emerald: '#0F9B72',
  red: '#B42318',
  line: '#E2E8F0',
};

function safe(value: unknown): string {
  return String(value ?? '—');
}

function amount(value: { toString(): string }, currency: string): string {
  return formatMoney(value.toString(), currency, false);
}

/** Pure document definition — testable without a browser and built only from database data. */
export function buildStatementDocument(statement: Statement): Record<string, unknown> {
  const body: unknown[][] = [
    [{ text: 'Date', style: 'tableHeader' }, { text: 'Type', style: 'tableHeader' }, { text: 'Description', style: 'tableHeader' },
      { text: 'Received', style: 'tableHeader', alignment: 'right' }, { text: 'Paid', style: 'tableHeader', alignment: 'right' },
      { text: 'Balance', style: 'tableHeader', alignment: 'right' }],
  ];
  for (const line of statement.lines) {
    body.push([
      safe(line.txn.txn_date),
      safe(line.txn.type.replace(/_/g, ' ')),
      safe(line.txn.description || line.txn.reference || line.txn.id.slice(0, 8)),
      { text: line.received.isPositive() ? amount(line.received, statement.currency) : '—', color: COLORS.emerald, alignment: 'right' },
      { text: line.paid.isPositive() ? amount(line.paid, statement.currency) : '—', color: COLORS.red, alignment: 'right' },
      { text: amount(line.balance, statement.currency), alignment: 'right' },
    ]);
  }
  if (statement.lines.length === 0) {
    body.push([{ text: 'No transactions in the selected period', colSpan: 6, alignment: 'center', color: COLORS.slate }, '', '', '', '', '']);
  }

  return {
    pageSize: 'A4',
    pageMargins: [38, 64, 38, 56],
    header: {
      margin: [38, 22, 38, 0],
      columns: [
        { text: 'MyKhata', fontSize: 15, bold: true, color: COLORS.navy },
        { text: 'Offline Financial Statements', fontSize: 9, color: COLORS.slate, alignment: 'right' },
      ],
      lineBelow: true,
    },
    footer: (currentPage: number, pageCount: number) => ({
      margin: [38, 12, 38, 0],
      columns: [
        { text: `Generated ${new Date(statement.generatedAt).toLocaleString()}`, fontSize: 8, color: COLORS.slate },
        { text: `Page ${currentPage} of ${pageCount}`, fontSize: 8, color: COLORS.slate, alignment: 'right' },
      ],
    }),
    content: [
      { text: statement.title, style: 'title' },
      { text: statement.subtitle, style: 'subtitle' },
      {
        columns: [
          { text: `Period: ${statement.period}`, fontSize: 9, color: COLORS.slate },
          { text: `Currency: ${statement.currency}`, fontSize: 9, color: COLORS.slate, alignment: 'right' },
        ],
        margin: [0, 4, 0, 12],
      },
      {
        table: {
          widths: ['25%', '25%', '25%', '25%'],
          body: [[
            { text: 'Opening balance', style: 'label' },
            { text: 'Total received', style: 'label' },
            { text: 'Total paid', style: 'label' },
            { text: 'Closing balance', style: 'label' },
          ], [
            { text: amount(statement.opening, statement.currency), style: 'value' },
            { text: amount(statement.totalReceived, statement.currency), style: 'value', color: COLORS.emerald },
            { text: amount(statement.totalPaid, statement.currency), style: 'value', color: COLORS.red },
            { text: amount(statement.closing, statement.currency), style: 'value', bold: true },
          ]],
        },
        layout: { fillColor: () => '#F8FAFC', hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => COLORS.line, vLineColor: () => COLORS.line },
        margin: [0, 0, 0, 14],
      },
      {
        table: {
          headerRows: 1,
          widths: ['14%', '18%', '*', '16%', '16%', '16%'],
          body,
        },
        layout: {
          fillColor: (rowIndex: number) => (rowIndex === 0 ? COLORS.navy : (rowIndex % 2 === 0 ? '#F8FAFC' : null)),
          hLineWidth: () => 0.4,
          vLineWidth: () => 0,
          hLineColor: () => COLORS.line,
          paddingLeft: () => 6,
          paddingRight: () => 6,
          paddingTop: () => 5,
          paddingBottom: () => 5,
        },
      },
      {
        text: 'All amounts are derived from posted, balanced ledger entries. Corrections are recorded as reversals.',
        fontSize: 8,
        italics: true,
        color: COLORS.slate,
        margin: [0, 14, 0, 0],
      },
    ],
    styles: {
      title: { fontSize: 20, bold: true, color: COLORS.navy },
      subtitle: { fontSize: 12, color: COLORS.slate, margin: [0, 2, 0, 6] },
      tableHeader: { bold: true, color: '#FFFFFF', fontSize: 9 },
      label: { fontSize: 8, color: COLORS.slate, bold: true },
      value: { fontSize: 11, color: COLORS.navy },
    },
    defaultStyle: { font: 'Roboto', fontSize: 9 },
  };
}

export function generatePdfBuffer(statement: Statement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(buildStatementDocument(statement)).getBuffer((buffer) => resolve(buffer));
    } catch (error) {
      reject(error);
    }
  });
}

export function downloadStatementPdf(statement: Statement, fileName = 'mykhata-statement.pdf'): void {
  pdfMake.createPdf(buildStatementDocument(statement)).download(fileName);
}

export type StatementKind =
  | 'person' | 'company' | 'project' | 'receivables' | 'payables'
  | 'monthly' | 'yearly' | 'complete' | 'account';

export async function buildStatement(
  adapter: DbAdapter,
  kind: StatementKind,
  options: { id?: string; range?: DateRange; year?: number; month?: number } = {},
): Promise<Statement> {
  switch (kind) {
    case 'person':
    case 'company': {
      if (!options.id) throw new Error('Select a person or company');
      return partyStatement(adapter, options.id, options.range ?? {});
    }
    case 'project': {
      if (!options.id) throw new Error('Select a project');
      return projectStatement(adapter, options.id, options.range ?? {});
    }
    case 'receivables': return obligationsReport(adapter, 'receivable', options.range ?? {});
    case 'payables': return obligationsReport(adapter, 'payable', options.range ?? {});
    case 'monthly': return monthlySummary(adapter, options.year ?? new Date().getFullYear(), options.month ?? new Date().getMonth() + 1);
    case 'yearly': return yearlySummary(adapter, options.year ?? new Date().getFullYear());
    case 'complete': return completeSummary(adapter, options.range ?? {});
    case 'account': {
      const { accountStatement } = await import('../core/reports');
      if (!options.id) throw new Error('Select an account');
      return accountStatement(adapter, options.id, options.range ?? {});
    }
  }
}

export function statementFileName(statement: Statement): string {
  const clean = statement.subtitle.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return `mykhata-${statement.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${clean || 'report'}.pdf`;
}

export function statementPeriod(statement: Statement): string {
  return periodLabel({ from: statement.period.split(' to ')[0], to: statement.period.split(' to ')[1] });
}
