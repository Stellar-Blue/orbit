# Orbit — Counterparty Tiering Requirements (Configurable)

**Status:** Draft v1.2 — tiers are generated `Tier 1…n` with admin-configurable count; starter model, Attio attribute type, visibility and Unrated all settled
**Purpose:** every counterparty gets a computed **tier** (`Tier 1 … Tier n`, where the number of tiers is configured by admins) derived from the contracts (and invoices) registered against it in Orbit — and the *definition* of what makes a counterparty matter more or less is not hardcoded: admins configure the metrics, their weights, and the thresholds in system settings. When StellarBlue's idea of "important client" changes, the settings change — not the code.
**Inherits:** contracts with direction + committed value, the revenue schedule, the invoice module (payment behavior), counterparty registry + Attio rollups, audit triggers, admin-only settings.

---

## 1. Design principles

1. **Computed, explainable, reproducible.** A tier is never a vibe. Every tier comes with a visible breakdown — each metric's raw value, the points it scored, its weight, its contribution — so "why is ΔΕΠΑ Tier 2?" has a one-click answer. Same inputs + same config ⇒ same tier, always.
2. **Absolute scoring, not relative.** Metrics score against **configured bands** (e.g. ARR ≥ €100k → 100 points), never normalized against the current client population. Relative normalization means a counterparty's tier silently drops because *someone else* signed a big deal — confusing, and it makes historical tiers meaningless. Bands keep tiers stable and comparable over time.
3. **Config changes are transparent events.** Re-weighting the model recomputes everyone, and the settings screen shows the resulting distribution *before* applying (simulation). Tier changes are history-tracked and audited — both the data-driven ones and the config-driven ones, distinguishably.
4. **No new data entry.** Every metric derives from data Orbit already holds. If a desired metric needs a new field, that's a schema discussion first, not a free-text score.

## 2. The scoring model

```
for each enabled metric m:
    raw_m    = computed from contracts/invoices (metric catalog, §3)
    points_m = band lookup: which configured band raw_m falls into → 0–100
score        = Σ (points_m × weight_m) / Σ weight_m        -- weighted average, 0–100
tier         = highest tier whose min_score ≤ score
```

- **Weights** are positive numbers; the engine normalizes by their sum, so admins can think in simple ratios (ARR 50, tenure 20, payment 30) without forcing a sum of 100.
- **Bands** per metric: ordered, contiguous ranges mapping raw value → points (e.g. ARR: `<10k → 0`, `10–50k → 40`, `50–100k → 70`, `≥100k → 100`). Editable count and boundaries; validation enforces contiguity and monotonic points.
- **Tiers**: admins configure **how many tiers exist (n)** and each one's `min_score` and color. **Names are generated, not typed: `Tier 1 … Tier n`.**
  - **Numbering direction (fixed, not configurable): Tier 1 is the highest.** Tier 1 holds the top `min_score`, Tier n the lowest — matching normal commercial usage ("a tier 1 client"). This must be a system invariant rather than a setting, because a flippable direction makes every historical record ambiguous.
  - `n` is admin-set, bounded **2–10**; above ~5 the settings screen shows a soft warning that granularity exceeds what a portfolio of this size can meaningfully distinguish.
  - Each tier may carry an optional **internal description** ("strategic accounts", "long tail") shown in Orbit tooltips and the settings screen only — never synced to Attio, never part of the label.
  - Default seed: n = 4 (Tier 1 ≥ 85, Tier 2 ≥ 65, Tier 3 ≥ 40, Tier 4 ≥ 0).
- **`Unrated` sits outside the numbering** — it is not "Tier n+1". A counterparty with no contracts in the model's direction is unscored, not bottom-ranked.
- **Direction-scoped models.** Two independent models on the same engine: **Client tier** (revenue-direction metrics) and **Supplier tier** (cost-direction: spend, criticality). A `both`-role counterparty carries both badges. v1 ships the client model configured and enabled; the supplier model exists in the engine but starts disabled — see Open Q2.
- **Insufficient data:** a counterparty with no active or historical contracts in the model's direction gets tier `Unrated` — never the lowest tier. Absence of data is not a low ranking.

## 3. Metric catalog (v1 — all derived from existing data)

