"use client";

import React from 'react';
import type { CustomTooltipProps } from 'ag-grid-react';
import { coverageTotal, documentTotal, type InvoiceCellCoverage } from '@/lib/invoice-coverage';
import type { InvoiceSuggestion } from '@/lib/invoice-suggestions';
import { formatDate } from '@/lib/date';
import { euro, invoiceStateOf, invoiceVerdictOf } from '@/components/contracts/invoice-verdict';

/** What a month cell of the revenue schedule shows on hover. */
export type ScheduleCellTooltipValue =
  | { kind: 'invoice'; reference: string; coverage: InvoiceCellCoverage; projects?: string[] }
  | { kind: 'suggestion'; suggestion: InvoiceSuggestion; actionHere: boolean }
  | { kind: 'projects'; month: string; shares: Array<{ label: string; name: string; amount: number }> };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const periodOf = (first: string, last: string) => {
  if (first === last) return monthName(first);
  return first.slice(0, 4) === last.slice(0, 4)
    ? `${MONTHS[Number(first.slice(5, 7)) - 1]} – ${monthName(last)}`
    : `${monthName(first)} – ${monthName(last)}`;
};

/**
 * The hover card of a schedule month cell: the invoice behind the box (what it billed this row, what
 * the agreement expects, and the verdict), a period still to invoice, or the change requests that
 * make up the cell. Rendered by AG Grid in its tooltip popup, so it is never clipped by the cell.
 */
export function ScheduleCellTooltip({ value }: CustomTooltipProps<unknown, ScheduleCellTooltipValue>) {
  if (!value) return null;
  return (
    <div className="w-[300px] overflow-hidden rounded-[var(--radius-card)] border border-[var(--line-strong)] bg-[var(--surface)] text-[12px] leading-snug text-[var(--ink-2)] shadow-[var(--shadow-pop)]">
      {value.kind === 'invoice' && <InvoiceCard {...value} />}
      {value.kind === 'suggestion' && <SuggestionCard {...value} />}
      {value.kind === 'projects' && <ProjectsCard {...value} />}
    </div>
  );
}

function InvoiceCard({ reference, coverage, projects }: Extract<ScheduleCellTooltipValue, { kind: 'invoice' }>) {
  const state = invoiceStateOf(coverage);
  const verdict = invoiceVerdictOf(coverage);
  const covered = coverageTotal(coverage);
  const whole = documentTotal(coverage) + coverage.receiptTotal;
  const details: Array<[string, string]> = [
    ...(whole !== covered ? [['Invoice total', `${euro(whole)} (this row ${euro(covered)})`] as [string, string]] : []),
    ...(coverage.lines.length > 0 ? [['Lines', coverage.lines.join('; ')] as [string, string]] : []),
    ...(coverage.receipts.length > 0
      ? [['Received', `${euro(coverage.receiptTotal)} without a tax invoice (${coverage.receipts.join(', ')})`] as [string, string]]
      : []),
    ...(coverage.issueDate ? [['Issued', formatDate(coverage.issueDate)] as [string, string]] : []),
    ...(projects && projects.length > 0 ? [['Projects', projects.join(', ')] as [string, string]] : []),
  ];

  return (
    <div className="space-y-2.5 p-3 pl-3.5" style={{ boxShadow: `inset 3px 0 0 ${state.color}` }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-[var(--ink)]">
            {coverage.invoices.length > 0 ? coverage.invoices.join(', ') : 'Payment received'}
          </p>
          <p className="text-[11.5px] text-[var(--ink-3)]">
            {periodOf(coverage.firstMonth, coverage.lastMonth)}, <span className="whitespace-nowrap">{reference}</span>
          </p>
        </div>
        <span className="shrink-0 text-[11.5px] font-semibold" style={{ color: state.color }}>{state.label}</span>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <p className="ui-num text-[18px] font-semibold leading-none text-[var(--ink)]">{euro(covered)}</p>
          <span className="shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold" style={{ color: verdict.color, background: verdict.soft }}>
            {verdict.text}
          </span>
        </div>
        <p className="mt-1 text-[11.5px] text-[var(--ink-3)]">
          invoiced against <span className="ui-num font-semibold text-[var(--ink-2)]">{euro(coverage.contractTotal)}</span> expected
        </p>
      </div>

      {details.length > 0 && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-[var(--line)] pt-2 text-[11.5px]">
          {details.map(([term, description]) => (
            <React.Fragment key={term}>
              <dt className="text-[var(--ink-3)]">{term}</dt>
              <dd className="text-[var(--ink-2)]">{description}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}

      {coverage.invoiceIds.length > 0 && (
        <p className="text-[11px] text-[var(--ink-4)]">Click the badge for the invoice details.</p>
      )}
    </div>
  );
}

function SuggestionCard({ suggestion, actionHere }: Extract<ScheduleCellTooltipValue, { kind: 'suggestion' }>) {
  return (
    <div className="space-y-1.5 p-3 pl-3.5" style={{ boxShadow: 'inset 3px 0 0 var(--accent)' }}>
      <p className="text-[11.5px] font-semibold text-[var(--accent-ink)]">To invoice</p>
      <p className="text-[12px] text-[var(--ink-3)]">
        <span className="ui-num text-[18px] font-semibold text-[var(--ink)]">{euro(suggestion.amount)}</span>
        {' '}for {suggestion.period.label}
      </p>
      <p className="text-[11.5px] text-[var(--ink-3)]">
        Raise on {formatDate(suggestion.invoiceDate)}, billed {suggestion.timing === 'end_of_period' ? 'in arrears' : 'in advance'}.
      </p>
      <p className="text-[11px] text-[var(--ink-4)]">
        {actionHere ? 'Click + on this cell to create the draft.' : 'Create the draft from the + on the period’s first month.'}
      </p>
    </div>
  );
}

function ProjectsCard({ month, shares }: Extract<ScheduleCellTooltipValue, { kind: 'projects' }>) {
  const total = shares.reduce((sum, share) => sum + share.amount, 0);
  return (
    <div className="space-y-2 p-3 pl-3.5" style={{ boxShadow: 'inset 3px 0 0 var(--warning)' }}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[12px] font-semibold text-[var(--ink)]">Change requests in {monthName(month)}</p>
        <span className="ui-num text-[13px] font-semibold text-[var(--ink)]">{euro(total)}</span>
      </div>
      <ul className="space-y-1 border-t border-[var(--line)] pt-2 text-[11.5px]">
        {shares.map(share => (
          <li key={`${share.label}-${share.name}`} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-[var(--ink-2)]">
              <span className="font-semibold">{share.label}</span>{share.label !== share.name && <span className="text-[var(--ink-3)]"> {share.name}</span>}
            </span>
            <span className="ui-num shrink-0 text-[var(--ink)]">{euro(share.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
