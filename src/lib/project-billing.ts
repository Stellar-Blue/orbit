import { netInvoices, type NettableInvoice } from '@/lib/invoice-netting';

/**
 * How much is a project worth, how much has been logged, and what should the next draft invoice carry?
 *
 * Two bases are supported, in this order:
 *  1. `entries` — the logged time entries carry a billing-rate snapshot (hourly T&M work):
 *     amount = uninvoiced billable hours × rate.
 *  2. `project_value` — the project has a fixed value (budget_value): amount = value still uninvoiced.
 * When neither exists there is no basis, and the UI must say so instead of falling back to a default
 * amount (a blank register modal defaulting to €1,000 produced wrong drafts).
 */
export interface ProjectBillingInput {
  project_id: string;
  minutes?: number | null;
  billable?: boolean | null;
  status?: string | null;
  billing_rate?: number | null;
  invoice_id?: string | null;
}

export interface ProjectValueInput {
  id: string;
  budget_value?: number | null;
  budget_hours?: number | null;
  default_billable?: boolean | null;
}

export interface ProjectBillingBasis {
  /** Hours on every entry of the project (any status). */
  loggedHours: number;
  /** Approved, billable hours that no invoice covers yet. */
  unbilledHours: number;
  /** Uninvoiced billable hours × the entry's own rate (0 when rates are missing). */
  ratedUnbilledAmount: number;
  /** Value of invoices already covering the project's entries. */
  invoicedAmount: number;
  /** The project's fixed value, when one is recorded. */
  projectValue: number | null;
  /** projectValue ÷ budget_hours — the rate the project value implies. */
  impliedRate: number | null;
  /** Value the logged hours represent at the implied rate. */
  hoursValueAtImpliedRate: number | null;
  /** Amount a draft invoice should carry right now. 0 when there is no basis. */
  suggestedAmount: number;
  /** Which rule produced `suggestedAmount`. */
  basis: 'entries' | 'project_value' | 'none';
  /** Human-readable reconciliation notes / warnings for the UI. */
  warnings: string[];
}

const hours = (minutes: number | null | undefined) => (Number(minutes) || 0) / 60;

export interface ProjectBillingInvoice extends NettableInvoice {
  id: string;
  status: string;
  gross_eur?: number | null;
}

export function projectBillingBasis(
  entries: ProjectBillingInput[],
  invoices: Array<ProjectBillingInvoice>,
  project: ProjectValueInput
): ProjectBillingBasis {
  const mine = entries.filter(e => e.project_id === project.id);
  const loggedHours = mine.reduce((s, e) => s + hours(e.minutes), 0);

  const uninvoicedBillable = mine.filter(e => e.billable !== false && e.status === 'approved' && !e.invoice_id);
  const unbilledHours = uninvoicedBillable.reduce((s, e) => s + hours(e.minutes), 0);
  const ratedUnbilledAmount = uninvoicedBillable.reduce(
    (s, e) => s + hours(e.minutes) * (Number(e.billing_rate) || 0),
    0
  );

  const invoiceIds = new Set(mine.filter(e => e.invoice_id).map(e => e.invoice_id as string));
  // A credit note reverses work already invoiced: neither it nor the invoice it cancels is billable.
  const invoicedAmount = netInvoices(
    invoices.filter(i => invoiceIds.has(i.id) && i.status !== 'draft')
  ).active.reduce((s, i) => s + (Number(i.gross_eur) || 0), 0);

  const projectValue = project.budget_value != null && Number(project.budget_value) > 0 ? Number(project.budget_value) : null;
  const budgetHours = project.budget_hours != null && Number(project.budget_hours) > 0 ? Number(project.budget_hours) : null;
  const impliedRate = projectValue != null && budgetHours != null ? projectValue / budgetHours : null;
  const hoursValueAtImpliedRate = impliedRate != null ? Number((loggedHours * impliedRate).toFixed(2)) : null;

  const warnings: string[] = [];
  let suggestedAmount = 0;
  let basis: ProjectBillingBasis['basis'] = 'none';

  if (ratedUnbilledAmount > 0) {
    suggestedAmount = Number(ratedUnbilledAmount.toFixed(2));
    basis = 'entries';
  } else if (projectValue != null) {
    suggestedAmount = Number(Math.max(0, projectValue - invoicedAmount).toFixed(2));
    basis = 'project_value';
    if (unbilledHours > 0 && impliedRate != null && unbilledHours * impliedRate < suggestedAmount) {
      warnings.push(
        `${unbilledHours.toFixed(1)}h uninvoiced at the implied €${impliedRate.toFixed(2)}/h is €${(unbilledHours * impliedRate).toFixed(2)}, ` +
        `less than the remaining project value — the draft carries the full remaining value of €${suggestedAmount.toFixed(2)}.`
      );
    }
  } else {
    basis = 'none';
    if (unbilledHours > 0) {
      warnings.push(
        'No billing rate on the logged entries and no project value — set one of them before invoicing this project.'
      );
    }
  }

  if (ratedUnbilledAmount > 0 && projectValue != null && ratedUnbilledAmount > projectValue) {
    warnings.push(
      `Hours × rate (€${ratedUnbilledAmount.toFixed(2)}) exceed the project value (€${projectValue.toFixed(2)}).`
    );
  }
  if (budgetHours != null && loggedHours > budgetHours) {
    warnings.push(
      `Logged ${loggedHours.toFixed(1)}h against a ${budgetHours}h budget — ${(loggedHours - budgetHours).toFixed(1)}h over.`
    );
  }
  if (projectValue != null && budgetHours == null && loggedHours > 0) {
    warnings.push('Project value recorded without budget hours, so no implied hourly rate can be derived.');
  }

  return {
    loggedHours: Number(loggedHours.toFixed(2)),
    unbilledHours: Number(unbilledHours.toFixed(2)),
    ratedUnbilledAmount: Number(ratedUnbilledAmount.toFixed(2)),
    invoicedAmount: Number(invoicedAmount.toFixed(2)),
    projectValue,
    impliedRate: impliedRate != null ? Number(impliedRate.toFixed(2)) : null,
    hoursValueAtImpliedRate,
    suggestedAmount,
    basis,
    warnings,
  };
}

/** Short label for the billing basis, for badges and invoice notes. */
export const projectBasisLabel = (basis: ProjectBillingBasis['basis']): string =>
  basis === 'entries' ? 'logged hours × billing rate'
  : basis === 'project_value' ? 'remaining project value'
  : 'no value or rate recorded';
