"use client";

import React, { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, Button, Badge } from '@/components/ui/primitives';
import { notifySuccess, notifyValidation } from '@/lib/validation-modal';
import { formatDate } from '@/lib/date';
import { Calendar, Plus, Edit2, Trash2, Save, X, Info, AlertTriangle } from 'lucide-react';
import type { PublicHoliday } from '@/lib/types';

const WEEKDAY_CODES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Weekday of a `YYYY-MM-DD` string, built from local parts so it can't shift a day. */
function weekdayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return WEEKDAY_CODES[new Date(y, m - 1, d).getDay()];
}

const SCOPES: Array<{ value: PublicHoliday['scope']; label: string }> = [
  { value: 'national', label: 'National' },
  { value: 'thessaloniki', label: 'Thessaloniki' },
];

/**
 * Public-holiday calendar (Settings → Leaves).
 *
 * `public_holidays` is the single source of truth for working-day maths: leave, remote quota and
 * timesheet capacity all subtract these dates, so a missing year silently costs every employee a
 * day of leave (that is exactly what the empty 2024/2025 did — 15 August 2024 was charged as leave).
 *
 * Adding or removing a holiday re-costs the leave records the change reaches. The context owns that
 * rule; this screen only reports how many rows moved, and says loudly that a hand-adjusted row is
 * never touched.
 */
