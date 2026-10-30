"use client";

import React from 'react';
import Link from 'next/link';
import { Receipt } from 'lucide-react';
import { projectBillingBasis, projectBasisLabel, type ProjectBillingInput, type ProjectBillingInvoice, type ProjectValueInput } from '@/lib/project-billing';

const money = (n: number, min = 2) => `€${n.toLocaleString('en-US', { minimumFractionDigits: min, maximumFractionDigits: min })}`;

/**
 * Billing bar for one project: what is uninvoiced, what the draft will carry, and how the logged hours
 * reconcile against the project's value. Split out of the projects tab so it can be rendered standalone.
 */
export function ProjectBillingBar({
  project,
  entries,
  invoices,
  contractId,
}: {
  project: ProjectValueInput & { name: string };
  entries: ProjectBillingInput[];
  invoices: ProjectBillingInvoice[];
  contractId: string;
}) {
  const basis = projectBillingBasis(entries, invoices, project);
  const amount = basis.suggestedAmount;
  const link = `/invoices?new=1&contract=${contractId}&project=${project.id}&net=${amount}`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
        <span className="text-[11px] font-semibold text-slate-600">
          {basis.unbilledHours > 0 ? (
            <>
              <span className="font-mono text-slate-800">{basis.unbilledHours}h</span> approved, not invoiced
              {amount > 0 ? (
                <> &middot; draft amount <span className="font-mono font-extrabold text-emerald-700">{money(amount)}</span>{' '}
                  <span className="text-slate-400">({projectBasisLabel(basis.basis)})</span></>
              ) : (
                <span className="text-amber-700"> &middot; no billing rate or project value to price it</span>
              )}
            </>
          ) : (
            <span className="text-slate-400">No approved, uninvoiced billable hours on this project.</span>
          )}
        </span>
        <Link
          href={link}
          className="inline-flex items-center gap-1.5 text-[11px] font-extrabold text-[var(--accent)] hover:underline shrink-0"
          title={amount > 0 ? `Open the register pre-filled with ${money(amount)} (${projectBasisLabel(basis.basis)})` : 'Open the register for this project'}
        >
          <Receipt className="w-3.5 h-3.5" /> Create draft invoice →
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-[11px]">
        <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Logged</div>
          <div className="font-mono font-bold text-slate-800">{basis.loggedHours}h · {(basis.loggedHours / 8).toFixed(1)}d</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Project value</div>
          <div className="font-mono font-bold text-slate-800">
            {basis.projectValue != null ? money(basis.projectValue, 0) : <span className="text-slate-400 font-normal">not set</span>}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Implied rate</div>
          <div className="font-mono font-bold text-slate-800">
            {basis.impliedRate != null ? `${money(basis.impliedRate)}/h` : <span className="text-slate-400 font-normal">—</span>}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Invoiced</div>
          <div className="font-mono font-bold text-slate-800">{money(basis.invoicedAmount)}</div>
        </div>
      </div>

      {basis.hoursValueAtImpliedRate != null && basis.projectValue != null && (
        <div className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${
          basis.hoursValueAtImpliedRate > basis.projectValue
            ? 'bg-rose-50 border-rose-200 text-rose-800'
            : 'bg-blue-50/60 border-blue-200 text-slate-700'
        }`}>
          {basis.loggedHours}h at the implied {basis.impliedRate != null ? `${money(basis.impliedRate)}/h` : 'rate'} ={' '}
          {money(basis.hoursValueAtImpliedRate)} of the {money(basis.projectValue, 0)} project value
          {basis.projectValue > 0 && ` (${Math.round((basis.hoursValueAtImpliedRate / basis.projectValue) * 100)}% consumed)`}
          {basis.hoursValueAtImpliedRate > basis.projectValue && ' — the logged hours already exceed the project value.'}
        </div>
      )}

      {basis.warnings.length > 0 && (
        <ul className="space-y-1">
          {basis.warnings.map((w, i) => (
            <li key={i} className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
