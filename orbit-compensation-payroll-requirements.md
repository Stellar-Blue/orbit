# Orbit — Compensation & Payroll, Version 1 (simple)

**Goal:** know what every person costs, record what was actually paid, and hand the accountant clean data. Orbit is a **ledger, not a payroll engine** — the accountant computes gross-to-net, ΕΦΚΑ, and ΦΜΥ; Orbit records the results.

## The whole model in one paragraph

Each person has a **salary record** (what they're contracted to earn, with history). Each month, Orbit **generates a draft** of expected payments from those records, an admin adjusts and **marks them paid**, and that becomes the permanent **payment ledger**. Every employee can see **their own** salary history and payments (read-only); admins see and manage everything. From the ledger and salary records, Orbit reports monthly cost, burn forecast, and per-person history, and exports a monthly package for the accountant. That's it.

## 1. Salary records (what someone *should* earn)

- One row per person per period of validity: gross monthly amount (or monthly fee / day rate for contractors), employer cost (see below), valid-from date, note ("hired", "annual review 2027").
- **Never edit in place.** A raise = close the old row, add a new one. Salary history falls out for free, and past months stay reconstructible.
- **Employer cost:** entered **by hand as an absolute amount** (`employer_cost_amount`) — the admin records the gross and the full monthly company cost, and Orbit stores the difference. A single multiplier is not used because employer contributions and VAT treatment differ per person. Orbit never computes contributions — it just stores the number it was given. Fully-loaded monthly cost = gross + employer cost.
- Contractors: same table, `basis = fee` instead of `salary`; company cost = the fee (no employer burden).
- The legacy `employer_cost_multiplier` / `employer_cost_pct` columns remain only as a read fallback for historical rows that predate the absolute amount.

## 2. Payment types (a table, not code)

A small admin-editable list: **name, recurring-monthly? (y/n), default month (for the Greek statutory items), applies to (employees / contractors / both)**.

Seeded with: Salary, Δώρο Χριστουγέννων (Dec), Δώρο Πάσχα (Apr/May), Επίδομα αδείας (summer), Bonus, Overtime, Contractor fee, Other. Admins can add types anytime without a developer.

## 3. The monthly workflow (the core feature)

1. **Generate draft month:** one click creates a planned payment row for every active person — Salary/Fee rows from current salary records, plus any statutory type whose default month matches (December auto-includes Δώρο Χριστουγέννων rows). Amounts are prefills, always editable.
2. **Adjust:** fix amounts against the accountant's payroll run, add one-offs (bonus, overtime), delete what doesn't apply. Fields per row: person, type, gross, net, employer cost, payment date, bank reference, note.
3. **Mark paid:** per row or "mark all paid" for the month. Paid rows lock (edits admin-only, audit-logged).
4. **Attach the receipt:** each payment row carries a **receipt file** (PDF/image — the bank transfer confirmation or payslip). Upload happens at mark-paid or any time after; bulk upload for the month is supported (drop N files, match to rows by person, confirm). A paid row without a receipt shows a "missing receipt" badge and appears in an admin checklist — missing files should be visible, not forgotten.

Guard: one row per person + type + month (no accidental double Δώρο). Target: a normal month takes under 5 minutes.

## 4. Reporting

- **This month / any month:** total company cost, split by team and by employee vs contractor *(admin)*.
- **Burn forecast:** next 12 months projected from current salary records, statutory months included — so December's real cost doesn't surprise anyone *(admin)*.
- **Per person (admin):** full payment history and salary history on their profile tab.
- **My compensation (employee):** each person gets a read-only "My payments" page — their own salary history (gross + effective dates) and their own payment rows (type, gross, net, date, reference), filterable by year, **with a download link for each payment's receipt**. Only **paid** rows are shown; draft/planned rows stay admin-only until marked paid, so nobody sees an unadjusted prefill and takes it as a promise. No employer-cost multiplier or company totals — those reveal company economics, not personal pay.
- **Planned vs paid (admin):** any month, see what's still unpaid.

## 5. Accountant export

One button, per month: an XLSX with all payment rows (person, ΑΦΜ, type, gross, net, employer cost, date, reference), with an optional **"include receipts"** toggle that produces a ZIP of the month's receipt files named `{ΑΦΜ}_{type}_{YYYY-MM}.pdf` alongside the XLSX. This replaces accountant access to the app. Nothing else from `profile_sensitive` is ever exported.

## 6. Security (non-negotiable, already Orbit policy)

- Access model: **admins see everything; every employee sees only their own rows, read-only.** No employee can ever read another person's salary or payments — not a colleague's, not an aggregate that would reveal one.
- RLS policies: `admin` → all rows; `employee` → `profile_id = own` **and** `status = paid` on payments, own rows on salary records. Writes are admin-only everywhere.
- Compensation queries still run **server-side only**, with RLS as the second gate — the self-view pages go through the same server functions, scoped to the signed-in user.
- Every write to salary records and payments is audit-logged (existing triggers).
- **Receipts** live in a **private** storage bucket (Orbit's existing pattern): access only via short-lived signed URLs generated server-side after the same authorization check as the row itself — admin, or the payment's own employee. Files are keyed by payment id, never by guessable names; replacing a receipt keeps the old file (audit) and marks the new one current.

## 7. Explicitly NOT in v1

Gross-to-net calculation · ΕΦΚΑ/ΦΜΥ rules · payslip generation · ΑΠΔ or any government filing · bank file (SEPA) generation · expense claims · multi-currency. The accountant owns all of that; Orbit records outcomes.

## 8. Tests (8)

1. Raise on 1 March: February reports use the old gross, March uses the new; history shows both rows.
2. Generate December draft → every employee gets Salary + Δώρο Χριστουγέννων rows; contractors get only Fee rows.
3. Duplicate guard: second Salary row for the same person/month is rejected.
4. Burn forecast for a €2,000-gross, ×1.24 employee shows €2,480 in normal months and the statutory extras in their months.
5. RLS: employee A queries salary and payment tables → gets **only their own rows**; a query for employee B's rows (or with no filter) returns nothing of B's; draft/planned payment rows are invisible to A even when they're A's own; all employee write attempts are rejected.
6. Accountant export for a month matches the ledger exactly and contains no fields beyond §5's list.
7. "My payments" page for employee A shows exactly the rows admin sees on A's profile tab filtered to `paid` — the two views can never disagree.
8. Receipts: employee A downloads their own receipt via a signed URL; a request for employee B's receipt (or a direct storage URL guess) is denied; a paid row without a receipt appears on the missing-receipts checklist; the "include receipts" export ZIP contains one correctly named file per receipted row.
