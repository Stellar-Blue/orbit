import { Contract, ContractLine, ContractLineGroup, CatalogModule, CatalogItem } from '@/lib/types';

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
 * Calculates the gross line item amount for a given quantity and frequency,
 * enforcing any configured minimum monthly charge.
 */
export function calculateLineGrossAmount(
  line: { unit_price?: number; frequency?: string; min_monthly_charge?: number | null },
  qty: number
): { gross: number; minChargeApplied: boolean } {
  const baseGross = (Number(line.unit_price) || 0) * qty;
  if (line.min_monthly_charge && Number(line.min_monthly_charge) > 0 && line.frequency !== 'one_time') {
    let minTarget = Number(line.min_monthly_charge);
    if (line.frequency === 'quarterly') minTarget *= 3;
    else if (line.frequency === 'annual') minTarget *= 12;

    if (baseGross < minTarget) {
      return { gross: minTarget, minChargeApplied: true };
    }
  }
  return { gross: baseGross, minChargeApplied: false };
}

/**
 * Computes the proportional scaling ratio for a group-level monthly floor.
 * When the group's combined monthly-equivalent gross is below the floor,
 * every line in the group scales up proportionally so the combined amount
 * reaches the floor (returned ratio > 1). Returns 1 when no floor is set,
 * the total already exceeds the floor, or the total is empty.
 */
export function calculateGroupFloorRatio(
  floor: number | null | undefined,
  monthlyEquivTotal: number
): number {
  const f = Number(floor) || 0;
  if (f <= 0 || monthlyEquivTotal <= 0 || monthlyEquivTotal >= f) return 1;
  return f / monthlyEquivTotal;
}

/**
 * Builds a lookup map of group_id -> min_monthly_charge for groups that
 * actually carry an active (positive) floor.
 */
export function buildGroupFloorMap(
  groups: Array<Partial<ContractLineGroup>> = []
): Map<string, number> {
  const map = new Map<string, number>();
  groups.forEach(g => {
    const f = Number(g.min_monthly_charge) || 0;
    if (g.id && f > 0) map.set(g.id, f);
  });
  return map;
}

/**
 * Monthly carry-forward helper shared by the valuation, schedule builder and
 * invoice calculator: returns the effective quantity for a line at a given
 * period index (only evaluated for Variable Quantity Pricing Schemes).
 */
function getEffectiveQuantityForPeriod(
  l: Partial<ContractLine>,
  pIdx: number,
  periods: string[],
  catalogModules: CatalogModule[] = [],
  catalogItems: CatalogItem[] = []
): number {
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
}

/**
 * Computes per-group floor scaling ratios for a single period: each group's
 * combined monthly-equivalent gross is compared against its floor, and lines
 * in floored groups scale proportionally (ratio > 1) so the group total
 * reaches the floor.
 */
function computeGroupFloorRatiosForPeriod(
  lines: Array<Partial<ContractLine>>,
  periods: string[],
  pIdx: number,
  groupFloors: Map<string, number>,
  catalogModules: CatalogModule[] = [],
  catalogItems: CatalogItem[] = []
): Map<string, number> {
  const ratios = new Map<string, number>();
  if (groupFloors.size === 0) return ratios;

  const equivByGroup = new Map<string, number>();
  lines.forEach(l => {
    if (l.frequency === 'one_time' || !l.group_id) return;
    const effQty = getEffectiveQuantityForPeriod(l, pIdx, periods, catalogModules, catalogItems);
    const { gross: grossVal } = calculateLineGrossAmount(l, effQty);
    const equiv = l.frequency === 'annual' ? grossVal / 12 : l.frequency === 'quarterly' ? grossVal / 3 : grossVal;
    equivByGroup.set(l.group_id, (equivByGroup.get(l.group_id) || 0) + equiv);
  });

  equivByGroup.forEach((equiv, gid) => {
    const ratio = calculateGroupFloorRatio(groupFloors.get(gid), equiv);
    if (ratio !== 1) ratios.set(gid, ratio);
  });

  return ratios;
}

export interface ContractPeriodAmount {
  period: string;
  amount: number;
}

/**
 * Builds the month-by-month revenue schedule across the contract term,
 * respecting billing frequency anchors, monthly quantity carry-forwards and
 * group-level monthly floors (a floor applies to the COMBINED total of the
 * group's line items, distributed proportionally across them).
 */