export function HolidaysCard() {
  const { publicHolidays, addPublicHoliday, updatePublicHoliday, deletePublicHoliday } = useAuth();

  const years = useMemo(() => {
    const set = new Set<number>(publicHolidays.map(h => h.year));
    set.add(new Date().getFullYear());
    return Array.from(set).sort((a, b) => b - a);
  }, [publicHolidays]);

  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const [isAdding, setIsAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const [newDate, setNewDate] = useState('');
  const [newNameEn, setNewNameEn] = useState('');
  const [newNameEl, setNewNameEl] = useState('');
  const [newScope, setNewScope] = useState<PublicHoliday['scope']>('national');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editNameEn, setEditNameEn] = useState('');
  const [editNameEl, setEditNameEl] = useState('');
  const [editScope, setEditScope] = useState<PublicHoliday['scope']>('national');

  const rows = useMemo(
    () => publicHolidays.filter(h => h.year === year).sort((a, b) => a.date.localeCompare(b.date) || a.scope.localeCompare(b.scope)),
    [publicHolidays, year],
  );

  const resetAddForm = () => {
    setNewDate('');
    setNewNameEn('');
    setNewNameEl('');
    setNewScope('national');
    setIsAdding(false);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDate) {
      notifyValidation({ type: 'warning', title: 'Date required', message: 'Pick the date of the holiday.' });
      return;
    }
    if (!newNameEn.trim() || !newNameEl.trim()) {
      notifyValidation({ type: 'warning', title: 'Names required', message: 'Give the holiday both an English and a Greek name — the calendar shows them on hover.' });
      return;
    }
    if (publicHolidays.some(h => h.date === newDate && h.scope === newScope)) {
      notifyValidation({
        type: 'warning',
        title: 'Already in the calendar',
        message: `${formatDate(newDate)} already has a ${newScope} holiday. Edit that row instead of adding a second one.`,
      });
      return;
    }
    setBusy(true);
    const res = await addPublicHoliday({
      date: newDate,
      name_en: newNameEn.trim(),
      name_el: newNameEl.trim(),
      scope: newScope,
      year: Number(newDate.slice(0, 4)),
    });
    setBusy(false);
    if (res.ok) {
      setYear(Number(newDate.slice(0, 4)));
      resetAddForm();
      notifySuccess(
        res.recosted > 0
          ? `Holiday added. ${res.recosted} leave record${res.recosted === 1 ? '' : 's'} re-costed.`
          : 'Holiday added. No leave record was affected.',
        'Holiday saved',
      );
    }
  };

  const startEdit = (h: PublicHoliday) => {
    setEditingId(h.id);
    setEditDate(h.date);
    setEditNameEn(h.name_en);
    setEditNameEl(h.name_el);
    setEditScope(h.scope);
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    if (!editDate || !editNameEn.trim() || !editNameEl.trim()) {
      notifyValidation({ type: 'warning', title: 'Incomplete', message: 'A holiday needs a date and both names.' });
      return;
    }
    setBusy(true);
    const res = await updatePublicHoliday(editingId, {
      date: editDate,
      name_en: editNameEn.trim(),
      name_el: editNameEl.trim(),
      scope: editScope,
    });
    setBusy(false);
    if (res.ok) {
      setEditingId(null);
      setYear(Number(editDate.slice(0, 4)));
      notifySuccess(
        res.recosted > 0 ? `Holiday updated. ${res.recosted} leave record${res.recosted === 1 ? '' : 's'} re-costed.` : 'Holiday updated.',
        'Holiday saved',
      );
    }
  };

  const handleDelete = async (h: PublicHoliday) => {
    const ok = confirm(
      `Remove ${h.name_en} (${formatDate(h.date)}) from the calendar?\n\n` +
      'Any leave already filed that was costed with this holiday will be re-costed, which can INCREASE the days it deducts. ' +
      'Records an admin adjusted by hand are left untouched.',
    );
    if (!ok) return;
    setBusy(true);
    const res = await deletePublicHoliday(h.id);
    setBusy(false);
    if (res.ok) {
      notifySuccess(
        res.recosted > 0 ? `Holiday removed. ${res.recosted} leave record${res.recosted === 1 ? '' : 's'} re-costed.` : 'Holiday removed. No leave record was affected.',
        'Holiday removed',
      );
    }
  };

  return (
    <Card
      title="Public Holidays"
      subtitle="The single source of truth for working-day maths — leave, remote quota and timesheet capacity all subtract these dates"
      className="shadow-xs border-slate-200"
      action={
        <div className="flex items-center gap-2">
          <select
            value={year}
            onChange={e => { setYear(Number(e.target.value)); setEditingId(null); }}
            className="px-3 py-2 border border-slate-300 rounded-xl bg-white text-xs font-bold text-slate-700 focus:ring-2 focus:ring-[#3D87D3] outline-none cursor-pointer"
          >
            {years.map(y => (
              <option key={y} value={y}>
                {y} ({publicHolidays.filter(h => h.year === y).length})
              </option>
            ))}
          </select>
          <Button
            variant="primary"
            size="sm"
            onClick={() => (isAdding ? resetAddForm() : setIsAdding(true))}
            className="bg-[#3D87D3] text-white cursor-pointer shrink-0"
          >
            {isAdding ? <><X className="w-3.5 h-3.5 mr-1.5" /> Cancel</> : <><Plus className="w-3.5 h-3.5 mr-1.5" /> Add Holiday</>}
          </Button>
        </div>
      }
    >
      <p className="mt-1 text-[11px] text-slate-500 flex items-start gap-1.5">
        <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-px" />
        <span>
          Editing this calendar re-costs the leave records the change reaches. Records an admin adjusted by hand
          (or that still carry a stale count from before September 2026) are recognised and left alone.
        </span>
      </p>

      {isAdding && (
        <form onSubmit={handleAdd} className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
          <label className="sm:col-span-1 block">
            <span className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">Date</span>
            <input
              type="date"
              value={newDate}
              onChange={e => setNewDate(e.target.value)}
              className="mt-1 w-full px-2 py-2 border border-slate-300 rounded-lg bg-white text-xs font-bold text-slate-800 focus:ring-2 focus:ring-[#3D87D3] outline-none"
            />
          </label>
          <label className="sm:col-span-1 block">
            <span className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">Name (EN)</span>
            <input
              value={newNameEn}
              onChange={e => setNewNameEn(e.target.value)}
              placeholder="e.g. Assumption"
              className="mt-1 w-full px-2 py-2 border border-slate-300 rounded-lg bg-white text-xs font-bold text-slate-800 focus:ring-2 focus:ring-[#3D87D3] outline-none"
            />
          </label>
          <label className="sm:col-span-1 block">
            <span className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">Name (EL)</span>
            <input
              value={newNameEl}
              onChange={e => setNewNameEl(e.target.value)}
              placeholder="π.χ. Κοίμηση της Θεοτόκου"
              className="mt-1 w-full px-2 py-2 border border-slate-300 rounded-lg bg-white text-xs font-bold text-slate-800 focus:ring-2 focus:ring-[#3D87D3] outline-none"
            />
          </label>
          <label className="sm:col-span-1 block">
            <span className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">Scope</span>
            <select
              value={newScope}
              onChange={e => setNewScope(e.target.value as PublicHoliday['scope'])}
              className="mt-1 w-full px-2 py-2 border border-slate-300 rounded-lg bg-white text-xs font-bold text-slate-800 focus:ring-2 focus:ring-[#3D87D3] outline-none cursor-pointer"
            >
              {SCOPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <Button type="submit" variant="primary" size="sm" disabled={busy} className="bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer h-[34px]">
            <Save className="w-3.5 h-3.5 mr-1.5" /> Save
          </Button>
        </form>
      )}

      {rows.length === 0 ? (
        <div className="mt-3 p-4 rounded-xl border border-dashed border-amber-300 bg-amber-50 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">
            <strong>No holidays loaded for {year}.</strong> Every weekday in this year counts as a working day, so leave
            spend is overstated for anyone whose range covers a holiday. Add the year's holidays here.
          </p>
        </div>
      ) : (
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <th className="text-left font-extrabold px-3 py-2">Date</th>
                <th className="text-left font-extrabold px-3 py-2">Day</th>
                <th className="text-left font-extrabold px-3 py-2">English</th>
                <th className="text-left font-extrabold px-3 py-2">Greek</th>
                <th className="text-left font-extrabold px-3 py-2">Scope</th>
                <th className="text-right font-extrabold px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(h => {
                if (editingId === h.id) {
                  return (
                    <tr key={h.id} className="bg-blue-50/60 border-t border-slate-200">
                      <td className="px-2 py-2">
                        <input
                          type="date"
                          value={editDate}
                          onChange={e => setEditDate(e.target.value)}
                          className="w-full px-2 py-1.5 border border-[#3D87D3] rounded-lg bg-white text-xs font-bold text-slate-800 outline-none"
                        />
                      </td>
                      <td className="px-3 py-2 text-slate-400 font-bold">{weekdayOf(editDate)}</td>
                      <td className="px-2 py-2">
                        <input
                          value={editNameEn}
                          onChange={e => setEditNameEn(e.target.value)}
                          className="w-full px-2 py-1.5 border border-[#3D87D3] rounded-lg bg-white text-xs font-bold text-slate-800 outline-none"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={editNameEl}
                          onChange={e => setEditNameEl(e.target.value)}
                          className="w-full px-2 py-1.5 border border-[#3D87D3] rounded-lg bg-white text-xs font-bold text-slate-800 outline-none"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          value={editScope}
                          onChange={e => setEditScope(e.target.value as PublicHoliday['scope'])}
                          className="w-full px-2 py-1.5 border border-[#3D87D3] rounded-lg bg-white text-xs font-bold text-slate-800 outline-none cursor-pointer"
                        >
                          {SCOPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button size="sm" variant="primary" onClick={handleUpdate} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer !px-2.5">
                            <Save className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEditingId(null)} className="border-slate-300 cursor-pointer !px-2.5">
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={h.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                    <td className="px-3 py-2 font-bold text-slate-800">{formatDate(h.date)}</td>
                    <td className="px-3 py-2 text-slate-500 font-bold">{weekdayOf(h.date)}</td>
                    <td className="px-3 py-2 text-slate-700">{h.name_en}</td>
                    <td className="px-3 py-2 text-slate-700">{h.name_el}</td>
                    <td className="px-3 py-2">
                      <Badge variant={h.scope === 'thessaloniki' ? 'info' : 'neutral'}>{h.scope === 'thessaloniki' ? 'Thessaloniki' : 'National'}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => startEdit(h)} className="text-xs py-1.5 font-bold border-slate-300 hover:bg-slate-50 cursor-pointer">
                          <Edit2 className="w-3.5 h-3.5 mr-1 text-blue-600" /> Edit
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleDelete(h)} disabled={busy} className="text-xs py-1.5 font-bold text-rose-700 border-rose-200 hover:bg-rose-50 cursor-pointer">
                          <Trash2 className="w-3.5 h-3.5 mr-1 text-rose-600" /> Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 text-[10px] font-bold text-slate-500 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-amber-500" />
            {rows.length} holiday{rows.length === 1 ? '' : 's'} in {year} · synced with public.public_holidays
          </div>
        </div>
      )}
    </Card>
  );
}
