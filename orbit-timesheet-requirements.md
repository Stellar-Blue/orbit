# Orbit — Timesheet Tracking Requirements

**Status:** Draft v1.1 — no standard daily hours (capacity model reworked), detailed charge report required on invoices, retainers dropped
**Purpose:** record the hours each employee spends on features/work for a contract, price that effort using role- and seniority-based rate cards, and turn it into the two numbers a services business runs on: **utilization** (are we busy?) and **project margin** (are we profitable?).
**Inherits:** profiles + `work_schedule` + employment types, `salary_history` (cost side), leave/holidays (capacity), contracts + line items + revenue schedule, invoices + allocations, admin-only financial RLS, audit triggers, configurable-settings pattern (payment types, tier model).

---

## 1. Position in the system — what this is NOT

Three boundaries, stated up front because each one is a trap:

- **Not a legal working-time record.** Greek working-time obligations run through ΕΡΓΑΝΗ and the digital work card (ψηφιακή κάρτα εργασίας) — actual clock-in/clock-out. Orbit's timesheet is **effort allocation**: which contract/feature consumed the day. The two will not always agree, and Orbit's numbers must never be presented, exported, or reasoned about as a working-time or overtime record. Where a timesheet day materially exceeds the declared schedule, Orbit **flags an anomaly for review** rather than treating it as authoritative (§10).
- **Not payroll input.** Salaried employees are paid their salary; logged hours never affect pay. (Contractors are the narrow exception — §9 — where hours *validate* an invoice they issue, and still don't compute it.)
- **Not surveillance.** No screenshots, no activity monitors, no idle detection, no keystroke/app tracking. Ever. Self-reported allocation at day granularity is the whole product.

## 2. Core model

```
contract ──▶ project ──▶ work_item (feature/task) ──▶ time_entry ◀── employee
                │
internal project (no contract) ─────────────────────────┘
```

- **Project** = a unit of delivery. Usually belongs to one contract; may be `internal` (no contract) for Orbit development, pre-sales, R&D, recruitment, training, internal admin. Non-contract work **must** be loggable — if every hour has to map to a client contract, people either mislabel or stop filling it in, and the data becomes worthless.
- **Work item** = the "feature" level the ask calls for: a feature, epic, module, or workstream. Optional depth — small projects can take time directly at project level. Work items may be **linked to Linear issues/projects** (§12) rather than re-typed.
- **Time entry** = person + date + duration + work item (or project) + optional note + `billable` flag (defaulted from the project, overridable with a reason).
- **Leave and holidays are never logged as time entries.** They come from the leave module and are subtracted from capacity automatically (§8). Double-entry is the fastest way to make people hate a timesheet.
- Duration stored as **integer minutes**; entered/displayed as decimal hours (1.5) or h:mm, per user preference. Configurable minimum increment (default 15 min). Rounding happens only at invoice generation, never per entry.

## 3. Roles, seniority, and rate cards — the pricing of effort

### 3.1 Configurable dimensions (not enums)

Following the payment-types decision: **roles and seniorities are admin-managed data**, not hardcoded lists.

- `job_roles`: Engineer, Business Analyst, Project Manager, Data Scientist, QA, Designer, Consultant… — add/rename/deactivate in settings, `active` flag, sort order.
- `seniority_levels`: Junior, Mid, Senior, Principal… — ordered, admin-managed.

Adding "Solutions Architect" or a "Lead" level is a settings change, never a migration.

### 3.2 The rate matrix

A **rate card** is a named, effective-dated matrix of `(role × seniority) → hourly rate` (optionally also a daily rate, for contracts that bill in days — matching the existing `per_day` pricing method).

```
rate_cards        id, name, currency, valid_from, valid_to, is_default, notes
rate_card_entries rate_card_id, job_role_id, seniority_id, hourly_rate, daily_rate
```

Not every cell must be filled — a missing cell simply means that combination has no standard rate on that card, and resolution falls through (§3.4).

### 3.3 Which role/seniority applies to an entry

The rate follows **the role performed on that engagement**, not the person's job title — an engineer running a small delivery as PM should bill as PM.

Resolution for `(person, project, date)`:

1. **Assignment role** — `project_assignments (project_id, profile_id, job_role_id, seniority_id, valid_from, valid_to)`, if one exists.
2. **Person's default role/seniority as of that date** — from `profile_role_history` (effective-dated; a promotion inserts a row, never edits one, exactly like `salary_history`).

Effective dating matters: someone promoted to Senior in March must bill Mid for January's hours. Promotions must not retroactively re-price delivered work.

### 3.4 Which rate applies — resolution chain

First match wins, and the resolved source is recorded on the entry so it's always explainable:

1. **Assignment rate override** — a negotiated per-person rate on this project (rare, but real).
2. **Contract rate card** — `contracts.rate_card_id`, the normal case for T&M work.
3. **Counterparty default rate card** — a client with agreed rates across several contracts.
4. **Global default rate card** — internal standard/list rates.
5. **No match** → the entry is logged but marked `unrated`, appearing in an admin exceptions list. It is **never silently valued at zero** — a zero-value billable hour is an invisible revenue leak.

### 3.5 Snapshotting (non-negotiable)

When a time entry is approved, Orbit **snapshots onto the entry**: resolved `job_role_id`, `seniority_id`, `billing_rate`, `rate_source`, and `cost_rate` (§4). All later valuation reads the snapshot.

Rationale, consistent with pricing snapshots, salary history, and tier config versions: publishing a new rate card next January must not rewrite the value of last year's delivered work, re-open reconciled invoices, or change reported historical margin. Unapproved entries re-resolve live so corrections behave sensibly before lock.

## 4. Cost rates & margin — the payoff for having salaries in Orbit

Billing rate alone gives revenue. Orbit already holds `salary_history` and employer cost, so it can compute the **cost of an hour** and therefore **margin** — the reason to build this at all rather than tracking hours in a spreadsheet.

- `cost_rate = (monthly_gross × (1 + employer_cost_pct) × 12 × overhead_multiplier) ÷ target_annual_hours`
- `target_annual_hours` and `overhead_multiplier` are **settings** (suggested defaults: 1,600 h; 1.0 until someone wants overhead allocation), documented as assumptions on every margin report so nobody mistakes them for precision.
- Contractors: `cost_rate` = agreed hourly/day rate from their contractor record — real cash, not a derived figure.
- Margin per project = Σ(billable value of approved hours) − Σ(cost of all hours on the project, billable or not). Non-billable time on a client project is real cost and must count against it, otherwise "profitable" projects hide rework.

⚠️ **Sensitivity warning for the dev team:** a per-person cost rate is salary data by another name — at 11 people, "cost by person" reveals compensation. Cost rates and any view exposing them are **admin-only**, excluded from every export that isn't explicitly a compensation export, and never surfaced in project views that a wider audience might later be given.

## 5. Entering time — UX requirements

The single biggest determinant of whether timesheets succeed is friction. Requirements, not suggestions:

- **Weekly grid is the primary surface**: rows = project/work item, columns = Mon–Sun (Monday-first), one cell per day, keyboard-navigable, totals per row/column/week. Entering a week should take under two minutes.
- **Copy last week** — one click, brings the row structure without amounts.
- **Recent/pinned items** at the top of the picker; searchable by contract, counterparty, project, Linear identifier.
- **Suggestions, never auto-entries**: Linear issues the person moved this week and calendar meetings (if the §12 read integration is enabled) appear as *proposed rows* to accept or dismiss. Nothing is written on their behalf.
- **Day and week totals are shown without a target.** Since there is no standard daily hours figure (§8), nothing turns red because someone logged 6 hours. Totals are information for the person entering, not a compliance bar. The only completeness signal is *"did you submit the week"* — a binary, not an hours quota.
- **Backdating window**: configurable (default 30 days) for open periods; older requires admin entry.
- **Mobile**: quick-add for a single day only. Nobody fills a grid on a phone.
- **Reminders**: Friday afternoon nudge to the individual; Monday digest to admins listing incomplete submissions for the prior week. Delivered over the existing Slack/email channels.
- **Timers are explicitly out of scope for v1** — they suit hourly consultancies, not a product team; revisit only on real demand.

## 6. Approval, locking, and period close

```
draft ──submit(week)──▶ submitted ──approve──▶ approved ──period close──▶ locked
                            │                      │
                            └──reject(reason)──────┘ (back to draft, employee notified)
```

- **Weekly submission**, whole week at a time. Approval routes to admins (founders) per the existing no-manager-role decision; per-project approvers can come later if delivery leads emerge.
- **Approve in bulk** from a review queue grouped by person or project; partial approval (approve most, reject specific entries) supported with a per-entry reason.
- **Period close (monthly)**: an admin closes a month → all approved entries `locked`, snapshots frozen, no edits. Reopening requires admin action, a mandatory reason, and produces an audit entry plus a warning if any locked entry was already invoiced.
- **Invoiced entries can never be edited**, only corrected by an adjusting entry in an open period — the same discipline as credit notes not mutating original invoices.
- Every transition audit-logged with actor and before/after.

## 7. Contracts, billing modes, and the money path

Time only becomes revenue for some contract types. `contracts.billing_mode` is **set manually per contract** by an admin (default `fixed_price`); Orbit never infers it.

| Mode | Time's role | Revenue effect |
|---|---|---|
| `fixed_price` | Cost & margin tracking only | None — schedule already deterministic |
| `time_and_materials` | **Drives billing** | Approved hours × snapshot rate → billable amount per period |

**Optional cap on T&M** (`hours_cap` and/or `value_cap`, both nullable): as hours accumulate, alerts fire at the configured burn thresholds; past the cap, further hours log as non-billable with a loud alert to the contract owner. A cap is a property of a T&M contract, not a separate billing mode — this keeps the model at two modes instead of four.

**Retainer / prepaid hour blocks are out of scope** — no client uses one today. If that changes it's a new mode plus a balance table, not a retrofit of anything here.

Connections to what already exists:

- **Revenue schedule:** currently deterministic from contract lines. T&M periods are **actuals-driven** — the schedule row for a T&M contract carries an *estimate* (from budget/forecast) that is replaced by approved-hours value when the period closes. Reporting must distinguish `contracted`, `forecast`, and `actual`, or the ARR/committed figures quietly become fiction.
- **Invoices:** a T&M invoice is generated *from* approved hours for a period — one click producing draft lines (grouped per the contract's preference) plus the **charge report** below. Registered through the existing invoice module; `invoice_allocations` link back to the periods. Approved-but-uninvoiced hours = **WIP**, which belongs on the monthly-close widget beside "uninvoiced schedule periods".

### 7.1 Detailed charge report (required deliverable)

Every T&M invoice ships with a detailed charge report, so the backing detail exists the moment a client asks for it.

- **Columns:** date · person · role · seniority · project · work item (feature) · hours · rate · amount · note (conditional, below). Subtotals by work item and by person; grand total reconciling **to the cent** with the invoice net.
- **Generated from locked entries only** and stored as an immutable, versioned `invoice_documents` row alongside the invoice PDF. The exact artifact that was sent must be retrievable years later during a dispute — regeneration produces a *new version*, never overwrites the sent one.
- **Formats:** PDF (client-facing, attached to the invoice) plus XLSX/CSV so the client can analyze it themselves without retyping.
- **Rounding** applied once at invoice level and shown explicitly in the annex, so the client can reconcile line-by-line without a discrepancy.
- **Grouping mode per contract** (`annex_grouping`): chronological detail (default), by work item, by person, or **by role** — the last for clients who shouldn't receive named-individual detail.
- **Notes:** included when `annex_includes_notes` is on (contract-level, default on). The timesheet entry UI displays a visible marker when logging to such a project, so people know their note text will reach the client and write accordingly.
- **Admin review before issuing:** the annex is previewed as part of invoice generation. Anything unsuitable is fixed by **correcting the underlying entry in an open period** — never by editing the annex — so the document always provably matches the timesheet record.
- ⚠️ **Deliberate asymmetry to be aware of:** the annex exposes named individuals and their billing rates to the client, while §10 keeps those same rates hidden from the employees themselves. That is normal T&M practice and not a conflict, but it should be a conscious choice rather than a discovery — `annex_grouping: by_role` is the lever if a given client shouldn't see either.
- **Budgets:** per project and/or work item, in hours and/or value, with burn alerts at configurable thresholds (default 75 / 90 / 100%) to the project owner and admins. For fixed-price work this is the early-warning system that a feature is eating its margin.

## 8. Capacity & utilization — without a standard day

**Decision: StellarBlue has no standard daily hours figure, and Orbit will not invent one.** A global `standard_daily_hours` setting is therefore removed. That has real consequences for what can and cannot be computed, and the design is explicit about both rather than fabricating a denominator.

**Primary metric — billable ratio (always available, zero configuration):**
`billable ratio = billable hours ÷ total logged hours`, per person, team, project, month. It needs no capacity assumption at all, works from the first week of data, and answers the question that actually matters commercially: how much of what we do is sellable.

**Secondary metric — capacity utilization (optional, per person):**
`billable ÷ available` is computed **only** for people who have an optional `contracted_weekly_hours` value on their profile — sourced from their employment contract, which under Greek law states weekly hours. Where it is unset, the metric renders **"—"**, never a guessed number.
`available_hours = contracted_weekly_hours prorated across their work_schedule days − approved leave − public holidays.`
This keeps part-timers correct automatically and lets the metric switch on per person, whenever someone chooses to fill the field in — no big-bang configuration decision.

**Forward capacity** degrades gracefully to **person-days** rather than hours when contracted hours aren't set: "three people have eight free days in September" still answers *can we take this project* without pretending to hour-level precision.

**Not built:** allocation planning, Gantt resourcing, scenario modelling. Separate module if the need ever appears.

## 9. Contractors (μπλοκάκι)

Contractors are in scope for timesheets even though they're out of scope for leave/remote:

- They log time like everyone else; their hours are usually billable and their `cost_rate` is their real agreed rate.
- **Their timesheet validates their invoice.** When a contractor's AP invoice arrives, Orbit compares it against approved hours for the period and flags mismatches — a direct, concrete tie-in to the invoice module and a genuine control.
- Capacity/utilization metrics segment contractors separately from employees (their availability isn't governed by `work_schedule` or leave).

## 10. Permissions, privacy, and Greek context

- **Employees see hours, never money.** No billing rates, no cost rates, no margin, no project value — anywhere in the employee-facing UI. They log effort; commercial interpretation is admin-only. This is both a privacy and a culture requirement.
- Employees see their own entries and their own history; nobody sees a colleague's entries.
- Admins see everything. Financial views follow the existing two-gate pattern (server-side role check + RLS default-deny), and the RLS test suite extends to every new table.
- **GDPR:** time tracking is employee personal data processed for a new purpose — add it to the record of processing activities, document retention (align with the contract/invoice retention already defined), and be explicit internally that data is used for project costing and capacity, **not** individual performance monitoring. Say it in the rollout, and don't build features that contradict it.
- **ΕΡΓΑΝΗ anomaly flag (see §1):** since there is no standard-day baseline to compare against, anomalies use **absolute configurable thresholds** — hours on a day above a limit (default 10), any hours on an approved leave day or public holiday, and a week total above a limit (default 55). These are data-quality signals raised to an admin: they never block the entry, never constitute an overtime claim, and never produce any ΕΡΓΑΝΗ-facing side effect.

## 11. Reporting

- **Project profitability**: billable value vs. cost vs. budget; margin € and %.
- **Contract profitability**: rolled up across projects, alongside the contract's own committed value — the answer to "is this client actually good business", which pairs naturally with the counterparty tier model.
- **Effort by feature/work item** — the estimation feedback loop: what did that module actually cost to build? Directly useful for pricing future Atlas/EMS work.
- **Utilization** per person/team/month; **realization** (invoiced value ÷ logged billable value) exposing write-offs.
- **WIP** (approved, unbilled) and **unrated entries** as operational exception lists.
- Timesheet completeness per person/week — a compliance list, not a leaderboard.

## 12. Integrations

- **Linear (read-only, high value):** the team already lives there. Sync Linear projects and issues as selectable work items (identifier + title + state), refreshed periodically; store `linear_issue_id` on the work item. Time is logged in Orbit, never pushed back into Linear. Optional: map a Linear project → an Orbit project once, so new issues attach automatically.
- **Calendar (optional, only if the Outlook read integration ships):** meetings as *suggested* rows. Suggestions only — never auto-logged.
- **Slack:** the Friday reminder and a `/timesheet` quick-add shortcut, reusing the connection already made mandatory for every employee.

## 13. Schema sketch

```
job_roles              id, name, active, sort_order
seniority_levels       id, name, rank, active
profile_role_history   id, profile_id, job_role_id, seniority_id, valid_from, valid_to

rate_cards             id, name, currency, valid_from, valid_to, is_default, notes
rate_card_entries      id, rate_card_id, job_role_id, seniority_id, hourly_rate, daily_rate

projects               id, contract_id (nullable → internal), counterparty_id (derived),
                       name, code, status, owner_profile_id, default_billable,
                       budget_hours, budget_value, starts_on, ends_on
work_items             id, project_id, name, kind (feature|epic|task|workstream),
                       linear_issue_id (nullable), status, budget_hours
project_assignments    id, project_id, profile_id, job_role_id, seniority_id,
                       rate_override, valid_from, valid_to

time_entries           id, profile_id, work_date, minutes, project_id, work_item_id,
                       note, billable, status (draft|submitted|approved|rejected|locked),
                       -- snapshots, set at approval --
                       job_role_id, seniority_id, billing_rate, rate_source,
                       cost_rate, currency,
                       submitted_at, decided_by, decided_at, locked_at,
                       invoice_id (nullable), anomaly_flags jsonb
timesheet_periods      id, period (YYYY-MM), status (open|closed), closed_by, closed_at
profiles               + contracted_weekly_hours (nullable — enables capacity
                         utilization for that person only; "—" when unset)
contracts              + billing_mode (fixed_price|time_and_materials, set manually),
                       rate_card_id, hours_cap (nullable), value_cap (nullable),
                       annex_grouping (chronological|work_item|person|role),
                       annex_includes_notes bool DEFAULT true
counterparties         + default_rate_card_id
invoice_documents      (existing) + doc_type 'charge_report', version — the annex
                         artifact, immutable once issued
settings               + target_annual_hours, overhead_multiplier, min_increment_minutes,
                       backdating_window_days,
                       anomaly_day_hours (default 10), anomaly_week_hours (default 55)
```

Indexes that matter: `(profile_id, work_date)`, `(project_id, work_date)`, `(status)` — everything else is small-N.

## 14. Anti-patterns explicitly rejected

1. Requiring every hour to map to a client contract → mislabeled data.
2. Letting a rate-card change re-value historical work → broken reconciliation, unreproducible margin.
3. Showing employees their billing or cost rate → privacy and culture damage, zero benefit.
4. Enforcing exactly 8.0 h/day, or inventing a standard day where the company doesn't have one, purely to make a utilization formula work → fabricated numbers and a metric nobody trusts. Report billable ratio instead, and leave capacity utilization blank until someone supplies a real contracted-hours figure.
5. Valuing an unmatched rate as €0 → silent revenue leak. Flag it.
6. Rebuilding Linear inside Orbit → maintenance cost, immediate abandonment.
7. Treating timesheets as an attendance or overtime record → the ΕΡΓΑΝΗ problem in §1.
8. Per-entry rounding to billable increments → drift across a month; round once, at invoicing.

## 15. Acceptance criteria

1. An engineer logs a 5-day week across two projects in under two minutes using the grid; leave days are pre-marked and not enterable.
2. A person promoted Mid→Senior on 1 March: February entries approve at the Mid rate, March entries at Senior — automatically, with the rate source visible on each.
3. An engineer assigned as PM on project X bills the PM rate there and the Engineer rate elsewhere, same week.
4. Publishing a new rate card changes no approved entry's value, no closed-period report, and no issued invoice.
5. A billable entry with no matching rate-card cell is accepted, marked `unrated`, and appears in the admin exceptions list — never valued at zero.
6. Approved T&M hours for a month generate a draft invoice with an hours annex; the entries become `invoiced` and are no longer editable; the amount matches Σ(minutes × snapshot rate) to the cent with rounding applied once.
7. Project margin equals billable value minus the cost of **all** hours logged to it (including non-billable), using cost rates derived from salary history at each entry's date.
8. An employee session exposes no billing rate, cost rate, margin, budget value, or colleague entry by any path (RLS suite extended).
9. Closing March locks its entries; an admin reopen requires a reason, is audited, and warns that invoiced entries are affected.
10. Logging 11 hours on a day, or any hours on an approved leave day, raises an anomaly flag to admins without blocking the entry and without any ΕΡΓΑΝΗ-facing side effect.
11. **Utilization without a standard day:** billable ratio is reported for every person from their first logged week with no configuration; capacity utilization shows "—" for anyone without `contracted_weekly_hours`, and for a part-timer who has it, uses their own figure prorated across their `work_schedule` — never a 40-hour or 8-hour assumption anywhere in the codebase.
12. **Charge report:** generating a T&M invoice produces a PDF + XLSX annex whose grand total reconciles to the invoice net to the cent; the annex is stored as an immutable versioned document; regenerating after a correction creates version 2 while version 1 (the one sent) remains retrievable.
13. A contract set to `annex_grouping: by_role` produces an annex with no individual names anywhere; one set to `annex_includes_notes: false` contains no note text, and the timesheet UI shows the client-visible marker only for projects where notes are on.
14. Logging past a T&M contract's `hours_cap` succeeds, marks the entries non-billable, and alerts the contract owner — no silent free work, no blocked entry.

## 16. Build order

1. **Foundations:** roles, seniorities, `profile_role_history`, rate cards + matrix editor in settings. (Pure config; no behavior yet.)
2. **Projects & work items** + Linear read sync + assignments.
3. **Entry grid + submission** — get people logging before any money logic exists; a week of real data is the best spec for everything after.
4. **Approval, resolution chain, snapshots, period close.**
5. **Cost rates & margin reporting** (needs salary integration — highest sensitivity, so land it after the RLS patterns are exercised).
6. **T&M billing path**: budgets, WIP, invoice generation from approved hours.
7. **Utilization & capacity views.**

Steps 1–3 are shippable alone and already useful (effort by feature, completeness). Everything financial rides on top.

## 17. Decisions & remaining questions

**Resolved:**

| Question | Decision | Consequence |
|---|---|---|
| Standard daily hours | **None exists** — Orbit will not invent one | Global setting removed; billable ratio becomes the primary metric; capacity utilization is optional and per-person via `contracted_weekly_hours`; entry grid shows totals with no target and no deficit warnings |
| Billing granularity | **Detailed charge report** required with every T&M invoice | §7.1: immutable versioned PDF + XLSX annex, per-contract grouping and note-visibility flags, admin preview before issue |
| T&M classification | Set **manually** per contract | `billing_mode` is an admin field defaulting to `fixed_price`; no inference logic, no migration heuristics |
| PhD / research structure | Not needed yet | Covered by generic internal projects; no dedicated hierarchy |
| Retainers | No client uses one | `retainer_hours` dropped entirely; caps become optional fields on T&M, keeping the model at two billing modes |

**Remaining:**

1. **`target_annual_hours` for cost rates** (suggested 1,600): still needed, and now the *only* hours assumption left in the system — it scales every margin figure, so it should be a deliberate number with the accountant rather than a default nobody chose. Note it is a costing denominator, unrelated to any working-time expectation.
2. **Minimum increment** (default 15 min) and **backdating window** (default 30 days): confirm, or accept the defaults.
3. **Charge report branding:** should the annex use StellarBlue letterhead/styling matching invoices, or plain tabular? Affects whether the PDF generator needs the document-template work.
4. **Anomaly thresholds:** 10 h/day and 55 h/week are placeholders — set numbers that would genuinely warrant a look, since they are the only automated "is this data sane" check.
