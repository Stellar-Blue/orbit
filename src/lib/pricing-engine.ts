import { Contract, ContractLine, CatalogModule, CatalogItem } from '@/lib/types';

export interface ContractTierResult {
  tier: number;
  label: string;
  badgeClass: string;
  description: string;
}

export interface ContractValuation {
  netMonthlyMRR: number;            // Starting recurring MRR (excluding one-time fees)
  netARR: number;                   // True ARR (netMonthlyMRR * 12, strictly excluding one-time fees)
  oneTimeValue: number;             // Additional value from one-time fees (onboarding, setup, implementation)
  scheduledRecurringValue: number;  // Exact multi-year scheduled cash flow across contract term
  totalContractValue: number;       // Real contract deal valuation (scheduledRecurringValue + oneTimeValue)
  weightedARR: number;              // Weighted ARR for Tier calculation
  tierInfo: ContractTierResult;     // Calculated Tier 1 to 10 rating
  breakdown: {
    flatModulesARR: number;         // Weight: 1.5x (Flat ETRM Modules & Subscriptions)
    perAssetEngineARR: number;      // Weight: 1.2x (Per-Asset, Tiered Optimization Engines & Man-Days)
    fixedRateARR: number;           // Weight: 1.0x (Fixed rate / general lines)
  };
}

/**
 * Determines whether a pricing line item uses a variable quantity scheme (e.g. Per-Asset & Tiered Optimization Engines, Man-Days)
 * versus a fixed/constant scheme (Flat ETRM Modules & Subscriptions).
 * Flat ETRM Modules & Subscriptions do not need monthly schedules!
 */
export function isVariableQuantityPricingScheme(
  line: Partial<ContractLine> & { name?: string; unit_label?: string; frequency?: string; catalog_item_id?: string | null },
  catalogModules: CatalogModule[] = [],
  catalogItems: CatalogItem[] = []
): boolean {
  if (line.frequency === 'one_time') return false;

  // 1) Explicit checks against Catalog Module definitions
  if (line.catalog_item_id) {
    const item = catalogItems.find(i => i.id === line.catalog_item_id);
    if (item) {
      const mod = catalogModules.find(m => m.id === item.module_id);
      const modName = (mod?.name || '').toLowerCase();
      if (modName.includes('flat') || modName.includes('subscription')) return false;
      if (modName.includes('per-asset') || modName.includes('optimization') || modName.includes('engine') || modName.includes('man-day')) return true;
    }
  }

  // 2) Fallback classification by unit label and item name
  const uLabel = (line.unit_label || '').toLowerCase();
  const name = (line.name || '').toLowerCase();
  if (uLabel === 'flat' || name.includes('etrm platform') || name.includes('license') || name.includes('suite') || name.includes('subscription')) {
    return false;
  }
  if (uLabel === 'mw' || uLabel === 'assets' || uLabel === 'man-days' || uLabel === 'mwh/h' || name.includes('man-day') || name.includes('optimization') || name.includes('forecast') || name.includes('dispatch') || name.includes('adhoc')) {
    return true;
  }

  // Default to false (fixed quantity) unless explicitly variable
  return false;
}

/**
 * Maps a Weighted Annual Recurring Revenue (WARR) figure to a Tier 1-10 classification.
 */
