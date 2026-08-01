"use client";

import React, { useState, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { ContractLine, CatalogItem } from '@/lib/types';
import { Card, Button, Badge } from '@/components/ui/primitives';
import { 
  Plus, Trash2, Tag, DollarSign, Calendar, Clock, 
  Sparkles, CheckCircle2, AlertCircle, Layers, ArrowRight, ChevronDown, ChevronUp, BarChart3
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
      note: l.note || ''
    }))
  );

  const [discountPct, setDiscountPct] = useState<number>(initialDiscountPct);
  const [termYears, setTermYears] = useState<number>(initialTermYears);
  const [startDate, setStartDate] = useState<string>(initialStartDate || new Date().toISOString().split('T')[0]);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string>('');
  const [showSchedulePreview, setShowSchedulePreview] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

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
        note: ''
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
        note: 'Custom negotiated rate'
      }
    ]);
  };

  const updateLine = (index: number, field: keyof Omit<ContractLine, 'id' | 'contract_id'>, value: any) => {
    setLines(prev => prev.map((l, idx) => idx === index ? { ...l, [field]: value } : l));
  };

  const deleteLine = (index: number) => {
    setLines(prev => prev.filter((_, idx) => idx !== index));
  };

  const applyTermSuggestion = (years: number, disc: number) => {
    setTermYears(years);
    setDiscountPct(disc);
  };

  // Calculations (Section 4 Rule Set)
  const totals = useMemo(() => {
    let recurringGrossMonthly = 0;
    let oneTimeTotal = 0;

    lines.forEach(line => {
      const lineVal = (Number(line.unit_price) || 0) * (Number(line.quantity) || 0);
      if (line.frequency === 'one_time') {
        oneTimeTotal += lineVal;
      } else {
        // Unit prices are monthly rate sheet equivalents regardless of quarterly/annual payment cadence
        recurringGrossMonthly += lineVal;
      }
    });

    const discountMultiplier = Math.max(0, 1 - (Number(discountPct) || 0) / 100);
    const netMonthlyMRR = recurringGrossMonthly * discountMultiplier;
    const netAnnual = netMonthlyMRR * 12;
    const totalContractValue = (netAnnual * (Number(termYears) || 1)) + oneTimeTotal;

    return {
      recurringGrossMonthly,
      discountAmount: recurringGrossMonthly - netMonthlyMRR,
      netMonthlyMRR,
      netAnnual,
      oneTimeTotal,
      totalContractValue
    };
  }, [lines, discountPct, termYears]);

  // Schedule generator (Section 5)
  const schedule = useMemo(() => {
    const monthsCount = Math.max(1, (Number(termYears) || 1) * 12);
    const startObj = new Date(startDate || new Date());
    const startYear = startObj.getFullYear();
    const startMonth = startObj.getMonth(); // 0-indexed

    const discountMultiplier = Math.max(0, 1 - (Number(discountPct) || 0) / 100);
    const result: { period: string; amount: number }[] = [];

    for (let i = 0; i < monthsCount; i++) {
      const d = new Date(startYear, startMonth + i, 1);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const period = `${yyyy}-${mm}`;

      let monthTotal = 0;

      lines.forEach(line => {
        const grossLineMonthly = (Number(line.unit_price) || 0) * (Number(line.quantity) || 0);
        const netLineMonthly = grossLineMonthly * discountMultiplier;

        if (line.frequency === 'monthly') {
          monthTotal += netLineMonthly;
        } else if (line.frequency === 'quarterly') {
          // Lands 3x net monthly rate every 3rd month (0, 3, 6, 9...)
          if (i % 3 === 0) {
            monthTotal += netLineMonthly * 3;
          }
        } else if (line.frequency === 'annual') {
          // Lands 12x net monthly rate in month 0 of each contract year (0, 12, 24...)
          if (i % 12 === 0) {
            monthTotal += netLineMonthly * 12;
          }
        } else if (line.frequency === 'one_time') {
          // Lands fully undiscounted once in month 0
          if (i === 0) {
            monthTotal += grossLineMonthly;
          }
        }
      });

      result.push({ period, amount: Number(monthTotal.toFixed(2)) });
    }

    return result;
  }, [lines, discountPct, termYears, startDate]);

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
              <span className="text-xs font-mono text-amber-300/90 uppercase tracking-widest font-extrabold">Modular Pricing & Revenue Schedule</span>
            </div>
            <h3 className="text-xl font-extrabold tracking-tight text-white mt-1">Contract Term & Discount Calibration</h3>
            <p className="text-xs text-slate-300 max-w-xl mt-0.5">
              Select standard term presets or manually adjust discount brackets. MRR always equals net monthly rate regardless of billing frequency.
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
          <span className="text-xs text-slate-500">Values snapped locally per deal</span>
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
                  <th className="py-2.5 px-3 w-32">Rate (€ / Mo)</th>
                  <th className="py-2.5 px-3 w-28">Quantity</th>
                  <th className="py-2.5 px-3 w-28">Unit Label</th>
                  <th className="py-2.5 px-3 w-36">Frequency</th>
                  <th className="py-2.5 px-4 text-right w-32">Monthly Rate</th>
                  {!readOnly && <th className="py-2.5 px-3 text-center w-14">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {lines.map((line, idx) => {
                  const lineGross = (Number(line.unit_price) || 0) * (Number(line.quantity) || 0);
                  const isOneTime = line.frequency === 'one_time';

                  return (
                    <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4 font-medium text-slate-900">
                        {readOnly ? (
                          <span>{line.name}</span>
                        ) : (
                          <input
                            type="text"
                            value={line.name}
                            onChange={e => updateLine(idx, 'name', e.target.value)}
                            className="w-full bg-white border border-slate-300 rounded px-2.5 py-1 text-sm font-medium focus:outline-none focus:border-blue-500"
                            placeholder="Line description..."
                          />
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {readOnly ? (
                          <span className="font-mono text-slate-700">€{Number(line.unit_price).toLocaleString()}</span>
                        ) : (
                          <input
                            type="number"
                            step="0.01"
                            value={line.unit_price}
                            onChange={e => updateLine(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                            className="w-full bg-white border border-slate-300 rounded px-2.5 py-1 text-sm font-mono focus:outline-none focus:border-blue-500"
                          />
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {readOnly ? (
                          <span className="font-mono text-slate-700">{Number(line.quantity).toLocaleString()}</span>
                        ) : (
                          <input
                            type="number"
                            step="1"
                            min="0.01"
                            value={line.quantity}
                            onChange={e => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)}
                            className="w-full bg-white border border-slate-300 rounded px-2.5 py-1 text-sm font-mono focus:outline-none focus:border-blue-500"
                          />
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {readOnly ? (
                          <span className="text-slate-600">{line.unit_label}</span>
                        ) : (
                          <input
                            type="text"
                            value={line.unit_label}
                            onChange={e => updateLine(idx, 'unit_label', e.target.value)}
                            className="w-full bg-white border border-slate-300 rounded px-2.5 py-1 text-sm text-slate-700 focus:outline-none focus:border-blue-500"
                          />
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {readOnly ? (
                          <Badge variant={isOneTime ? 'info' : 'success'}>{line.frequency}</Badge>
                        ) : (
                          <select
                            value={line.frequency}
                            onChange={e => updateLine(idx, 'frequency', e.target.value as any)}
                            className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs font-semibold uppercase focus:outline-none focus:border-blue-500"
                          >
                            <option value="monthly">Monthly</option>
                            <option value="quarterly">Quarterly</option>
                            <option value="annual">Annual</option>
                            <option value="one_time">One-time</option>
                          </select>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                        {isOneTime ? (
                          <span className="text-amber-600" title="One-time fee (undiscounted)">€{lineGross.toLocaleString()} (One-off)</span>
                        ) : (
                          <span>€{lineGross.toLocaleString()}/mo</span>
                        )}
                      </td>
                      {!readOnly && (
                        <td className="py-3 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => deleteLine(idx)}
                            className="text-rose-500 hover:text-rose-700 transition-colors p-1 rounded-full hover:bg-rose-50 cursor-pointer"
                            title="Remove line"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
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
            <span className="text-[11px] font-bold text-slate-400 uppercase block tracking-wider">Gross Monthly</span>
            <span className="text-xl font-mono font-bold text-slate-200 mt-1 block">
              €{totals.recurringGrossMonthly.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-slate-400 block mt-0.5">Before discount</span>
          </div>
          <div className="pt-3 md:pt-0 md:pl-6">
            <span className="text-[11px] font-bold text-amber-400 uppercase block tracking-wider">Discount ({discountPct}%)</span>
            <span className="text-xl font-mono font-bold text-amber-300 mt-1 block">
              -€{totals.discountAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-slate-400 block mt-0.5">Recurring lines only</span>
          </div>
          <div className="pt-3 md:pt-0 md:pl-6">
            <span className="text-[11px] font-bold text-emerald-400 uppercase block tracking-wider">Net MRR</span>
            <span className="text-2xl font-mono font-black text-emerald-300 mt-1 block">
              €{totals.netMonthlyMRR.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-slate-300 font-semibold block mt-0.5">Monthly Recurring Revenue</span>
          </div>
          <div className="pt-3 md:pt-0 md:pl-6">
            <span className="text-[11px] font-bold text-slate-400 uppercase block tracking-wider">Net Annual Rate</span>
            <span className="text-xl font-mono font-bold text-slate-200 mt-1 block">
              €{totals.netAnnual.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-slate-400 block mt-0.5">MRR × 12 months</span>
          </div>
          <div className="pt-3 md:pt-0 md:pl-6 col-span-2 md:col-span-1 bg-gradient-to-r from-blue-900/30 to-transparent p-3 rounded-xl md:bg-none md:p-0">
            <span className="text-xs font-black text-blue-400 uppercase block tracking-wider flex items-center">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-blue-400 inline" /> TCV ({termYears} Yr)
            </span>
            <span className="text-2xl font-mono font-black text-white mt-1 block">
              €{totals.totalContractValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-slate-300 block mt-0.5">
              Includes €{totals.oneTimeTotal.toLocaleString()} in one-off fees
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
              <span>Monthly Cash Landing Recognition ({termYears} Year Horizon)</span>
              <span className="text-[11px] text-slate-400 font-normal">
                Quarterly & Annual frequency lines land strictly on scheduled months
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 lg:grid-cols-12 gap-2 max-h-60 overflow-y-auto pr-1">
              {schedule.map(row => (
                <div key={row.period} className="p-2.5 rounded-lg bg-slate-800/80 border border-slate-700/80 text-center">
                  <span className="text-[10px] font-mono text-slate-400 block">{row.period}</span>
                  <span className={`text-xs font-mono font-bold block mt-1 ${row.amount > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
                    €{row.amount.toLocaleString()}
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
