"use client";

// Shared AG Grid setup for Orbit: registers the community/enterprise modules based on the
// configured license key (NEXT_PUBLIC_AG_GRID_LICENSE_KEY) and exports a shared theme plus
// Excel-style filter helpers. This module has side effects, so it must only be imported
// from client components (grids are dynamically imported with ssr:false).

import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from 'ag-grid-community';
import { AllEnterpriseModule, LicenseManager } from 'ag-grid-enterprise';

export const AG_GRID_LICENSE_KEY = process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY?.trim() || '';
export const HAS_AG_GRID_LICENSE = !!AG_GRID_LICENSE_KEY;

if (HAS_AG_GRID_LICENSE) {
  ModuleRegistry.registerModules([AllCommunityModule, AllEnterpriseModule]);
  LicenseManager.setLicenseKey(AG_GRID_LICENSE_KEY);
} else {
  ModuleRegistry.registerModules([AllCommunityModule]);
}

export const orbitGridTheme = themeQuartz.withParams({
  backgroundColor: '#ffffff',
  foregroundColor: '#1e293b',
  headerBackgroundColor: '#f8fafc',
  headerTextColor: '#64748b',
  borderColor: '#e2e8f0',
  accentColor: '#3D87D3',
  oddRowBackgroundColor: '#fafbfc',
  rowHoverColor: '#f1f5f9',
  fontSize: 12,
  headerFontSize: 11,
  fontFamily: 'inherit',
  wrapperBorderRadius: 0
});

/**
 * Excel-style filters (checkbox set filters with search / Select All / Blanks) are an
 * AG Grid Enterprise feature: they activate with the license key, and fall back to
 * text filters while the key is missing.
 */
export const excelSetFilter = (values?: string[]): Pick<ColDef, 'filter' | 'filterParams'> =>
  HAS_AG_GRID_LICENSE
    ? { filter: 'agSetColumnFilter', filterParams: { values, excelMode: 'windows' } }
    : { filter: 'agTextColumnFilter', filterParams: undefined };
