"use client";

import React, { useState, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { ContractLine, CatalogItem } from '@/lib/types';
import { calculateContractValuation, isVariableQuantityPricingScheme } from '@/lib/pricing-engine';
import { Card, Button, Badge } from '@/components/ui/primitives';
import { 
  Plus, Trash2, Tag, DollarSign, Calendar, Clock, 
  Sparkles, CheckCircle2, AlertCircle, Layers, ArrowRight, ChevronDown, ChevronUp, BarChart3, RefreshCw, X
} from 'lucide-react';

interface ContractPricingBuilderProps {
  contractId?: string;
  initialLines?: ContractLine[];
  initialDiscountPct?: number;
  initialTermYears?: number;
  initialStartDate?: string;
  onSave?: (
    lines: Omit<ContractLine, 'id' | 'contract_id'>[], 
    schedule: { period: string; amount: number }[], 
    discountPct: number, 
    termYears: number, 
    startDate: string,
    totalContractValue: number
  ) => Promise<void> | void;
  onCancel?: () => void;
  readOnly?: boolean;
}

export const ContractPricingBuilder: React.FC<ContractPricingBuilderProps> = ({
  contractId,
  initialLines = [],
  initialDiscountPct = 0,
  initialTermYears = 1,
  initialStartDate = new Date().toISOString().split('T')[0],
  onSave,
  onCancel,
  readOnly = false
}) => {
  const { catalogModules, catalogItems } = useAuth();

  const [lines, setLines] = useState<Omit<ContractLine, 'id' | 'contract_id'>[]>(
    initialLines.map(l => ({
      catalog_item_id: l.catalog_item_id,
      name: l.name,
      unit_price: Number(l.unit_price) || 0,
      quantity: Number(l.quantity) || 1,
      unit_label: l.unit_label || 'unit',
      frequency: l.frequency || 'monthly',
      note: l.note || '',
      monthly_quantities: l.monthly_quantities ? { ...l.monthly_quantities } : {}
    }))
  );

  const [discountPct, setDiscountPct] = useState<number>(initialDiscountPct);
  const [termYears, setTermYears] = useState<number>(initialTermYears);
  const [startDate, setStartDate] = useState<string>(initialStartDate || new Date().toISOString().split('T')[0]);
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
        name: item.name,
        unit_price: Number(item.default_unit_price),
        quantity: 1,
        unit_label: item.unit_label,
        frequency: item.default_frequency,
        note: '',
        monthly_quantities: {},
        apply_discount: true
      }
    ]);
    setSelectedCatalogId('');
  };

  const handleAddCustomItem = () => {
    setLines(prev => [
      ...prev,
      {
        catalog_item_id: null,
        name: 'Custom Fee / Engine Service',
        unit_price: 1000,
        quantity: 1,
        unit_label: 'flat',
        frequency: 'monthly',
        note: 'Custom negotiated rate',
        monthly_quantities: {},
        apply_discount: true
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

  const applyTermSuggestion = (years: number, disc: number) => {
    setTermYears(years);
    setDiscountPct(disc);
  };

  // Calculations incorporating dynamic monthly quantity carry-forward schedules and Tier 1-10 weighting
  const totals = useMemo(() => {
    const valuation = calculateContractValuation(lines as any, discountPct, termYears, startDate, catalogModules, catalogItems);
    return {
      netMonthlyMRR: valuation.netMonthlyMRR,
      netAnnual: valuation.netARR,
      oneTimeTotal: valuation.oneTimeValue,
      totalContractValue: valuation.totalContractValue,
      tierInfo: valuation.tierInfo,
      breakdown: valuation.breakdown,
      weightedARR: valuation.weightedARR
    };
  }, [lines, discountPct, termYears, startDate, catalogModules, catalogItems]);

  // Schedule generator reflecting monthly variable quantity carry-forwards
  const schedule = useMemo(() => {
    const discountMultiplier = Math.max(0, 1 - (Number(discountPct) || 0) / 100);
    const result: { period: string; amount: number }[] = [];

    termPeriods.forEach((period, i) => {
      let monthTotal = 0;

      lines.forEach(line => {
        const effectiveQty = getEffectiveQuantity(line, i, termPeriods);
        const grossLineVal = (Number(line.unit_price) || 0) * effectiveQty;
        const lineMult = line.apply_discount !== false ? discountMultiplier : 1.0;
        const netLineVal = grossLineVal * lineMult;

        if (line.frequency === 'monthly') {
          monthTotal += netLineVal;
        } else if (line.frequency === 'quarterly') {
          if (i % 3 === 0) {
            monthTotal += netLineVal;
          }
        } else if (line.frequency === 'annual') {
          if (i % 12 === 0) {
            monthTotal += netLineVal;
          }
        } else if (line.frequency === 'one_time') {
          if (i === 0) {
            monthTotal += ((Number(line.unit_price) || 0) * (Number(line.quantity) || 0)) * lineMult;
          }
        }
      });

      result.push({ period, amount: Number(monthTotal.toFixed(2)) });
    });

    return result;
  }, [lines, discountPct, termPeriods]);

  const handleSaveClick = async () => {
    if (!onSave) return;
    setIsSaving(true);
    try {
      await onSave(lines, schedule, discountPct, termYears, startDate, totals.totalContractValue);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Terms Configuration */}
      <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-[#1e3a5f] text-white shadow-xl relative overflow-hidden border border-slate-700/50">
        <div className="absolute right-0 top-0 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center space-x-2">
              <Sparkles className="w-5 h-5 text-amber-400" />
              <span className="text-xs font-mono text-amber-300/90 uppercase tracking-widest font-extrabold">Modular Pricing & Variable Revenue Projections</span>
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-black tracking-wide border shadow-sm ml-1 ${totals.tierInfo.badgeClass}`}>
                {totals.tierInfo.label}
              </span>
            </div>
            <h3 className="text-xl font-extrabold tracking-tight text-white mt-1">Contract Term & Discount Calibration</h3>
            <p className="text-xs text-slate-300 max-w-2xl mt-0.5">
              Configure term lengths and recurring discount brackets. One-time payments are kept strictly separate from ARR to reveal true valuation. Tier rating reflects weighted contributions (Flat Modules: 1.5x, Optimization/Man-Days: 1.2x).
            </p>
          </div>

          {!readOnly && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-slate-400">Presets:</span>
              <button
                type="button"
                onClick={() => applyTermSuggestion(1, 5)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  termYears === 1 && discountPct === 5 
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30' 
                    : 'bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-600/50'
                }`}
              >
                1 Year · 5% Off
              </button>
              <button
                type="button"
                onClick={() => applyTermSuggestion(3, 10)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  termYears === 3 && discountPct === 10 
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/30' 
                    : 'bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-600/50'
                }`}
              >
                3 Years · 10% Off
              </button>
              <button
                type="button"
                onClick={() => applyTermSuggestion(5, 20)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  termYears === 5 && discountPct === 20 
                    ? 'bg-amber-600 text-white shadow-lg shadow-amber-500/30' 
                    : 'bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-600/50'
                }`}
              >
                5 Years · 20% Off
              </button>
            </div>
          )}
        </div>

        {/* Inputs for Term, Discount, Start Date */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6 pt-6 border-t border-slate-700/60 text-slate-100">
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5 flex items-center">
              <Calendar className="w-3.5 h-3.5 mr-1 text-blue-400" /> Service Start Date
            </label>
            <input
              type="date"
              disabled={readOnly}
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="w-full bg-slate-950/80 border border-slate-600/80 rounded-lg px-3 py-2 text-sm font-semibold text-white focus:outline-none focus:border-blue-400 disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5 flex items-center">
              <Clock className="w-3.5 h-3.5 mr-1 text-emerald-400" /> Term Length (Years)
            </label>
            <input
              type="number"
              min="1"
              max="25"
              disabled={readOnly}
              value={termYears}
              onChange={e => setTermYears(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full bg-slate-950/80 border border-slate-600/80 rounded-lg px-3 py-2 text-sm font-semibold text-white focus:outline-none focus:border-emerald-400 disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5 flex items-center">
              <Tag className="w-3.5 h-3.5 mr-1 text-amber-400" /> Recurring Discount %
            </label>
            <div className="relative">
              <input
                type="number"
                step="0.5"
                min="0"
                max="100"
                disabled={readOnly}
                value={discountPct}
                onChange={e => setDiscountPct(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
                className="w-full bg-slate-950/80 border border-slate-600/80 rounded-lg pl-3 pr-8 py-2 text-sm font-semibold text-white focus:outline-none focus:border-amber-400 disabled:opacity-60"
              />
              <span className="absolute right-3 top-2 text-slate-400 font-bold">%</span>
            </div>
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
                  <th className="py-2.5 px-4">Item Name / Module</th>
                  <th className="py-2.5 px-3 w-40">Unit Rate (€)</th>
                  <th className="py-2.5 px-3 w-36">Base Qty / Mo Horizon</th>
                  <th className="py-2.5 px-3 w-28">Unit Label</th>
                  <th className="py-2.5 px-3 w-36">Frequency</th>
                  <th className="py-2.5 px-3 text-center w-32">Discount Applied</th>
                  <th className="py-2.5 px-4 text-right w-48">Month 1 Rate / Projections</th>
                  {!readOnly && <th className="py-2.5 px-3 text-center w-14">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {lines.map((line, idx) => {
                  const baseQty = Number(line.quantity) || 0;
                  const lineGross = (Number(line.unit_price) || 0) * baseQty;
                  const isOneTime = line.frequency === 'one_time';
                  const isVariableScheme = isVariableQuantityPricingScheme(line, catalogModules, catalogItems);
                  const periodSuffix = line.frequency === 'monthly' ? '/ mo' : line.frequency === 'quarterly' ? '/ qtr' : line.frequency === 'annual' ? '/ year' : 'one-off';
                  const monthlyMrrEquiv = line.frequency === 'annual' ? lineGross / 12 : line.frequency === 'quarterly' ? lineGross / 3 : lineGross;
                  const isExpanded = expandedScheduleLineIdx === idx;
                  const overrideCount = Object.keys(line.monthly_quantities || {}).length;

                  return (
                    <React.Fragment key={idx}>
                      <tr className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-4 font-medium text-slate-900 align-top">
                          {readOnly ? (
                            <span className="block mt-1 font-bold">{line.name}</span>
                          ) : (
                            <input
                              type="text"
                              value={line.name}
                              onChange={e => updateLine(idx, 'name', e.target.value)}
                              className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-sm font-medium focus:outline-none focus:border-blue-500"
                              placeholder="Line description..."
                            />
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
                                €{((lineGross * (line.apply_discount !== false ? Math.max(0, 1 - discountPct / 100) : 1.0))).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (One-off)
                              </div>
                              {line.apply_discount !== false && discountPct > 0 && (
                                <div className="text-[10px] line-through text-slate-400">€{lineGross.toLocaleString()} gross</div>
                              )}
                            </div>
                          ) : (
                            <div>
                              <div className={`font-bold mt-1 ${line.apply_discount !== false && discountPct > 0 ? 'text-emerald-700' : 'text-slate-900'}`}>
                                €{((lineGross * (line.apply_discount !== false ? Math.max(0, 1 - discountPct / 100) : 1.0))).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {periodSuffix}
                              </div>
                              {line.apply_discount !== false && discountPct > 0 && (
                                <div className="text-[11px] text-slate-400 line-through">€{lineGross.toLocaleString()} gross</div>
                              )}
                              <div className="text-[11px] font-normal text-slate-500">
                                €{((monthlyMrrEquiv * (line.apply_discount !== false ? Math.max(0, 1 - discountPct / 100) : 1.0))).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo ({line.apply_discount !== false && discountPct > 0 ? 'Net MRR' : 'Mo. 1 MRR'})
                              </div>
                              {overrideCount > 0 && (
                                <div className="text-[10px] font-semibold text-purple-600 mt-0.5">
                                  Varies per monthly timeline
                                </div>
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
                                  const periodGross = (Number(line.unit_price) || 0) * effQty;

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
                                          €{periodGross.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              <div className="pt-2 flex items-center justify-between text-xs text-slate-400 border-t border-slate-800">
                                <span>💡 Pro-tip: Edits automatically roll forward to all subsequent months until another manual override is encountered.</span>
                                <span className="font-mono text-emerald-400 font-bold">
                                  Line TCV Contribution: €{schedule.reduce((acc, r, sIdx) => acc + ((Number(line.unit_price) || 0) * getEffectiveQuantity(line, sIdx, termPeriods) * (line.apply_discount !== false ? Math.max(0, 1 - (Number(discountPct) || 0) / 100) : 1.0)), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                disabled={isSaving || lines.length === 0}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold px-6 shadow-lg shadow-emerald-600/30 cursor-pointer"
              >
                {isSaving ? 'Saving Snapshot...' : 'Save & Lock Contract Pricing'}
              </Button>
            )}
          </div>
        </div>

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
