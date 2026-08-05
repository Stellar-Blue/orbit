"use client";

import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface DateRangePickerProps {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function toDate(s: string): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(`${s}T12:00:00Z`);
}

function toStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const DateRangePicker: React.FC<DateRangePickerProps> = ({ start, end, onChange }) => {
  const anchor = toDate(start) || toDate(end) || new Date();
  const [viewYear, setViewYear] = useState(anchor.getUTCFullYear());
  const [viewMonth, setViewMonth] = useState(anchor.getUTCMonth());
  const [pendingStart, setPendingStart] = useState<string | null>(null);

  const startDate = toDate(start);
  const endDate = toDate(end);

  const cells = useMemo(() => {
    const first = new Date(Date.UTC(viewYear, viewMonth, 1));
    const offset = (first.getUTCDay() + 6) % 7; // Monday-first
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
    const out: Array<Date | null> = [];
    for (let i = 0; i < offset; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(new Date(Date.UTC(viewYear, viewMonth, d)));
    return out;
  }, [viewYear, viewMonth]);

  const nav = (delta: number) => {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setViewMonth(m);
    setViewYear(y);
  };

  const handleDay = (d: Date) => {
    const str = toStr(d);
    if (pendingStart === null) {
      setPendingStart(str);
      onChange(str, str);
      return;
    }
    setPendingStart(null);
    if (str < pendingStart) {
      onChange(str, pendingStart);
    } else {
      onChange(pendingStart, str);
    }
  };

  const inRange = (d: Date): boolean => {
    if (!startDate || !endDate) return false;
    return d >= startDate && d <= endDate;
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 select-none">
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={() => nav(-1)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer" aria-label="Previous month">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="text-sm font-extrabold text-slate-800">{MONTHS[viewMonth]} {viewYear}</div>
        <button type="button" onClick={() => nav(1)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer" aria-label="Next month">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {WEEKDAYS.map(w => (
          <div key={w} className="text-center text-[10px] font-bold text-slate-400 uppercase py-1">{w}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const str = toStr(d);
          const isStart = startDate && str === toStr(startDate);
          const isEnd = endDate && str === toStr(endDate);
          const range = inRange(d);
          const isToday = str === toStr(new Date());
          return (
            <button
              key={str}
              type="button"
              onClick={() => handleDay(d)}
              className={`h-8 text-xs rounded-lg font-semibold transition-colors cursor-pointer relative ${
                isStart || isEnd
                  ? 'bg-[#3D87D3] text-white font-black shadow-sm'
                  : range
                    ? 'bg-[#3D87D3]/15 text-[#3D87D3]'
                    : 'text-slate-700 hover:bg-slate-100'
              } ${isToday && !isStart && !isEnd ? 'ring-1 ring-[#3D87D3]/50' : ''}`}
            >
              {d.getUTCDate()}
            </button>
          );
        })}
      </div>

      <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
        <span className="font-mono font-bold text-slate-700">
          {start ? `${start} → ${end && end >= start ? end : start}` : 'Select a date…'}
        </span>
        <button
          type="button"
          onClick={() => { onChange('', ''); setPendingStart(null); }}
          className="text-[10px] font-bold text-slate-400 hover:text-rose-600 cursor-pointer uppercase tracking-wide"
        >
          Clear
        </button>
      </div>
    </div>
  );
};
