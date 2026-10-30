import type { CatalogItem, CatalogModule, Contract } from '@/lib/types';
import { getContractBillingPeriods, type BillingPeriodInvoice, type BillingPeriodItem } from '@/lib/billing-periods';
import { monthKeysBetween, toMonthKey } from '@/lib/revenue-schedule';

/**
 * Invoice suggestions for the revenue schedule: the billing periods each contract already owes
 * (derived from its cadence and invoicing timing) that are still unbilled. The grid paints one very
 * light box over each suggestion's months and offers a one-click "create the draft" action.
 */

export interface InvoiceSuggestion {
  id: string;
  contractId: string;
  contract: Contract;
  period: BillingPeriodItem;
  /** Calendar months the suggested invoice bills ('YYYY-MM'). */
  months: string[];
  amount: number;
  timing: BillingPeriodItem['timing'];
  /** Date the invoice is raised — the period start when billed in advance, its end in arrears. */
  invoiceDate: string;
  /** Month carrying the "create draft" action (its first unbilled month). */
  actionMonth: string;
}

export interface InvoiceSuggestionOptions {
  catalogModules?: CatalogModule[];
  catalogItems?: CatalogItem[];
  /** Contracts' linked invoices, so periods already drafted or billed are not suggested again. */
  invoices?: BillingPeriodInvoice[];
  /** Optimistic "draft created" marks, keyed `${contractId}::${periodKey}`. */
  draftInvoiceIds?: Record<string, string>;
  today?: Date;
}

/** Every calendar month a billing window touches. */
export function suggestionMonths(period: Pick<BillingPeriodItem, 'from' | 'to'>): string[] {
  const from = toMonthKey(period.from);
  const to = toMonthKey(period.to) || from;
  return from ? monthKeysBetween(from, to as string) : [];
}

export function buildInvoiceSuggestions(
  contracts: Contract[],
  options: InvoiceSuggestionOptions = {}
): InvoiceSuggestion[] {
  const { catalogModules = [], catalogItems = [], invoices = [], draftInvoiceIds = {}, today } = options;

  return contracts
    .flatMap(contract => {
      const periods = getContractBillingPeriods(contract, {
        today,
        catalogModules,
        catalogItems,
        groups: contract.groups || [],
        invoices,
        generatedDraftIds: draftInvoiceIds,
      });

      return periods
        .filter(period => period.status === 'unbilled' && period.expectedAmount > 0)
        .map(period => {
          const months = suggestionMonths(period);
          return {
            id: `${contract.id}::${period.key}`,
            contractId: contract.id,
            contract,
            period,
            months,
            amount: period.expectedAmount,
            timing: period.timing,
            invoiceDate: period.billingDate,
            actionMonth: months[0] ?? '',
          };
        })
        .filter(suggestion => suggestion.months.length > 0);
    })
    .sort((a, b) => a.contract.counterparty?.legal_name?.localeCompare(b.contract.counterparty?.legal_name || '') || 0);
}

export const suggestionCellKey = (contractId: string, month: string) => `${contractId}:${month}`;

/** Inline style painting one cell of the suggestion box; contiguous cells share the box outline. */
export function suggestionCellStyle(suggestion: InvoiceSuggestion, month: string): Record<string, string> {
  // Theme tokens: the dotted suggestion box follows Brand Blue in both colour schemes.
  const line = 'color-mix(in srgb, var(--accent) 45%, transparent)';
  const shadows = [`inset 0 1px 0 0 ${line}`, `inset 0 -1px 0 0 ${line}`];
  if (month === suggestion.months[0]) shadows.push(`inset 1px 0 0 0 ${line}`);
  if (month === suggestion.months[suggestion.months.length - 1]) shadows.push(`inset -1px 0 0 0 ${line}`);
  return {
    backgroundColor: 'color-mix(in srgb, var(--accent) 7%, transparent)',
    boxShadow: shadows.join(', '),
  };
}