export function getContractTier(weightedARR: number): ContractTierResult {
  if (weightedARR <= 0) {
    return { tier: 1, label: "Tier 1 · Entry Agreement", badgeClass: "bg-slate-800 text-slate-200 border-slate-700", description: "Standard pilot or non-recurring SLA" };
  }
  if (weightedARR < 15000) {
    return { tier: 1, label: "Tier 1 · Starter Engine", badgeClass: "bg-slate-800 text-slate-200 border-slate-700", description: "< €15k Weighted ARR" };
  }
  if (weightedARR < 35000) {
    return { tier: 2, label: "Tier 2 · Basic Deployment", badgeClass: "bg-blue-950/90 text-blue-300 border-blue-700/60", description: "€15k – €35k Weighted ARR" };
  }
  if (weightedARR < 60000) {
    return { tier: 3, label: "Tier 3 · Core Module Pack", badgeClass: "bg-blue-900/80 text-blue-200 border-blue-500/60", description: "€35k – €60k Weighted ARR" };
  }
  if (weightedARR < 100000) {
    return { tier: 4, label: "Tier 4 · Standard ETRM Suite", badgeClass: "bg-indigo-950 text-indigo-200 border-indigo-600/60", description: "€60k – €100k Weighted ARR" };
  }
  if (weightedARR < 150000) {
    return { tier: 5, label: "Tier 5 · Advanced Optimization", badgeClass: "bg-violet-950 text-violet-200 border-violet-500/60", description: "€100k – €150k Weighted ARR" };
  }
  if (weightedARR < 225000) {
    return { tier: 6, label: "Tier 6 · Multi-Asset Powerhouse", badgeClass: "bg-purple-950 text-purple-200 border-purple-500/60", description: "€150k – €225k Weighted ARR" };
  }
  if (weightedARR < 325000) {
    return { tier: 7, label: "Tier 7 · Premium Portfolio Hub", badgeClass: "bg-fuchsia-950 text-fuchsia-300 border-fuchsia-600/60", description: "€225k – €325k Weighted ARR" };
  }
  if (weightedARR < 450000) {
    return { tier: 8, label: "Tier 8 · Strategic Enterprise", badgeClass: "bg-amber-950 text-amber-300 border-amber-500/60", description: "€325k – €450k Weighted ARR" };
  }
  if (weightedARR < 650000) {
    return { tier: 9, label: "Tier 9 · Global Fleet Trading", badgeClass: "bg-emerald-950 text-emerald-300 border-emerald-500/60", description: "€450k – €650k Weighted ARR" };
  }
  return { 
    tier: 10, 
    label: "Tier 10 · Flagship Sovereign ETRM", 
    badgeClass: "bg-gradient-to-r from-amber-500 via-amber-300 to-yellow-500 text-slate-950 font-black shadow-md shadow-amber-500/20 border-amber-300", 
    description: "€650k+ Flagship Strategic Deal" 
  };
}

/**
 * Calculates accurate Contract Valuation, separating true ARR from additional one-time fees,
 * and computing a Tier rating weighted by module category.
 */