| Key | Definition | Source |
|---|---|---|
| `active_arr` | Current annualized recurring value across active revenue contracts (post-discount/multiplier) | revenue schedule |
| `committed_remaining` | Σ schedule from today to each active contract's end | revenue schedule |
| `lifetime_invoiced` | Total invoiced (net of credit notes), all time | invoices |
| `active_contracts` | Count of active contracts in direction | contracts |
| `tenure_months` | Months since earliest contract `starts_on` | contracts |
| `product_breadth` | Distinct products/module groups under contract (Atlas ETRM, EMS, …) | contract line items |
| `payment_behavior` | % of invoiced amount paid within terms, trailing 12 months (AR: do they pay us on time) | invoice payments |
| `growth_yoy` | ARR now vs 12 months ago, as % | revenue schedule history |
| `avg_contract_term` | Weighted average committed term of active contracts | contracts |
| `supplier_spend_annual` | (supplier model) annualized cost-direction committed spend | revenue schedule |

Each metric in a model is **enabled/disabled** independently; disabled metrics drop out of the weighted average entirely (weights renormalize). The catalog is code (each metric is one tested SQL/function), but which are used and how they score is pure configuration. Adding a new metric to the catalog is a small PR, not a migration.

### 3.1 No-data handling (per metric, per counterparty)

A metric can be enabled globally yet have no data for a given counterparty — a client contracted last month has no `payment_behavior` and no `growth_yoy`. **Scoring it 0 would be wrong** (it punishes newness, which is not the same as bad behavior). Rule:

- Each metric function returns either a value or `not_applicable`.
- `not_applicable` metrics are **excluded from that counterparty's weighted average**, with weights renormalized across the remainder — the same mechanism as a globally disabled metric, applied per row.
- The breakdown shows them explicitly as "not scored — insufficient data", so the tier stays explainable.
- Guard: if fewer than half of the model's total weight is scoreable for a counterparty, it is `Unrated` rather than scored on a thin slice.

### 3.2 v1 starter model (decision: no prior ranking practice)

StellarBlue does not rank clients today, so there is no existing mental model to encode — and inventing an elaborate one would be false precision. Two consequences shape the v1 configuration:

**(a) Only enable metrics that have data on day one.** `payment_behavior`, `growth_yoy`, and `lifetime_invoiced` all need 12 months of accumulated invoice/schedule history that does not exist yet. They ship in the catalog but **globally disabled**, with a calendar reminder to revisit once the invoice module has a year of history. Enabling them later is a settings change, previewed in the simulation panel like any other.

**(b) Start deliberately simple and near-objective.** Proposed seed configuration — money now, money committed, relationship depth:

| Metric | Weight | Rationale |
|---|---|---|
| `active_arr` | 40 | The primary signal; what this counterparty is worth per year right now |
| `committed_remaining` | 30 | Distinguishes a large one-year deal from a large five-year one |
| `tenure_months` | 15 | Rewards durable relationships without dominating |
| `product_breadth` | 15 | Multi-product clients are structurally stickier and strategically weightier |

Band boundaries are seeded from the actual portfolio distribution at build time (so the initial spread is sensible rather than arbitrary) and immediately tunable in the simulation panel.

**Expectation to set with the team:** the first configuration is a starting hypothesis, not a verdict. The intended workflow is to look at the resulting distribution against the real portfolio, react ("that client shouldn't be Tier 3"), and adjust weights or bands until the output matches intuition. That reaction *is* the ranking model being discovered — which is the honest way to build one when none exists.

## 4. Settings screen (admin)

One screen per model (Client / Supplier):

- **Metric table:** enable toggle, weight input, inline band editor per metric (range boundaries + points, with unit-aware formatting — €, months, %, count).
- **Tier editor:** set the **tier count `n`** (2–10) and each tier's `min_score`, color, and optional internal description. Labels render read-only as `Tier 1 … Tier n`; there is no name field.
  - **Changing `n` is a first-class operation, not an afterthought.** Increasing it splits the widest score band by default (admin adjusts); decreasing it merges the two closest bands by default. Either way the simulation panel shows the full before/after mapping — "Tier 3 (of 4) → Tier 2 (of 3)" per counterparty — before anything applies.
  - Thresholds are validated strictly descending with no gaps or overlaps; Tier n's `min_score` is pinned at 0.
- **Live simulation panel — the feature that makes configuration safe:** as the admin edits, a preview recomputes against *current real data*: resulting distribution ("Tier 1: 3 · Tier 2: 5 · Tier 3: 9 · Tier 4: 2 · Unrated: 4"), and the list of counterparties that would **change tier**, with old → new. Nothing applies until "Apply & recompute," which snapshots the config version and writes one audit entry plus per-counterparty tier-history rows attributed to `config_change`.
- Config is **versioned** (`tier_model_versions`, immutable rows — same snapshot philosophy as pricing): every tier-history entry references the config version it was computed under, so historical tiers remain interpretable after any re-weighting.

