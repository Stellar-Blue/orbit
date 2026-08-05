// Configurable Counterparty Tiering Engine
// Scoring: for each enabled metric, raw value -> band lookup -> 0-100 points;
// score = weighted average (weights renormalized over scoreable metrics);
// tier = highest tier whose min_score <= score. Tier 1 = highest.
// Unrated: counterparty with no scoreable data, or <50% of enabled weight scoreable.

import { Contract, Invoice, ContractSchedule, CatalogModule, CatalogItem } from '@/lib/types';
import { calculateContractValuation } from '@/lib/pricing-engine';

export type TierModel = 'client' | 'supplier';

export interface MetricBand {
  min: number | null;
  max: number | null;
  points: number;
}

export interface MetricConfig {
  enabled: boolean;
  weight: number;
  bands: MetricBand[];
}

export interface TierConfig {
  min_score: number;
  color: string;
  description?: string;
}

export interface TierModelConfig {
  metrics: Record<string, MetricConfig>;
  tiers: TierConfig[];
}

export interface MetricResult {
  key: string;
  label: string;
  value: number | null;
  points: number | null;
  weight: number;
  contribution: number | null;
  notApplicable: boolean;
}

export interface TierScoreResult {
  score: number | null;
  tierIndex: number | null; // null = Unrated
  tierCount: number;
  breakdown: MetricResult[];
  unrated: boolean;
  unratedReason?: string;
}

export interface TierSimulationChange {
  counterpartyId: string;
  legalName: string;
  oldTierIndex: number | null;
  newTierIndex: number | null;
  oldTierCount: number;
  newTierCount: number;
  oldScore: number | null;
  newScore: number | null;
}

export interface TierSimulation {
  distribution: Array<{ tierIndex: number | null; count: number }>;
  changes: TierSimulationChange[];
  scoredCount: number;
  unratedCount: number;
}

export interface TierHistoryDelta {
  counterparty_id: string;
  model: TierModel;
  old_tier_index: number | null;
  new_tier_index: number | null;
  old_tier_count: number;
  new_tier_count: number;
  old_score: number | null;
  new_score: number | null;
  cause: 'data_change' | 'config_change' | 'override';
}

export interface TierDataContext {
  contracts: Contract[];
  invoices: Invoice[];
  schedule: ContractSchedule[];
  catalogModules: CatalogModule[];
  catalogItems: CatalogItem[];
}

export const TIER_MODELS: TierModel[] = ['client', 'supplier'];

export const METRIC_LABELS: Record<string, string> = {
  active_arr: 'Active ARR',
  committed_remaining: 'Committed Remaining',
  tenure_months: 'Tenure',
  product_breadth: 'Product Breadth',
  active_contracts: 'Active Contracts',
  lifetime_invoiced: 'Lifetime Invoiced',
  payment_behavior: 'Payment Behavior',
  growth_yoy: 'Growth YoY',
  avg_contract_term: 'Avg Contract Term',
  supplier_spend_annual: 'Supplier Spend (Annual)'
};

export const MODEL_DIRECTION: Record<TierModel, 'revenue' | 'cost'> = {
  client: 'revenue',
  supplier: 'cost'
};

export function tierLabel(tierIndex: number | null | undefined, tierCount?: number | null): string {
  if (tierIndex === null || tierIndex === undefined) return 'Unrated';
  const base = `Tier ${tierIndex + 1}`;
  return tierCount && tierCount > 0 ? `${base} of ${tierCount}` : base;
}

// ---------------------------------------------------------------------------
// Default v1 seed config (mirrors migration 0024; used for pre-apply simulation)
// ---------------------------------------------------------------------------

