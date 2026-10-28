"use client";

import React from 'react';
import { Gift } from 'lucide-react';
import { SalaryRecord, PaymentType } from '@/lib/types';
import { formatDate } from '@/lib/date';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The contractual recurring extras on an employee's ledger, shown as their monthly benefits.
 * Read-only for the employee: extras are added/edited by an admin on Compensation & Payroll.
 */
export function BenefitsList({ extras, paymentTypes }: { extras: SalaryRecord[]; paymentTypes: PaymentType[] }) {
  const isRunning = (x: SalaryRecord) => !x.valid_to || x.valid_to >= today();
  const contractedTotal = extras
    .filter(isRunning)
    .reduce((sum, x) => sum + (Number(x.gross_amount) || 0), 0);

  return (
    <div className="mt-6 pt-5 border-t border-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 flex items-center">
          <Gift className="w-4 h-4 mr-1.5 text-[#2f6fa3]" /> Recurring Monthly Benefits
        </h3>
        {contractedTotal > 0 && (
          <span className="text-xs font-bold text-slate-600">
            Contracted total: <span className="font-mono text-emerald-700">€{contractedTotal.toLocaleString('de-DE', { minimumFractionDigits: 2 })}</span> / month
          </span>
        )}
      </div>

      {extras.length === 0 ? (
        <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
          No recurring extras are part of your contract. One-off bonuses (Easter, Summer, Xmas or ad-hoc) appear in your payment history once they are paid.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {extras.map(x => {
            const pt = x.payment_type_id ? paymentTypes.find(t => t.id === x.payment_type_id) : undefined;
            const running = isRunning(x);
            return (
              <li
                key={x.id}
                className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${running ? 'bg-emerald-50/60 border-emerald-200/80' : 'bg-slate-50 border-slate-200/80'}`}
              >
                <div className="min-w-0">
                  <span className={`text-xs font-extrabold block truncate ${running ? 'text-slate-900' : 'text-slate-500 line-through'}`}>
                    {x.label || 'Contractual extra'}
                  </span>
                  <span className="text-[10px] text-slate-500 block truncate">
                    {pt ? `${pt.name_el} · ${pt.name_en}` : 'Bonus category'}
                    {' · '}
                    {formatDate(x.valid_from)} → {x.valid_to ? formatDate(x.valid_to) : 'Present'}
                  </span>
                </div>
                <div className="text-right shrink-0">
                  <span className={`font-mono font-extrabold text-sm block ${running ? 'text-emerald-700' : 'text-slate-400'}`}>
                    €{Number(x.gross_amount).toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                  </span>
                  <span className="text-[10px] font-bold text-slate-500 uppercase">{running ? 'per month' : 'ended'}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
