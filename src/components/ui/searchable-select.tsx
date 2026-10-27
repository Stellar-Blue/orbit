"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

export interface SearchableSelectOption {
  value: string;
  /** Main line, also the primary match target. */
  label: string;
  /** Optional second line under the label (record id, subtitle, code…). */
  description?: string;
  /** Optional right-aligned detail (VAT number, contract value, code…). */
  hint?: string;
  /** Extra text to match on besides the label (ΑΦΜ, domain, category description…). */
  keywords?: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  /** Label of the option that represents "nothing selected" (value ""). */
  emptyLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Shows a clear (×) button whenever a value is selected. */
  allowClear?: boolean;
  className?: string;
  /** Panel height cap in px (default 300). */
  maxPanelHeight?: number;
}

/**
 * Dropdown with a built-in search box, for lists that are too long to scroll through
 * (counterparties, contracts, expense categories…).
 *
 * The panel is positioned `fixed` from the trigger's rect instead of being absolutely positioned:
 * these selects live inside scrollable modal bodies, and an absolute panel would be clipped by the
 * container. Position is recomputed on scroll/resize while open.
 */
export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  value,
  onChange,
  options,
  emptyLabel = 'Select an option…',
  placeholder = 'Search…',
  disabled = false,
  allowClear = false,
  className = '',
  maxPanelHeight = 300,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [panel, setPanel] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find(o => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o =>
      o.label.toLowerCase().includes(q) ||
      (o.description || '').toLowerCase().includes(q) ||
      (o.hint || '').toLowerCase().includes(q) ||
      (o.keywords || '').toLowerCase().includes(q)
    );
  }, [options, query]);

  const positionPanel = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const flipUp = spaceBelow < Math.min(maxPanelHeight, 260) && r.top > spaceBelow;
    setPanel({
      top: flipUp ? undefined : r.bottom + 4,
      bottom: flipUp ? window.innerHeight - r.top + 4 : undefined,
      left: r.left,
      width: r.width,
    });
  }, [maxPanelHeight]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    // Capture phase so scrolls inside the modal body are seen too.
    window.addEventListener('scroll', positionPanel, true);
    window.addEventListener('resize', positionPanel);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      window.removeEventListener('scroll', positionPanel, true);
      window.removeEventListener('resize', positionPanel);
    };
  }, [open, positionPanel]);

  /** Opens the panel: reset the query, measure the trigger, then focus the search box. */
  const openPanel = () => {
    setQuery('');
    setActiveIndex(0);
    positionPanel();
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const commit = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, filtered.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const option = filtered[activeIndex];
      if (option) commit(option.value);
    }
  };

  const triggerLabel = selected ? selected.label : (value ? value : emptyLabel);
  const isEmpty = !selected && !value;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        ref={triggerRef}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-2 text-left text-xs p-2.5 pr-2 border border-slate-300 rounded-xl bg-slate-50 font-bold focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20 ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-white'} ${open ? 'ring-2 ring-[#3D87D3]/20' : ''}`}
      >
        <span className={`truncate ${isEmpty ? 'text-slate-400 font-medium' : 'text-slate-800'}`}>{triggerLabel}</span>
        <span className="flex items-center gap-1 shrink-0">
          {allowClear && !isEmpty && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              onClick={e => { e.stopPropagation(); commit(''); }}
              title="Clear selection"
              className="p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && panel && (
        <div
          style={{ top: panel.top, bottom: panel.bottom, left: panel.left, width: panel.width, maxHeight: maxPanelHeight }}
          className="fixed z-[60] flex flex-col bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden"
        >
          <div className="p-2 border-b border-slate-100 shrink-0">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => { setQuery(e.target.value); setActiveIndex(0); }}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                className="w-full text-xs py-2 pl-8 pr-2.5 border border-slate-200 rounded-lg bg-slate-50 font-medium focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
              />
            </div>
          </div>

          <ul role="listbox" className="flex-1 overflow-y-auto py-1">
            {emptyLabel && (
              <li>
                <button
                  type="button"
                  onClick={() => commit('')}
                  onMouseEnter={() => setActiveIndex(-1)}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 hover:bg-slate-50 ${isEmpty ? 'font-extrabold text-[#3D87D3]' : 'text-slate-500'}`}
                >
                  <span className="truncate">{emptyLabel}</span>
                  {isEmpty && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              </li>
            )}
            {filtered.length === 0 && (
              <li className="px-3 py-3 text-xs text-slate-400 italic">No match for “{query}”.</li>
            )}
            {filtered.map((option, idx) => (
              <li key={option.value}>
                <button
                  type="button"
                  onClick={() => commit(option.value)}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-3 ${idx === activeIndex ? 'bg-[#3D87D3]/10' : 'hover:bg-slate-50'} ${option.value === value ? 'font-extrabold text-[#3D87D3]' : 'text-slate-700'}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{option.label}</span>
                    {option.description && (
                      <span className="block truncate font-mono text-[10px] font-normal text-slate-400">{option.description}</span>
                    )}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    {option.hint && <span className="text-[10px] font-mono text-slate-400 truncate max-w-[140px]">{option.hint}</span>}
                    {option.value === value && <Check className="w-3.5 h-3.5" />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