export const DEFAULT_CLIENT_MODEL_CONFIG: TierModelConfig = {
  metrics: {
    active_arr: { enabled: true, weight: 40, bands: [
      { min: null, max: 10000, points: 0 }, { min: 10000, max: 50000, points: 40 },
      { min: 50000, max: 100000, points: 70 }, { min: 100000, max: null, points: 100 }
    ]},
    committed_remaining: { enabled: true, weight: 30, bands: [
      { min: null, max: 25000, points: 0 }, { min: 25000, max: 100000, points: 40 },
      { min: 100000, max: 250000, points: 70 }, { min: 250000, max: null, points: 100 }
    ]},
    tenure_months: { enabled: true, weight: 15, bands: [
      { min: null, max: 3, points: 0 }, { min: 3, max: 12, points: 40 },
      { min: 12, max: 24, points: 70 }, { min: 24, max: null, points: 100 }
    ]},
    product_breadth: { enabled: true, weight: 15, bands: [
      { min: null, max: 1, points: 40 }, { min: 1, max: 2, points: 70 }, { min: 2, max: null, points: 100 }
    ]},
    active_contracts: { enabled: false, weight: 10, bands: [
      { min: null, max: 1, points: 0 }, { min: 1, max: 3, points: 50 }, { min: 3, max: null, points: 100 }
    ]},
    lifetime_invoiced: { enabled: false, weight: 10, bands: [
      { min: null, max: 25000, points: 0 }, { min: 25000, max: 100000, points: 40 },
      { min: 100000, max: 250000, points: 70 }, { min: 250000, max: null, points: 100 }
    ]},
    payment_behavior: { enabled: false, weight: 20, bands: [
      { min: null, max: 0.5, points: 0 }, { min: 0.5, max: 0.8, points: 50 }, { min: 0.8, max: null, points: 100 }
    ]},
    growth_yoy: { enabled: false, weight: 10, bands: [
      { min: null, max: 0, points: 0 }, { min: 0, max: 0.25, points: 40 },
      { min: 0.25, max: 1, points: 70 }, { min: 1, max: null, points: 100 }
    ]},
    avg_contract_term: { enabled: false, weight: 10, bands: [
      { min: null, max: 6, points: 0 }, { min: 6, max: 12, points: 40 },
      { min: 12, max: 24, points: 70 }, { min: 24, max: null, points: 100 }
    ]},
    supplier_spend_annual: { enabled: false, weight: 40, bands: [
      { min: null, max: 10000, points: 0 }, { min: 10000, max: 50000, points: 40 },
      { min: 50000, max: 100000, points: 70 }, { min: 100000, max: null, points: 100 }
    ]}
  },
  tiers: [
    { min_score: 85, color: '#0f766e', description: 'Strategic accounts' },
    { min_score: 65, color: '#2563eb', description: 'Core recurring clients' },
    { min_score: 40, color: '#7c3aed', description: 'Standard accounts' },
    { min_score: 0, color: '#64748b', description: 'Long tail' }
  ]
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ConfigValidationError {
  field: string;
  message: string;
}

export function validateModelConfig(config: TierModelConfig): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];

  // Tiers: 2-10, strictly descending min_score, last pinned at 0
  if (!config.tiers || config.tiers.length < 2 || config.tiers.length > 10) {
    errors.push({ field: 'tiers', message: 'Tier count must be between 2 and 10.' });
  } else {
    config.tiers.forEach((t, i) => {
      if (typeof t.min_score !== 'number' || isNaN(t.min_score) || t.min_score < 0 || t.min_score > 100) {
        errors.push({ field: `tiers[${i}].min_score`, message: 'min_score must be between 0 and 100.' });
      }
      if (i > 0 && t.min_score >= config.tiers[i - 1].min_score) {
        errors.push({ field: `tiers[${i}].min_score`, message: 'Thresholds must be strictly descending (Tier 1 = highest).' });
      }
    });
    if (config.tiers.length > 0 && config.tiers[config.tiers.length - 1].min_score !== 0) {
      errors.push({ field: `tiers[${config.tiers.length - 1}].min_score`, message: 'The last tier min_score must be pinned at 0.' });
    }
  }

  // Metrics: positive weights; bands contiguous + monotonic points
  Object.entries(config.metrics || {}).forEach(([key, m]) => {
    if (!m) return;
    if (typeof m.weight !== 'number' || m.weight <= 0) {
      errors.push({ field: `metrics.${key}.weight`, message: 'Weight must be a positive number.' });
    }
    if (!Array.isArray(m.bands) || m.bands.length === 0) {
      errors.push({ field: `metrics.${key}.bands`, message: 'At least one band is required.' });
      return;
    }
    const sorted = [...m.bands].sort((a, b) => (a.min ?? -Infinity) - (b.min ?? -Infinity));
    sorted.forEach((b, i) => {
      if (i === 0 && b.min !== null) {
        errors.push({ field: `metrics.${key}.bands[0].min`, message: 'First band min must be unbounded (null).' });
      }
      if (i === sorted.length - 1 && b.max !== null) {
        errors.push({ field: `metrics.${key}.bands[last].max`, message: 'Last band max must be unbounded (null).' });
      }
      if (i > 0 && b.min !== sorted[i - 1].max) {
        errors.push({ field: `metrics.${key}.bands[${i}].min`, message: 'Bands must be contiguous (no gaps or overlaps).' });
      }
      if (i > 0 && b.points < sorted[i - 1].points) {
        errors.push({ field: `metrics.${key}.bands[${i}].points`, message: 'Points must be monotonic (non-decreasing).' });
      }
    });
  });

  return errors;
}

