"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { ContractLine, ContractLineGroup, CatalogItem } from '@/lib/types';
import { calculateContractValuation, isVariableQuantityPricingScheme, calculateLineGrossAmount, calculatePeriodAmounts, calculateGroupFloorRatio } from '@/lib/pricing-engine';
import { Card, Button, Badge } from '@/components/ui/primitives';
import { 
  Plus, Trash2, Tag, DollarSign, Calendar, 
  Sparkles, CheckCircle2, AlertCircle, AlertTriangle, Layers, ArrowRight, ChevronDown, ChevronUp, BarChart3, RefreshCw, X, FolderPlus, Folder, ShieldCheck
} from 'lucide-react';

/** The pricing half of a contract, reported to the dossier so one Save can persist the whole thing. */
export interface PricingDraft {
  contractId?: string;
  lines: Omit<ContractLine, 'id' | 'contract_id'>[];
  schedule: { period: string; amount: number }[];
  discountPct: number;
  termYears: number;
  startDate: string;
  totalContractValue: number;
  groups: Omit<ContractLineGroup, 'contract_id'>[];
  /** Invalid per-line active windows block persistence — the dossier's Save honours this too. */
  windowErrorCount: number;
  /** False while the pricing sheet still matches what was last persisted. */
  isDirty: boolean;
}

interface ContractPricingBuilderProps {
  contractId?: string;
  initialLines?: ContractLine[];
  initialGroups?: ContractLineGroup[];
  initialDiscountPct?: number;
  initialTermYears?: number;
  initialStartDate?: string;
  /** The contract's end date — the term length is derived from it instead of being typed in. */
  contractEndsOn?: string | null;
  /** The contract's own invoice timing — shown as the inherited default for lines without their own. */
  contractInvoiceTiming?: string | null;
  onSave?: (
    lines: Omit<ContractLine, 'id' | 'contract_id'>[], 
    schedule: { period: string; amount: number }[], 
    discountPct: number, 
    termYears: number, 
    startDate: string,
    totalContractValue: number,
    groups: Omit<ContractLineGroup, 'contract_id'>[]
  ) => Promise<void> | void;
  onCancel?: () => void;
  readOnly?: boolean;
  /** Reports the live pricing draft; lets the dossier host a single Save for every tab. */
  onDraftChange?: (draft: PricingDraft) => void;
  /** Hides the builder's own Cancel / "Save & Lock" row when the dossier owns the save action. */
  hideActions?: boolean;
}

const toDraftLine = (l: ContractLine | Omit<ContractLine, 'id' | 'contract_id'>): Omit<ContractLine, 'id' | 'contract_id'> => ({
  catalog_item_id: l.catalog_item_id,
  group_id: l.group_id || null,
  name: l.name,
  unit_price: Number(l.unit_price) || 0,
  quantity: Number(l.quantity) || 1,
  unit_label: l.unit_label || 'unit',
  frequency: l.frequency || 'monthly',
  note: l.note || '',
  monthly_quantities: l.monthly_quantities ? { ...l.monthly_quantities } : {},
  apply_discount: l.apply_discount !== false,
  min_monthly_charge: null,
  invoice_timing: l.invoice_timing || null,
  // These two must be carried over or a saved window renders empty and the next save overwrites
  // it with NULL — which made the dates look like they never saved.
  starts_on: l.starts_on || null,
  ends_on: l.ends_on || null,
  line_kind: l.line_kind || 'unit',
  role: l.role || null,
  seniority: l.seniority || null,
});

const toDraftGroup = (g: Partial<ContractLineGroup>, index: number): Omit<ContractLineGroup, 'contract_id'> => ({
  id: g.id as string,
  name: g.name || '',
  min_monthly_charge: g.min_monthly_charge ? Number(g.min_monthly_charge) : null,
  sort_order: g.sort_order ?? index,
});

