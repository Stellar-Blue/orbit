"use client";

import React, { useCallback, useRef, useState } from 'react';
import type { GridApi } from 'ag-grid-community';
import { FilterX } from 'lucide-react';

/**
 * Filters a parent page applies to the rows *before* handing them to a grid (search boxes, status
 * selects, …). Without them the button would look broken: the table is clearly filtered, yet the
 * grid's own filter model and quick filter are both empty. Pass this so one click resets everything.
 */
export type ExternalFilterSource = {
  /** True when at least one of the page-level filters is narrowing the rows. */
  active: boolean;
  /** Resets those page-level filters. */
  onClear: () => void;
};

/**
 * Shared "clear all filters" behaviour for every Orbit data grid.
 *
 * AG Grid keeps two independent filter systems — per-column filters (floating row / column menu)
 * and the quick-filter text box — so one reset has to clear both. The quick filter is a controlled
 * prop on the grid, so resetting the local state is enough to clear it.
 *
 * `hasActiveFilters` drives the button's disabled state and also accounts for the quick filter,
 * which `getFilterModel()` does not report.
 */
export function useGridFilterControls(external?: ExternalFilterSource) {
  const apiRef = useRef<GridApi | null>(null);
  const [quickFilter, setQuickFilter] = useState('');
  const [hasColumnFilters, setHasColumnFilters] = useState(false);

  const onGridReady = useCallback((params: { api: GridApi }) => {
    apiRef.current = params.api;
  }, []);

  const onFilterChanged = useCallback(() => {
    const model = apiRef.current?.getFilterModel();
    setHasColumnFilters(!!model && Object.keys(model).length > 0);
  }, []);

  const externalOnClear = external?.onClear;
  const clearFilters = useCallback(() => {
    apiRef.current?.setFilterModel(null);
    setQuickFilter('');
    setHasColumnFilters(false);
    externalOnClear?.();
  }, [externalOnClear]);

  return {
    /** Spread onto `<AgGridReact>` so the grid reports its api and filter changes. */
    gridProps: { onGridReady, onFilterChanged },
    quickFilter,
    setQuickFilter,
    clearFilters,
    hasActiveFilters:
      quickFilter.trim().length > 0 || hasColumnFilters || (external?.active ?? false),
  };
}

export type GridFilterControls = ReturnType<typeof useGridFilterControls>;

type ControlTone = 'light' | 'dark';

const TONE_CLASSES: Record<ControlTone, string> = {
  light:
    'bg-white text-slate-600 border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:text-slate-300 disabled:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-300',
  dark:
    'bg-slate-950 text-slate-300 border-slate-700 hover:bg-slate-800 hover:text-white disabled:text-slate-600 disabled:border-slate-800 disabled:hover:bg-slate-950 disabled:hover:text-slate-600',
};

/**
 * Toolbar control that resets filters. Presentational: pass whether anything is active and what
 * to run on click, so non-AG-Grid toolbars (select/input based) can reuse the exact same control.
 * Use `tone="dark"` inside a dark toolbar.
 */
export function ClearFiltersControl({
  active,
  onClear,
  tone = 'light',
}: {
  active: boolean;
  onClear: () => void;
  tone?: ControlTone;
}) {
  return (
    <button
      type="button"
      onClick={onClear}
      disabled={!active}
      title="Clear all filters"
      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-all shrink-0 cursor-pointer disabled:cursor-not-allowed ${TONE_CLASSES[tone]}`}
    >
      <FilterX className="w-3.5 h-3.5" /> Clear filters
    </button>
  );
}

/** AG Grid toolbar variant: clears every column filter plus the quick-filter box. */
export function ClearFiltersButton({
  controls,
  tone = 'light',
}: {
  controls: GridFilterControls;
  tone?: ControlTone;
}) {
  return <ClearFiltersControl active={controls.hasActiveFilters} onClear={controls.clearFilters} tone={tone} />;
}
