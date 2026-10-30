"use client";

// Shared AG Grid setup for Orbit: registers the community/enterprise modules based on the
// configured license key (NEXT_PUBLIC_AG_GRID_LICENSE_KEY) and exports a shared theme,
// Excel-style filter helpers and grouping options. This module has side effects, so it
// must only be imported from client components (grids are dynamically imported with ssr:false).

import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type GridOptions } from 'ag-grid-community';
import { AllEnterpriseModule, LicenseManager } from 'ag-grid-enterprise';
import { OptionsFilter } from '@/lib/ag-grid-options-filter';
import { useTheme } from '@/lib/theme';

export const AG_GRID_LICENSE_KEY = process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY?.trim() || '';
export const HAS_AG_GRID_LICENSE = !!AG_GRID_LICENSE_KEY;

if (HAS_AG_GRID_LICENSE) {
  ModuleRegistry.registerModules([AllCommunityModule, AllEnterpriseModule]);
  LicenseManager.setLicenseKey(AG_GRID_LICENSE_KEY);
} else {
  ModuleRegistry.registerModules([AllCommunityModule]);
}

// Ledger-grade grid: stencilled header band, hairline rows, tabular figures inherited from the app.
// Two builds of the same theme so grids can follow the app's light/dark switch.
export const orbitGridTheme = themeQuartz.withParams({
  backgroundColor: '#ffffff',
  foregroundColor: '#3a3f48',
  headerBackgroundColor: '#f1f3f6',
  headerTextColor: '#6b717c',
  headerFontWeight: 700,
  borderColor: '#e6e8ec',
  accentColor: '#3d87d3',
  oddRowBackgroundColor: '#fbfcfd',
  rowHoverColor: '#eff3f7',
  selectedRowBackgroundColor: '#eaf2fb',
  fontSize: 12,
  headerFontSize: 10,
  fontFamily: 'inherit',
  wrapperBorderRadius: 0
});

export const orbitGridDarkTheme = themeQuartz.withParams({
  backgroundColor: '#14171c',
  foregroundColor: '#c9d1dc',
  headerBackgroundColor: '#1b2028',
  headerTextColor: '#98a2b0',
  headerFontWeight: 700,
  borderColor: '#262b33',
  accentColor: '#5a9be0',
  oddRowBackgroundColor: '#171b20',
  rowHoverColor: '#1f262f',
  selectedRowBackgroundColor: '#16283c',
  fontSize: 12,
  headerFontSize: 10,
  fontFamily: 'inherit',
  wrapperBorderRadius: 0
});

/** The grid theme for the active colour scheme. Call from a client component. */
export function useOrbitGridTheme() {
  const { theme } = useTheme();
  return theme === 'dark' ? orbitGridDarkTheme : orbitGridTheme;
}

/**
 * Excel-style filters: checkbox list of ALL available values in the column, with search,
 * Select All and Blanks.
 *  - With the Enterprise license key: native agSetColumnFilter with excelMode 'windows'.
 *  - Without it: a community custom checkbox OptionsFilter (same UX, no license required).
 */
export const excelSetFilter = (values?: Array<string | number>): Pick<ColDef, 'filter' | 'filterParams' | 'floatingFilter'> =>
  HAS_AG_GRID_LICENSE
    ? { filter: 'agSetColumnFilter', filterParams: { values, excelMode: 'windows' } }
    : { filter: OptionsFilter, filterParams: values ? { values } : undefined };

/**
 * Enterprise row-grouping capabilities (drag column headers into the group panel).
 * Only active when the license key is present; safely ignored in community mode.
 */
export const GROUPING_OPTIONS: Partial<GridOptions> = HAS_AG_GRID_LICENSE
  ? {
      // The grouping strip and the columns panel both steal horizontal room from a dense ledger,
      // so they stay collapsed until someone actually groups or opens a tool panel.
      rowGroupPanelShow: 'onlyWhenGrouping',
      groupDefaultExpanded: 1,
      sideBar: {
        toolPanels: [
          { id: 'columns', labelDefault: 'Columns', labelKey: 'columns', iconKey: 'columns', toolPanel: 'agColumnsToolPanel' },
          { id: 'filters', labelDefault: 'Filters', labelKey: 'filters', iconKey: 'filter', toolPanel: 'agFiltersToolPanel' },
        ],
      },
    }
  : {};
