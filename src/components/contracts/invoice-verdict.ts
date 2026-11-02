import { invoiceBoxState, invoiceVarianceTone, type InvoiceCellCoverage } from '@/lib/invoice-coverage';

/** Whole-euro money as the schedules print it, cents only when there are any. */
export const euro = (value: number) => `€${(Math.round(value * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** Same colours as the invoice boxes on the schedules, so a state reads the same everywhere. */
export function invoiceStateOf(coverage: InvoiceCellCoverage): { label: string; color: string } {
  const state = invoiceBoxState(coverage);
  if (state === 'paid') return { label: 'Paid', color: 'var(--viz-paid)' };
  if (state === 'issued') return { label: 'Issued, not paid', color: 'var(--viz-issued)' };
  return { label: 'Draft', color: 'var(--viz-draft)' };
}

/** How the invoiced money compares with what the agreement expects, in words and colour. */
export function invoiceVerdictOf(coverage: InvoiceCellCoverage): { text: string; color: string; soft: string } {
  const tone = invoiceVarianceTone(coverage);
  if (tone === 'match') return { text: 'Matches the contract', color: 'var(--positive)', soft: 'var(--positive-soft)' };
  if (tone === 'under') return { text: `${euro(-coverage.variance)} short`, color: 'var(--danger)', soft: 'var(--danger-soft)' };
  return { text: `${euro(coverage.variance)} over`, color: 'var(--warning)', soft: 'var(--warning-soft)' };
}