// ---------------------------------------------------------------------------
// Metric catalog (all derived from existing Orbit data)
// ---------------------------------------------------------------------------

function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

function bandPoints(metric: MetricConfig, value: number): number {
  for (const band of metric.bands) {
    const lo = band.min === null ? -Infinity : band.min;
    const hi = band.max === null ? Infinity : band.max;
    if (value >= lo && value < hi) return band.points;
  }
  // Exact top-boundary (value === last band max is impossible since max is null) — fallback to last band
  return metric.bands[metric.bands.length - 1].points;
}

interface MetricValue {
  value: number | null;
}

function computeMetricValue(
  key: string,
  model: TierModel,
  counterpartyId: string,
  ctx: TierDataContext
): MetricValue {
  const direction = MODEL_DIRECTION[model];
  const cpContracts = ctx.contracts.filter(c => c.counterparty_id === counterpartyId);
  const active = cpContracts.filter(c => c.status === 'active' && c.direction === direction);
  const valuation = (c: Contract) => calculateContractValuation(
    c.lines || [], c.discount_pct || 0, c.term_years || 1,
    c.service_start_date || c.starts_on, ctx.catalogModules, ctx.catalogItems,
    c.value || 0, c.billing_cadence
  );

  switch (key) {
    case 'active_arr': {
      if (active.length === 0) return { value: null };
      const arr = active.reduce((sum, c) => sum + valuation(c).netARR, 0);
      return { value: arr };
    }
    case 'committed_remaining': {
      if (active.length === 0) return { value: null };
      const today = new Date();
      let committed = 0;
      active.forEach(c => {
        const val = valuation(c);
        const start = c.service_start_date || c.starts_on;
        const startObj = new Date(start + 'T00:00:00');
        const endObj = c.ends_on
          ? new Date(c.ends_on + 'T00:00:00')
          : new Date(startObj.getFullYear() + (c.term_years || 1), startObj.getMonth(), startObj.getDate());
        const months = Math.max(0, monthsBetween(today, endObj));
        committed += (val.netARR / 12) * months;
      });
      return { value: committed };
    }
    case 'tenure_months': {
      const withStart = cpContracts.filter(c => c.direction === direction && c.starts_on);
      if (withStart.length === 0) return { value: null };
      const earliest = withStart.reduce((min, c) => (c.starts_on < min ? c.starts_on : min), withStart[0].starts_on);
      return { value: monthsBetween(new Date(earliest + 'T00:00:00'), new Date()) };
    }
    case 'product_breadth': {
      if (active.length === 0) return { value: null };
      const products = new Set(active.map(c => c.product || c.type || 'Other').filter(Boolean));
      return { value: products.size };
    }
    case 'active_contracts': {
      return { value: active.length };
    }
    case 'lifetime_invoiced': {
      const invDirection = model === 'client' ? 'outgoing' : 'incoming';
      const invs = ctx.invoices.filter(i => i.counterparty_id === counterpartyId && i.direction === invDirection && i.status !== 'cancelled');
      if (invs.length === 0) return { value: null };
      const total = invs.reduce((sum, i) => {
        const sign = i.type === 'credit_note' ? -1 : 1;
        return sum + sign * i.gross_eur;
      }, 0);
      return { value: total };
    }
    case 'payment_behavior': {
      // % of invoiced amount paid within terms, trailing 12 months
      const invDirection = model === 'client' ? 'outgoing' : 'incoming';
      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - 1);
      const invs = ctx.invoices.filter(i =>
        i.counterparty_id === counterpartyId && i.direction === invDirection &&
        i.status !== 'cancelled' && new Date(i.issue_date + 'T00:00:00') >= cutoff
      );
      if (invs.length === 0) return { value: null };
      let totalInvoiced = 0;
      let paidWithinTerms = 0;
      invs.forEach(i => {
        const gross = i.type === 'credit_note' ? -i.gross_eur : i.gross_eur;
        totalInvoiced += Math.abs(gross);
        const due = new Date(i.due_date + 'T00:00:00');
        due.setDate(due.getDate() + 7); // grace window
        (i.payments || []).forEach(p => {
          const paidOn = new Date(p.paid_on + 'T00:00:00');
          if (paidOn <= due) paidWithinTerms += p.amount;
        });
      });
      if (totalInvoiced <= 0) return { value: null };
      return { value: Math.min(1, paidWithinTerms / totalInvoiced) };
    }
    case 'growth_yoy': {
      if (active.length === 0) return { value: null };
      const arrNow = active.reduce((sum, c) => sum + valuation(c).netARR, 0);
      const nowPeriod = new Date();
      const yearAgo = new Date(nowPeriod.getFullYear() - 1, nowPeriod.getMonth(), 1);
      const yearAgoKey = `${yearAgo.getFullYear()}-${String(yearAgo.getMonth() + 1).padStart(2, '0')}`;
      const matching = ctx.schedule.filter(s => s.period === yearAgoKey && active.some(c => c.id === s.contract_id));
      if (matching.length === 0) return { value: null };
      const arrYearAgo = matching.reduce((sum, s) => sum + s.amount, 0);
      if (arrYearAgo <= 0) return { value: null };
      return { value: (arrNow - arrYearAgo) / arrYearAgo };
    }
    case 'avg_contract_term': {
      if (active.length === 0) return { value: null };
      let weighted = 0;
      let weightSum = 0;
      active.forEach(c => {
        const start = new Date((c.service_start_date || c.starts_on) + 'T00:00:00');
        const end = c.ends_on
          ? new Date(c.ends_on + 'T00:00:00')
          : new Date(start.getFullYear() + (c.term_years || 1), start.getMonth(), start.getDate());
        const termMonths = Math.max(1, monthsBetween(start, end));
        const arr = valuation(c).netARR;
        weighted += termMonths * arr;
        weightSum += arr;
      });
      if (weightSum <= 0) return { value: null };
      return { value: weighted / weightSum };
    }
    case 'supplier_spend_annual': {
      if (active.length === 0) return { value: null };
      const spend = active.reduce((sum, c) => sum + valuation(c).netARR, 0);
      return { value: spend };
    }
    default:
      return { value: null };
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function scoreCounterparty(
  model: TierModel,
  counterpartyId: string,
  config: TierModelConfig,
  ctx: TierDataContext
): TierScoreResult {
  const tierCount = config.tiers.length;

  const breakdown: MetricResult[] = Object.entries(config.metrics).map(([key, metric]) => {
    const raw = computeMetricValue(key, model, counterpartyId, ctx).value;
    if (!metric.enabled) {
      return { key, label: METRIC_LABELS[key] || key, value: raw, points: null, weight: metric.weight, contribution: null, notApplicable: true };
    }
    if (raw === null) {
      return { key, label: METRIC_LABELS[key] || key, value: null, points: null, weight: metric.weight, contribution: null, notApplicable: true };
    }
    const points = bandPoints(metric, raw);
    return { key, label: METRIC_LABELS[key] || key, value: raw, points, weight: metric.weight, contribution: null, notApplicable: false };
  });

  const enabledMetrics = Object.entries(config.metrics).filter(([, m]) => m.enabled);
  const enabledWeight = enabledMetrics.reduce((sum, [, m]) => sum + m.weight, 0);
  const scoreable = breakdown.filter(m => m.points !== null && !m.notApplicable);
  const scoreableWeight = scoreable.reduce((sum, m) => sum + m.weight, 0);

  if (enabledWeight <= 0 || scoreable.length === 0) {
    return { score: null, tierIndex: null, tierCount, breakdown, unrated: true, unratedReason: 'No scoreable metrics' };
  }
  // Guard: fewer than half of the model's enabled weight scoreable -> Unrated
  if (scoreableWeight < enabledWeight * 0.5) {
    return {
      score: null, tierIndex: null, tierCount, breakdown, unrated: true,
      unratedReason: `Less than half of the model weight is scoreable (${scoreableWeight.toFixed(1)} / ${enabledWeight.toFixed(1)})`
    };
  }

  let weightedSum = 0;
  scoreable.forEach(m => {
    const contribution = ((m.points || 0) * m.weight) / scoreableWeight;
    m.contribution = contribution;
    weightedSum += contribution;
  });

  const score = Math.round(weightedSum * 100) / 100;
  let tierIndex = config.tiers.length - 1;
  for (let i = 0; i < config.tiers.length; i++) {
    if (score >= config.tiers[i].min_score) {
      tierIndex = i;
      break;
    }
  }

  return { score, tierIndex, tierCount, breakdown, unrated: false };
}

// ---------------------------------------------------------------------------
// Simulation & history
// ---------------------------------------------------------------------------

export function simulateConfig(
  model: TierModel,
  config: TierModelConfig,
  counterparties: Array<{ id: string; legal_name: string }>,
  ctx: TierDataContext,
  currentTiers: Map<string, { tier_index: number | null; tier_count: number; score: number | null }>
): TierSimulation {
  const distribution = new Map<string, number>();
  const changes: TierSimulationChange[] = [];
  let scoredCount = 0;
  let unratedCount = 0;

  counterparties.forEach(cp => {
    const result = scoreCounterparty(model, cp.id, config, ctx);
    const key = result.tierIndex === null ? 'unrated' : String(result.tierIndex);
    distribution.set(key, (distribution.get(key) || 0) + 1);
    if (result.unrated) unratedCount++;
    else scoredCount++;

    const current = currentTiers.get(cp.id);
    const oldIndex = current ? current.tier_index : null;
    const oldCount = current ? current.tier_count : config.tiers.length;
    if (
      !current ||
      oldIndex !== result.tierIndex ||
      oldCount !== result.tierCount
    ) {
      changes.push({
        counterpartyId: cp.id,
        legalName: cp.legal_name,
        oldTierIndex: oldIndex,
        newTierIndex: result.tierIndex,
        oldTierCount: oldCount,
        newTierCount: result.tierCount,
        oldScore: current ? current.score : null,
        newScore: result.score
      });
    }
  });

  const distArr: Array<{ tierIndex: number | null; count: number }> = [];
  for (let i = 0; i < config.tiers.length; i++) {
    distArr.push({ tierIndex: i, count: distribution.get(String(i)) || 0 });
  }
  distArr.push({ tierIndex: null, count: distribution.get('unrated') || 0 });

  return { distribution: distArr, changes, scoredCount, unratedCount };
}

export function buildHistoryDeltas(
  model: TierModel,
  newState: Array<{ counterparty_id: string; tier_index: number | null; tier_count: number; score: number | null }>,
  currentMap: Map<string, { tier_index: number | null; tier_count: number; score: number | null }>,
  cause: 'data_change' | 'config_change' | 'override'
): TierHistoryDelta[] {
  const deltas: TierHistoryDelta[] = [];
  newState.forEach(n => {
    const cur = currentMap.get(n.counterparty_id);
    if (!cur) {
      deltas.push({
        counterparty_id: n.counterparty_id, model,
        old_tier_index: null, new_tier_index: n.tier_index,
        old_tier_count: n.tier_count, new_tier_count: n.tier_count,
        old_score: null, new_score: n.score, cause
      });
      return;
    }
    if (cur.tier_index !== n.tier_index || cur.tier_count !== n.tier_count) {
      deltas.push({
        counterparty_id: n.counterparty_id, model,
        old_tier_index: cur.tier_index, new_tier_index: n.tier_index,
        old_tier_count: cur.tier_count, new_tier_count: n.tier_count,
        old_score: cur.score, new_score: n.score, cause
      });
    }
  });
  return deltas;
}
