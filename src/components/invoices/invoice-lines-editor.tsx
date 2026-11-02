"use client";

import React, { useMemo } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { DatePicker } from '@/components/ui/date-picker';
import { formatMoney } from '@/lib/currency';
import { useAuth } from '@/lib/auth-context';
import { invoiceLineTargets } from '@/lib/invoice-links';
import { createInvoiceLineAllocator } from '@/lib/invoice-coverage';
import type { Contract, Invoice, InvoiceLine, Project } from '@/lib/types';

interface InvoiceLinesEditorProps {
  lines: InvoiceLine[];
  onChange: (lines: InvoiceLine[]) => void;
  /** The agreements and projects picked in the invoice's linkage — what a line can bill. */
  contracts: Contract[];
  projects: Project[];
  currency: string;
  /** A new line starts on the invoice period; the first one also takes over the current net. */
  defaultPeriod: { from: string; to: string };
  currentNet: number;
}

type Target = { kind: 'contract' | 'project'; id: string; label: string; title: string };

/**
 * "What does each part of this invoice bill?" — each line has its own amount and service period and
 * bills one or more agreement fees and projects. A line billing several is split by what each expects
 * over the line's months, which is how the schedules and the Billing check match it. Once there is a
 * line, the invoice net is the sum of the lines.
 */
