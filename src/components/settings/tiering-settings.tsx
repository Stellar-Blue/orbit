"use client";

import React, { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { notifySuccess } from '@/lib/validation-modal';
import {
  validateModelConfig, simulateConfig, tierLabel, DEFAULT_CLIENT_MODEL_CONFIG, METRIC_LABELS, METRIC_DESCRIPTIONS,
  type TierModelConfig, type MetricConfig, type TierConfig, type TierDataContext
} from '@/lib/tiering-engine';
import { Button, Badge } from '@/components/ui/primitives';
import { Sparkles, AlertTriangle, CheckCircle2, RefreshCw, Layers, ArrowRight } from 'lucide-react';

const num = (v: string, fallback: number): number => {
  const parsed = parseFloat(v);
  return isNaN(parsed) ? fallback : parsed;
};

export const TieringSettings: React.FC = () => {
  const {
    counterparties, contracts, invoices, contractSchedules, catalogModules, catalogItems,
    tierModelVersions, tierStates, applyTierModelConfig, recomputeTiers
  } = useAuth();

  const [config, setConfig] = useState<TierModelConfig>(() => {
    const active = tierModelVersions.find(v => v.model === 'client' && v.active);
    const raw = active?.config as unknown;
    const parsed = typeof raw === 'string' ? (JSON.parse(raw) as TierModelConfig) : (raw as TierModelConfig);
    return parsed && Array.isArray(parsed.tiers) ? parsed : DEFAULT_CLIENT_MODEL_CONFIG;
  });
  const [dirty, setDirty] = useState(false);
  const [applying, setApplying] = useState(false);

  const ctx = useMemo<TierDataContext>(() => ({
    contracts, invoices, schedule: contractSchedules, catalogModules, catalogItems
  }), [contracts, invoices, contractSchedules, catalogModules, catalogItems]);

  const currentTiers = useMemo(() => new Map(
    tierStates.filter(t => t.model === 'client').map(t => [t.counterparty_id, { tier_index: t.tier_index, tier_count: t.tier_count, score: t.score }])
  ), [tierStates]);

  const errors = useMemo(() => validateModelConfig(config), [config]);
  const simulation = useMemo(
    () => simulateConfig('client', config, counterparties, ctx, currentTiers),
    [config, counterparties, ctx, currentTiers]
  );

  const updateMetric = (key: string, patch: Partial<MetricConfig>) => {
    setConfig(prev => ({ ...prev, metrics: { ...prev.metrics, [key]: { ...prev.metrics[key], ...patch } } }));
    setDirty(true);
  };

  const updateBand = (key: string, bandIdx: number, patch: Partial<{ min: number | null; max: number | null; points: number }>) => {
    setConfig(prev => {
      const metric = prev.metrics[key];
      const bands = metric.bands.map((b, i) => i === bandIdx ? { ...b, ...patch } : b);
      return { ...prev, metrics: { ...prev.metrics, [key]: { ...metric, bands } } };
    });
    setDirty(true);
  };

  const setTierCount = (n: number) => {
    setConfig(prev => {
      const tiers = [...prev.tiers];
      if (n > tiers.length) {
        // Split the widest band: insert a new tier between the two lowest thresholds
        const last = tiers[tiers.length - 1].min_score;
        const secondLast = tiers.length >= 2 ? tiers[tiers.length - 2].min_score : last + 100;
        const mid = Math.round((last + secondLast) / 2);
        const newTier: TierConfig = { min_score: mid, color: '#9333ea', description: '' };
        tiers.splice(tiers.length - 1, 0, newTier);
      } else if (n < tiers.length) {
        // Merge: remove the tier closest to the bottom
        tiers.pop();
      }
      return { ...prev, tiers };
    });
    setDirty(true);
  };

  const updateTier = (i: number, patch: Partial<TierConfig>) => {
    setConfig(prev => ({ ...prev, tiers: prev.tiers.map((t, idx) => idx === i ? { ...t, ...patch } : t) }));
    setDirty(true);
  };

  const handleApply = async () => {
    if (errors.length > 0 || applying) return;
    if (!confirm(`Apply this model configuration?\n\nSimulated distribution: ${simulation.distribution.map(d => `${d.tierIndex === null ? 'Unrated' : `Tier ${d.tierIndex + 1}`}: ${d.count}`).join(' · ')}\n\n${simulation.changes.length} counterparty tier change(s) will be recorded and all linked Attio records re-asserted.`)) return;
    setApplying(true);
    const result = await applyTierModelConfig('client', config as unknown as Record<string, unknown>, config.tiers.length);
    setApplying(false);
    if (result.ok) {
      const digest = result.changes.length > 0
        ? result.changes.map(c => `${c.new_tier_index === null ? 'Unrated' : `Tier ${c.new_tier_index + 1}`}`).length
        : 0;
      notifySuccess(`Tiering model applied (${digest} change(s) recorded).`);
      setDirty(false);
    } else {
      alert(`Apply failed: ${result.error || 'Unknown error'}`);
    }
  };

  const handleRecomputeNow = async () => {
    const result = await recomputeTiers('client', 'data_change');
    if (result.ok) {
      alert(result.changes.length > 0
        ? `Recomputed against live data — ${result.changes.length} tier change(s) recorded (cause: data_change).`
        : 'Recomputed against live data — no tier changes (stable).');
    } else {
      alert(`Recompute failed: ${result.error || 'Unknown error'}`);
    }
  };

  const bandInput = (key: string, idx: number, field: 'min' | 'max' | 'points') => {
    const band = config.metrics[key]?.bands[idx];
    if (!band) return null;
    return (
      <input
        type="number"
        step="any"
        value={band[field] === null ? '' : band[field]}
        placeholder={field === 'min' ? '–∞' : field === 'max' ? '∞' : 'pts'}
        onChange={e => updateBand(key, idx, { [field]: e.target.value === '' ? null : num(e.target.value, 0) } as Partial<{ min: number | null; max: number | null; points: number }>)}
        className="w-20 bg-white border border-slate-300 rounded px-1.5 py-1 text-[11px] font-mono focus:outline-none focus:border-indigo-500"
      />
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-indigo-900 via-slate-900 to-indigo-950 text-white shadow-xl border border-indigo-500/30">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 text-[10px] font-mono font-bold uppercase">
              <Sparkles className="w-3 h-3" /> Configurable Tiering Model
            </div>
            <h3 className="text-lg font-extrabold mt-2 flex items-center gap-2">
              <Layers className="w-5 h-5 text-indigo-300" /> Client Tier Model
            </h3>
            <p className="text-xs text-indigo-200 mt-1 max-w-3xl">
              Every counterparty is scored 0–100 from configured metrics (weights + bands) and mapped to Tier 1…n (Tier 1 = highest).
              Nothing applies until you run the simulation below and hit &quot;Apply &amp; recompute&quot; — which snapshots a new config version and audits every change.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button type="button" variant="outline" size="sm" onClick={handleRecomputeNow}
              className="bg-transparent border-slate-500 text-slate-200 hover:bg-slate-800 cursor-pointer">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Recompute Now (data change)
            </Button>
            <Button type="button" size="sm" onClick={handleApply} disabled={applying || errors.length > 0 || !dirty}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold px-5 cursor-pointer disabled:opacity-50">
              {applying ? 'Applying…' : 'Apply & Recompute'}
            </Button>
          </div>
        </div>
        {dirty && !errors.length && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-amber-500/15 border border-amber-400/30 text-amber-200 text-xs flex items-center">
            <AlertTriangle className="w-3.5 h-3.5 mr-1.5" /> Unapplied changes — the simulation below reflects your edits against live data.
          </div>
        )}
        {errors.length > 0 && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-rose-500/15 border border-rose-400/30 text-rose-200 text-xs space-y-0.5">
            {errors.map(e => (
              <div key={e.field} className="flex items-start"><AlertTriangle className="w-3 h-3 mr-1.5 mt-0.5 shrink-0" /> {e.message} <span className="text-rose-300/70 font-mono ml-1">({e.field})</span></div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Left: metrics + tiers editors */}
        <div className="space-y-6">
          {/* Metric table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="text-sm font-extrabold text-slate-800">Metric Catalog & Weights</span>
              <span className="text-[10px] text-slate-400">Disabled metrics drop out; weights renormalize</span>
            </div>
            <div className="divide-y divide-slate-100">
              {Object.entries(config.metrics).map(([key, metric]) => (
                <div key={key} className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <input type="checkbox" checked={metric.enabled} onChange={e => updateMetric(key, { enabled: e.target.checked })}
                      className="accent-indigo-600 w-4 h-4 cursor-pointer" />
                    <span className={`font-bold text-sm flex-1 ${metric.enabled ? 'text-slate-800' : 'text-slate-400'}`}>
                      {METRIC_LABELS[key] || key}
                      <span className="block text-[11px] font-normal text-slate-500 mt-0.5 leading-snug max-w-xl">
                        {METRIC_DESCRIPTIONS[key] || ''}
                      </span>
                    </span>
                    <span className="text-[10px] uppercase text-slate-400 font-bold shrink-0">Weight</span>
                    <input type="number" min="1" value={metric.weight}
                      onChange={e => updateMetric(key, { weight: Math.max(0, num(e.target.value, 1)) })}
                      className="w-16 bg-white border border-slate-300 rounded px-2 py-1 text-xs font-mono text-right focus:outline-none focus:border-indigo-500" />
                  </div>
                  {metric.enabled && (
                    <div className="mt-2 pl-7 space-y-1.5">
                      {metric.bands.map((band, bi) => (
                        <div key={bi} className="flex items-center gap-1.5 text-[11px] text-slate-500">
                          <span className="w-24 text-right">{band.min === null ? '–∞' : `≥ ${band.min}`}</span>
                          <span className="text-slate-300">–</span>
                          <span className="w-24">{band.max === null ? '∞' : `< ${band.max}`}</span>
                          <span className="text-slate-300">→</span>
                          <input type="number" min="0" max="100" value={band.points}
                            onChange={e => updateBand(key, bi, { points: Math.max(0, Math.min(100, num(e.target.value, 0))) })}
                            className="w-14 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-[11px] font-mono text-center focus:outline-none focus:border-indigo-500" />
                          <span className="text-slate-400">pts</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Tier editor */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="text-sm font-extrabold text-slate-800">Tier Definition</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 font-bold uppercase">Tier Count</span>
                <select value={config.tiers.length}
                  onChange={e => setTierCount(parseInt(e.target.value))}
                  className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-800 cursor-pointer">
                  {[2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
            {config.tiers.length > 5 && (
              <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-[11px] flex items-center">
                <AlertTriangle className="w-3.5 h-3.5 mr-1.5" /> More than 5 tiers may exceed what this portfolio can meaningfully distinguish.
              </div>
            )}
            <div className="divide-y divide-slate-100">
              {config.tiers.map((tier, i) => (
                <div key={i} className="px-5 py-3 flex items-center gap-3">
                  <span className="font-black text-sm w-16 shrink-0" style={{ color: tier.color }}>Tier {i + 1}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-slate-400">min_score</span>
                    <input type="number" min="0" max="100" value={tier.min_score}
                      onChange={e => updateTier(i, { min_score: Math.max(0, Math.min(100, num(e.target.value, 0))) })}
                      className="w-16 bg-white border border-slate-300 rounded px-2 py-1 text-xs font-mono text-right focus:outline-none focus:border-indigo-500" />
                  </div>
                  <input type="color" value={tier.color} onChange={e => updateTier(i, { color: e.target.value })}
                    className="w-8 h-8 rounded border border-slate-300 cursor-pointer bg-white" title="Tier color" />
                  <input type="text" value={tier.description || ''} placeholder="Internal description (tooltips only)"
                    onChange={e => updateTier(i, { description: e.target.value })}
                    className="flex-1 bg-white border border-slate-300 rounded px-2.5 py-1 text-xs text-slate-700 focus:outline-none focus:border-indigo-500" />
                  {i === 0 && <span className="text-[10px] text-emerald-600 font-bold shrink-0">Highest</span>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: simulation panel */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-gradient-to-r from-indigo-50 to-white border-b border-slate-200 flex items-center justify-between">
            <span className="text-sm font-extrabold text-slate-800 flex items-center">
              <Sparkles className="w-4 h-4 mr-2 text-indigo-600" /> Live Simulation (against real data)
            </span>
            <span className="text-[10px] font-mono text-slate-400">Model version: {tierModelVersions.find(v => v.model === 'client' && v.active)?.id.slice(0, 8) || 'seed'}</span>
          </div>
          <div className="p-5 space-y-5">
            {/* Distribution */}
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-400 mb-2">Resulting distribution</div>
              <div className="flex flex-wrap gap-2">
                {simulation.distribution.map(d => (
                  <span key={d.tierIndex === null ? 'unrated' : d.tierIndex}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold"
                    style={{
                      borderColor: d.tierIndex === null ? '#cbd5e1' : (config.tiers[d.tierIndex]?.color || '#94a3b8'),
                      color: d.tierIndex === null ? '#64748b' : (config.tiers[d.tierIndex]?.color || '#334155'),
                      backgroundColor: d.tierIndex === null ? '#f8fafc' : `${config.tiers[d.tierIndex]?.color || '#94a3b8'}14`
                    }}>
                    {d.tierIndex === null ? 'Unrated' : `Tier ${d.tierIndex + 1}`}
                    <span className="font-mono">{d.count}</span>
                  </span>
                ))}
              </div>
              <div className="text-[11px] text-slate-400 mt-2">
                {simulation.scoredCount} scored · {simulation.unratedCount} unrated (no contracts / insufficient data)
              </div>
            </div>

            {/* Would-change list */}
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-400 mb-2 flex items-center">
                Tier changes if applied ({simulation.changes.length})
              </div>
              {simulation.changes.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-xl">
                  <CheckCircle2 className="w-6 h-6 mx-auto mb-1.5 text-emerald-500" />
                  No counterparty would change tier under this configuration.
                </div>
              ) : (
                <div className="max-h-[340px] overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl">
                  {simulation.changes.map(ch => (
                    <div key={ch.counterpartyId} className="px-4 py-2.5 flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-800 truncate">{ch.legalName}</span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        <Badge variant="neutral" className="text-[10px] font-mono">{tierLabel(ch.oldTierIndex, ch.oldTierCount)}</Badge>
                        <ArrowRight className="w-3 h-3 text-slate-400" />
                        <Badge variant="success" className="text-[10px] font-mono">{tierLabel(ch.newTierIndex, ch.newTierCount)}</Badge>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-500 leading-relaxed">
              <strong className="text-slate-700">How scoring works:</strong> each enabled metric is computed from contracts/invoices, mapped to 0–100 via its bands, and weighted-averaged
              (weights renormalize over scoreable metrics). A counterparty with no data — or with less than half the model&apos;s weight scoreable — is <strong>Unrated</strong>, never bottom-ranked.
              Applying snapshots this config as a new version and audits every transition with <code className="text-slate-700">cause = config_change</code>.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
