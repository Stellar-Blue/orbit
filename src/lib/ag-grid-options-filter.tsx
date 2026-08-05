"use client";

// Community-mode Excel-style filter: checkbox list of the column's available values,
// with search + Select All. Used as the fallback when no AG Grid Enterprise license
// key is configured (the native agSetColumnFilter with excelMode requires enterprise).

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  type IFilter,
  type IFilterParams,
  type IDoesFilterPassParams,
  type IAfterGuiAttachedParams,
  type IRowNode
} from 'ag-grid-community';
import { Search, CheckSquare, Square } from 'lucide-react';

interface OptionsFilterBodyProps {
  values: Array<{ value: string; count: number }>;
  selected: Set<string>;
  search: string;
  allSelected: boolean;
  onToggle: (value: string) => void;
  onToggleAll: () => void;
  onSearch: (q: string) => void;
}

const OptionsFilterBody: React.FC<OptionsFilterBodyProps> = ({
  values,
  selected,
  search,
  allSelected,
  onToggle,
  onToggleAll,
  onSearch
}) => (
  <div className="w-[260px] bg-white rounded-lg shadow-lg border border-slate-200 overflow-hidden font-sans">
    <div className="px-3 py-2 border-b border-slate-200 bg-slate-50">
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
        <input
          type="text"
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder="Search values..."
          className="w-full bg-white border border-slate-200 rounded-md pl-8 pr-2 py-1 text-xs text-slate-800 focus:outline-none focus:border-[#3D87D3]"
          autoFocus
        />
      </div>
    </div>
    <div className="px-3 py-1.5 border-b border-slate-200 flex items-center gap-1.5 cursor-pointer select-none hover:bg-slate-50" onClick={onToggleAll}>
      {allSelected ? <CheckSquare className="w-3.5 h-3.5 text-[#3D87D3]" /> : <Square className="w-3.5 h-3.5 text-slate-400" />}
      <span className="text-[11px] font-bold text-slate-700">Select All</span>
    </div>
    <div className="max-h-[220px] overflow-y-auto py-1">
      {values.length === 0 && (
        <div className="px-3 py-3 text-center text-[11px] text-slate-400 italic">No matching values</div>
      )}
      {values.map(({ value, count }) => {
        const checked = selected.has(value);
        return (
          <label
            key={value}
            className="flex items-center gap-2 px-3 py-1 cursor-pointer hover:bg-blue-50/60 select-none"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(value)}
              className="accent-[#3D87D3] w-3.5 h-3.5 cursor-pointer"
            />
            <span className={`text-xs truncate flex-1 ${checked ? 'font-bold text-slate-800' : 'text-slate-600'}`}>{value}</span>
            <span className="text-[10px] text-slate-400 font-mono shrink-0">{count}</span>
          </label>
        );
      })}
    </div>
  </div>
);

export class OptionsFilter implements IFilter {
  private params!: IFilterParams;
  private gui!: HTMLDivElement;
  private root!: Root;
  private selected = new Set<string>();
  private search = '';
  private values: Array<{ value: string; count: number }> = [];

  init(params: IFilterParams): void {
    this.params = params;

    // Collect unique values present in the column data (with occurrence counts)
    const seen = new Map<string, number>();
    const col = params.column;
    params.api.forEachNode((node: IRowNode<unknown>) => {
      const raw = node.getDataValue(col);
      if (raw === null || raw === undefined || raw === '') return;
      const key = String(raw);
      seen.set(key, (seen.get(key) || 0) + 1);
    });

    const override = (params.colDef.filterParams as { values?: Array<string | number> } | undefined)?.values;
    const base = Array.isArray(override) && override.length > 0 ? override.map(String) : Array.from(seen.keys());
    this.values = base
      .map(v => ({ value: v, count: seen.get(v) || 0 }))
      .sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }));

    this.gui = document.createElement('div');
    this.root = createRoot(this.gui);
    this.render();
  }

  private render(): void {
    const filtered = this.values.filter(v => v.value.toLowerCase().includes(this.search.toLowerCase()));
    const allSelected = filtered.length > 0 && filtered.every(v => this.selected.has(v.value));
    this.root.render(
      <OptionsFilterBody
        values={filtered}
        selected={this.selected}
        search={this.search}
        allSelected={allSelected}
        onToggle={value => {
          if (this.selected.has(value)) this.selected.delete(value);
          else this.selected.add(value);
          this.render();
          this.params.filterChangedCallback();
        }}
        onToggleAll={() => {
          const filteredValues = this.values.filter(v => v.value.toLowerCase().includes(this.search.toLowerCase()));
          const allSelected = filteredValues.length > 0 && filteredValues.every(v => this.selected.has(v.value));
          if (allSelected) filteredValues.forEach(v => this.selected.delete(v.value));
          else filteredValues.forEach(v => this.selected.add(v.value));
          this.render();
          this.params.filterChangedCallback();
        }}
        onSearch={q => {
          this.search = q;
          this.render();
        }}
      />
    );
  }

  getGui(): HTMLElement {
    return this.gui;
  }

  isFilterActive(): boolean {
    return this.selected.size > 0;
  }

  doesFilterPass(params: IDoesFilterPassParams): boolean {
    if (this.selected.size === 0) return true;
    const raw = params.node.getDataValue(this.params.column);
    if (raw === null || raw === undefined || raw === '') return false;
    return this.selected.has(String(raw));
  }

  getModel(): { values: string[] } | null {
    return this.selected.size > 0 ? { values: Array.from(this.selected) } : null;
  }

  setModel(model: { values?: string[] } | null): void {
    this.selected = model && Array.isArray(model.values) ? new Set(model.values) : new Set();
    this.render();
  }

  afterGuiAttached(params?: IAfterGuiAttachedParams): void {
    void params;
  }

  onNewRowsLoaded(): void {
    this.selected = new Set();
    this.render();
  }
}