export const InvoiceLinesEditor: React.FC<InvoiceLinesEditorProps> = ({
  lines,
  onChange,
  contracts,
  projects,
  currency,
  defaultPeriod,
  currentNet,
}) => {
  const { contracts: allContracts, projects: allProjects, catalogModules, catalogItems } = useAuth();
  const allocate = useMemo(
    () => createInvoiceLineAllocator(allContracts || [], allProjects || [], catalogModules || [], catalogItems || []),
    [allContracts, allProjects, catalogModules, catalogItems]
  );

  const contractTarget = (contract: Contract): Target => ({
    kind: 'contract',
    id: contract.id,
    label: `${contract.reference || contract.product || 'Agreement'} fee`,
    title: `The agreement's own charges${contract.product ? ` (${contract.product})` : ''}`,
  });
  const projectTarget = (project: Project): Target => ({
    kind: 'project',
    id: project.id,
    label: project.code || project.name,
    title: `Change request: ${project.name}`,
  });

  /** What a line can bill: the linked agreements and projects, plus anything it already bills. */
  const optionsFor = (line: InvoiceLine): Target[] => {
    const { contractIds, projectIds } = invoiceLineTargets(line);
    const offered = [...contracts.map(contractTarget), ...projects.map(projectTarget)];
    const extra = [
      ...contractIds.filter(id => !contracts.some(contract => contract.id === id))
        .map(id => allContracts?.find(contract => contract.id === id)).filter((c): c is Contract => Boolean(c)).map(contractTarget),
      ...projectIds.filter(id => !projects.some(project => project.id === id))
        .map(id => allProjects?.find(project => project.id === id)).filter((p): p is Project => Boolean(p)).map(projectTarget),
    ];
    return [...offered, ...extra];
  };

  const update = (index: number, patch: Partial<InvoiceLine>) =>
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  // Targets live in the arrays from here on; the single legacy fields are cleared so they never
  // stand in for an emptied selection.
  const toggleTarget = (index: number, target: Target) => {
    const { contractIds, projectIds } = invoiceLineTargets(lines[index]);
    const flip = (ids: string[]) => (ids.includes(target.id) ? ids.filter(id => id !== target.id) : [...ids, target.id]);
    update(index, {
      contract_ids: target.kind === 'contract' ? flip(contractIds) : contractIds,
      project_ids: target.kind === 'project' ? flip(projectIds) : projectIds,
      contract_id: null,
      project_id: null,
    });
  };

  const addLine = () => {
    const first = contracts[0];
    onChange([
      ...lines,
      {
        id: crypto.randomUUID(),
        description: '',
        amount: lines.length === 0 ? currentNet : 0,
        period_from: defaultPeriod.from || null,
        period_to: defaultPeriod.to || null,
        contract_ids: first ? [first.id] : [],
        project_ids: [],
      },
    ]);
  };

  /** How a line billing several things is split — amounts in the invoice currency. */
  const splitOf = (line: InvoiceLine, options: Target[]) => {
    const shares = allocate(
      { currency: 'EUR', fx_rate: 1, period_from: defaultPeriod.from, period_to: defaultPeriod.to } as Invoice,
      line
    ).shares;
    if (shares.length < 2) return null;
    return shares
      .map(share => `${options.find(option => option.id === share.id)?.label ?? 'Unknown'} ${formatMoney(share.amount, currency)}`)
      .join(', ');
  };

  const total = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
  const nothingLinked = contracts.length === 0 && projects.length === 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="ui-label">Invoice lines {lines.length === 0 && <span className="normal-case font-medium text-[var(--ink-4)]">(optional)</span>}</label>
        <button
          type="button"
          onClick={addLine}
          disabled={nothingLinked}
          title={nothingLinked ? 'Link an agreement or project above first' : 'Add a line billing one or more agreement fees or projects'}
          className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--accent)] bg-[var(--accent-soft)] hover:brightness-95 px-2 py-1 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-3 h-3" /> Add line
        </button>
      </div>

      {lines.length === 0 ? (
        <p className="text-[11px] text-[var(--ink-4)]">
          {nothingLinked
            ? 'Link agreements or projects above to split this invoice into lines.'
            : 'Split the invoice into lines when it bills several agreements or projects, or different periods — the schedules then match each line on its own rows.'}
        </p>
      ) : (
        <div className="space-y-2">
          {lines.map((line, index) => {
            const options = optionsFor(line);
            const { contractIds, projectIds } = invoiceLineTargets(line);
            const selected = new Set([...contractIds, ...projectIds]);
            const split = selected.size > 1 ? splitOf(line, options) : null;
            return (
              <div key={line.id} className="space-y-2 rounded-[6px] border border-[var(--line)] bg-[var(--surface-muted)] p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="ui-label block mb-1">Bills</span>
                    <div role="group" aria-label={`What line ${index + 1} bills`} className="flex flex-wrap gap-1.5">
                      {options.map(option => {
                        const on = selected.has(option.id);
                        return (
                          <button
                            key={`${option.kind}-${option.id}`}
                            type="button"
                            aria-pressed={on}
                            title={option.title}
                            onClick={() => toggleTarget(index, option)}
                            className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11.5px] font-semibold transition-colors cursor-pointer ${
                              on
                                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]'
                                : 'border-[var(--line-strong)] text-[var(--ink-3)] hover:text-[var(--ink)]'
                            }`}
                          >
                            {on && <Check className="h-3 w-3" />}
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onChange(lines.filter((_, i) => i !== index))}
                    aria-label={`Remove line ${index + 1}`}
                    className="p-2 text-[var(--ink-4)] hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-12 sm:col-span-4">
                    <label className="ui-label block mb-1">Description</label>
                    <input
                      type="text"
                      value={line.description ?? ''}
                      onChange={e => update(index, { description: e.target.value })}
                      placeholder="e.g. Licences and support, Q3 2026"
                      className="ui-input text-xs"
                    />
                  </div>
                  <div className="col-span-6 sm:col-span-3">
                    <label className="ui-label block mb-1">Period from</label>
                    <DatePicker value={line.period_from ?? ''} onChange={next => update(index, { period_from: next || null })} className="w-full" />
                  </div>
                  <div className="col-span-6 sm:col-span-3">
                    <label className="ui-label block mb-1">Period to</label>
                    <DatePicker value={line.period_to ?? ''} onChange={next => update(index, { period_to: next || null })} className="w-full" />
                  </div>
                  <div className="col-span-12 sm:col-span-2">
                    <label className="ui-label block mb-1">Net ({currency})</label>
                    <input
                      type="number"
                      step="0.01"
                      value={line.amount}
                      onChange={e => update(index, { amount: parseFloat(e.target.value) || 0 })}
                      className="ui-input text-xs font-mono font-semibold"
                    />
                  </div>
                </div>

                {selected.size === 0 ? (
                  <p className="text-[11px] font-semibold text-[var(--danger)]">Choose what this line bills, or the schedules cannot match it.</p>
                ) : split && (
                  <p className="text-[11px] text-[var(--ink-3)]">Split by what each expects over the period: {split}.</p>
                )}
              </div>
            );
          })}
          <div className="flex justify-end text-[11px] text-[var(--ink-3)]">
            Lines total <span className="ml-1.5 font-mono font-bold text-[var(--ink)]">{formatMoney(total, currency)}</span>
            <span className="ml-1.5">— the invoice net</span>
          </div>
        </div>
      )}
    </div>
  );
};
