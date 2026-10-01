"use client";

import React, { useEffect, useRef, useState } from 'react';
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';

interface MonthRangePickerProps {
  /** `YYYY-MM` */
  from: string;
  /** `YYYY-MM` */
  to: string;
  onChange: (from: string, to: string) => void;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `YYYY-MM` → a sortable month index (`year * 12 + month`), or null for an empty value. */
function monthIndex(value: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value || '');
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
}

function monthKey(year: number, index: number): string {
  return `${year}-${String(index + 1).padStart(2, '0')}`;
}

function monthLabel(value: string): string {
  const i = monthIndex(value);
  return i === null ? '—' : `${MONTH_SHORT[i % 12]} ${Math.floor(i / 12)}`;
}

/**
 * One control for a month range: a single trigger plus a 12-month grid.
 *
 * Two separate month inputs let you set From after To, which silently produced an empty period
 * everywhere the range is used. Here the range cannot invert — the second click of a pair is always
 * the later month, and a backwards click swaps the two.
 */
export const MonthRangePicker: React.FC<MonthRangePickerProps> = ({ from, to, onChange }) => {
  const [open, setOpen] = useState(false);
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [year, setYear] = useState<number>(() => Number((from || to || '').slice(0, 4)) || new Date().getFullYear());
  const boxRef = useRef<HTMLDivElement>(null);

  // Follow the selection when it is changed from outside (the 1 Month / Year Range shortcuts).
  const anchorYear = () => Number((from || to || '').slice(0, 4)) || new Date().getFullYear();

  useEffect(() => {
    if (!open) return;
    const dismiss = () => { setOpen(false); setPendingStart(null); };
    const onPointerDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) dismiss();
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const close = () => { setOpen(false); setPendingStart(null); };

  /** Always open on the year the current range lives in, so the view can never drift out of sync. */
  const toggleOpen = () => {
    if (open) { close(); return; }
    setYear(anchorYear());
    setPendingStart(null);
    setOpen(true);
  };

  const startIdx = monthIndex(from);
  const endIdx = monthIndex(to);
  const rangeText = startIdx === null
    ? 'Any period'
    : endIdx === null || startIdx === endIdx
      ? monthLabel(from)
      : `${monthLabel(from)} → ${monthLabel(to)}`;

  const pick = (index: number) => {
    const key = monthKey(year, index);
    if (pendingStart === null) {
      // First click of a pair: a single-month range until the second click lands.
      setPendingStart(key);
      onChange(key, key);
      return;
    }
    setPendingStart(null);
    const anchor = monthIndex(pendingStart);
    if (anchor !== null && index < anchor) onChange(key, pendingStart);
    else onChange(pendingStart, key);
  };

  const today = new Date();
  const thisMonth = today.getFullYear() * 12 + today.getMonth();

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        title="Pick the month range"
        className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-white transition-colors cursor-pointer"
      >
        <CalendarRange className="w-3.5 h-3.5 text-[#3D87D3]" />
        <span className="font-mono">{rangeText}</span>
      </button>

      {open && (
        <div className="absolute z-40 top-full left-0 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg select-none">
          <div className="flex items-center justify-between mb-2">
            <button
              type="button" onClick={() => setYear(y => y - 1)} aria-label="Previous year"
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="text-sm font-extrabold text-slate-800">{year}</div>
            <button
              type="button" onClick={() => setYear(y => y + 1)} aria-label="Next year"
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-4 gap-1">
            {MONTH_SHORT.map((name, index) => {
              const idx = year * 12 + index;
              const value = monthKey(year, index);
              const isEdge = value === from || value === to;
              const inRange = startIdx !== null && endIdx !== null && idx >= startIdx && idx <= endIdx;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => pick(index)}
                  aria-pressed={isEdge}
                  className={`h-8 text-[11px] rounded-lg font-bold transition-colors cursor-pointer ${
                    isEdge
                      ? 'bg-[#3D87D3] text-white font-black shadow-sm'
                      : inRange
                        ? 'bg-[#3D87D3]/15 text-[#3D87D3]'
                        : 'text-slate-700 hover:bg-slate-100'
                  } ${idx === thisMonth && !isEdge ? 'ring-1 ring-[#3D87D3]/50' : ''}`}
                >
                  {name}
                </button>
              );
            })}
          </div>

          <div className="mt-2 pt-2 border-t border-slate-100 text-[10px] font-semibold text-slate-400">
            Click the first and last month of the range.
          </div>
        </div>
      )}
    </div>
  );
};