const generateGroupId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `grp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const roleLabel = (role?: string | null): string => {
  const map: Record<string, string> = {
    engineer: 'Engineer',
    consultant: 'Consultant',
    designer: 'Product Designer',
    project_manager: 'Project Manager',
    data_scientist: 'Data Scientist',
    devops: 'DevOps Engineer',
  };
  return role ? (map[role] || role) : 'Man-Hours';
};

export const ContractPricingBuilder: React.FC<ContractPricingBuilderProps> = ({
  contractId,
  initialLines = [],
  initialGroups = [],
  initialDiscountPct = 0,
  initialTermYears = 1,
  initialStartDate = new Date().toISOString().split('T')[0],
  contractEndsOn = null,
  contractInvoiceTiming = 'start_of_period',
  onSave,
  onCancel,
  readOnly = false,
  onDraftChange,
  hideActions = false
}) => {
  const { catalogModules, catalogItems } = useAuth();

  const [groups, setGroups] = useState<ContractLineGroup[]>(
    initialGroups.map((g, i) => ({ ...toDraftGroup(g, i), contract_id: g.contract_id }) as ContractLineGroup)
  );

  const [lines, setLines] = useState<Omit<ContractLine, 'id' | 'contract_id'>[]>(
    initialLines.map(toDraftLine)
  );

  const [discountPct, setDiscountPct] = useState<number>(initialDiscountPct);
  // Term and service start come from the contract itself (the metadata editor owns them), so the
  // pricing sheet only ever needs the discount.
  const startDate = initialStartDate || new Date().toISOString().split('T')[0];
  const termYears = useMemo(() => {
    const start = new Date(`${startDate}T00:00:00`);
    const end = contractEndsOn ? new Date(`${contractEndsOn}T00:00:00`) : null;
    if (end && !isNaN(start.getTime()) && !isNaN(end.getTime()) && end > start) {
      const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
      return Math.min(25, Math.max(1, Math.ceil(months / 12)));
    }
    return Math.max(1, initialTermYears || 1);
  }, [startDate, contractEndsOn, initialTermYears]);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string>('');
  const [showSchedulePreview, setShowSchedulePreview] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [expandedScheduleLineIdx, setExpandedScheduleLineIdx] = useState<number | null>(null);

  // Generate ordered timeline periods (YYYY-MM) across the entire contract term
  const termPeriods = useMemo(() => {
    const monthsCount = Math.max(1, (Number(termYears) || 1) * 12);
    const startObj = new Date(startDate || new Date());
    const startYear = startObj.getFullYear();
    const startMonth = startObj.getMonth();
    const periods: string[] = [];

    for (let i = 0; i < monthsCount; i++) {
      const d = new Date(startYear, startMonth + i, 1);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      periods.push(`${yyyy}-${mm}`);
    }
    return periods;
  }, [termYears, startDate]);

  // ── Per-line active window (start from / ends at) ────────────────────────────────────────────────
  /** First and last date a line may legitimately charge: the contract's own service window. */
  const windowBounds = useMemo(() => {
    const first = termPeriods[0] || startDate.slice(0, 7);
    const last = termPeriods[termPeriods.length - 1] || first;
    const lastDay = new Date(Number(last.slice(0, 4)), Number(last.slice(5, 7)), 0).getDate();
    return { min: `${first}-01`, max: `${last}-${String(lastDay).padStart(2, '0')}`, firstMonth: first, lastMonth: last };
  }, [termPeriods, startDate]);

  const monthLabel = (iso: string) => {
    const [y, m] = iso.slice(0, 7).split('-');
    return `${MONTH_SHORT[Number(m) - 1] ?? m} ${y}`;
  };

  /** Months a line's window actually charges inside the contract term (client-side preview only). */
  const lineActiveMonthCount = (line: Omit<ContractLine, 'id' | 'contract_id'>) =>
    termPeriods.filter(p => (!line.starts_on || p >= line.starts_on.slice(0, 7)) && (!line.ends_on || p <= line.ends_on.slice(0, 7))).length;

  /**
   * Validation of every line window. Only a genuinely broken range blocks the save — a window that
   * reaches past the contract term (or starts before it) is legitimate input: the line simply charges
   * while the contract runs, so it is reported as a note instead of being rejected. Blocking those was
   * making saves look "broken" while the dates were quietly discarded.
   */
  const windowErrors = useMemo(() => {
    const errors = new Map<number, string>();
    lines.forEach((line, idx) => {
      const from = line.starts_on ? String(line.starts_on).slice(0, 7) : null;
      const to = line.ends_on ? String(line.ends_on).slice(0, 7) : null;
      if (from && to && to < from) errors.set(idx, '“to” is before “from”');
    });
    return errors;
  }, [lines]);

  /** Non-blocking notes: the window is fine, but it extends past the contract's own term. */
  const windowNotes = useMemo(() => {
    const notes = new Map<number, string>();
    lines.forEach((line, idx) => {
      const from = line.starts_on ? String(line.starts_on).slice(0, 7) : null;
      const to = line.ends_on ? String(line.ends_on).slice(0, 7) : null;
      if (from && from < windowBounds.firstMonth) notes.set(idx, `starts before the contract — charges from ${monthLabel(windowBounds.min)}`);
      else if (to && to > windowBounds.lastMonth) notes.set(idx, `runs past the term — charges until ${monthLabel(windowBounds.max)}`);
    });
    return notes;
  }, [lines, windowBounds]);

  /** A window that fails validation is never sent to the engine. */
  const sanitizedLines = useMemo(
    () => lines.map((line, idx) => (windowErrors.has(idx) ? { ...line, starts_on: null, ends_on: null } : line)),
    [lines, windowErrors]
  );

  // Carry-forward calculation: find explicit quantity override or carry forward previous month's quantity
  const getEffectiveQuantity = (line: Omit<ContractLine, 'id' | 'contract_id'>, periodIdx: number, allPeriods: string[]) => {
    if (line.frequency === 'one_time' || !isVariableQuantityPricingScheme(line, catalogModules, catalogItems)) {
      return Number(line.quantity) || (line.frequency === 'one_time' ? 1 : 0);
    }
    const mq = line.monthly_quantities || {};
    // Search backward from periodIdx to 0 for an explicit monthly override
    for (let i = periodIdx; i >= 0; i--) {
      const p = allPeriods[i];
      if (mq[p] !== undefined && mq[p] !== null && !isNaN(Number(mq[p]))) {
        return Number(mq[p]);
      }
    }
    // Fall back to base initial quantity
    return Number(line.quantity) || 0;
  };

  // Snapshot catalog defaults into a new contract line item
  const handleAddCatalogItem = (itemId: string) => {
    if (!itemId) return;
    const item = catalogItems.find(i => i.id === itemId);
    if (!item) return;

    setLines(prev => [
      ...prev,
      {
        catalog_item_id: item.id,
        group_id: null,
        name: item.name,
        unit_price: Number(item.default_unit_price),
        quantity: 1,
        unit_label: item.unit_label,
        frequency: item.default_frequency,
        note: '',
        monthly_quantities: {},
        apply_discount: true,
        min_monthly_charge: null,
        line_kind: item.pricing_kind === 'man_hours' ? 'man_hours' : 'unit',
        role: item.role || null,
        seniority: item.seniority || null
      }
    ]);
    setSelectedCatalogId('');
  };

  const handleAddCustomItem = () => {
    setLines(prev => [
      ...prev,
      {
        catalog_item_id: null,
        group_id: null,
        name: 'Custom Fee / Engine Service',
        unit_price: 1000,
        quantity: 1,
        unit_label: 'flat',
        frequency: 'monthly',
        note: 'Custom negotiated rate',
        monthly_quantities: {},
        apply_discount: true,
        min_monthly_charge: null,
        line_kind: 'unit',
        role: null,
        seniority: null
      }
    ]);
  };

  const updateLine = (index: number, field: keyof Omit<ContractLine, 'id' | 'contract_id'>, value: any) => {
    setLines(prev => prev.map((l, idx) => idx === index ? { ...l, [field]: value } : l));
  };

  const deleteLine = (index: number) => {
    setLines(prev => prev.filter((_, idx) => idx !== index));
    if (expandedScheduleLineIdx === index) setExpandedScheduleLineIdx(null);
  };

  const addGroup = () => {
    setGroups(prev => [
      ...prev,
      {
        id: generateGroupId(),
        contract_id: contractId || '',
        name: `Group ${prev.length + 1}`,
        min_monthly_charge: null,
        sort_order: prev.length
      }
    ]);
  };

  const updateGroup = (index: number, field: keyof ContractLineGroup, value: string | number | boolean | null) => {
    setGroups(prev => prev.map((g, idx) => idx === index ? { ...g, [field]: value } : g));
  };

  const deleteGroup = (groupId: string) => {
    setGroups(prev => prev.filter(g => g.id !== groupId));
    setLines(prev => prev.map(l => l.group_id === groupId ? { ...l, group_id: null } : l));
    if (expandedScheduleLineIdx !== null) {
      setExpandedScheduleLineIdx(null);
    }
  };

  // Group floor scaling ratio for a single period (combined monthly-equivalent total of the group)
  const getGroupFloorRatio = (groupId: string | null | undefined, pIdx: number): number => {
    if (!groupId) return 1;
    const group = groups.find(g => g.id === groupId);
    const floor = group?.min_monthly_charge;
    let equiv = 0;
    lines.forEach(l => {
      if (l.group_id !== groupId || l.frequency === 'one_time') return;
      const effQty = getEffectiveQuantity(l, pIdx, termPeriods);
      const { gross: g } = calculateLineGrossAmount(l, effQty);
      equiv += l.frequency === 'annual' ? g / 12 : l.frequency === 'quarterly' ? g / 3 : g;
    });
    return calculateGroupFloorRatio(floor, equiv);
  };

  // Calculations incorporating dynamic monthly quantity carry-forward schedules and Tier 1-10 weighting.
  // Lines with an invalid active window are excluded (they fall back to the contract's full term) so a
  // half-typed date can never distort the price sheet.
  const totals = useMemo(() => {
    const valuation = calculateContractValuation(sanitizedLines, discountPct, termYears, startDate, catalogModules, catalogItems, 0, 'monthly', groups);
    return {
      netMonthlyMRR: valuation.netMonthlyMRR,
      netAnnual: valuation.netARR,
      oneTimeTotal: valuation.oneTimeValue,
      totalContractValue: valuation.totalContractValue,
      tierInfo: valuation.tierInfo,
      breakdown: valuation.breakdown,
      weightedARR: valuation.weightedARR
    };
  }, [sanitizedLines, discountPct, termYears, startDate, catalogModules, catalogItems, groups]);

  // Schedule generator reflecting monthly variable quantity carry-forwards and group-level floors
  const schedule = useMemo(() => {
    return calculatePeriodAmounts(sanitizedLines, discountPct, termYears, startDate, catalogModules, catalogItems, groups);
  }, [sanitizedLines, discountPct, termYears, startDate, catalogModules, catalogItems, groups]);

  const handleSaveClick = async () => {
    if (!onSave) return;
    if (windowErrors.size > 0) return; // guarded by the disabled button; never persist an invalid window
    setIsSaving(true);
    try {
      await onSave(sanitizedLines, schedule, discountPct, termYears, startDate, totals.totalContractValue, groups);
    } finally {
      setIsSaving(false);
    }
  };

  // The dossier owns the single Save, so the live draft (and whether it diverges from what was last
  // persisted) is reported upwards. Comparing fingerprints keeps the check independent of object identity.
  const draftFingerprint = useMemo(
    () => JSON.stringify([sanitizedLines, groups, discountPct, termYears, startDate]),
    [sanitizedLines, groups, discountPct, termYears, startDate]
  );
  const persistedFingerprint = useMemo(
    () => JSON.stringify([
      initialLines.map(toDraftLine),
      initialGroups.map(toDraftGroup),
      initialDiscountPct,
      initialTermYears,
      initialStartDate,
    ]),
    [initialLines, initialGroups, initialDiscountPct, initialTermYears, initialStartDate]
  );

  const draftChangeRef = useRef(onDraftChange);
  useEffect(() => { draftChangeRef.current = onDraftChange; }, [onDraftChange]);

  useEffect(() => {
    draftChangeRef.current?.({
      contractId,
      lines: sanitizedLines,
      schedule,
      discountPct,
      termYears,
      startDate,
      totalContractValue: totals.totalContractValue,
      groups,
      windowErrorCount: windowErrors.size,
      isDirty: draftFingerprint !== persistedFingerprint,
    });
    // `schedule` / `sanitizedLines` are memoised on the fields in `draftFingerprint`, so the
    // fingerprints are the real trigger — they just carry the freshly computed payload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftFingerprint, persistedFingerprint, totals.totalContractValue, windowErrors.size]);

  return (
    <div className="space-y-4">
      {/* Rate sheet header — one compact row: the contract owns the term and start date */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 rounded-xl bg-gradient-to-r from-slate-900 via-slate-800 to-[#1e3a5f] text-white border border-slate-700/50 shadow-sm">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-sm font-extrabold tracking-tight text-white truncate">Contract Rate Sheet</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black tracking-wide border shrink-0 ${totals.tierInfo.badgeClass}`}>
            {totals.tierInfo.label}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="contract-discount" className="text-[11px] font-bold text-slate-300 flex items-center">
            <Tag className="w-3 h-3 mr-1 text-amber-400" /> Discount
          </label>
          <div className="relative">
            <input
              id="contract-discount"
              type="number"
              step="0.5"
              min="0"
              max="100"
              disabled={readOnly}
              value={discountPct}
              onChange={e => setDiscountPct(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
              className="w-16 bg-slate-950/80 border border-slate-600/80 rounded-md pl-2 pr-5 py-1 text-xs font-bold text-white text-right focus:outline-none focus:border-amber-400 disabled:opacity-60"
            />
            <span className="absolute right-1.5 top-1 text-[10px] font-bold text-slate-400">%</span>
          </div>
        </div>
      </div>

      {/* Catalog Selector Bar */}
      {!readOnly && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 rounded-xl bg-slate-100 border border-slate-200 shadow-sm">
          <div className="flex items-center space-x-3 flex-1">
            <Layers className="w-5 h-5 text-blue-600 shrink-0" />
            <div className="flex-1 max-w-md">
              <select
                value={selectedCatalogId}
                onChange={e => setSelectedCatalogId(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-medium text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-- Select module from rate sheet catalog --</option>
                {catalogModules.filter(m => m.active).map(mod => {
                  const modItems = catalogItems.filter(i => i.module_id === mod.id && i.active);
                  if (modItems.length === 0) return null;
                  return (
                    <optgroup key={mod.id} label={mod.name}>
                      {modItems.map(item => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({Number(item.default_unit_price).toLocaleString()} € / {item.unit_label} · {item.default_frequency})
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </div>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!selectedCatalogId}
              onClick={() => handleAddCatalogItem(selectedCatalogId)}
              className="shrink-0 cursor-pointer shadow-md"
            >
              <Plus className="w-4 h-4 mr-1" /> Add from Catalog
            </Button>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddCustomItem}
            className="shrink-0 cursor-pointer bg-white border-dashed border-slate-400 text-slate-700 hover:bg-slate-50"
          >
            <Plus className="w-4 h-4 mr-1" /> Add Custom Line
          </Button>
        </div>
      )}

      {/* Pricing Groups Manager */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200 flex items-center justify-between">
          <span className="text-sm font-extrabold text-slate-800 flex items-center">
            <Folder className="w-4 h-4 mr-2 text-indigo-600" /> Pricing Groups ({groups.length})
            <span className="ml-3 hidden sm:inline text-[11px] font-semibold text-slate-500">Floor price / mo applies to the COMBINED total of the group&apos;s line items, not per line</span>
          </span>
          {!readOnly && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addGroup}
              className="shrink-0 cursor-pointer bg-white border-indigo-300 text-indigo-700 hover:bg-indigo-50"
            >
              <FolderPlus className="w-4 h-4 mr-1" /> Add Group
            </Button>
          )}
        </div>

        {groups.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400 bg-indigo-50/30">
            No pricing groups yet. Groups bundle line items under a shared <strong>floor price / mo</strong> — when the group&apos;s combined monthly total falls below the floor, it is raised proportionally across the group&apos;s lines.
            {!readOnly && <span className="block mt-1 text-indigo-600 font-semibold">Click &quot;Add Group&quot; to start bundling.</span>}
          </div>
        ) : (
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {groups.map((group, gIdx) => {
              const memberCount = lines.filter(l => l.group_id === group.id && l.frequency !== 'one_time').length;
              const ratio = getGroupFloorRatio(group.id, 0);
              const floorApplied = ratio > 1;
              return (
                <div key={group.id} className={`p-3.5 rounded-xl border transition-all ${floorApplied ? 'bg-amber-50 border-amber-300 shadow-sm' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex items-start justify-between gap-2">
                    {readOnly ? (
                      <span className="font-extrabold text-slate-800 text-sm mt-0.5">{group.name}</span>
                    ) : (
                      <input
                        type="text"
                        value={group.name}
                        onChange={e => updateGroup(gIdx, 'name', e.target.value)}
                        className="flex-1 min-w-0 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm font-bold text-slate-800 focus:outline-none focus:border-indigo-500"
                        placeholder="Group name..."
                      />
                    )}
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => deleteGroup(group.id)}
                        className="text-rose-500 hover:text-rose-700 transition-colors p-1 rounded hover:bg-rose-50 cursor-pointer shrink-0"
                        title="Delete group (lines become ungrouped)"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="mt-2.5 flex items-center justify-between gap-3">
                    <div className="flex-1">
                      {readOnly ? (
                        <span className="font-mono font-bold text-slate-700 text-sm block">
                          {group.min_monthly_charge && Number(group.min_monthly_charge) > 0 ? `€${Number(group.min_monthly_charge).toLocaleString()} / mo` : 'No Floor'}
                        </span>
                      ) : (
                        <div className="flex items-center space-x-1.5">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Floor / mo</span>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            value={group.min_monthly_charge ?? ''}
                            onChange={e => updateGroup(gIdx, 'min_monthly_charge', e.target.value ? parseFloat(e.target.value) : null)}
                            placeholder="0 (None)"
                            className="flex-1 min-w-[80px] bg-white border border-slate-300 rounded-lg px-2 py-1 text-sm font-mono focus:outline-none focus:border-indigo-500"
                          />
                          <span className="text-[10px] font-bold text-slate-500">€</span>
                        </div>
                      )}
                    </div>
                    <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${memberCount > 0 ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-slate-100 text-slate-400 border-slate-200'}`}>
                      {memberCount} line{memberCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  {floorApplied && (
                    <div className="mt-2 flex items-center text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-300 rounded-lg px-2 py-1">
                      <ShieldCheck className="w-3 h-3 mr-1.5 shrink-0" />
                      Floor active — month-1 combined €{(() => {
                        let equiv = 0;
                        lines.forEach(l => {
                          if (l.group_id !== group.id || l.frequency === 'one_time') return;
                          // Same effective quantity as getGroupFloorRatio, otherwise the figure quoted
                          // here disagrees with the ratio that was actually applied.
                          const { gross: g } = calculateLineGrossAmount(l as any, getEffectiveQuantity(l, 0, termPeriods));
                          equiv += l.frequency === 'annual' ? g / 12 : l.frequency === 'quarterly' ? g / 3 : g;
                        });
                        return equiv.toLocaleString(undefined, { maximumFractionDigits: 0 });
                      })()} raised to €{Number(group.min_monthly_charge).toLocaleString()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Contract Lines Matrix */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <span className="text-sm font-extrabold text-slate-800 flex items-center">
            <Layers className="w-4 h-4 mr-2 text-slate-600" /> Contract Line Items ({lines.length})
          </span>
          <span className="text-xs text-slate-500">Values snapped locally per deal · Expand rows to program month-by-month projections</span>
        </div>

        {lines.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs">
            No line items attached yet. Select modules from the catalog above or add a custom line item.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-600 text-[11px] font-extrabold uppercase tracking-wider border-b border-slate-200">
                  <th className="py-2.5 px-4 min-w-[280px]">Item Name / Module</th>
                  <th className="py-2.5 px-3 w-40">Unit Rate (€)</th>
                  <th className="py-2.5 px-3 w-40">Pricing Group (Floor / Mo)</th>
                  <th className="py-2.5 px-3 w-36">Base Qty / Mo Horizon</th>
                  <th className="py-2.5 px-3 w-28">Unit Label</th>
                  <th className="py-2.5 px-3 w-36">Frequency</th>
                  <th className="py-2.5 px-3 w-44">Invoicing Timing</th>
                  <th className="py-2.5 px-3 w-52">Active Window</th>
                  <th className="py-2.5 px-3 text-center w-32">Discount Applied</th>
                  <th className="py-2.5 px-4 text-right w-48">Month 1 Rate / Projections</th>
                  {!readOnly && <th className="py-2.5 px-3 text-center w-14">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {lines.map((line, idx) => {
                  const baseQty = Number(line.quantity) || 0;
                  // Money shows MONTH 1, so the quantity must be month 1's effective one (the last
                  // override at/before period 0, else the base). Using the base quantity here made
                  // grouped rows quote a rate the schedule and the group floor never charged.
                  const month1Qty = getEffectiveQuantity(line, 0, termPeriods);
                  const { gross: lineGross, minChargeApplied } = calculateLineGrossAmount(line as any, month1Qty);
                  const groupFloorRatio = getGroupFloorRatio(line.group_id, 0);
                  const groupMinApplied = groupFloorRatio > 1;
                  const scaledLineGross = lineGross * groupFloorRatio;
                  const isOneTime = line.frequency === 'one_time';
                  const isVariableScheme = isVariableQuantityPricingScheme(line, catalogModules, catalogItems);
                  const periodSuffix = line.frequency === 'monthly' ? '/ mo' : line.frequency === 'quarterly' ? '/ qtr' : line.frequency === 'annual' ? '/ year' : 'one-off';
                  const monthlyMrrEquiv = line.frequency === 'annual' ? scaledLineGross / 12 : line.frequency === 'quarterly' ? scaledLineGross / 3 : scaledLineGross;
                  const isExpanded = expandedScheduleLineIdx === idx;
                  const overrideCount = Object.keys(line.monthly_quantities || {}).length;

                  return (
                    <React.Fragment key={idx}>
                      <tr className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-4 font-medium text-slate-900 align-top min-w-[280px]">
                          {readOnly ? (
                            <span className="block mt-1 font-bold text-base">{line.name}</span>
                          ) : (
                            <input
                              type="text"
                              value={line.name}
                              onChange={e => updateLine(idx, 'name', e.target.value)}
                              title={line.name || 'Line description...'}
                              className="w-full bg-white border border-slate-300 rounded px-3 py-2.5 text-[17px] font-semibold focus:outline-none focus:border-blue-500"
                              placeholder="Line description..."
                            />
                          )}
                          {line.line_kind === 'man_hours' && (
                            <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5 inline-block mt-1">
                              MAN-HOURS · {roleLabel(line.role)} · {String(line.seniority || 'mid').toUpperCase()}
                            </span>
                          )}
                          {!isOneTime && (
                            <span className="text-[11px] font-normal mt-1 block text-slate-500">
                              {isVariableScheme 
                                ? (overrideCount > 0 ? `⚡ Dynamic Engine: ${overrideCount} monthly override(s)` : '⚡ Variable Engine: Expand schedule to program monthly usage') 
                                : '🔒 Flat ETRM Module / Subscription (Constant quantity)'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 align-top">
                          {readOnly ? (
                            <span className="font-mono text-slate-700 font-bold block mt-1">€{Number(line.unit_price).toLocaleString()} <span className="text-xs text-slate-500 font-normal">{periodSuffix}</span></span>
                          ) : (
                            <div className="flex items-center space-x-1">
                              <input
                                type="number"
                                step="0.01"
                                value={line.unit_price}
                                onChange={e => updateLine(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                                className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-500 min-w-[70px]"
                              />
                              <span className="text-[11px] font-bold text-slate-500 uppercase whitespace-nowrap">{periodSuffix}</span>
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 align-top">
                          {isOneTime ? (
                            <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded block text-center mt-1">
                              N/A (One-off)
                            </span>
                          ) : readOnly ? (
                            <span className={`font-bold block mt-1 ${line.group_id ? 'text-indigo-700' : 'text-slate-500'}`}>
                              {line.group_id ? (groups.find(g => g.id === line.group_id)?.name || 'Group') : 'Ungrouped'}
                              {line.group_id && groups.find(g => g.id === line.group_id)?.min_monthly_charge ? ` · Floor €${Number(groups.find(g => g.id === line.group_id)?.min_monthly_charge).toLocaleString()}/mo` : ''}
                            </span>
                          ) : (
                            <select
                              value={line.group_id || ''}
                              onChange={e => updateLine(idx, 'group_id', e.target.value || null)}
                              className={`w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-xs font-bold uppercase focus:outline-none focus:border-indigo-500 ${line.group_id ? 'text-indigo-700 border-indigo-300 bg-indigo-50/50' : 'text-slate-600'}`}
                            >
                              <option value="">— Ungrouped —</option>
                              {groups.map(g => (
                                <option key={g.id} value={g.id}>
                                  {g.name}{g.min_monthly_charge && Number(g.min_monthly_charge) > 0 ? ` (Floor €${Number(g.min_monthly_charge).toLocaleString()}/mo)` : ''}
                                </option>
                              ))}
                            </select>
                          )}
                          {!isOneTime && !line.group_id && !readOnly && (
                            <span className="text-[10px] text-slate-400 font-normal block mt-1">Not covered by a floor</span>
                          )}
                          {!isOneTime && line.group_id && (
                            <span className="text-[10px] text-indigo-400 font-normal block mt-1">Floor applies to group total</span>
                          )}
                        </td>
                        <td className="py-3 px-3 align-top">
                          <div>
                            {readOnly ? (
                              <span className="font-mono font-bold text-slate-700 block mt-1">{baseQty.toLocaleString()}</span>
                            ) : (
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={line.quantity}
                                onChange={e => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)}
                                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-sm font-mono font-bold focus:outline-none focus:border-blue-500"
                                title="Default month 1 quantity"
                              />
                            )}
                            {!isOneTime && isVariableScheme ? (
                              <button
                                type="button"
                                onClick={() => setExpandedScheduleLineIdx(isExpanded ? null : idx)}
                                className={`mt-2 w-full inline-flex items-center justify-center text-[11px] font-bold px-2 py-1 rounded-lg border transition-all cursor-pointer ${
                                  isExpanded 
                                    ? 'bg-purple-600 text-white border-purple-600 shadow-md shadow-purple-500/20' 
                                    : overrideCount > 0
                                      ? 'bg-purple-50 text-purple-700 border-purple-300 hover:bg-purple-100'
                                      : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200/80'
                                }`}
                              >
                                <Calendar className="w-3 h-3 mr-1 shrink-0" />
                                {overrideCount > 0 ? `${overrideCount} Mo Overrides` : 'Monthly Schedule'}
                                {isExpanded ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
                              </button>
                            ) : !isOneTime && (
                              <span className="mt-2 text-[10px] bg-slate-100 border border-slate-200 text-slate-500 font-semibold px-2 py-0.5 rounded-md block text-center uppercase tracking-wider" title="Flat ETRM Modules have constant quantity across the term">
                                Constant Qty
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 align-top">
                          {readOnly ? (
                            <span className="text-slate-600 font-medium block mt-1">{line.unit_label}</span>
                          ) : (
                            <input
                              type="text"
                              value={line.unit_label}
                              onChange={e => updateLine(idx, 'unit_label', e.target.value)}
                              className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-sm text-slate-700 focus:outline-none focus:border-blue-500"
                            />
                          )}
                        </td>
                        <td className="py-3 px-3 align-top">
                          {readOnly ? (
                            <Badge variant={isOneTime ? 'info' : 'success'}>{line.frequency}</Badge>
                          ) : (
                            <select
                              value={line.frequency}
                              onChange={e => updateLine(idx, 'frequency', e.target.value as any)}
                              className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-xs font-bold uppercase focus:outline-none focus:border-blue-500"
                            >
                              <option value="monthly">Monthly</option>
                              <option value="quarterly">Quarterly</option>
                              <option value="annual">Annual</option>
                              <option value="one_time">One-time</option>
                            </select>
                          )}
                        </td>
                        <td className="py-3 px-3 align-top">
                          {/* Per-line invoice timing: a license can be billed up front while a service line
                              is billed once the period closes, within the same contract and period. */}
                          {readOnly ? (
                            <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border ${
                              (line.invoice_timing || contractInvoiceTiming) === 'end_of_period'
                                ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            }`}>
                              {line.invoice_timing
                                ? (line.invoice_timing === 'end_of_period' ? '⏳ Arrears' : '🚀 Advance')
                                : `Inherited (${contractInvoiceTiming === 'end_of_period' ? 'Arrears' : 'Advance'})`}
                            </span>
                          ) : (
                            <select
                              value={line.invoice_timing || ''}
                              onChange={e => updateLine(idx, 'invoice_timing', e.target.value || null)}
                              className={`w-full bg-white border rounded px-2 py-1.5 text-xs font-bold focus:outline-none focus:border-blue-500 ${
                                (line.invoice_timing || contractInvoiceTiming) === 'end_of_period'
                                  ? 'border-indigo-300 text-indigo-700'
                                  : 'border-emerald-300 text-emerald-700'
                              }`}
                              title="When this line item is invoiced. Default inherits the contract's own timing."
                            >
                              <option value="">Inherit contract ({contractInvoiceTiming === 'end_of_period' ? 'arrears' : 'advance'})</option>
                              <option value="start_of_period">Start of period (in advance)</option>
                              <option value="end_of_period">End of period (in arrears)</option>
                            </select>
                          )}
                        </td>
                        <td className="py-3 px-3 align-top">
                          {/* Per-line active window: a charge can start later or stop earlier than the contract. */}
                          {readOnly ? (
                            <span className="text-[11px] text-slate-600 font-mono block mt-1">
                              {line.starts_on ? monthLabel(line.starts_on) : 'from contract start'}
                              <span className="text-slate-400"> → </span>
                              {line.ends_on ? monthLabel(line.ends_on) : 'to contract end'}
                            </span>
                          ) : (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] font-bold text-slate-400 w-6 shrink-0">from</span>
                                <input
                                  type="date"
                                  value={line.starts_on || ''}
                                  onChange={e => updateLine(idx, 'starts_on', e.target.value || null)}
                                  title="First chargeable month for this line (inclusive) — leave empty to start with the contract"
                                  className={`w-full bg-white border rounded px-1.5 py-1 text-[11px] font-mono focus:outline-none ${windowErrors.get(idx) ? 'border-rose-400 focus:border-rose-500' : 'border-slate-300 focus:border-blue-500'}`}
                                />
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] font-bold text-slate-400 w-6 shrink-0">to</span>
                                <input
                                  type="date"
                                  value={line.ends_on || ''}
                                  onChange={e => updateLine(idx, 'ends_on', e.target.value || null)}
                                  title="Last chargeable month for this line (inclusive) — leave empty to run to the contract end"
                                  className={`w-full bg-white border rounded px-1.5 py-1 text-[11px] font-mono focus:outline-none ${windowErrors.get(idx) ? 'border-rose-400 focus:border-rose-500' : 'border-slate-300 focus:border-blue-500'}`}
                                />
                              </div>
                              {windowErrors.get(idx) && (
                                <div className="text-[10px] font-bold text-rose-600">{windowErrors.get(idx)}</div>
                              )}
                              {!windowErrors.get(idx) && (line.starts_on || line.ends_on) && (
                                <div className="text-[10px] text-slate-500">
                                  {isOneTime
                                    ? `charged once, in ${monthLabel(line.starts_on || windowBounds.min)}`
                                    : `charged for ${lineActiveMonthCount(line)} of ${termPeriods.length} months`}
                                </div>
                              )}
                              {!windowErrors.get(idx) && windowNotes.get(idx) && (
                                <div className="text-[10px] font-semibold text-amber-600">{windowNotes.get(idx)}</div>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 align-top text-center">
                          {readOnly ? (
                            <span className={`inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full border ${
                              line.apply_discount !== false && discountPct > 0
                                ? 'bg-amber-50 text-amber-700 border-amber-300'
                                : 'bg-slate-100 text-slate-500 border-slate-200'
                            }`}>
                              {line.apply_discount !== false ? `Yes (-${discountPct}%)` : 'No (Net Rate)'}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => updateLine(idx, 'apply_discount', line.apply_discount === false ? true : false)}
                              className={`w-full text-xs font-bold px-2 py-1.5 rounded-lg border transition-all cursor-pointer inline-flex items-center justify-center space-x-1 ${
                                line.apply_discount !== false
                                  ? 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100 shadow-2xs'
                                  : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200/80'
                              }`}
                              title={line.apply_discount !== false ? `Contract discount (-${discountPct}%) is applied to this line item. Click to exempt.` : 'No contract discount applied to this line item. Click to enable discount.'}
                            >
                              <Tag className={`w-3.5 h-3.5 mr-1 ${line.apply_discount !== false ? 'text-amber-600' : 'text-slate-400'}`} />
                              <span>{line.apply_discount !== false ? `Yes (${discountPct > 0 ? `-${discountPct}%` : 'On'})` : 'No (Exempt)'}</span>
                            </button>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-slate-900 align-top">
                          {isOneTime ? (
                            <div className="mt-1" title="One-time fee">
                              <div className="font-bold text-amber-600">
                                €{(lineGross * (line.apply_discount !== false ? Math.max(0, 1 - discountPct / 100) : 1.0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (One-off)
                              </div>
                              {line.apply_discount !== false && discountPct > 0 && (
                                <div className="text-[10px] line-through text-slate-400">€{lineGross.toLocaleString()} gross</div>
                              )}
                            </div>
                          ) : (
                            <div>
                              <div className={`font-bold mt-1 ${line.apply_discount !== false && discountPct > 0 ? 'text-emerald-700' : 'text-slate-900'}`}>
                                €{(scaledLineGross * (line.apply_discount !== false ? Math.max(0, 1 - discountPct / 100) : 1.0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {periodSuffix}
                              </div>
                              {line.apply_discount !== false && discountPct > 0 && (
                                <div className="text-[11px] text-slate-400 line-through">€{scaledLineGross.toLocaleString()} gross</div>
                              )}
                              <div className="text-[11px] font-normal text-slate-500">
                                €{(monthlyMrrEquiv * (line.apply_discount !== false ? Math.max(0, 1 - discountPct / 100) : 1.0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo ({line.apply_discount !== false && discountPct > 0 ? 'Net MRR' : 'Mo. 1 MRR'})
                              </div>
                                {overrideCount > 0 && (
                                  <div className="text-[10px] font-semibold text-purple-600 mt-0.5">
                                    Varies per monthly timeline
                                  </div>
                                )}
                                {groupMinApplied && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 mt-1" title="Group floor raised this line's share so the group's combined monthly total meets the floor">
                                    ⚡ Group Floor Applied
                                  </span>
                                )}
                                {minChargeApplied && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 mt-1" title="Minimum monthly fee floor applied">
                                    ⚡ Min Charge Applied
                                  </span>
                                )}
                            </div>
                          )}
                        </td>
                        {!readOnly && (
                          <td className="py-3 px-3 text-center align-top">
                            <button
                              type="button"
                              onClick={() => deleteLine(idx)}
                              className="text-rose-500 hover:text-rose-700 transition-colors p-1.5 mt-0.5 rounded-full hover:bg-rose-50 cursor-pointer"
                              title="Remove line"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        )}
                      </tr>

                      {/* Expandable Month-by-Month Quantity Horizon & Carry-Forward Projection Grid */}
                      {isExpanded && !isOneTime && isVariableScheme && (
                        <tr>
                          <td colSpan={readOnly ? 7 : 8} className="p-0 border-t border-b border-slate-700 bg-slate-900">
                            <div className="p-5 text-slate-100 space-y-4 shadow-inner">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3.5">
                                <div>
                                  <div className="flex items-center space-x-2">
                                    <span className="text-xs font-black uppercase tracking-wider text-purple-400 flex items-center">
                                      <Calendar className="w-4 h-4 mr-1.5 text-purple-400" />
                                      Monthly Quantity Timeline & Carry-Forward Projections
                                    </span>
                                    <span className="bg-purple-900/40 text-purple-300 text-[10px] px-2 py-0.5 rounded-full font-semibold border border-purple-500/30">
                                      {termYears} Year Horizon ({termPeriods.length} Mo)
                                    </span>
                                  </div>
                                  <p className="text-xs text-slate-300 mt-1">
                                    Enter exact quantities for specific months. Unmodified future months automatically inherit from the previous month for effortless budgeting.
                                  </p>
                                </div>
                                <div className="flex items-center space-x-2 shrink-0">
                                  {!readOnly && overrideCount > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => updateLine(idx, 'monthly_quantities', {})}
                                      className="text-xs font-bold bg-slate-800 hover:bg-rose-900/50 text-slate-300 hover:text-rose-300 px-3 py-1.5 rounded-lg border border-slate-700 hover:border-rose-600/50 transition-all flex items-center cursor-pointer"
                                      title="Clear all manual monthly overrides and reset to base initial quantity"
                                    >
                                      <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                                      Reset All Overrides
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => setExpandedScheduleLineIdx(null)}
                                    className="text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700 transition-all flex items-center cursor-pointer"
                                  >
                                    <X className="w-3.5 h-3.5 mr-1" /> Close Timeline
                                  </button>
                                </div>
                              </div>

                              {/* Grid of Months */}
                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 max-h-[360px] overflow-y-auto pr-1">
                                {termPeriods.map((period, pIdx) => {
                                  const hasOverride = line.monthly_quantities?.[period] !== undefined && line.monthly_quantities?.[period] !== null && !isNaN(Number(line.monthly_quantities[period]));
                                  const effQty = getEffectiveQuantity(line, pIdx, termPeriods);
                                  const { gross: periodGross, minChargeApplied: periodMin } = calculateLineGrossAmount(line as any, effQty);
                                  const periodRatio = getGroupFloorRatio(line.group_id, pIdx);
                                  const periodScaled = periodGross * periodRatio;

                                  return (
                                    <div 
                                      key={period} 
                                      className={`p-2.5 rounded-xl border transition-all flex flex-col justify-between ${
                                        hasOverride 
                                          ? 'bg-gradient-to-br from-purple-950/80 to-slate-900 border-purple-500/80 shadow-md shadow-purple-500/10' 
                                          : 'bg-slate-800/60 border-slate-700/80 hover:bg-slate-800/90'
                                      }`}
                                    >
                                      <div className="flex items-center justify-between text-xs mb-2">
                                        <span className="font-mono font-extrabold text-slate-200 text-[11px]">{period}</span>
                                        {hasOverride ? (
                                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                            Overridden
                                          </span>
                                        ) : (
                                          <span className="text-[9px] font-medium text-slate-400 flex items-center" title={pIdx === 0 ? "Default Starting Base Quantity" : "Inherited automatically from previous month"}>
                                            {pIdx === 0 ? 'Base Qty' : '🔄 Inherited'}
                                          </span>
                                        )}
                                      </div>
                                      
                                      <div className="relative flex items-center">
                                        <input
                                          type="number"
                                          step="0.01"
                                          disabled={readOnly}
                                          value={hasOverride ? line.monthly_quantities![period] : effQty}
                                          onChange={e => {
                                            const valStr = e.target.value;
                                            const updatedMq = { ...(line.monthly_quantities || {}) };
                                            if (valStr === '') {
                                              delete updatedMq[period];
                                            } else {
                                              const parsed = parseFloat(valStr);
                                              if (!isNaN(parsed)) updatedMq[period] = parsed;
                                            }
                                            updateLine(idx, 'monthly_quantities', updatedMq);
                                          }}
                                          placeholder={String(effQty)}
                                          className={`w-full bg-slate-950 border rounded-lg pl-2 pr-6 py-1 text-xs font-mono font-bold focus:outline-none focus:ring-2 ${
                                            hasOverride 
                                              ? 'text-purple-200 border-purple-500/70 focus:ring-purple-400' 
                                              : 'text-slate-300 border-slate-700 focus:ring-blue-400 opacity-70'
                                          }`}
                                        />
                                        {hasOverride && !readOnly && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const updatedMq = { ...(line.monthly_quantities || {}) };
                                              delete updatedMq[period];
                                              updateLine(idx, 'monthly_quantities', updatedMq);
                                            }}
                                            className="absolute right-1.5 text-slate-400 hover:text-rose-400 transition-colors p-0.5 cursor-pointer"
                                            title="Clear override (inherit previous month's quantity)"
                                          >
                                            <X className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                      </div>

                                      <div className="mt-2 text-right border-t border-slate-700/50 pt-1.5 flex items-center justify-between text-[10px] font-mono text-slate-400">
                                        <span>{line.unit_label || 'unit'}(s)</span>
                                        <span className="font-bold text-slate-300">
                                          €{periodScaled.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                                          {periodRatio > 1 && <span className="block text-[9px] text-amber-400 font-normal">Group Floor</span>}
                                          {periodMin && <span className="block text-[9px] text-amber-400 font-normal">Min Floor</span>}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              <div className="pt-2 flex items-center justify-between text-xs text-slate-400 border-t border-slate-800">
                                <span>💡 Pro-tip: Edits automatically roll forward to all subsequent months until another manual override is encountered.</span>
                                <span className="font-mono text-emerald-400 font-bold">
                                  Line TCV Contribution: €{schedule.reduce((acc, r, sIdx) => acc + (calculateLineGrossAmount(line as any, getEffectiveQuantity(line, sIdx, termPeriods)).gross * getGroupFloorRatio(line.group_id, sIdx) * (line.apply_discount !== false ? Math.max(0, 1 - (Number(discountPct) || 0) / 100) : 1.0)), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Live Financial Totals Footer */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-[#132338] to-slate-900 text-white shadow-xl border border-slate-800">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 divide-y md:divide-y-0 md:divide-x divide-slate-700/60">
          <div className="pt-2 md:pt-0">
            <span className="text-[11px] font-bold text-slate-400 uppercase block tracking-wider">Starting Net MRR</span>
            <span className="text-xl font-mono font-black text-slate-200 mt-1 block">
              €{totals.netMonthlyMRR.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-slate-400 block mt-0.5">Recurring lines only</span>
          </div>
          <div className="pt-3 md:pt-0 md:pl-6">
            <span className="text-[11px] font-bold text-emerald-400 uppercase block tracking-wider">Net ARR (Recurring)</span>
            <span className="text-2xl font-mono font-black text-emerald-300 mt-1 block">
              €{totals.netAnnual.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-emerald-300/80 font-semibold block mt-0.5">Strictly excludes one-time payments</span>
          </div>
          <div className="pt-3 md:pt-0 md:pl-6">
            <span className="text-[11px] font-bold text-amber-400 uppercase block tracking-wider">Additional Value (One-Off)</span>
            <span className="text-xl font-mono font-bold text-amber-300 mt-1 block">
              +€{totals.oneTimeTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-slate-300 block mt-0.5">Onboarding, setup & adhoc days</span>
          </div>
          <div className="pt-3 md:pt-0 md:pl-6">
            <span className="text-[11px] font-bold text-purple-300 uppercase block tracking-wider">Contract Tier</span>
            <div className="mt-1">
              <span className={`px-2 py-0.5 rounded text-xs font-extrabold inline-block ${totals.tierInfo.badgeClass}`}>
                {totals.tierInfo.label}
              </span>
            </div>
            <span className="text-[9px] text-slate-400 block mt-1 leading-tight">
              Flat: €{(totals.breakdown.flatModulesARR * 1.5).toLocaleString(undefined, { maximumFractionDigits: 0 })} (1.5x) · Engines: €{(totals.breakdown.perAssetEngineARR * 1.2).toLocaleString(undefined, { maximumFractionDigits: 0 })} (1.2x)
            </span>
          </div>
          <div className="pt-3 md:pt-0 md:pl-6 col-span-2 md:col-span-1 bg-gradient-to-r from-blue-900/30 to-transparent p-3 rounded-xl md:bg-none md:p-0">
            <span className="text-xs font-black text-blue-400 uppercase block tracking-wider flex items-center">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-blue-400 inline" /> Real Deal TCV ({termYears} Yr)
            </span>
            <span className="text-2xl font-mono font-black text-white mt-1 block">
              €{totals.totalContractValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-slate-300 block mt-0.5">
              Scheduled ARR + Additional One-Time value
            </span>
          </div>
        </div>

        {/* Action button row */}
        <div className="mt-6 pt-5 border-t border-slate-700/60 flex flex-col sm:flex-row items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => setShowSchedulePreview(!showSchedulePreview)}
            className="text-xs font-bold text-blue-400 hover:text-blue-300 transition-colors flex items-center cursor-pointer"
          >
            <BarChart3 className="w-4 h-4 mr-1.5" />
            {showSchedulePreview ? 'Hide' : 'Inspect'} Generated Revenue Recognition Schedule ({schedule.length} Months)
            {showSchedulePreview ? <ChevronUp className="w-4 h-4 ml-1" /> : <ChevronDown className="w-4 h-4 ml-1" />}
          </button>

          {!hideActions && (
            <div className="flex items-center space-x-3 w-full sm:w-auto justify-end">
            {onCancel && (
              <Button type="button" variant="outline" size="sm" onClick={onCancel} className="bg-transparent border-slate-600 text-slate-300 hover:bg-slate-800">
                Cancel
              </Button>
            )}
            {onSave && !readOnly && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleSaveClick}
                disabled={isSaving || lines.length === 0 || windowErrors.size > 0}
                title={windowErrors.size > 0 ? 'Fix the highlighted active windows before saving' : 'Save the pricing snapshot'}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold px-6 shadow-lg shadow-emerald-600/30 cursor-pointer disabled:opacity-50"
              >
                {isSaving ? 'Saving Snapshot...' : windowErrors.size > 0 ? `Fix ${windowErrors.size} active window${windowErrors.size === 1 ? '' : 's'}` : 'Save & Lock Contract Pricing'}
              </Button>
            )}
          </div>
          )}
        </div>

        {/* Invalid per-line active windows block the save — billing would silently skip those months */}
        {!readOnly && windowErrors.size > 0 && (
          <div className="mt-4 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <div>{windowErrors.size} line item{windowErrors.size === 1 ? ' has' : 's have'} an end date before its start date — fix it to save.</div>
              <ul className="mt-1 space-y-0.5 font-medium">
                {Array.from(windowErrors.entries()).map(([idx, msg]) => (
                  <li key={idx}>{lines[idx]?.name || `Line ${idx + 1}`}: {msg}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Windows that reach outside the contract term are saved as typed and bounded by the term */}
        {!readOnly && windowErrors.size === 0 && windowNotes.size > 0 && (
          <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-semibold flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              {windowNotes.size} line item{windowNotes.size === 1 ? '' : 's'} reach outside the contract term
              ({monthLabel(windowBounds.min)} → {monthLabel(windowBounds.max)}). The dates are saved as entered and the
              line only charges while the contract runs.
            </div>
          </div>
        )}

        {/* Schedule Matrix Expandable */}
        {showSchedulePreview && (
          <div className="mt-6 pt-6 border-t border-slate-700 text-slate-200">
            <div className="text-xs font-extrabold text-slate-300 mb-3 flex items-center justify-between">
              <span>Monthly Cash Landing & Revenue Recognition ({termYears} Year Horizon)</span>
              <span className="text-[11px] text-slate-400 font-normal">
                Reflects all variable monthly quantity projections and billing frequency anchors
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 lg:grid-cols-12 gap-2 max-h-60 overflow-y-auto pr-1">
              {schedule.map(row => (
                <div key={row.period} className="p-2.5 rounded-lg bg-slate-800/80 border border-slate-700/80 text-center">
                  <span className="text-[10px] font-mono text-slate-400 block">{row.period}</span>
                  <span className={`text-xs font-mono font-bold block mt-1 ${row.amount > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
                    €{row.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