export function calculatePeriodAmounts(
  lines: Array<Partial<ContractLine>>,
  discountPct: number = 0,
  termYears: number = 1,
  startDate: string = new Date().toISOString().split('T')[0],
  catalogModules: CatalogModule[] = [],
  catalogItems: CatalogItem[] = [],
  groups: Array<Partial<ContractLineGroup>> = []
): ContractPeriodAmount[] {
  const discountMultiplier = Math.max(0, 1 - (Number(discountPct) || 0) / 100);
  const monthsCount = Math.max(1, (Number(termYears) || 1) * 12);
  const startObj = new Date(startDate || new Date());
  const startYear = startObj.getFullYear();
  const startMonth = startObj.getMonth();
  const periods: string[] = [];
  for (let i = 0; i < monthsCount; i++) {
    const d = new Date(startYear, startMonth + i, 1);
    periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const groupFloors = buildGroupFloorMap(groups);
  const result: ContractPeriodAmount[] = [];

  periods.forEach((period, pIdx) => {
    const groupRatios = computeGroupFloorRatiosForPeriod(lines, periods, pIdx, groupFloors, catalogModules, catalogItems);
    let monthTotal = 0;

    lines.forEach(l => {
      const effQty = getEffectiveQuantityForPeriod(l, pIdx, periods, catalogModules, catalogItems);
      let { gross: grossVal } = calculateLineGrossAmount(l, effQty);
      if (l.group_id && l.frequency !== 'one_time') {
        const ratio = groupRatios.get(l.group_id);
        if (ratio) grossVal *= ratio;
      }
      const lineMult = l.apply_discount !== false ? discountMultiplier : 1.0;
      const netVal = grossVal * lineMult;

      if (l.frequency === 'monthly') {
        monthTotal += netVal;
      } else if (l.frequency === 'quarterly') {
        if (pIdx % 3 === 0) monthTotal += netVal;
      } else if (l.frequency === 'annual') {
        if (pIdx % 12 === 0) monthTotal += netVal;
      } else if (l.frequency === 'one_time') {
        if (pIdx === 0) monthTotal += netVal;
      }
    });

    result.push({ period, amount: Number(monthTotal.toFixed(2)) });
  });

  return result;
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
  fallbackCadence: string = 'monthly',
  groups: Array<Partial<ContractLineGroup>> = []
): ContractValuation {
  const discountMultiplier = Math.max(0, 1 - (Number(discountPct) || 0) / 100);
  
  // If we have line items, calculate with full granularity
  if (lines && lines.length > 0) {
    let startingNetMonthly = 0;
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

    const groupFloors = buildGroupFloorMap(groups);

    let scheduledRecurringValue = 0;
    periods.forEach((period, pIdx) => {
      const groupRatios = computeGroupFloorRatiosForPeriod(lines, periods, pIdx, groupFloors, catalogModules, catalogItems);
      lines.forEach(l => {
        const effQty = getEffectiveQuantityForPeriod(l, pIdx, periods, catalogModules, catalogItems);
        let { gross: grossVal } = calculateLineGrossAmount(l as any, effQty);
        if (l.group_id && l.frequency !== 'one_time') {
          const ratio = groupRatios.get(l.group_id);
          if (ratio) grossVal *= ratio;
        }
        const lineMult = l.apply_discount !== false ? discountMultiplier : 1.0;
        const netVal = grossVal * lineMult;

        if (l.frequency === 'one_time') {
          if (pIdx === 0) {
            oneTimeValue += ((Number(l.unit_price) || 0) * (Number(l.quantity) || 0)) * lineMult;
          }
        } else if (l.frequency === 'annual') {
          if (pIdx % 12 === 0) scheduledRecurringValue += netVal;
          if (pIdx === 0) startingNetMonthly += (grossVal / 12) * lineMult;
        } else if (l.frequency === 'quarterly') {
          if (pIdx % 3 === 0) scheduledRecurringValue += netVal;
          if (pIdx === 0) startingNetMonthly += (grossVal / 3) * lineMult;
        } else {
          // monthly
          scheduledRecurringValue += netVal;
          if (pIdx === 0) startingNetMonthly += grossVal * lineMult;
        }
      });
    });

    const netMonthlyMRR = startingNetMonthly;
    const netARR = netMonthlyMRR * 12; // Strictly recurring, oneTimeValue excluded!
    const totalContractValue = scheduledRecurringValue + oneTimeValue;

    // Group floors on base (month 1) quantities for Tier scoring
    const tierRatios = new Map<string, number>();
    if (groupFloors.size > 0) {
      const equivByGroup = new Map<string, number>();
      lines.forEach(l => {
        if (l.frequency === 'one_time' || !l.group_id) return;
        const baseQty = Number(l.quantity) || 0;
        let { gross: g } = calculateLineGrossAmount(l as any, baseQty);
        if (l.frequency === 'annual') g /= 12;
        else if (l.frequency === 'quarterly') g /= 3;
        equivByGroup.set(l.group_id, (equivByGroup.get(l.group_id) || 0) + g);
      });
      equivByGroup.forEach((equiv, gid) => {
        const ratio = calculateGroupFloorRatio(groupFloors.get(gid), equiv);
        if (ratio !== 1) tierRatios.set(gid, ratio);
      });
    }

    // Calculate weighted ARR contribution across items for Tier scoring
    lines.forEach(l => {
      if (l.frequency === 'one_time') return; // One-time fees do not contribute to ARR tiering
      
      const baseQty = Number(l.quantity) || 0;
      let { gross: grossLineMo } = calculateLineGrossAmount(l as any, baseQty);
      if (l.group_id) {
        const ratio = tierRatios.get(l.group_id);
        if (ratio) grossLineMo *= ratio;
      }
      if (l.frequency === 'annual') grossLineMo /= 12;
      else if (l.frequency === 'quarterly') grossLineMo /= 3;
      
      const lineMult = l.apply_discount !== false ? discountMultiplier : 1.0;
      const netLineARR = grossLineMo * lineMult * 12;

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

export function getContractNoticeStatus(contract: {
  status?: string;
  ends_on?: string;
  notice_period_days?: number;
  notice_deadline?: string;
}) {
  let deadlineDate: Date | null = null;
  let noticeDeadlineStr = contract.notice_deadline || 'Indefinite';

  if (contract.ends_on) {
    const endsDate = new Date(contract.ends_on + 'T00:00:00');
    if (!isNaN(endsDate.getTime())) {
      const days = Number(contract.notice_period_days) || 30;
      deadlineDate = new Date(endsDate.getTime() - days * 86400000);
      noticeDeadlineStr = deadlineDate.toISOString().split('T')[0];
    }
  } else if (contract.notice_deadline && contract.notice_deadline !== 'Indefinite') {
    deadlineDate = new Date(contract.notice_deadline + 'T00:00:00');
    if (!isNaN(deadlineDate.getTime())) {
      noticeDeadlineStr = contract.notice_deadline;
    }
  }

  if (!deadlineDate || isNaN(deadlineDate.getTime())) {
    return { isUrgent: false, daysUntilNotice: Infinity, noticeDeadlineStr: 'Indefinite' };
  }

  const today = new Date();
  const diffTime = deadlineDate.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0);
  const daysUntilNotice = Math.round(diffTime / (1000 * 60 * 60 * 24));

  const isUrgent = (contract.status === 'active' || contract.status === 'expiring' || contract.status === 'in_negotiation') &&
                   daysUntilNotice <= 60 && daysUntilNotice >= -30;

  return {
    isUrgent,
    daysUntilNotice,
    noticeDeadlineStr
  };
}

/**
 * Calculates the correct invoice amount for a specific billing period,
 * respecting each line item's individual frequency vs the contract's billing cadence.
 *
 * Rules:
 *   - `one_time` line   → only on the very first invoice (period overlaps service_start_date)
 *   - `annual` line     → only on the FIRST billing period of the calendar year (start_of_period)
 *                         or the LAST billing period of the calendar year (end_of_period)
 *   - `quarterly` line  → only on the FIRST billing period of the quarter (start_of_period)
 *                         or the LAST billing period of the quarter (end_of_period)
 *   - `monthly` line    → included in every billing period
 *
 * @param lines          Contract line items
 * @param periodFrom     ISO date string of the billing period start (e.g. "2026-08-01")
 * @param periodTo       ISO date string of the billing period end   (e.g. "2026-08-31")
 * @param invoiceTiming  'start_of_period' | 'end_of_period' | 'upon_milestone'
 * @param billingCadence Contract billing cadence (monthly | quarterly | annual | one_off | milestone)
 * @param serviceStartDate ISO date of contract service start (to identify first invoice)
 * @param discountPct    Discount percentage (0–100)
 * @param catalogModules  Catalog modules for variable-qty detection
 * @param catalogItems    Catalog items for variable-qty detection
 * @param groups          Contract line groups; any active min_monthly_charge is enforced on
 *                        the COMBINED monthly-equivalent total of the group's line items
 *                        (distributed proportionally across the group's lines).
 */
export function calculateInvoiceAmountForPeriod(
  lines: Array<Partial<ContractLine> & { name: string; unit_price: number; quantity: number; frequency: string }>,
  periodFrom: string,
  periodTo: string,
  invoiceTiming: string,
  billingCadence: string,
  serviceStartDate: string,
  discountPct: number = 0,
  catalogModules: CatalogModule[] = [],
  catalogItems: CatalogItem[] = [],
  groups: Array<Partial<ContractLineGroup>> = []
): number {
  if (!lines || lines.length === 0) return 0;

  const discountMultiplier = Math.max(0, 1 - (Number(discountPct) || 0) / 100);
  const periodStart = new Date(periodFrom + 'T00:00:00');
  const periodYear = periodStart.getFullYear();
  const periodMonth = periodStart.getMonth(); // 0-indexed
  const periodQuarter = Math.floor(periodMonth / 3); // 0-indexed

  const isEndTiming = invoiceTiming === 'end_of_period';
  const isFirstInvoice = serviceStartDate <= periodFrom;

  // Determine if this billing period is the "annual trigger" period for a given year
  const isAnnualTriggerPeriod = (): boolean => {
    if (billingCadence === 'annual') return true;
    if (billingCadence === 'quarterly') {
      // First/last quarter of the year triggers annual line
      return isEndTiming ? periodQuarter === 3 : periodQuarter === 0;
    }
    if (billingCadence === 'monthly') {
      // First/last month of the year triggers annual line
      return isEndTiming ? periodMonth === 11 : periodMonth === 0;
    }
    return true;
  };

  // Determine if this billing period is the "quarterly trigger" period
  const isQuarterlyTriggerPeriod = (): boolean => {
    if (billingCadence === 'annual' || billingCadence === 'quarterly') return true;
    if (billingCadence === 'monthly') {
      // First or last month within the current quarter
      const monthInQuarter = periodMonth - periodQuarter * 3; // 0, 1, or 2
      return isEndTiming ? monthInQuarter === 2 : monthInQuarter === 0;
    }
    return true;
  };

  // For annual billing cadence: annual line appears once per year but check start-date for partial year
  // For quarterly: quarterly lines appear once per quarter
  // We need to identify if this is the very first time we'd invoice this line
  // (when service starts mid-year, first invoice is still the trigger)
  const isFirstPeriodOfYear = (): boolean => {
    const serviceStart = new Date(serviceStartDate + 'T00:00:00');
    // If service started this year and this is that first period, it's the trigger
    if (serviceStart.getFullYear() === periodYear && periodFrom <= serviceStartDate + 'Z') return true;
    return isAnnualTriggerPeriod();
  };

  const isFirstPeriodOfQuarter = (): boolean => {
    const serviceStart = new Date(serviceStartDate + 'T00:00:00');
    const serviceQuarter = Math.floor(serviceStart.getMonth() / 3);
    if (serviceStart.getFullYear() === periodYear && serviceQuarter === periodQuarter && periodFrom <= serviceStartDate + 'Z') return true;
    return isQuarterlyTriggerPeriod();
  };

  // Compute raw per-line invoice contributions plus monthly-equivalent amounts
  // (monthly-equiv is used to enforce group floors at the group level).
  const groupFloors = buildGroupFloorMap(groups);
  const lineCalcs = lines.map(l => {
    const qty = Number(l.quantity) || 0;
    const { gross: baseGross } = calculateLineGrossAmount(l as any, qty);
    const lineMult = l.apply_discount !== false ? discountMultiplier : 1.0;
    const grossLine = baseGross * lineMult;

    let amount = 0;
    switch (l.frequency) {
      case 'one_time':
        // Only on the very first billing period (service_start_date falls in or before this period)
        if (isFirstInvoice) {
          amount = grossLine;
        }
        break;

      case 'annual':
        // Include only on the correct first/last billing period of the year
        if (isFirstPeriodOfYear()) {
          amount = grossLine;
        }
        break;

      case 'quarterly':
        // Include only on the correct first/last billing period of the quarter
        if (isFirstPeriodOfQuarter()) {
          amount = grossLine;
        }
        break;

      case 'monthly':
      default:
        // Monthly lines appear on every billing period
        if (billingCadence === 'annual') {
          amount = grossLine * 12;
        } else if (billingCadence === 'quarterly') {
          amount = grossLine * 3;
        } else {
          amount = grossLine;
        }
        break;
    }

    const equiv = l.frequency === 'annual' ? grossLine / 12
      : l.frequency === 'quarterly' ? grossLine / 3
      : l.frequency === 'monthly' ? grossLine : 0;

    return { line: l, amount, equiv };
  });

  // Group floors: scale included amounts proportionally so each group's combined
  // monthly-equivalent total reaches its floor.
  const groupRatios = new Map<string, number>();
  if (groupFloors.size > 0) {
    const equivByGroup = new Map<string, number>();
    lineCalcs.forEach(c => {
      if (c.line.frequency === 'one_time' || !c.line.group_id) return;
      equivByGroup.set(c.line.group_id, (equivByGroup.get(c.line.group_id) || 0) + c.equiv);
    });
    equivByGroup.forEach((equiv, gid) => {
      const ratio = calculateGroupFloorRatio(groupFloors.get(gid), equiv);
      if (ratio !== 1) groupRatios.set(gid, ratio);
    });
  }

  let total = 0;
  lineCalcs.forEach(c => {
    let amount = c.amount;
    if (c.line.group_id && c.line.frequency !== 'one_time') {
      const ratio = groupRatios.get(c.line.group_id);
      if (ratio) amount *= ratio;
    }
    total += amount;
  });

  return total;
}
