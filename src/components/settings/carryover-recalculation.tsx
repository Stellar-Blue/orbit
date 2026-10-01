"use client";

import React, { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, Button, Badge } from '@/components/ui/primitives';
import { notifySuccess } from '@/lib/validation-modal';
import { RefreshCw, Info, Lock, Unlock, CheckCircle2, Users, AlertTriangle } from 'lucide-react';

/**
 * Carry-over recalculation (Settings → Leaves).
 *
 * The balance derives carry-over LIVE, so nothing here is needed for the numbers to be right. What
 * this screen is for is the stored copy: `leave_entitlements.carried_over_days` is what People →
 * Edit Profile and the Excel exports read, and it goes stale the moment something moves underneath
 * it — a leave record re-costed, a holiday added, an entitlement changed.
 *
 * Preview first, by design: `planLeaveCarryover` is the same walk as `syncLeaveCarryover`, so the
 * table below IS what a run writes. Nothing is overwritten that an admin set by hand, and a hand-set
 * value can be handed back to the automatic rule from here (that used to be a one-way door).
 */
export function CarryoverRecalculationCard() {
  const {
    entitlements, profiles, currentUser,
    planLeaveCarryover, syncLeaveCarryover, releaseLeaveEntitlementToAuto, staleLeaveDayCounts,
  } = useAuth();
  const isAdmin = currentUser.role === 'admin';

  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<string[] | null>(null);

  // Recomputed on every render on purpose: it reads live state, and the table has to show the
  // values the NEXT run would write (including right after a run rewrote some of them).
  const plan = planLeaveCarryover();
  // A leave row whose stored day count disagrees with its dates is what makes a pot wrong for no
  // visible reason — 8 of them hid 6 missing days of a 2024 usage. Never let that be silent again.
  const staleDays = staleLeaveDayCounts();

  const payable = plan.filter(r => !r.isManual);
  const moves = payable.filter(r => r.stored !== r.derived);
  const netDays = moves.reduce((sum, r) => sum + (r.derived - (r.stored ?? 0)), 0);
  const newRecords = moves.filter(r => r.stored === null).length;
  const manualRows = plan.filter(r => r.isManual);

  /** Active employees the rule derives nothing for because no entitlement record exists. */
  const notSetUp = useMemo(
    () => profiles.filter(p => p.status === 'active' && p.employment_type !== 'contractor'
      && !entitlements.some(e => e.profile_id === p.id)),
    [profiles, entitlements],
  );

  const run = async (profileId?: string, label?: string) => {
    setBusy(profileId ?? 'all');
    setReport(null);
    const result = await syncLeaveCarryover(profileId);
    setBusy(null);
    if (!result) return;

    const lines = [
      `${result.created} record(s) created, ${result.updated} refreshed` +
      (result.manual > 0 ? `, ${result.manual} left alone (set by hand)` : '') + '.',
      ...result.changes
        .sort((a, b) => a.year - b.year || a.profileName.localeCompare(b.profileName))
        .map(c => `${c.profileName} · ${c.year}: ${c.from} → ${c.to} day(s)`),
    ];
    setReport(lines);
    notifySuccess(
      result.changes.length > 0
        ? `${label ?? 'Carry-over'} recalculated — ${result.changes.length} value(s) changed.`
        : `${label ?? 'Carry-over'} recalculated — nothing needed to change.`,
      'Recalculated',
    );
  };

  const release = async (profileName: string, profileId: string, year: number) => {
    const ok = await releaseLeaveEntitlementToAuto(profileId, year);
    if (ok) {
      setReport([`${profileName} · ${year}: handed back to the automatic rule (value refreshed, no longer MANUAL).`]);
      notifySuccess(`${profileName}'s ${year} carry-over now follows the calculated value.`, 'Released to automatic');
    }
  };

  if (!isAdmin) return null;

  return (
    <Card
      title="Carry-Over Recalculation"
      subtitle="Preview, then write the calculated carry-over into each employee's entitlement record"
      className="shadow-xs border-slate-200"
      action={
        <Button
          variant="primary"
          size="sm"
          onClick={() => run(undefined, 'Company-wide carry-over')}
          disabled={busy !== null}
          className="bg-[#3D87D3] text-white cursor-pointer shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${busy === 'all' ? 'animate-spin' : ''}`} />
          {busy === 'all' ? 'Recalculating…' : 'Recalculate all'}
        </Button>
      }
    >
      <div className="space-y-4 mt-2">
        <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 text-[11px] text-blue-900 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-[#3D87D3] shrink-0 mt-0.5" />
          <span>
            The balances already use the calculated carry-over — this writes the same number into the stored
            entitlement record, which is what People → Edit Profile and the Excel exports read. Records marked{' '}
            <strong className="font-extrabold">MANUAL</strong> are never overwritten: release one with the unlock
            button to put it back under the automatic rule.
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
          <Badge variant={moves.length > 0 ? 'warning' : 'success'} className="text-[10px] px-2 py-0.5">
            {moves.length} value{moves.length === 1 ? '' : 's'} would change
          </Badge>
          {netDays !== 0 && (
            <Badge variant={netDays > 0 ? 'success' : 'error'} className="text-[10px] px-2 py-0.5">
              {netDays > 0 ? '+' : ''}{netDays} day(s) net
            </Badge>
          )}
          {newRecords > 0 && (
            <Badge variant="info" className="text-[10px] px-2 py-0.5">{newRecords} new record(s)</Badge>
          )}
          {manualRows.length > 0 && (
            <Badge variant="neutral" className="text-[10px] px-2 py-0.5">
              {manualRows.length} protected MANUAL record(s)
            </Badge>
          )}
          <span className="font-normal text-slate-500">· nothing is written until you press a button</span>
        </div>

        {plan.length === 0 ? (
          <div className="p-4 rounded-xl border border-dashed border-slate-300 text-xs text-slate-500">
            No carry-over to calculate: no employee has entitlement records for two consecutive years.
            Set up the yearly allowance in <strong className="text-slate-700">People → Edit Profile → Annual Leave
            Entitlement</strong> first — a carry-over needs the closed year to have been granted explicitly.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="text-left font-extrabold px-3 py-2">Employee</th>
                  <th className="text-left font-extrabold px-3 py-2">Year</th>
                  <th className="text-right font-extrabold px-3 py-2">Stored</th>
                  <th className="text-right font-extrabold px-3 py-2">Calculated</th>
                  <th className="text-right font-extrabold px-3 py-2">Change</th>
                  <th className="text-right font-extrabold px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {plan.map(row => {
                  const delta = row.isManual ? 0 : row.derived - (row.stored ?? 0);
                  const movesRow = delta !== 0;
                  return (
                    <tr
                      key={`${row.profileId}-${row.year}`}
                      className={`border-t border-slate-100 ${row.isManual ? 'bg-slate-50/60' : movesRow ? 'bg-amber-50/40' : ''}`}
                    >
                      <td className="px-3 py-2 font-bold text-slate-800">{row.profileName}</td>
                      <td className="px-3 py-2 text-slate-600 font-mono">{row.year}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-700">
                        {row.stored === null
                          ? <span className="text-slate-400">not set</span>
                          : <span className={row.isManual ? 'font-bold' : ''}>{row.stored}</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{row.derived}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {row.isManual
                          ? <span className="inline-flex items-center gap-1 text-slate-500 font-sans font-bold"><Lock className="w-3 h-3" />manual</span>
                          : movesRow
                            ? <span className={`font-bold ${delta > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{delta > 0 ? '+' : ''}{delta}</span>
                            : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1.5">
                          {row.isManual ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => release(row.profileName, row.profileId, row.year)}
                              disabled={busy !== null}
                              title={`Adopt the calculated ${row.derived} day(s) and stop treating this record as manual`}
                              className="text-xs py-1.5 font-bold border-slate-300 hover:bg-white cursor-pointer"
                            >
                              <Unlock className="w-3.5 h-3.5 mr-1 text-amber-600" /> Use calculated
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => run(row.profileId, `${row.profileName} ${row.year}`)}
                              disabled={busy !== null || !movesRow}
                              className="text-xs py-1.5 font-bold border-slate-300 hover:bg-slate-50 cursor-pointer disabled:opacity-40"
                            >
                              <RefreshCw className={`w-3.5 h-3.5 mr-1 text-blue-600 ${busy === row.profileId ? 'animate-spin' : ''}`} />
                              Recalculate
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 text-[10px] font-bold text-slate-500">
              {plan.length} record(s) in scope · per-employee recalculation only touches that employee&apos;s chain
            </div>
          </div>
        )}

        {report && (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-900 space-y-1">
            <p className="font-extrabold flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" /> What changed
            </p>
            {report.map((line, i) => <p key={i} className="font-mono leading-relaxed">{line}</p>)}
          </div>
        )}

        {staleDays.length > 0 && (
          <div className="p-4 rounded-xl border border-rose-300 bg-rose-50 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="text-[11px] text-rose-900 space-y-1 w-full">
              <p className="font-extrabold">
                {staleDays.length} leave record{staleDays.length === 1 ? '' : 's'} disagree with their own dates
              </p>
              <p className="leading-relaxed">
                The balance is deducted by the day count stored on the record, so a wrong one quietly skews the year
                it sits in — and every carry-over derived from that year. Fix the record in{' '}
                <strong className="font-extrabold">Company Leave</strong> (editing the dates re-costs it), unless an
                admin adjusted the count on purpose, in which case ignore this.
              </p>
              <div className="mt-1.5 space-y-0.5 font-mono">
                {staleDays.slice(0, 6).map(s => (
                  <p key={s.id}>
                    {s.profileName} · {s.startDate} → {s.endDate}: stored {s.stored}, dates say {s.computed}
                  </p>
                ))}
                {staleDays.length > 6 && <p>…and {staleDays.length - 6} more</p>}
              </div>
            </div>
          </div>
        )}

        {notSetUp.length > 0 && (
          <div className="p-4 rounded-xl border border-amber-300 bg-amber-50 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-[11px] text-amber-900 space-y-1">
              <p className="font-extrabold flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> {notSetUp.length} active employee(s) have no entitlement records
              </p>
              <p className="leading-relaxed">
                No yearly allowance has been granted for them, so the rule derives (and would write){' '}
                <strong className="font-extrabold">nothing</strong> — a carry-over needs the closed year to have
                been granted explicitly, otherwise everyone would carry over the company default from years nobody
                set up. Give them a record per year in People → Edit Profile first.
              </p>
              <p className="font-bold">{notSetUp.map(p => `${p.first_name} ${p.last_name}`).join(' · ')}</p>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
