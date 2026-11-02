"use client";

import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { DatePicker } from '@/components/ui/date-picker';
import { formatMoney } from '@/lib/currency';
import type { Contract, InvoiceLine, Project } from '@/lib/types';

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

const targetOf = (line: InvoiceLine) => line.project_id ? `p:${line.project_id}` : line.contract_id ? `c:${line.contract_id}` : '';

/**
 * "What does each part of this invoice bill?" — one line per agreement fee or project, each with its
 * own amount and service period. Once there is a line, the invoice net is the sum of the lines.
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
  const update = (index: number, patch: Partial<InvoiceLine>) =>
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const setTarget = (index: number, value: string) => {
    const [kind, id] = value.split(':');
    if (kind === 'p') {
      update(index, { project_id: id, contract_id: projects.find(project => project.id === id)?.contract_id ?? null });
    } else {
      update(index, { project_id: null, contract_id: id || null });
    }
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
        contract_id: first?.id ?? null,
        project_id: null,
      },
    ]);
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
          title={nothingLinked ? 'Link an agreement or project above first' : 'Add a line billing one agreement fee or project'}
          className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--accent)] bg-[var(--accent-soft)] hover:brightness-95 px-2 py-1 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-3 h-3" /> Add line
        </button>
      </div>

      {lines.length === 0 ? (
        <p className="text-[11px] text-[var(--ink-4)]">
          {nothingLinked
            ? 'Link agreements or projects above to split this invoice into lines.'
            : 'Split the invoice into lines when it bills several agreements or projects, or different periods — the schedules then match each line on its own row.'}
        </p>
      ) : (
        <div className="space-y-2">
          {lines.map((line, index) => (
            <div key={line.id} className="grid grid-cols-12 gap-2 items-end rounded-[6px] border border-[var(--line)] bg-[var(--surface-muted)] p-2">
              <div className="col-span-12 sm:col-span-4">
                <label className="ui-label block mb-1">Bills</label>
                <select value={targetOf(line)} onChange={e => setTarget(index, e.target.value)} className="ui-input text-xs font-semibold">
                  <option value="" disabled>Choose an agreement fee or project…</option>
                  {contracts.map(contract => (
                    <option key={contract.id} value={`c:${contract.id}`}>Fee · {contract.reference || contract.product || 'Agreement'}</option>
                  ))}
                  {projects.map(project => (
                    <option key={project.id} value={`p:${project.id}`}>
                      Project · {project.code ? `${project.code} · ` : ''}{project.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-12 sm:col-span-8">
                <label className="ui-label block mb-1">Description</label>
                <input
                  type="text"
                  value={line.description ?? ''}
                  onChange={e => update(index, { description: e.target.value })}
                  placeholder="e.g. ETRM licence Q3 2026"
                  className="ui-input text-xs"
                />
              </div>
              <div className="col-span-6 sm:col-span-4">
                <label className="ui-label block mb-1">Period from</label>
                <DatePicker value={line.period_from ?? ''} onChange={next => update(index, { period_from: next || null })} className="w-full" />
              </div>
              <div className="col-span-6 sm:col-span-4">
                <label className="ui-label block mb-1">Period to</label>
                <DatePicker value={line.period_to ?? ''} onChange={next => update(index, { period_to: next || null })} className="w-full" />
              </div>
              <div className="col-span-10 sm:col-span-3">
                <label className="ui-label block mb-1">Net ({currency})</label>
                <input
                  type="number"
                  step="0.01"
                  value={line.amount}
                  onChange={e => update(index, { amount: parseFloat(e.target.value) || 0 })}
                  className="ui-input text-xs font-mono font-semibold"
                />
              </div>
              <div className="col-span-2 sm:col-span-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => onChange(lines.filter((_, i) => i !== index))}
                  aria-label={`Remove line ${index + 1}`}
                  className="p-2 text-[var(--ink-4)] hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          <div className="flex justify-end text-[11px] text-[var(--ink-3)]">
            Lines total <span className="ml-1.5 font-mono font-bold text-[var(--ink)]">{formatMoney(total, currency)}</span>
            <span className="ml-1.5">— the invoice net</span>
          </div>
        </div>
      )}
    </div>
  );
};
