'use client';

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import { cn } from '@/components/ui/primitives';
import {
  WEEKDAY_LABELS,
  clampMonthToRange,
  clampToRange,
  dayLabel,
  formatDisplayDate,
  formatDisplayMonth,
  isoFromDate,
  monthLabel,
  monthMatrix,
  monthOfIsoDate,
  parseDateText,
  parseMonthText,
  shiftIsoMonth,
  shiftIsoYear,
  yearMonths,
} from '@/lib/date-input';

type DatePickerMode = 'day' | 'month';

export interface DatePickerProps {
  /** `YYYY-MM-DD` (day mode) or `YYYY-MM` (month mode). Empty/null = no value. */
  value?: string | null;
  onChange: (next: string) => void;
  mode?: DatePickerMode;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  id?: string;
  name?: string;
  className?: string;
  /** Tooltip on the trigger, e.g. "First chargeable month for this line". */
  title?: string;
  'aria-label'?: string;
  /** How the value is read out; defaults to "Choose a date". */
  'aria-describedby'?: string;
}

const CELL = 32;
const POPOVER_WIDTH = { day: 296, month: 268 } as const;

interface PopoverPosition {
  top: number;
  left: number;
  width: number;
}

/**
 * Orbit's date field: a normal-looking text input you can type into (`07/08/2026`, `2026-08-07`,
 * `07082026`, `today`, `+7`) with a calendar popover for picking. Built on the app's own tokens so it
 * matches the forms around it, and rendered in a portal so it is never clipped by a modal's scroll box.
 */
