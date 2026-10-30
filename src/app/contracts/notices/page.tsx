"use client";

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { getContractNoticeStatus, NOTICE_ALERT_WINDOW_DAYS } from '@/lib/pricing-engine';
import { Card, Badge } from '@/components/ui/primitives';
import { formatDate } from '@/lib/date';
import type { Contract } from '@/lib/types';
import { AlertTriangle, ArrowLeft, ArrowUpRight, CalendarClock, CheckCircle2, Clock, Search } from 'lucide-react';

const searchFields = (contract: Contract) =>
  `${contract.reference} ${contract.counterparty?.legal_name || ''} ${contract.product || ''} ${contract.type || ''}`.toLowerCase();

const daysLabel = (days: number) => (days === 0 ? 'today' : `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`);

interface NoticeRow {
  contract: Contract;
  daysUntilNotice: number;
  daysUntilEnd: number;
  noticeDeadlineStr: string;
}

export default function ContractNoticeReportPage() {
  const { currentUser, contracts, isLoading } = useAuth();
  const [query, setQuery] = useState('');
  const isAdmin = currentUser.role === 'admin';

  const rows = useMemo<NoticeRow[]>(() => {
    const actionable: NoticeRow[] = [];
    const needle = query.trim().toLowerCase();
    contracts.forEach(contract => {
      const notice = getContractNoticeStatus(contract);
      if (!notice.isUrgent) return;
      if (needle && !searchFields(contract).includes(needle)) return;
      actionable.push({
        contract,
        daysUntilNotice: notice.daysUntilNotice,
        daysUntilEnd: notice.daysUntilEnd,
        noticeDeadlineStr: notice.noticeDeadlineStr,
      });
    });
    return actionable.sort((a, b) => a.daysUntilNotice - b.daysUntilNotice);
  }, [contracts, query]);

  const overdue = rows.filter(row => row.daysUntilNotice < 0);
  const dueSoon = rows.filter(row => row.daysUntilNotice >= 0 && row.daysUntilNotice <= 30);
  const later = rows.filter(row => row.daysUntilNotice > 30);
  const endingSoon = rows.filter(row => row.daysUntilEnd >= 0 && row.daysUntilEnd <= 30);

  if (!isAdmin) {
    return (
      <div className="p-10 text-center bg-slate-50 border border-slate-200 rounded-2xl max-w-xl mx-auto my-12 space-y-3 shadow-xs">
        <AlertTriangle className="w-10 h-10 mx-auto text-amber-600" />
        <h3 className="text-lg font-bold text-slate-800">Access Restricted: Admin Clearance Required</h3>
        <p className="text-xs text-slate-600 leading-relaxed">
          The notice-window report exposes confidential contract terms, client SLAs and vendor pricing. Your profile does not currently hold administrator credentials.
        </p>
      </div>
    );
  }

  const renderTable = (title: string, subtitle: string, badge: 'error' | 'warning' | 'info', data: NoticeRow[]) => {
    if (data.length === 0) return null;
    return (
      <Card className="overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50/70">
          <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
            <Badge variant={badge} className="text-[10px] px-2 py-0.5 font-black">{data.length}</Badge>
            {title}
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                <th className="text-left font-black px-5 py-2">Counterparty / Contract</th>
                <th className="text-left font-black px-3 py-2">Direction</th>
                <th className="text-left font-black px-3 py-2">Ends on</th>
                <th className="text-left font-black px-3 py-2">Notice deadline</th>
                <th className="text-left font-black px-3 py-2">Notice window</th>
                <th className="text-left font-black px-3 py-2">Renewal</th>
                <th className="text-right font-black px-5 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.map(({ contract, daysUntilNotice, daysUntilEnd, noticeDeadlineStr }) => {
                const isOverdue = daysUntilNotice < 0;
                return (
                  <tr key={contract.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3">
                      <div className="font-extrabold text-slate-900">{contract.counterparty?.legal_name || 'Unmapped counterparty'}</div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {contract.reference}{contract.product ? ` · ${contract.product}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant={contract.direction === 'revenue' ? 'success' : 'warning'} className="text-[10px] font-bold">
                        {contract.direction === 'revenue' ? 'Client' : 'Supplier'}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 font-mono text-slate-700">
                      {contract.ends_on ? formatDate(contract.ends_on) : '—'}
                      {daysUntilEnd >= 0 && daysUntilEnd <= 30 && (
                        <span className="block text-[10px] font-bold text-rose-600">in {daysLabel(daysUntilEnd)}</span>
                      )}
                    </td>
                    <td className="px-3 py-3 font-mono font-bold text-slate-900">{noticeDeadlineStr}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center gap-1 font-bold ${isOverdue ? 'text-rose-700' : daysUntilNotice <= 30 ? 'text-amber-700' : 'text-slate-600'}`}>
                        {isOverdue ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                        {isOverdue ? `${daysLabel(daysUntilNotice)} overdue` : `${daysLabel(daysUntilNotice)} left`}
                      </span>
                      <span className="block text-[10px] text-slate-500">
                        {contract.notice_period_days ?? 30}-day written notice
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {contract.auto_renews
                        ? <Badge variant={isOverdue ? 'error' : 'neutral'} className="text-[10px] font-bold">Auto-renews</Badge>
                        : <span className="text-slate-500">Expires</span>}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/contracts/${contract.id}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-bold text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
                      >
                        Open dossier <ArrowUpRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <Link href="/contracts" className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-[var(--accent)] transition-colors mb-2">
            <ArrowLeft className="w-3.5 h-3.5" /> Contract registry
          </Link>
          <h1 className="text-2xl font-semibold text-slate-800 tracking-tight flex items-center">
            <CalendarClock className="w-6 h-6 mr-3 text-rose-600" /> Action Required — Contract Notice Windows
          </h1>
          <p className="text-slate-500 text-xs mt-1">
            Agreements whose cancellation or renewal notice window is open — or was already missed — within the next {NOTICE_ALERT_WINDOW_DAYS} days.
            Sorted by urgency; a missed deadline keeps showing until the agreement ends.
          </p>
        </div>
        <div className="relative w-full sm:w-72 shrink-0">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search counterparty or contract…"
            className="w-full bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[var(--accent)] placeholder:text-slate-400"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card className="border-rose-200/70">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Missed notice windows</p>
          <p className="text-2xl font-black text-rose-600 mt-1">{overdue.length}</p>
          <p className="text-[11px] text-slate-500 mt-1">Deadline passed while the contract still runs</p>
        </Card>
        <Card className="border-amber-200/70">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Due within 30 days</p>
          <p className="text-2xl font-black text-amber-600 mt-1">{dueSoon.length}</p>
          <p className="text-[11px] text-slate-500 mt-1">Notice must be served shortly</p>
        </Card>
        <Card>
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Due in 31–{NOTICE_ALERT_WINDOW_DAYS} days</p>
          <p className="text-2xl font-black text-slate-800 mt-1">{later.length}</p>
          <p className="text-[11px] text-slate-500 mt-1">Plan the renegotiation now</p>
        </Card>
        <Card>
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Contracts ending ≤ 30 days</p>
          <p className="text-2xl font-black text-slate-800 mt-1">{endingSoon.length}</p>
          <p className="text-[11px] text-slate-500 mt-1">Expiry or auto-renewal imminent</p>
        </Card>
      </div>

      {isLoading && rows.length === 0 ? (
        <Card className="py-10 text-center">
          <p className="text-sm font-bold text-slate-500">Loading notice windows…</p>
        </Card>
      ) : rows.length === 0 ? (
        <Card className="py-10 text-center">
          <CheckCircle2 className="w-9 h-9 mx-auto text-emerald-600 mb-2" />
          <p className="text-sm font-extrabold text-slate-800">
            {query ? 'No notice windows match that search.' : 'No notice windows need action right now.'}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            {query
              ? 'Clear the search to see every open or missed window.'
              : `Every active agreement is more than ${NOTICE_ALERT_WINDOW_DAYS} days away from its notice deadline.`}
          </p>
        </Card>
      ) : (
        <div className="space-y-5">
          {renderTable('Notice window missed', 'The deadline has passed and the agreement has not ended yet — act before it auto-renews or lapses.', 'error', overdue)}
          {renderTable('Due within 30 days', 'Serve the written notice now to keep the option to cancel or renegotiate.', 'warning', dueSoon)}
          {renderTable(`Due in 31–${NOTICE_ALERT_WINDOW_DAYS} days`, 'Window opens inside the alert horizon — start the renewal conversation early.', 'info', later)}
        </div>
      )}
    </div>
  );
}