export function calculateContractValuation(
  lines: Array<Partial<ContractLine> & { name: string; unit_price: number; quantity: number; frequency: string }>,
  discountPct: number = 0,
  termYears: number = 1,
  startDate: string = new Date().toISOString().split('T')[0],
  catalogModules: CatalogModule[] = [],
  catalogItems: CatalogItem[] = [],
  fallbackContractValue: number = 0,
  fallbackCadence: string = 'monthly'
): ContractValuation {
  const discountMultiplier = Math.max(0, 1 - (Number(discountPct) || 0) / 100);
  
  // If we have line items, calculate with full granularity
  if (lines && lines.length > 0) {
    let startingGrossMonthly = 0;
    let oneTimeValue = 0;
    let flatModulesARR = 0;
    let perAssetEngineARR = 0;
    let fixedRateARR = 0;

    // Build timeline periods for multi-year cash schedule evaluation
    const monthsCount = Math.max(1, (Number(termYears) || 1) * 12);
    const startObj = new Date(startDate || new Date());
    const startYear = startObj.getFullYear();
    const startMonth = startObj.getMonth();
    const periods: string[] = [];
    for (let i = 0; i < monthsCount; i++) {
      const d = new Date(startYear, startMonth + i, 1);
      periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    // Helper for monthly carry-forward (only evaluated for Variable Quantity Pricing Schemes!)
    const getEffectiveQty = (l: any, pIdx: number) => {
      if (l.frequency === 'one_time' || !isVariableQuantityPricingScheme(l, catalogModules, catalogItems)) {
        return Number(l.quantity) || (l.frequency === 'one_time' ? 1 : 0);
      }
      const mq = l.monthly_quantities || {};
      for (let i = pIdx; i >= 0; i--) {
        const p = periods[i];
        if (mq[p] !== undefined && mq[p] !== null && !isNaN(Number(mq[p]))) {
          return Number(mq[p]);
        }
      }
      return Number(l.quantity) || 0;
    };

    let scheduledRecurringValue = 0;
    periods.forEach((period, pIdx) => {
      lines.forEach(l => {
        const effQty = getEffectiveQty(l, pIdx);
        const grossVal = (Number(l.unit_price) || 0) * effQty;
        const netVal = grossVal * discountMultiplier;

        if (l.frequency === 'one_time') {
          if (pIdx === 0) {
            oneTimeValue += (Number(l.unit_price) || 0) * (Number(l.quantity) || 0);
          }
        } else if (l.frequency === 'annual') {
          if (pIdx % 12 === 0) scheduledRecurringValue += netVal;
          if (pIdx === 0) startingGrossMonthly += grossVal / 12;
        } else if (l.frequency === 'quarterly') {
          if (pIdx % 3 === 0) scheduledRecurringValue += netVal;
          if (pIdx === 0) startingGrossMonthly += grossVal / 3;
        } else {
          // monthly
          scheduledRecurringValue += netVal;
          if (pIdx === 0) startingGrossMonthly += grossVal;
        }
      });
    });

    const netMonthlyMRR = startingGrossMonthly * discountMultiplier;
    const netARR = netMonthlyMRR * 12; // Strictly recurring, oneTimeValue excluded!
    const totalContractValue = scheduledRecurringValue + oneTimeValue;

    // Calculate weighted ARR contribution across items for Tier scoring
    lines.forEach(l => {
      if (l.frequency === 'one_time') return; // One-time fees do not contribute to ARR tiering
      
      const baseQty = Number(l.quantity) || 0;
      let grossLineMo = (Number(l.unit_price) || 0) * baseQty;
      if (l.frequency === 'annual') grossLineMo /= 12;
      else if (l.frequency === 'quarterly') grossLineMo /= 3;
      
      const netLineARR = grossLineMo * discountMultiplier * 12;

      // Determine Category & Weighting
      let category = 'fixed';
      if (l.catalog_item_id) {
        const item = catalogItems.find(i => i.id === l.catalog_item_id);
        if (item) {
          const mod = catalogModules.find(m => m.id === item.module_id);
          const modName = (mod?.name || '').toLowerCase();
          if (modName.includes('flat') || modName.includes('subscription')) category = 'flat';
          else if (modName.includes('per-asset') || modName.includes('optimization') || modName.includes('engine') || modName.includes('man-day')) category = 'asset';
        }
      }

      // Fallback inference if custom line item or catalog not loaded
      if (category === 'fixed') {
        const name = (l.name || '').toLowerCase();
        const uLabel = (l.unit_label || '').toLowerCase();
        if (uLabel === 'flat' || name.includes('etrm platform') || name.includes('license') || name.includes('suite') || name.includes('subscription')) {
          category = 'flat';
        } else if (uLabel === 'mw' || uLabel === 'assets' || uLabel === 'man-days' || uLabel === 'mwh/h' || name.includes('man-day') || name.includes('optimization') || name.includes('forecast') || name.includes('dispatch') || name.includes('adhoc')) {
          category = 'asset';
        }
      }

      if (category === 'flat') {
        flatModulesARR += netLineARR;
      } else if (category === 'asset') {
        perAssetEngineARR += netLineARR;
      } else {
        fixedRateARR += netLineARR;
      }
    });

    // Tier calculation weighting formula:
    // Flat ETRM Modules (Highest Weight: 1.5x)
    // Per-Asset / Man-Days Optimization Engines (Second Highest: 1.2x)
    // Fixed rate / General (Standard: 1.0x)
    const weightedARR = (flatModulesARR * 1.5) + (perAssetEngineARR * 1.2) + (fixedRateARR * 1.0);
    const tierInfo = getContractTier(weightedARR);

    return {
      netMonthlyMRR,
      netARR,
      oneTimeValue,
      scheduledRecurringValue,
      totalContractValue,
      weightedARR,
      tierInfo,
      breakdown: { flatModulesARR, perAssetEngineARR, fixedRateARR }
    };
  }

  // Fallback for legacy agreements without structured line items
  let netMonthlyMRR = 0;
  let netARR = 0;
  let oneTimeValue = 0;
  let totalContractValue = fallbackContractValue || 0;

  if (fallbackCadence === 'one_time') {
    oneTimeValue = fallbackContractValue || 0;
  } else if (fallbackCadence === 'annual') {
    netARR = (fallbackContractValue || 0) * Math.max(0, 1 - discountPct / 100);
    netMonthlyMRR = netARR / 12;
  } else if (fallbackCadence === 'quarterly') {
    netMonthlyMRR = ((fallbackContractValue || 0) / 3) * Math.max(0, 1 - discountPct / 100);
    netARR = netMonthlyMRR * 12;
  } else {
    netMonthlyMRR = (fallbackContractValue || 0) * Math.max(0, 1 - discountPct / 100);
    netARR = netMonthlyMRR * 12;
  }

  const weightedARR = netARR * 1.0; // Assume standard rate weight
  const tierInfo = getContractTier(weightedARR);
  const scheduledRecurringValue = netARR * Math.max(1, Number(termYears) || 1);

  return {
    netMonthlyMRR,
    netARR,
    oneTimeValue,
    scheduledRecurringValue,
    totalContractValue,
    weightedARR,
    tierInfo,
    breakdown: { flatModulesARR: 0, perAssetEngineARR: 0, fixedRateARR: netARR }
  };
}