export function DatePicker({
  value,
  onChange,
  mode = 'day',
  min,
  max,
  disabled = false,
  required = false,
  placeholder,
  id,
  name,
  className,
  title,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: DatePickerProps) {
  const autoId = useId();
  const fieldId = id || `date-picker-${autoId}`;
  const popoverId = `${fieldId}-calendar`;

  const [open, setOpen] = useState(false);
  /** Text while the field is being edited; null means "show the committed value". */
  const [editing, setEditing] = useState<{ text: string } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // Opening by clicking the field must not pull the caret into the calendar — the field stays typeable.
  const focusGridOnOpen = useRef(false);
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());

  const display = useCallback(
    (iso: string) => (mode === 'month' ? formatDisplayMonth(iso) : formatDisplayDate(iso)),
    [mode]
  );

  const committed = value || '';
  const todayIso = isoFromDate(new Date());
  const todayMonth = todayIso.slice(0, 7);
  const initialCursor = mode === 'month'
    ? (committed || todayMonth)
    : (committed || todayIso);

  const [viewMonth, setViewMonth] = useState(() => (mode === 'month' ? initialCursor : monthOfIsoDate(initialCursor)));
  const [cursor, setCursor] = useState(initialCursor);

  const draft = editing ? editing.text : display(committed);

  const grid = useMemo(() => (mode === 'day' ? monthMatrix(viewMonth) : []), [mode, viewMonth]);
  const months = useMemo(() => (mode === 'month' ? yearMonths(Number(viewMonth.slice(0, 4))) : []), [mode, viewMonth]);

  const positionPopover = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const width = POPOVER_WIDTH[mode];
    const height = mode === 'month' ? 300 : 336;
    const margin = 8;
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin);
    const below = rect.bottom + 6;
    const top = below + height > window.innerHeight - margin && rect.top - height - 6 > margin
      ? rect.top - height - 6
      : below;
    setPosition({ top, left, width });
  }, [mode]);

  const openPicker = useCallback((focusGrid = true) => {
    if (disabled) return;
    focusGridOnOpen.current = focusGrid;
    const start = committed || (mode === 'month' ? todayMonth : todayIso);
    setCursor(start);
    setViewMonth(mode === 'month' ? start : monthOfIsoDate(start));
    setEditing(null);
    setInvalid(false);
    positionPopover();
    setOpen(true);
  }, [disabled, committed, mode, todayMonth, todayIso, positionPopover]);

  const closePicker = useCallback((restoreFocus = true) => {
    setOpen(false);
    setPosition(null);
    setEditing(null);
    setInvalid(false);
    if (restoreFocus) inputRef.current?.focus();
  }, []);

  const commit = useCallback((next: string) => {
    setEditing(null);
    setInvalid(false);
    if (next !== committed) onChange(next);
  }, [committed, onChange]);

  /** Parses whatever is typed; used by Enter, blur and the calendar. */
  const commitDraft = useCallback((text: string): boolean => {
    const raw = text.trim();
    if (!raw) {
      commit('');
      return true;
    }
    const parsed = mode === 'month' ? parseMonthText(raw) : parseDateText(raw);
    const allowed = parsed && (mode === 'month' ? clampMonthToRange(parsed, min, max) : clampToRange(parsed, min, max));
    if (!allowed) {
      setInvalid(true);
      return false;
    }
    commit(allowed);
    return true;
  }, [mode, min, max, commit]);

  const select = useCallback((iso: string) => {
    commit(iso);
    setCursor(iso);
    setViewMonth(mode === 'month' ? iso : monthOfIsoDate(iso));
    closePicker();
  }, [commit, mode, closePicker]);

  // Outside click, scroll and resize close the popover instead of leaving it floating.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || inputRef.current?.contains(target)) return;
      closePicker(false);
    };
    const onScroll = (event: Event) => {
      if (popoverRef.current?.contains(event.target as Node)) return;
      closePicker(false);
    };
    const onResize = () => closePicker(false);
    document.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, closePicker]);

  // Park focus on the active cell when the calendar opens or the cursor moves.
  useEffect(() => {
    if (!open || !focusGridOnOpen.current) return;
    const cell = cellRefs.current.get(cursor);
    cell?.focus({ preventScroll: true });
  }, [open, cursor, viewMonth]);

  const moveCursor = useCallback((target: string) => {
    setCursor(target);
    if (mode === 'month') setViewMonth(target);
    else setViewMonth(monthOfIsoDate(target));
  }, [mode]);

  const onGridKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const current = cursor;
    const step = (days: number) => {
      const date = new Date(`${current}T00:00:00`);
      date.setDate(date.getDate() + days);
      moveCursor(isoFromDate(date));
    };
    const stepMonth = (delta: number) => {
      const next = shiftIsoMonth(current.slice(0, 7), delta);
      moveCursor(mode === 'month' ? next : `${next}${current.slice(7) || '-01'}`);
    };
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        if (mode === 'month') moveCursor(shiftIsoMonth(current, -1));
        else step(-1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (mode === 'month') moveCursor(shiftIsoMonth(current, 1));
        else step(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (mode === 'month') moveCursor(shiftIsoMonth(current, -3));
        else step(-7);
        break;
      case 'ArrowDown':
        event.preventDefault();
        if (mode === 'month') moveCursor(shiftIsoMonth(current, 3));
        else step(7);
        break;
      case 'Home': {
        event.preventDefault();
        const date = new Date(`${current}T00:00:00`);
        if (mode === 'month') moveCursor(`${current.slice(0, 4)}-01`);
        else {
          const offset = (date.getDay() + 6) % 7;
          date.setDate(date.getDate() - offset);
          moveCursor(isoFromDate(date));
        }
        break;
      }
      case 'End': {
        event.preventDefault();
        const date = new Date(`${current}T00:00:00`);
        if (mode === 'month') moveCursor(`${current.slice(0, 4)}-12`);
        else {
          const offset = (date.getDay() + 6) % 7;
          date.setDate(date.getDate() + (6 - offset));
          moveCursor(isoFromDate(date));
        }
        break;
      }
      case 'PageUp':
        event.preventDefault();
        if (mode === 'month') moveCursor(shiftIsoYear(current, -1));
        else stepMonth(event.shiftKey ? -12 : -1);
        break;
      case 'PageDown':
        event.preventDefault();
        if (mode === 'month') moveCursor(shiftIsoYear(current, 1));
        else stepMonth(event.shiftKey ? 12 : 1);
        break;
      case 'Escape':
        event.preventDefault();
        closePicker();
        break;
      case 'Enter':
      case ' ':
      case 'Spacebar':
        event.preventDefault();
        if (mode === 'month') select(cursor);
        else if (clampToRange(cursor, min, max)) select(cursor);
        break;
      default:
        break;
    }
  }, [cursor, mode, moveCursor, closePicker, select, min, max]);

  const isSelectable = (iso: string) => clampToRange(iso, min, max) !== null;

  const rangeHint = min || max
    ? `Allowed range: ${min ? formatDisplayDate(min) : 'any'} to ${max ? formatDisplayDate(max) : 'any'}`
    : undefined;

  // `w-full` is opt-in: a filter row or a compact table cell keeps the field's natural width.
  const fullWidth = /\bw-full\b/.test(className || '');

  const triggerClasses = cn(
    'w-full min-w-0 bg-white border border-[var(--line-strong)] rounded-[var(--radius-control)] px-3 text-[13px] text-[var(--ink)]',
    'placeholder:text-[var(--ink-4)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-60 disabled:cursor-not-allowed',
    'tabular-nums h-9 pr-14',
    invalid && 'border-rose-400 focus:border-rose-500',
    className
  );

  const popover = open && position
    ? createPortal(
        <div
          ref={popoverRef}
          id={popoverId}
          role="dialog"
          aria-modal="false"
          aria-label={mode === 'month' ? 'Choose a month' : 'Choose a date'}
          onBlur={event => {
            const next = event.relatedTarget as Node | null;
            if (!next) return;
            if (event.currentTarget.contains(next) || inputRef.current?.contains(next)) return;
            closePicker(false);
          }}
          style={{ position: 'fixed', top: position.top, left: position.left, width: position.width }}
          className="z-[80] rounded-[var(--radius-card)] border border-[var(--line)] bg-white p-3 shadow-[var(--shadow-pop)]"
        >
          <div className="flex items-center justify-between gap-1 pb-2">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setViewMonth(shiftIsoYear(viewMonth, -1))}
                className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[var(--ink-3)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)] cursor-pointer"
                aria-label="Previous year"
              >
                <ChevronsLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMonth(shiftIsoMonth(viewMonth, -1))}
                className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[var(--ink-3)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)] cursor-pointer"
                aria-label={mode === 'month' ? 'Previous year' : 'Previous month'}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
            <div className="text-[13px] font-semibold text-[var(--ink)]" aria-live="polite">
              {mode === 'month' ? viewMonth.slice(0, 4) : monthLabel(viewMonth)}
            </div>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setViewMonth(shiftIsoMonth(viewMonth, 1))}
                className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[var(--ink-3)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)] cursor-pointer"
                aria-label={mode === 'month' ? 'Next year' : 'Next month'}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMonth(shiftIsoYear(viewMonth, 1))}
                className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[var(--ink-3)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)] cursor-pointer"
                aria-label="Next year"
              >
                <ChevronsRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {mode === 'day' ? (
            <div role="grid" aria-label={monthLabel(viewMonth)} tabIndex={-1} onKeyDown={onGridKeyDown} className="focus:outline-none">
              <div className="grid grid-cols-7 pb-1" role="row">
                {WEEKDAY_LABELS.map(day => (
                  <div
                    key={day}
                    role="columnheader"
                    aria-label={day}
                    className="h-6 flex items-center justify-center text-[10px] font-medium text-[var(--ink-4)]"
                  >
                    {day}
                  </div>
                ))}
              </div>
              {Array.from({ length: 6 }, (_, week) => (
                <div key={week} className="grid grid-cols-7" role="row">
                  {grid.slice(week * 7, week * 7 + 7).map(iso => {
                    const outside = !iso.startsWith(viewMonth);
                    const selected = iso === committed;
                    const isToday = iso === todayIso;
                    const selectable = isSelectable(iso);
                    return (
                      <button
                        key={iso}
                        type="button"
                        role="gridcell"
                        ref={node => {
                          if (node) cellRefs.current.set(iso, node);
                          else cellRefs.current.delete(iso);
                        }}
                        tabIndex={iso === cursor ? 0 : -1}
                        aria-selected={selected}
                        aria-current={isToday ? 'date' : undefined}
                        aria-label={dayLabel(iso)}
                        disabled={!selectable}
                        onClick={() => select(iso)}
                        style={{ height: CELL }}
                        className={cn(
                          'relative rounded-md text-[12px] tabular-nums transition-colors cursor-pointer',
                          selected
                            ? 'bg-[var(--accent)] text-white font-semibold hover:bg-[var(--accent)]'
                            : 'text-[var(--ink)] hover:bg-[var(--surface-muted)]',
                          !selected && outside && 'text-[var(--ink-4)]',
                          !selected && isToday && 'font-semibold text-[var(--accent-ink)]',
                          !selectable && 'opacity-35 cursor-not-allowed hover:bg-transparent'
                        )}
                      >
                        {Number(iso.slice(8, 10))}
                        {isToday && !selected && (
                          <span className="absolute inset-x-0 bottom-1 mx-auto h-1 w-1 rounded-full bg-[var(--accent)]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div role="grid" aria-label={viewMonth.slice(0, 4)} tabIndex={-1} onKeyDown={onGridKeyDown} className="focus:outline-none">
              {Array.from({ length: 4 }, (_, row) => months.slice(row * 3, row * 3 + 3)).map((rowMonths, row) => (
                <div key={row} role="row" className="grid grid-cols-3 gap-1">
                  {rowMonths.map(isoMonth => {
                const selected = isoMonth === committed;
                const isCurrent = isoMonth === todayMonth;
                const selectable = clampMonthToRange(isoMonth, min, max) !== null;
                return (
                  <button
                    key={isoMonth}
                    type="button"
                    role="gridcell"
                    ref={node => {
                      if (node) cellRefs.current.set(isoMonth, node);
                      else cellRefs.current.delete(isoMonth);
                    }}
                    tabIndex={isoMonth === cursor ? 0 : -1}
                    aria-selected={selected}
                    aria-label={monthLabel(isoMonth)}
                    disabled={!selectable}
                    onClick={() => select(isoMonth)}
                    className={cn(
                      'h-10 rounded-md text-[12px] transition-colors cursor-pointer',
                      selected
                        ? 'bg-[var(--accent)] text-white font-semibold'
                        : 'text-[var(--ink)] hover:bg-[var(--surface-muted)]',
                      !selected && isCurrent && 'font-semibold text-[var(--accent-ink)]',
                      !selectable && 'opacity-35 cursor-not-allowed hover:bg-transparent'
                    )}
                  >
                    {monthLabel(isoMonth).split(' ')[0].slice(0, 3)}
                  </button>
                );
                  })}
                </div>
              ))}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between border-t border-[var(--line)] pt-2">
            <button
              type="button"
              onClick={() => select(mode === 'month' ? todayMonth : todayIso)}
              className="h-7 px-2 rounded-md text-[12px] font-medium text-[var(--accent-ink)] hover:bg-[var(--accent-soft)] cursor-pointer"
            >
              {mode === 'month' ? 'This month' : 'Today'}
            </button>
            <div className="flex items-center gap-1">
              {committed && (
                <button
                  type="button"
                  onClick={() => {
                    commit('');
                    closePicker();
                  }}
                  className="h-7 px-2 rounded-md text-[12px] font-medium text-[var(--ink-3)] hover:bg-[var(--surface-muted)] cursor-pointer"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => closePicker()}
                className="h-7 px-2 rounded-md text-[12px] font-medium text-[var(--ink-2)] hover:bg-[var(--surface-muted)] cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div
      className={cn('relative', fullWidth ? 'w-full' : 'w-[11.5rem]')}
      onBlur={event => {
        const next = event.relatedTarget as Node | null;
        if (!open || !next) return;
        if (event.currentTarget.contains(next) || popoverRef.current?.contains(next)) return;
        closePicker(false);
      }}
    >
      <input
        ref={inputRef}
        id={fieldId}
        name={name}
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        placeholder={placeholder ?? (mode === 'month' ? 'MM/YYYY' : 'DD/MM/YYYY')}
        disabled={disabled}
        required={required}
        title={title ? (rangeHint ? `${title} · ${rangeHint}` : title) : rangeHint}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        role="combobox"
        aria-invalid={invalid || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onBlur={() => {
          // A blurred field must never show text that is not the stored value.
          if (!commitDraft(editing?.text ?? display(committed))) setInvalid(false);
          setEditing(null);
        }}
        onChange={event => {
          setEditing({ text: event.target.value });
          setInvalid(false);
        }}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (commitDraft(editing?.text ?? display(committed))) closePicker(false);
            return;
          }
          if (event.key === 'Escape') {
            setEditing(null);
            setInvalid(false);
            if (open) closePicker(false);
            return;
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!open) openPicker(true);
            else {
              focusGridOnOpen.current = true;
              cellRefs.current.get(cursor)?.focus({ preventScroll: true });
            }
            return;
          }
          if (!open && (event.key === ' ' || event.key === 'F4')) {
            if (event.key === ' ' && draft.trim()) return;
            event.preventDefault();
            openPicker(true);
          }
        }}
        onClick={() => {
          if (!open) openPicker(false);
        }}
        className={triggerClasses}
        data-date-picker={mode}
      />

      <div className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center gap-0.5">
        {committed && !disabled && (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Clear date"
            onMouseDown={event => event.preventDefault()}
            onClick={() => {
              commit('');
              inputRef.current?.focus();
            }}
            className="pointer-events-auto h-6 w-6 inline-flex items-center justify-center rounded text-[var(--ink-4)] hover:text-[var(--ink-2)] hover:bg-[var(--surface-muted)] cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          aria-label="Open calendar"
          disabled={disabled}
          onMouseDown={event => event.preventDefault()}
          onClick={() => (open ? closePicker(false) : openPicker(true))}
          className="pointer-events-auto h-6 w-6 inline-flex items-center justify-center rounded text-[var(--ink-3)] hover:text-[var(--ink)] hover:bg-[var(--surface-muted)] cursor-pointer disabled:cursor-not-allowed"
        >
          <CalendarDays className="w-3.5 h-3.5" />
        </button>
      </div>
      {popover}
    </div>
  );
}