## 5. Computation & lifecycle

- **Triggers:** nightly full recompute (cheap at this scale — it's a handful of aggregates over hundreds of rows), plus debounced per-counterparty recompute on contract/invoice/payment changes (reuses the Attio rollup debounce window — same event sources).
- **State & history:**
```
tier_model_versions      id, model (client|supplier), tier_count, config jsonb,
                         created_by, created_at, active bool
counterparty_tiers       counterparty_id, model, tier_index, score,
                         breakdown jsonb,           -- per-metric raw/points/contribution
                         model_version_id, computed_at
counterparty_tier_history id, counterparty_id, model, old_tier_index, new_tier_index,
                         old_tier_count, new_tier_count,
                         old_score, new_score, cause (data_change|config_change|override),
                         model_version_id, changed_at
```

**Numbered-tier history rule (important):** because labels are positional, "Tier 3" means different things under different tier counts. Storage is therefore `tier_index` + the `tier_count` in force, never a rendered string — and any historical display where the count differs from today's renders as **"Tier 3 of 4"** rather than a bare "Tier 3". Without this, changing `n` silently rewrites the meaning of every past record.
- **Manual override:** an admin can pin a counterparty's tier (reason mandatory, optional expiry) — strategic accounts sometimes outrank their numbers (a pilot client who is also a flagship reference). Overrides display distinctly (pin icon + reason on hover), never silently: the computed tier stays visible alongside ("pinned Tier 2, computed Tier 3"). Override expiry reverts to computed and logs it.
- **Tier-change notifications:** admin digest entry on any change ("ΔΕΠΑ: Tier 3 → Tier 2, driven by committed_remaining"), with cause. Demotions are individually flagged rather than only digested when they affect a top tier — a Tier 1 counterparty sliding is exactly what founders want to see early.

## 6. Where tiers appear

- Badge on the counterparty page header and the register (sortable/filterable column).
- Contract views filterable by counterparty tier ("expiring contracts of Tier 1–2 clients" — renewal prioritization is the killer combination with the existing notice-deadline alerting).
- **Attio rollup — `orbit_tier` (attribute type: `select`, single-value):** the tier is pushed to the linked Attio company record so it is visible where account conversations happen.
  - **Single `select`, not `multi_select`.** A counterparty has exactly one client tier at a time; single-select makes that invariant structural — a partial write or sync bug cannot leave a record tagged both "Tier 1" and "Tier 3", which multi-select permits and nothing in Attio would prevent. It also gives clean kanban grouping and filtering. (Attio's own guidance uses the same test: choose Select when a record cannot hold two values at once. In the API both are the `select` type; the difference is single vs array on write.)
  - **Two models → two attributes, never one shared multi-select.** When the supplier model is enabled, it gets its own `orbit_supplier_tier` select. A shared multi-select holding "Tier 2" would be ambiguous about *which* model it refers to for a `both`-role counterparty.
  - **Options** are created via the API as `Tier 1 … Tier n` plus an explicit **`Unrated`** option, with colors matching Orbit's tier colors. `Unrated` is a real option rather than an empty field — empty reads as "not synced yet", while `Unrated` is a meaningful, filterable state ("linked companies with no contracts").
  - **When `n` changes:** new options are created for added tiers; options for removed tiers are **archived, not deleted**, so historical Attio records and any saved views referencing them survive. Sync then re-asserts every linked record's current tier in one recompute pass — expect a visible bulk update in the CRM, which the settings screen warns about before applying.
  - Since labels are positional, the Attio attribute **description** is set programmatically to state the current scheme ("Tier 1 = highest, of 4 tiers; maintained by Orbit — do not edit"), so CRM users reading a bare "Tier 3" know what it means.
  - Written on every recompute through the existing outbox + debounce; re-asserted by nightly reconciliation if edited manually in the CRM.
- Reporting: revenue by tier, tier distribution over time (from history).
- Explicitly **not** in v1: tiers driving behavior (payment terms defaults, SLA routing, discount ceilings). Display, filter, prioritize, sync — automation on top of tiers is a later, separate decision.

## 7. Permissions & audit

**Confirmed:** counterparties are an admin-only area of Orbit in the first place, so tiers, breakdowns, and configuration inherit that — no separate visibility rule is needed inside Orbit.

**Where tiers do become broadly visible is Attio**, and that is intentional: `orbit_tier` lands on the company record, so anyone with CRM access sees the tier. Two consequences to be deliberate about:

- **Only the tier label syncs — never the score or the breakdown.** The breakdown contains payment behavior and revenue figures; it stays inside Orbit. Attio gets the label ("Tier 2"), not the reasoning.
- The tier is therefore effectively a *shared commercial label* — which is part of why the numbering scheme is neutral (`Tier 1 … Tier n`, §2). A number carries no editorial judgment the way a metal-name scheme would, so a shared screen or an exported view stays uncomfortable-free.

Config changes, overrides, and every tier transition are audit-logged (the history table *is* the domain log; audit triggers cover config and overrides).

## 8. Acceptance criteria

1. With the seeded default model, every counterparty with revenue contracts shows a tier and a breakdown whose contributions sum to its score; a contract-less counterparty shows `Unrated`.
2. Changing a weight in settings shows the simulated distribution and the exact list of tier changes before applying; applying recomputes all, writes one config version, and history rows carry `cause = config_change`.
3. Registering a new invoice payment that lifts `payment_behavior` across a band boundary changes the tier within the debounce window, with `cause = data_change` and the driving metric visible in the notification.
4. A pinned override survives recomputes, displays both pinned and computed tiers, expires on schedule, and every step is in history.
5. Two counterparties with identical inputs always land identical scores; re-running the nightly job with unchanged data produces zero history rows.
6. Adding a big contract to counterparty A changes nothing about counterparty B's tier (absolute bands — no population effects).
7. A non-admin session cannot read tiers, breakdowns, or config by any path (RLS suite extended).
8. `orbit_tier` appears on linked Attio records after recompute as a single-select value, and reconciliation re-asserts it if edited in the CRM; an `Unrated` counterparty shows the explicit `Unrated` option, not an empty field; the score and breakdown appear nowhere in Attio.
9. A client contracted last month, with `payment_behavior` enabled, is scored on the remaining metrics with weights renormalized — not scored 0 for payment behavior — and its breakdown shows that metric as "not scored — insufficient data".
10. A counterparty for which less than half the model's weight is scoreable comes out `Unrated` rather than scored on a thin slice.
11. **Changing `n` from 4 to 3:** the simulation panel shows every counterparty's old→new mapping with counts ("Tier 3 of 4 → Tier 2 of 3") before applying; after applying, history rows record both old and new tier counts, historical entries still render with their original "of 4" context, the retired Attio option is archived rather than deleted, and all linked records are re-asserted to their new tier.
12. Tier 1 always carries the highest `min_score`; a config attempting non-descending thresholds, a gap, or a non-zero floor on the last tier is rejected in settings.

## 9. Decisions & remaining questions

**Resolved:**

| Question | Decision | Consequence |
|---|---|---|
| Initial model | No ranking practice exists today → ship the simple 4-metric starter model (§3.2) and discover the real model by reacting to its output in the simulation panel | Behavioral metrics disabled until a year of invoice history exists; no-data handling rule (§3.1) added |
| Tier visibility | Counterparties are already admin-only in Orbit; tiers inherit that. Tier syncs to Attio, where it is broadly visible | Only the label syncs, never score/breakdown; tier names are a shared-visibility naming decision |
| Attio attribute type | **Single `select`**, not multi-select — one tier per counterparty, enforced structurally | Supplier tier gets a separate attribute later, not a shared multi-select |
| Unrated | Explicit `Unrated` tier, distinct from the lowest scored tier | Synced to Attio as a real option, not an empty field |
| Tier naming | Generated `Tier 1 … Tier n`; **n is admin-configurable (2–10)**; Tier 1 = highest | No name field in settings; tier identity stored as index + count, never a string; changing `n` is a previewed, versioned operation |

**Remaining:**

1. **Supplier model:** enable in v1 (spend-band based) or leave disabled until a concrete use appears — vendor-risk review or renewal prioritization on the cost side? *Recommend disabled until the AP invoice history makes spend figures meaningful.*
2. **Band seeding:** confirm at build time that boundaries derived from the current portfolio produce a sensible spread rather than nine clients in one tier — a distribution check, one look at the simulation panel.
3. **Starting `n`:** the seed is 4. With a portfolio in the low tens, 3 may discriminate better than 4 — worth deciding from the first simulation run rather than in advance.
