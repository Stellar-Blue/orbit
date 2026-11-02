"use client";

import React, { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useCreateDraftInvoice } from '@/lib/use-create-draft-invoice';
import { buildBillingStatement, statementSummary, type StatementBlock, type StatementStream } from '@/lib/billing-statement';
import { coverageTotal, documentTotal, invoiceBoxState, invoiceVarianceTone, type InvoiceBoxState } from '@/lib/invoice-coverage';
import { formatDate } from '@/lib/date';
import { Button } from '@/components/ui/primitives';
import type { Contract } from '@/lib/types';

const RevenueScheduleGrid = dynamic(() => import('@/components/contracts/revenue-schedule-grid').then(m => m.RevenueScheduleGrid), { ssr: false });

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Height of one month on the statement spine; an invoice card is as tall as the months it covers. */
const MONTH_ROW = 54;

const euro = (value: number) => `€${(Math.round(value * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const monthName = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

/** Same colours as the invoice boxes on the portfolio schedules, so a state reads the same everywhere. */
const BOX_STATES: Record<InvoiceBoxState, { label: string; color: string }> = {
  paid: { label: 'Paid', color: 'var(--viz-paid)' },
  issued: { label: 'Issued, not paid', color: 'var(--viz-issued)' },
  draft: { label: 'Draft', color: 'var(--viz-draft)' },
};

function verdictOf(block: Extract<StatementBlock, { kind: 'invoice' }>) {
  const tone = invoiceVarianceTone(block.coverage);
  if (tone === 'match') return { text: 'Matches the contract', color: 'var(--positive)', soft: 'var(--positive-soft)' };
  if (tone === 'under') return { text: `${euro(-block.coverage.variance)} short`, color: 'var(--danger)', soft: 'var(--danger-soft)' };
  return { text: `${euro(block.coverage.variance)} over`, color: 'var(--warning)', soft: 'var(--warning-soft)' };
}

function cadenceSentence(contract: Contract): string {
  const start = formatDate(contract.service_start_date || contract.starts_on);
  if (contract.billing_cadence === 'one_off') return `Billed once, from ${start}.`;
  if (contract.billing_cadence === 'milestone') return `Billed on milestones, from ${start}.`;
  const cadence = contract.billing_cadence === 'annual' ? 'annually' : contract.billing_cadence || 'monthly';
  return `Billed ${cadence} ${contract.invoice_timing === 'end_of_period' ? 'in arrears' : 'in advance'}, from ${start}.`;
}

function streamTitle(stream: StatementStream): string {
  if (stream.row.kind === 'contract') return 'Contract charges';
  const projects = stream.row.projects ?? [];
  return projects.length === 1
    ? `Change request: ${projects[0].code ? `${projects[0].code} ` : ''}${projects[0].name}`
    : `Change requests: ${projects.map(project => project.code || project.name).join(', ')}`;
}

/**
 * Billing check for one client or one agreement: month by month, what each agreement and change
 * request should bring in, the invoices that cover it — big enough to read and compare — and what is
 * still to invoice, with the draft one click away. The portfolio schedule, scoped, sits one switch away.
 */
export function BillingCheck({ contracts: scope, showAgreementLinks = false }: {
  contracts: Contract[];
  /** On a client, each agreement heading links to its dossier. */
  showAgreementLinks?: boolean;
}) {
  const { contracts, projects, invoices, receipts, catalogModules, catalogItems } = useAuth();
  const { createDraft, creatingKey, draftIds } = useCreateDraftInvoice();
  const [view, setView] = useState<'statement' | 'schedule'>('statement');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [pickedYear, setPickedYear] = useState<number | null>(null);

  const statement = useMemo(() => buildBillingStatement({
    scope,
    contracts: contracts || [],
    projects: projects || [],
    invoices: invoices || [],
    receipts: receipts || [],
    catalogModules: catalogModules || [],
    catalogItems: catalogItems || [],
    draftInvoiceIds: draftIds,
  }), [scope, contracts, projects, invoices, receipts, catalogModules, catalogItems, draftIds]);

  const now = new Date();
  const thisYear = now.getFullYear();
  const currentMonth = `${thisYear}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const years = statement.years.length > 0 ? statement.years : [thisYear];
  const year = pickedYear ?? (years.includes(thisYear) ? thisYear : years[years.length - 1]);
  const yearIndex = years.indexOf(year);
  const summary = useMemo(() => statementSummary(statement, year), [statement, year]);

  if (scope.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--line-strong)] p-6 text-center text-[13px] text-[var(--ink-3)]">
        No client agreements to check yet. Billing check compares a client&apos;s invoices with its agreements — add one under Contracts.
      </p>
    );
  }

  const issueCount = summary.short.count + summary.over.count;

  return (
    <div className="space-y-5 pt-3">
      {/* The three questions, answered in a line each. */}
      <div className="grid sm:grid-cols-3 gap-px overflow-hidden rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--line)]">
        <p className="bg-[var(--surface)] p-4 text-[13px] leading-snug text-[var(--ink-2)]">
          {summary.toInvoice > 0 ? (
            <>
              <span className="ui-num block text-[22px] font-semibold tracking-[-0.01em] text-[var(--accent-ink)]">{euro(summary.toInvoice)}</span>
              to invoice now, across {summary.duePeriods} {summary.duePeriods === 1 ? 'period' : 'periods'} already due.
            </>
          ) : (
            <>
              <span className="block text-[22px] font-semibold tracking-[-0.01em] text-[var(--ink)]">Up to date</span>
              Nothing is due to invoice right now.
            </>
          )}
        </p>
        <p className="bg-[var(--surface)] p-4 text-[13px] leading-snug text-[var(--ink-2)]">
          <span className="ui-num block text-[22px] font-semibold tracking-[-0.01em] text-[var(--ink)]">{euro(summary.invoiced)}</span>
          invoiced in {year}, against <span className="ui-num font-semibold text-[var(--ink)]">{euro(summary.expected)}</span> the agreements expect.
        </p>
        <p className="bg-[var(--surface)] p-4 text-[13px] leading-snug text-[var(--ink-2)]">
          {summary.invoiced === 0 && issueCount === 0 ? (
            <>
              <span className="block text-[22px] font-semibold tracking-[-0.01em] text-[var(--ink)]">Nothing to check</span>
              No invoices cover {year} yet.
            </>
          ) : issueCount === 0 ? (
            <>
              <span className="block text-[22px] font-semibold tracking-[-0.01em] text-[var(--positive)]">All match</span>
              Every invoice in {year} agrees with its agreement.
            </>
          ) : (
            <>
              <span className="ui-num block text-[22px] font-semibold tracking-[-0.01em] text-[var(--danger)]">
                {issueCount} {issueCount === 1 ? 'invoice differs' : 'invoices differ'}
              </span>
              {summary.short.count > 0 && <>{euro(summary.short.amount)} short</>}
              {summary.short.count > 0 && summary.over.count > 0 && ', '}
              {summary.over.count > 0 && <>{euro(summary.over.amount)} over</>}
              {' '}in {year}.
            </>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className={view === 'statement' ? 'inline-flex items-center gap-1' : 'hidden'}>
          <button
            type="button"
            onClick={() => setPickedYear(years[yearIndex - 1])}
            disabled={yearIndex <= 0}
            aria-label="Previous year"
            className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-[var(--ink-3)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)] disabled:opacity-30 cursor-pointer disabled:cursor-default"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="ui-num w-12 text-center text-[15px] font-semibold text-[var(--ink)]" aria-live="polite">{year}</span>
          <button
            type="button"
            onClick={() => setPickedYear(years[yearIndex + 1])}
            disabled={yearIndex >= years.length - 1}
            aria-label="Next year"
            className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-[var(--ink-3)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)] disabled:opacity-30 cursor-pointer disabled:cursor-default"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="ui-segmented" role="group" aria-label="Billing check view">
          <button type="button" aria-pressed={view === 'statement'} onClick={() => setView('statement')}>Month by month</button>
          <button type="button" aria-pressed={view === 'schedule'} onClick={() => setView('schedule')}>Schedule grid</button>
        </div>
        {view === 'statement' && (
          <label className="ml-auto inline-flex items-center gap-2 text-[12.5px] text-[var(--ink-2)] cursor-pointer">
            <input type="checkbox" checked={onlyIssues} onChange={e => setOnlyIssues(e.target.checked)} className="accent-[var(--accent)]" />
            Only what needs attention
          </label>
        )}
      </div>

      {view === 'schedule' ? (
        <RevenueScheduleGrid
          contracts={scope}
          projects={projects || []}
          catalogModules={catalogModules || []}
          catalogItems={catalogItems || []}
          invoices={invoices || []}
          receipts={receipts || []}
          draftInvoiceIds={draftIds}
          onCreateInvoice={createDraft}
        />
      ) : (
        <div className="space-y-8">
          {scope.map(contract => (
            <section key={contract.id} aria-label={contract.reference} className="space-y-3">
              <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="text-[15px] font-semibold text-[var(--ink)]">
                  {showAgreementLinks ? (
                    <Link href={`/contracts/${contract.id}`} className="hover:text-[var(--accent)] hover:underline">{contract.reference}</Link>
                  ) : contract.reference}
                  {contract.product && <span className="ml-2 font-normal text-[var(--ink-3)]">{contract.product}</span>}
                </h3>
                <p className="text-[12.5px] text-[var(--ink-3)]">{cadenceSentence(contract)}</p>
              </header>
              {statement.streams
                .filter(stream => stream.row.contractId === contract.id)
                .map(stream => (
                  <StreamStatement
                    key={stream.row.id}
                    stream={stream}
                    year={year}
                    currentMonth={currentMonth}
                    onlyIssues={onlyIssues}
                    creatingKey={creatingKey}
                    onCreateDraft={createDraft}
                  />
                ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function StreamStatement({ stream, year, currentMonth, onlyIssues, creatingKey, onCreateDraft }: {
  stream: StatementStream;
  year: number;
  currentMonth: string;
  onlyIssues: boolean;
  creatingKey: string | null;
  onCreateDraft: (contract: Contract, period: Extract<StatementBlock, { kind: 'due' }>['suggestion']['period']) => void;
}) {
  const months = MONTHS.map((_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);
  const first = months[0];
  const last = months[11];
  const inYear = stream.blocks.filter(block => block.lastMonth >= first && block.firstMonth <= last);
  const covered = new Set<string>();
  inYear.forEach(block => months.forEach(month => { if (month >= block.firstMonth && month <= block.lastMonth) covered.add(month); }));
  // A month that has passed, should have earned something and no invoice or due period covers.
  const uncovered = months.filter(month => month < currentMonth && (stream.row.months[month] || 0) > 0 && !covered.has(month));
  const visible = onlyIssues
    ? inYear.filter(block => block.kind === 'due' || invoiceVarianceTone(block.coverage) !== 'match')
    : inYear;
  const yearExpected = months.reduce((total, month) => total + (stream.row.months[month] || 0), 0);

  if (onlyIssues && visible.length === 0 && uncovered.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[13px] text-[var(--ink-3)]">
        <span className="font-semibold text-[var(--ink-2)]">{streamTitle(stream)}</span> — nothing needs attention in {year}.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line)] px-4 py-2.5">
        <h4 className="text-[13px] font-semibold text-[var(--ink-2)]">{streamTitle(stream)}</h4>
        <span className="text-[12px] text-[var(--ink-3)]">
          <span className="ui-num font-semibold text-[var(--ink-2)]">{euro(yearExpected)}</span> expected in {year}
        </span>
      </div>
      <div
        className="grid"
        style={{ gridTemplateColumns: '52px 88px minmax(0, 1fr)', gridTemplateRows: `repeat(12, minmax(${MONTH_ROW}px, auto))` }}
      >
        {months.map((month, index) => {
          const expected = stream.row.months[month] || 0;
          const future = month > currentMonth;
          const isCurrent = month === currentMonth;
          return (
            <React.Fragment key={month}>
              <div
                style={{ gridRow: index + 1, gridColumn: 1 }}
                className={`flex items-center pl-4 text-[12.5px] ${index > 0 ? 'border-t border-[var(--line)]' : ''} ${
                  isCurrent ? 'font-semibold text-[var(--accent-ink)]' : future ? 'text-[var(--ink-4)]' : 'text-[var(--ink-2)]'
                }`}
                aria-current={isCurrent ? 'date' : undefined}
              >
                {MONTHS[index]}
              </div>
              <div
                style={{ gridRow: index + 1, gridColumn: 2 }}
                className={`ui-num flex items-center justify-end pr-3 text-[13px] ${index > 0 ? 'border-t border-[var(--line)]' : ''} ${
                  future ? 'text-[var(--ink-4)]' : 'text-[var(--ink)]'
                }`}
                title={`Expected in ${monthName(month)}`}
              >
                {expected > 0 ? euro(expected) : <span className="text-[var(--ink-4)]">—</span>}
              </div>
              <div
                style={{ gridRow: index + 1, gridColumn: 3 }}
                className={`flex items-center border-l border-[var(--line)] pl-3 ${index > 0 ? 'border-t' : ''} ${isCurrent ? 'bg-[var(--accent-soft)]/40' : ''}`}
              >
                {uncovered.includes(month) && (
                  <span className="text-[12px] text-[var(--danger)]">No invoice covers this month</span>
                )}
              </div>
            </React.Fragment>
          );
        })}

        {visible.map(block => {
          const start = block.firstMonth < first ? first : block.firstMonth;
          const end = block.lastMonth > last ? last : block.lastMonth;
          const startIndex = months.indexOf(start);
          const span = months.indexOf(end) - startIndex + 1;
          const continues = [
            block.firstMonth < first ? `from ${monthName(block.firstMonth)}` : '',
            block.lastMonth > last ? `until ${monthName(block.lastMonth)}` : '',
          ].filter(Boolean).join(', ');
          return (
            <div
              key={`${block.kind}-${block.firstMonth}-${block.lastMonth}-${block.kind === 'invoice' ? block.coverage.invoiceIds.join() : block.suggestion.id}`}
              style={{ gridColumn: 3, gridRow: `${startIndex + 1} / span ${span}` }}
              className="relative z-[1] p-1.5 pl-3"
            >
              {block.kind === 'invoice'
                ? <InvoiceCard block={block} span={span} continues={continues} />
                : (
                  <DueCard
                    block={block}
                    continues={continues}
                    creating={creatingKey === block.suggestion.period.key}
                    disabled={creatingKey !== null}
                    onCreate={() => onCreateDraft(block.suggestion.contract, block.suggestion.period)}
                  />
                )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InvoiceCard({ block, span, continues }: {
  block: Extract<StatementBlock, { kind: 'invoice' }>;
  span: number;
  continues: string;
}) {
  const { coverage } = block;
  const state = BOX_STATES[invoiceBoxState(coverage)];
  const verdict = verdictOf(block);
  const covered = coverageTotal(coverage);
  const whole = documentTotal(coverage) + coverage.receiptTotal;
  const period = block.firstMonth === block.lastMonth ? monthName(block.firstMonth) : `${monthName(block.firstMonth)} – ${monthName(block.lastMonth)}`;
  const details = [
    whole !== covered ? `Part of a ${euro(whole)} invoice` : '',
    coverage.lines.join(', '),
    coverage.receipts.length > 0 ? `Received without a tax invoice: ${coverage.receipts.join(', ')}` : '',
  ].filter(Boolean).join('. ');

  return (
    <article
      className={`flex h-full flex-col gap-1 rounded-[6px] border border-[var(--line)] bg-[var(--surface)] py-2 pl-3.5 pr-3 ${span > 1 ? 'justify-start pt-2.5' : 'justify-center'}`}
      style={{ boxShadow: `inset 3px 0 0 ${state.color}` }}
      title={`${period}${continues ? ` (${continues})` : ''}${details ? `. ${details}` : ''}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          {coverage.invoices.length > 0
            ? coverage.invoices.map((label, index) => (
              <Link
                key={coverage.invoiceIds[index] ?? label}
                href={`/invoices/${coverage.invoiceIds[index] ?? ''}`}
                target="_blank"
                rel="noopener"
                className="truncate text-[13px] font-semibold text-[var(--ink)] hover:text-[var(--accent)] hover:underline"
              >
                {label}
              </Link>
            ))
            : <span className="text-[13px] font-semibold text-[var(--ink)]">Payment received</span>}
          <span className="text-[12px] font-medium" style={{ color: state.color }}>{state.label}</span>
        </div>
        <span
          className="rounded-full px-2 py-0.5 text-[12px] font-semibold"
          style={{ color: verdict.color, background: verdict.soft }}
        >
          {verdict.text}
        </span>
      </div>
      <p className="text-[12.5px] text-[var(--ink-3)]">
        <span className="ui-num text-[16px] font-semibold text-[var(--ink)]">{euro(covered)}</span>
        {' '}invoiced against <span className="ui-num font-semibold text-[var(--ink-2)]">{euro(coverage.contractTotal)}</span> expected
        {span === 1 && whole !== covered && <>, part of <span className="ui-num">{euro(whole)}</span></>}
      </p>
      {span > 1 && (details || continues) && (
        <p className="truncate text-[12px] text-[var(--ink-3)]">{[continues && `Runs ${continues}`, details].filter(Boolean).join('. ')}</p>
      )}
    </article>
  );
}

function DueCard({ block, continues, creating, disabled, onCreate }: {
  block: Extract<StatementBlock, { kind: 'due' }>;
  continues: string;
  creating: boolean;
  disabled: boolean;
  onCreate: () => void;
}) {
  const { suggestion } = block;
  return (
    <article className="flex h-full flex-wrap items-start justify-between gap-x-4 gap-y-1.5 rounded-[6px] border border-dashed border-[var(--accent)] bg-[var(--accent-soft)] py-2.5 pl-3.5 pr-2.5">
      <div className="min-w-0">
        <p className="text-[12.5px] text-[var(--accent-ink)]">
          <span className="ui-num text-[16px] font-semibold">{euro(suggestion.amount)}</span>
          {' '}to invoice for {suggestion.period.label}
        </p>
        <p className="text-[12px] text-[var(--ink-3)]">
          Raise on {formatDate(suggestion.invoiceDate)}, billed {suggestion.timing === 'end_of_period' ? 'in arrears' : 'in advance'}
          {continues ? `. Runs ${continues}` : ''}.
        </p>
      </div>
      <Button variant="primary" size="sm" onClick={onCreate} disabled={disabled} className="shrink-0 disabled:cursor-wait">
        <Plus className="mr-1.5 h-3.5 w-3.5" /> {creating ? 'Creating draft…' : 'Create draft'}
      </Button>
    </article>
  );
}
