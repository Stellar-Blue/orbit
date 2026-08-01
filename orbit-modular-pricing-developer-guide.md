# Orbit — Contract Pricing, Version 1 (simple)

**Goal:** price a contract from a list of modules, and have Orbit compute the revenue. Nothing more.

## The whole model in one paragraph

There is a **catalog** of priced modules (with default prices). When you create or edit a contract, you pick modules from the catalog — each becomes a **line** on the contract, prefilled with the default price and payment frequency. You adjust quantities and prices per contract. A single **discount %** applies to the whole contract. Orbit multiplies, sums, and generates a month-by-month revenue schedule. That's it.

## 1. Every line is just: price × quantity

One formula for everything. No special pricing types.

| Example from the pricing sheet | Unit price | Quantity | Monthly |
|---|---|---|---|
| Invoice Generation & Billing (flat) | €1,000 | 1 | €1,000 |
| PV Park Optimization (per MW) | €5 | 500 MW | €2,500 |
| DAM Forecasting (per zone) | €500 | 1 | €500 |
| PV dispatch 1–50 band | €30 | 50 assets | €1,500 |
| PV dispatch 50–200 band | €20 | 150 assets | €3,000 |

- Flat modules are simply quantity = 1.
- A module priced per MW **and** per asset (like PV Production Forecasting) is **two lines**: one €3 × 500 MW, one €10 × 200 assets. Same for tier bands — one line per band, exactly like the spreadsheet already does. No tier engine in v1.
- One-time items (implementation, training, service days) are lines with `one_time` frequency: amount lands once, at the contract start (or a chosen month).

## 2. Two screens

**Pricing Configuration (admin settings):**
a table of modules → items. Each item has: name, default unit price, unit label (free text: MW, asset, zone, month, day…), default payment frequency (monthly / quarterly / annual / one-time). Add, edit, deactivate. Saving here saves the defaults. Changing a default affects **new** contract lines only — existing contracts keep the numbers they were saved with.

**Contract pricing (inside contract create/edit):**
1. Tick items from the catalog → lines appear prefilled with defaults.
2. Edit anything inline: price, quantity, frequency. Add a free-text line for anything not in the catalog.
3. Set the contract **discount %** (prefill suggestion: 5% for 1-year, 10% for 3-year, 20% for 5-year — but it's just one editable number), term (years), and start date.
4. A totals footer updates live: monthly total → discount → net monthly / annual / total contract value.

## 3. The math (complete)

```
line_monthly        = unit_price × quantity            (recurring lines)
contract_monthly    = Σ line_monthly
net_monthly         = contract_monthly × (1 − discount%)
net_annual          = net_monthly × 12
total_contract_value= net_annual × term_years + Σ one_time amounts
```

Rules kept deliberately blunt for v1:
- The discount applies to **all recurring lines**, none of the one-time lines.
- Any exception ("this module shouldn't be discounted", "Active-Passive deployment costs 20% more") is handled by **editing that line's price** on the contract. No flags, no multipliers.
- Everything is EUR, VAT-exclusive. Money is `numeric(14,2)`; round per line, then sum.

## 4. Payment frequency = when the cash lands, not how much

Prices are always entered as monthly rates. Frequency only moves cash in the schedule:

- monthly → the amount every month
- quarterly → 3× the amount every 3rd month (anchored to contract start)
- annual → 12× the amount once a year
- one_time → once

The contract's **MRR is always the monthly rate** regardless of frequency — so a client paying annually doesn't show up as a revenue spike + 11 empty months in your MRR dashboard.

## 5. Revenue schedule

On every save, regenerate one row per month for the contract's term: `(contract_id, period, amount)`, applying the frequency rules and the discount. The dashboard revenue view is then just `SUM(amount) GROUP BY period` across active contracts.

Mid-term change (client adds 120 MW)? Edit the quantity, save, schedule regenerates from the current month forward; past months stay as they were. The audit log (already in Orbit) records who changed what.

## 6. Schema (5 small tables)

```
catalog_modules   id, name, sort_order, active
catalog_items     id, module_id, name, default_unit_price, unit_label,
                  default_frequency, active

contracts         + discount_pct, term_years, service_start_date

contract_lines    id, contract_id, catalog_item_id (nullable = free-text line),
                  name, unit_price, quantity, unit_label, frequency, note
contract_schedule id, contract_id, period (YYYY-MM), amount
```

The one rule that matters: **contract lines store their own copied values.** Editing the catalog never changes an existing contract.

## 7. Seed & verify

Seed the catalog from `ETRM_Modular_Pricing.xlsx` (every sub-module row, monthly frequency, tier bands and per-MW/per-asset combos flattened into separate items). Verification: rebuild the workbook's two grand totals as a test contract — flat modules must sum to **€11,850/mo** and the per-asset set to **€28,100/mo**. If those two numbers come out right, the model is right.

## 8. Tests (6, not 60)

1. €1,000 × 1, monthly, 0% → €12,000/year.
2. €5 × 500 MW, 3-year, 10% → €2,500/mo → net €2,250/mo → €81,000 total contract value.
3. €1,000/mo line on annual frequency → schedule shows €12,000 in month 1 of each contract year, €0 elsewhere; MRR still €1,000; yearly sum identical to the monthly-frequency case.
4. Change a catalog default → existing contract totals unchanged; new contract prefills the new value.
5. Edit quantity mid-term → future schedule months change, past months don't.
6. One-time €20,000 implementation → appears once, never discounted.

## Explicitly NOT in v1

Deployment multipliers · tier auto-calculation · per-line discount flags · effective-dated line history · price-book versions · multi-currency · proration · indexation. Every one of these can be added later without breaking this model — and half of them may never be needed. If a deal needs something exotic, edit the line prices by hand; that's what the snapshot design is for.
