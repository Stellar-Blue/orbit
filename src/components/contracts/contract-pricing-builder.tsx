"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { ContractLine, ContractLineGroup } from '@/lib/types';
import { calculateContractValuation, isVariableQuantityPricingScheme, calculateLineGrossAmount, calculatePeriodAmounts, calculateGroupFloorRatio } from '@/lib/pricing-engine';
import { Button, Badge } from '@/components/ui/primitives';
import {
  Plus, Trash2, Tag, Calendar,
  AlertCircle, AlertTriangle, Layers, ChevronDown, ChevronUp, BarChart3, RefreshCw, X, FolderPlus, ShieldCheck
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
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 rounded-[var(--radius-card)] bg-white border border-[var(--line)]">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-[14px] font-semibold text-[var(--ink)] truncate">Rate sheet</span>
          <span className="ui-meta truncate">{totals.tierInfo.label}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="contract-discount" className="ui-label flex items-center">
            <Tag className="w-3 h-3 mr-1" /> Discount
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
              className="w-14 h-7 bg-white border border-[var(--line-strong)] rounded-[var(--radius-control)] pl-2 pr-4 text-[12px] ui-num text-right text-[var(--ink)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-60"
            />
            <span className="absolute right-1.5 top-1 text-[11px] text-[var(--ink-4)]">%</span>
          </div>
        </div>
      </div>

      {/* Catalog Selector Bar */}
      {!readOnly && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-4 py-2.5 rounded-[var(--radius-card)] bg-white border border-[var(--line)]">
          <div className="flex items-center gap-2 flex-1">
            <Layers className="w-4 h-4 text-[var(--ink-4)] shrink-0" />
            <div className="flex-1 max-w-md">
              <select
                value={selectedCatalogId}
                onChange={e => setSelectedCatalogId(e.target.value)}
                className="w-full h-9 bg-white border border-[var(--line-strong)] rounded-[var(--radius-control)] px-2.5 text-[13px] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
              >
                <option value="">Select a module from the catalogue…</option>
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
              className="shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4 mr-1" /> Add from catalogue
            </Button>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddCustomItem}
            className="shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4 mr-1" /> Add custom line
          </Button>
        </div>
      )}

      {/* Pricing Groups Manager */}
      <div className="bg-white rounded-[var(--radius-card)] border border-[var(--line)] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[var(--line)] flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 min-w-0">
            <span className="text-[13px] font-semibold text-[var(--ink)]">Pricing groups</span>
            <Badge variant="neutral">{groups.length}</Badge>
            <span className="ui-meta hidden lg:inline">A floor applies to the group&apos;s combined monthly total, not to each line</span>
          </span>
          {!readOnly && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addGroup}
              className="shrink-0 cursor-pointer"
            >
              <FolderPlus className="w-4 h-4 mr-1" /> Add group
            </Button>
          )}
        </div>

        {groups.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <p className="text-[12px] text-[var(--ink-3)]">
              Groups bundle line items under a shared monthly floor. When the group total falls short, the difference is spread across its lines.
            </p>
            {!readOnly && <p className="ui-meta mt-1">Add a group to start bundling.</p>}
          </div>
        ) : (
          <div className="p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {groups.map((group, gIdx) => {
              const memberCount = lines.filter(l => l.group_id === group.id && l.frequency !== 'one_time').length;
              const ratio = getGroupFloorRatio(group.id, 0);
              const floorApplied = ratio > 1;
              return (
                <div key={group.id} className={`p-3 rounded-lg border ${floorApplied ? 'bg-amber-50 border-amber-300' : 'bg-[var(--surface-muted)] border-[var(--line)]'}`}>
                  <div className="flex items-start justify-between gap-2">
                    {readOnly ? (
                      <span className="font-extrabold text-slate-800 text-sm mt-0.5">{group.name}</span>
                    ) : (
                      <input
                        type="text"
                        value={group.name}
                        onChange={e => updateGroup(gIdx, 'name', e.target.value)}
                        className="flex-1 min-w-0 h-8 bg-white border border-[var(--line-strong)] rounded-[var(--radius-control)] px-2 text-[13px] font-medium text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
                        placeholder="Group name"
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
      <div className="bg-white rounded-[var(--radius-card)] border border-[var(--line)] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[var(--line)] flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[var(--ink)]">Line items</span>
            <Badge variant="neutral">{lines.length}</Badge>
          </span>
          <span className="ui-meta">Expand a row to program it month by month</span>
        </div>

        {lines.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12px] text-[var(--ink-3)]">
            No line items yet. Add a module from the catalogue or a custom line.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="ui-label bg-[var(--surface-muted)] border-b border-[var(--line)]">
                  <th className="py-2 px-4 font-medium min-w-[280px]">Item</th>
                  <th className="py-2 px-3 font-medium w-40">Unit rate</th>
                  <th className="py-2 px-3 font-medium w-40">Pricing group</th>
                  <th className="py-2 px-3 font-medium w-36">Base qty</th>
                  <th className="py-2 px-3 font-medium w-28">Unit</th>
                  <th className="py-2 px-3 font-medium w-36">Frequency</th>
                  <th className="py-2 px-3 font-medium w-44">Invoicing timing</th>
                  <th className="py-2 px-3 font-medium w-52">Active window</th>
                  <th className="py-2 px-3 font-medium text-center w-32">Discount</th>
                  <th className="py-2 px-4 font-medium text-right w-48">Month 1 and projections</th>
                  {!readOnly && <th className="py-2 px-3 font-medium text-center w-14"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)] text-[12px]">
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
                        <td className="py-2.5 px-4 align-top min-w-[280px]">
                          {readOnly ? (
                            <span className="block mt-1 font-medium text-[13px] text-[var(--ink)]">{line.name}</span>
                          ) : (
                            <input
                              type="text"
                              value={line.name}
                              onChange={e => updateLine(idx, 'name', e.target.value)}
                              title={line.name || 'Line description'}
                              className="w-full h-8 bg-white border border-[var(--line-strong)] rounded-[var(--radius-control)] px-2 text-[13px] font-medium text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
                              placeholder="Line description"
                            />
                          )}
                          {line.line_kind === 'man_hours' && (
                            <span className="text-[10px] text-[var(--ink-3)] bg-[var(--surface-muted)] border border-[var(--line)] rounded px-1.5 py-0.5 inline-block mt-1">
                              {roleLabel(line.role)} · {line.seniority || 'mid'} seniority
                            </span>
                          )}
                          {!isOneTime && (
                            <span className="ui-meta mt-1 block">
                              {isVariableScheme
                                ? (overrideCount > 0 ? `Variable usage, ${overrideCount} monthly override${overrideCount === 1 ? '' : 's'}` : 'Variable usage, expand to set monthly quantities')
                                : 'Flat subscription, constant quantity'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 align-top">
                          {readOnly ? (
                            <span className="ui-num text-[var(--ink)] font-medium block mt-1">€{Number(line.unit_price).toLocaleString()} <span className="ui-meta">{periodSuffix}</span></span>
                          ) : (
                            <div className="flex items-center space-x-1">
                              <input
                                type="number"
                                step="0.01"
                                value={line.unit_price}
                                onChange={e => updateLine(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                                className="w-full h-8 bg-white border border-[var(--line-strong)] rounded-[var(--radius-control)] px-2 text-[12px] ui-num text-[var(--ink)] focus:outline-none focus:border-[var(--accent)] min-w-[70px]"
                              />
                              <span className="ui-meta whitespace-nowrap">{periodSuffix}</span>
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 align-top">
                          {isOneTime ? (
                            <span className="ui-meta block text-center mt-2">
                              Not grouped
                            </span>
                          ) : readOnly ? (
                            <span className={`font-medium block mt-1 ${line.group_id ? 'text-[var(--accent-ink)]' : 'text-[var(--ink-4)]'}`}>
                              {line.group_id ? (groups.find(g => g.id === line.group_id)?.name || 'Group') : 'Ungrouped'}
                              {line.group_id && groups.find(g => g.id === line.group_id)?.min_monthly_charge ? ` · Floor €${Number(groups.find(g => g.id === line.group_id)?.min_monthly_charge).toLocaleString()}/mo` : ''}
                            </span>
                          ) : (
                            <select
                              value={line.group_id || ''}
                              onChange={e => updateLine(idx, 'group_id', e.target.value || null)}
                              className={`w-full h-8 bg-white border rounded-[var(--radius-control)] px-2 text-[12px] focus:outline-none focus:border-[var(--accent)] ${line.group_id ? 'text-[var(--accent-ink)] border-[var(--accent)] bg-[var(--accent-soft)]' : 'text-[var(--ink-2)] border-[var(--line-strong)]'}`}
                            >
                              <option value="">Not grouped</option>
                              {groups.map(g => (
                                <option key={g.id} value={g.id}>
                                  {g.name}{g.min_monthly_charge && Number(g.min_monthly_charge) > 0 ? ` (Floor €${Number(g.min_monthly_charge).toLocaleString()}/mo)` : ''}
                                </option>
                              ))}
                            </select>
                          )}
                          {!isOneTime && !line.group_id && !readOnly && (
                            <span className="ui-meta block mt-1">No floor</span>
                          )}
                          {!isOneTime && line.group_id && (
                            <span className="ui-meta block mt-1">Floor applies to the group total</span>
                          )}
                        </td>
                        <td className="py-3 px-3 align-top">
                          <div>
                            {readOnly ? (
                              <span className="ui-num font-medium text-[var(--ink)] block mt-1">{baseQty.toLocaleString()}</span>
                            ) : (
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={line.quantity}
                                onChange={e => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)}
                                className="w-full h-8 bg-white border border-[var(--line-strong)] rounded-[var(--radius-control)] px-2 text-[12px] ui-num text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
                                title="Default month 1 quantity"
                              />
                            )}
                            {!isOneTime && isVariableScheme ? (
                              <button
                                type="button"
                                onClick={() => setExpandedScheduleLineIdx(isExpanded ? null : idx)}
                                className={`mt-2 w-full h-7 inline-flex items-center justify-center text-[11px] font-medium px-2 rounded-md border transition-colors cursor-pointer ${
                                  isExpanded
                                    ? 'bg-[var(--accent-soft)] text-[var(--accent-ink)] border-[var(--accent)]'
                                    : overrideCount > 0
                                      ? 'bg-white text-[var(--accent-ink)] border-[var(--accent)]'
                                      : 'bg-white text-[var(--ink-2)] border-[var(--line)] hover:border-[var(--line-strong)]'
                                }`}
                              >
                                <Calendar className="w-3 h-3 mr-1 shrink-0" />
                                {overrideCount > 0 ? `${overrideCount} overrides` : 'Timeline'}
                                {isExpanded ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
                              </button>
                            ) : !isOneTime && (
                              <span className="ui-meta mt-2 block text-center" title="Flat modules keep a constant quantity across the term">
                                Constant
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 align-top">
                          {readOnly ? (
                            <span className="text-[var(--ink-2)] font-medium block mt-1">{line.unit_label}</span>
                          ) : (
                            <input
                              type="text"
                              value={line.unit_label}
                              onChange={e => updateLine(idx, 'unit_label', e.target.value)}
                              className="w-full h-8 bg-white border border-[var(--line-strong)] rounded-[var(--radius-control)] px-2 text-[12px] text-[var(--ink-2)] focus:outline-none focus:border-[var(--accent)]"
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
                              className="w-full h-8 bg-white border border-[var(--line-strong)] rounded-[var(--radius-control)] px-2 text-[12px] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
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
                            <span className="ui-meta block mt-1">
                              {line.invoice_timing
                                ? (line.invoice_timing === 'end_of_period' ? 'Arrears' : 'In advance')
                                : `Contract default (${contractInvoiceTiming === 'end_of_period' ? 'arrears' : 'advance'})`}
                            </span>
                          ) : (
                            <select
                              value={line.invoice_timing || ''}
                              onChange={e => updateLine(idx, 'invoice_timing', e.target.value || null)}
                              className="w-full h-8 bg-white border border-[var(--line-strong)] rounded-[var(--radius-control)] px-2 text-[12px] text-[var(--ink-2)] focus:outline-none focus:border-[var(--accent)]"
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
                            <span className="ui-num text-[11px] text-[var(--ink-2)] block mt-1">
                              {line.starts_on ? monthLabel(line.starts_on) : 'from contract start'}
                              <span className="text-[var(--ink-4)]"> to </span>
                              {line.ends_on ? monthLabel(line.ends_on) : 'to contract end'}
                            </span>
                          ) : (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1">
                                <span className="ui-label w-6 shrink-0">From</span>
                                <input
                                  type="date"
                                  value={line.starts_on || ''}
                                  onChange={e => updateLine(idx, 'starts_on', e.target.value || null)}
                                  title="First chargeable month for this line (inclusive) — leave empty to start with the contract"
                                  className={`w-full h-7 bg-white border rounded-md px-1.5 text-[11px] ui-num focus:outline-none ${windowErrors.get(idx) ? 'border-rose-400 focus:border-rose-500' : 'border-[var(--line-strong)] focus:border-[var(--accent)]'}`}
                                />
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="ui-label w-6 shrink-0">To</span>
                                <input
                                  type="date"
                                  value={line.ends_on || ''}
                                  onChange={e => updateLine(idx, 'ends_on', e.target.value || null)}
                                  title="Last chargeable month for this line (inclusive) — leave empty to run to the contract end"
                                  className={`w-full h-7 bg-white border rounded-md px-1.5 text-[11px] ui-num focus:outline-none ${windowErrors.get(idx) ? 'border-rose-400 focus:border-rose-500' : 'border-[var(--line-strong)] focus:border-[var(--accent)]'}`}
                                />
                              </div>
                              {windowErrors.get(idx) && (
                                <div className="text-[10px] font-medium text-rose-700">{windowErrors.get(idx)}</div>
                              )}
                              {!windowErrors.get(idx) && (line.starts_on || line.ends_on) && (
                                <div className="ui-meta">
                                  {isOneTime
                                    ? `charged once, in ${monthLabel(line.starts_on || windowBounds.min)}`
                                    : `charged for ${lineActiveMonthCount(line)} of ${termPeriods.length} months`}
                                </div>
                              )}
                              {!windowErrors.get(idx) && windowNotes.get(idx) && (
                                <div className="text-[10px] text-amber-700">{windowNotes.get(idx)}</div>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 align-top text-center">
                          {readOnly ? (
                            <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-md border ${
                              line.apply_discount !== false && discountPct > 0
                                ? 'bg-[var(--accent-soft)] text-[var(--accent-ink)] border-transparent'
                                : 'bg-white text-[var(--ink-4)] border-[var(--line)]'
                            }`}>
                              {line.apply_discount !== false ? (discountPct > 0 ? `−${discountPct}%` : 'On') : 'Exempt'}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => updateLine(idx, 'apply_discount', line.apply_discount === false ? true : false)}
                              className={`w-full h-8 text-[11px] font-medium px-2 rounded-md border transition-colors cursor-pointer inline-flex items-center justify-center gap-1 ${
                                line.apply_discount !== false
                                  ? 'bg-[var(--accent-soft)] text-[var(--accent-ink)] border-transparent'
                                  : 'bg-white text-[var(--ink-4)] border-[var(--line)]'
                              }`}
                              title={line.apply_discount !== false ? `Contract discount (-${discountPct}%) is applied to this line item. Click to exempt.` : 'No contract discount applied to this line item. Click to enable discount.'}
                            >
                              <span>{line.apply_discount !== false ? (discountPct > 0 ? `−${discountPct}%` : 'Applied') : 'Exempt'}</span>
                            </button>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right ui-num text-[var(--ink)] align-top">
                          {isOneTime ? (
                            <div className="mt-1" title="One-time fee">
                              <div className="font-medium text-[var(--ink)]">
                                €{(lineGross * (line.apply_discount !== false ? Math.max(0, 1 - discountPct / 100) : 1.0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (One-off)
                              </div>
                              {line.apply_discount !== false && discountPct > 0 && (
                                <div className="text-[10px] line-through text-slate-400">€{lineGross.toLocaleString()} before discount</div>
                              )}
                            </div>
                          ) : (
                            <div>
                              <div className="font-medium mt-1 text-[var(--ink)]">
                                €{(scaledLineGross * (line.apply_discount !== false ? Math.max(0, 1 - discountPct / 100) : 1.0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {periodSuffix}
                              </div>
                              {line.apply_discount !== false && discountPct > 0 && (
                                <div className="text-[11px] text-slate-400 line-through">€{scaledLineGross.toLocaleString()} before discount</div>
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
                          <td colSpan={readOnly ? 7 : 8} className="p-0 border-t border-b border-[var(--line)] bg-[var(--surface-muted)]">
                            <div className="p-4 space-y-3">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--line)] pb-3">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[13px] font-semibold text-[var(--ink)] flex items-center">
                                      <Calendar className="w-3.5 h-3.5 mr-1.5 text-[var(--ink-3)]" />
                                      Monthly quantity timeline
                                    </span>
                                    <Badge variant="neutral">{termPeriods.length} months</Badge>
                                  </div>
                                  <p className="ui-meta mt-1">
                                    Set quantities for specific months. Later months inherit from the month before until you override them.
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {!readOnly && overrideCount > 0 && (
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      size="sm"
                                      onClick={() => updateLine(idx, 'monthly_quantities', {})}
                                      title="Clear all manual monthly overrides and reset to the base quantity"
                                    >
                                      <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                                      Reset overrides
                                    </Button>
                                  )}
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setExpandedScheduleLineIdx(null)}
                                  >
                                    <X className="w-3.5 h-3.5 mr-1" /> Close
                                  </Button>
                                </div>
                              </div>

                              {/* Grid of Months */}
                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 max-h-[360px] overflow-y-auto pr-1">
                                {termPeriods.map((period, pIdx) => {
                                  const hasOverride = line.monthly_quantities?.[period] !== undefined && line.monthly_quantities?.[period] !== null && !isNaN(Number(line.monthly_quantities[period]));
                                  const effQty = getEffectiveQuantity(line, pIdx, termPeriods);
                                  const { gross: periodGross, minChargeApplied: periodMin } = calculateLineGrossAmount(line as any, effQty);
                                  const periodRatio = getGroupFloorRatio(line.group_id, pIdx);
                                  const periodScaled = periodGross * periodRatio;

                                  return (
                                    <div 
                                      key={period} 
                                      className={`p-2 rounded-lg border flex flex-col justify-between ${
                                        hasOverride
                                          ? 'bg-white border-[var(--accent)]'
                                          : 'bg-white border-[var(--line)]'
                                      }`}
                                    >
                                      <div className="flex items-center justify-between gap-1 mb-1.5">
                                        <span className="ui-num text-[11px] text-[var(--ink-2)]">{period}</span>
                                        <span className={`text-[10px] ${hasOverride ? 'text-[var(--accent-ink)] font-medium' : 'text-[var(--ink-4)]'}`} title={pIdx === 0 ? 'Starting base quantity' : 'Inherited from the previous month'}>
                                          {hasOverride ? 'Overridden' : pIdx === 0 ? 'Base' : 'Inherited'}
                                        </span>
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
                                          className={`w-full h-7 bg-white border rounded-md pl-2 pr-6 text-[12px] ui-num focus:outline-none focus:border-[var(--accent)] ${
                                            hasOverride
                                              ? 'text-[var(--ink)] border-[var(--line-strong)]'
                                              : 'text-[var(--ink-3)] border-[var(--line)]'
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
                                            className="absolute right-1.5 text-[var(--ink-4)] hover:text-rose-600 transition-colors p-0.5 cursor-pointer"
                                            title="Clear override (inherit previous month's quantity)"
                                          >
                                            <X className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                      </div>

                                      <div className="mt-1.5 pt-1.5 border-t border-[var(--line)] flex items-center justify-between text-[10px] text-[var(--ink-4)]">
                                        <span>{line.unit_label || 'unit'}s</span>
                                        <span className="ui-num font-medium text-[var(--ink-2)] text-right">
                                          €{periodScaled.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                                          {periodRatio > 1 && <span className="block text-amber-700 font-normal">group floor</span>}
                                          {periodMin && <span className="block text-amber-700 font-normal">min floor</span>}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              <div className="pt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--ink-3)] border-t border-[var(--line)]">
                                <span>Edits carry forward to later months until another override is set.</span>
                                <span className="ui-num font-medium text-[var(--ink)]">
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

      {/* Live totals */}
      <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-white">
        <div className="grid grid-cols-2 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x divide-[var(--line)]">
          <div className="p-4">
            <span className="ui-label block">Starting net MRR</span>
            <span className="ui-num text-[17px] font-semibold text-[var(--ink)] mt-1 block">
              €{totals.netMonthlyMRR.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="ui-meta block">Recurring lines only</span>
          </div>
          <div className="p-4">
            <span className="ui-label block">Net ARR</span>
            <span className={`ui-num text-[17px] font-semibold mt-1 block ${totals.netAnnual > 0 ? 'text-[var(--accent-ink)]' : 'text-[var(--ink)]'}`}>
              €{totals.netAnnual.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="ui-meta block">Excludes one-time payments</span>
          </div>
          <div className="p-4">
            <span className="ui-label block">One-off value</span>
            <span className="ui-num text-[17px] font-semibold text-[var(--ink)] mt-1 block">
              +€{totals.oneTimeTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="ui-meta block">Onboarding, setup, ad-hoc days</span>
          </div>
          <div className="p-4">
            <span className="ui-label block">Tier</span>
            <span className={`mt-1 inline-flex px-2 h-5 items-center rounded-md text-[11px] font-medium border ${totals.tierInfo.badgeClass}`}>
              {totals.tierInfo.label}
            </span>
            <span className="ui-meta block mt-1">
              Flat €{(totals.breakdown.flatModulesARR * 1.5).toLocaleString(undefined, { maximumFractionDigits: 0 })} (1.5×) · Engines €{(totals.breakdown.perAssetEngineARR * 1.2).toLocaleString(undefined, { maximumFractionDigits: 0 })} (1.2×)
            </span>
          </div>
          <div className="p-4">
            <span className="ui-label block">Total contract value</span>
            <span className="ui-num text-[17px] font-semibold text-[var(--ink)] mt-1 block">
              €{totals.totalContractValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="ui-meta block">{termYears} year term, scheduled ARR plus one-off</span>
          </div>
        </div>

        <div className="px-4 py-2.5 border-t border-[var(--line)] flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setShowSchedulePreview(!showSchedulePreview)}
            className="text-[12px] font-medium text-[var(--accent-ink)] hover:underline inline-flex items-center gap-1.5 cursor-pointer"
          >
            <BarChart3 className="w-3.5 h-3.5" />
            {showSchedulePreview ? 'Hide' : 'Inspect'} the generated revenue schedule ({schedule.length} months)
            {showSchedulePreview ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {!hideActions && (
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              {onCancel && (
                <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
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
                  className="font-semibold"
                >
                  {isSaving ? 'Saving…' : windowErrors.size > 0 ? `Fix ${windowErrors.size} active window${windowErrors.size === 1 ? '' : 's'}` : 'Save pricing'}
                </Button>
              )}
            </div>
          )}
        </div>

        {!readOnly && windowErrors.size > 0 && (
          <div className="mx-4 mb-3 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-[12px] flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">{windowErrors.size} line item{windowErrors.size === 1 ? ' has' : 's have'} an end date before its start date. Fix {windowErrors.size === 1 ? 'it' : 'them'} to save.</div>
              <ul className="mt-1 space-y-0.5 text-rose-700">
                {Array.from(windowErrors.entries()).map(([idx, msg]) => (
                  <li key={idx}>{lines[idx]?.name || `Line ${idx + 1}`}: {msg}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {!readOnly && windowErrors.size === 0 && windowNotes.size > 0 && (
          <div className="mx-4 mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[12px] flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <p>
              {windowNotes.size} line item{windowNotes.size === 1 ? '' : 's'} reach outside the contract term
              ({monthLabel(windowBounds.min)} to {monthLabel(windowBounds.max)}). The dates are saved as entered; the line only bills while the contract runs.
            </p>
          </div>
        )}

        {showSchedulePreview && (
          <div className="px-4 pb-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-3">
              <span className="ui-label">Monthly cash landing and revenue recognition, {termYears} year horizon</span>
              <span className="ui-meta">Reflects quantity projections and billing anchors</span>
            </div>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 lg:grid-cols-12 gap-1.5 max-h-60 overflow-y-auto">
              {schedule.map(row => (
                <div key={row.period} className="px-2 py-1.5 rounded-md border border-[var(--line)] text-center">
                  <span className="ui-meta block text-[10px]">{row.period}</span>
                  <span className={`ui-num text-[11px] block mt-0.5 ${row.amount > 0 ? 'text-[var(--ink)]' : 'text-[var(--ink-4)]'}`}>
                    €{row.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              ))}
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
