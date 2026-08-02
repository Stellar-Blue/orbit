# Orbit — Invoice Tracking Requirements (via Contracts)

**Status:** Draft v1.0
**Purpose:** two jobs, one module. (1) **The invoice archive** — every invoice StellarBlue issues or receives lives in one place, findable, permanent: the common truth. (2) **The financial signal** — invoices reconciled against contracted revenue schedules turn Orbit from "what we agreed" into "what we billed, what we were billed, what got paid" — the basis for budgeting, cashflow, and variance analysis.
**Inherits:** contracts with `direction (revenue|cost)`, counterparties, the pricing engine's `contract_revenue_schedule`, private Storage + signed URLs, admin-only financial RLS, audit triggers.

---

## 1. Position in the system — what this module is NOT

Same discipline as payroll and ΕΡΓΑΝΗ:

- **Orbit does not issue invoices.** Greek invoices are legally issued through the accounting software/provider and transmitted to ΑΑΔΕ **myDATA**, receiving a **MARK** (Μοναδικός Αριθμός Καταχώρησης). Orbit registers the *result* — PDF + metadata + MARK — it is never the invoicing engine. (Future: myDATA has a REST API; a read-only reconciliation against the myDATA ledger is the natural sequel, exactly parallel to the ΕΡΓΑΝΗ design. Out of scope now, but the schema keeps `mark` so it costs nothing later.)
- **Orbit is not the accounting ledger.** No double-entry, no VAT returns, no Ε3 mapping. The accountant's software remains authoritative for accounting; Orbit is authoritative for *contract-linked financial operations* — completeness, timing, collection.
- Bank reconciliation (matching statements to invoices) is out of v1; payment status is set manually or via CSV assist later.

## 2. Invoice model

### 2.1 Directions — one table, two flows

| | **Issued (AR)** — `direction: outgoing` | **Received (AP)** — `direction: incoming` |
|---|---|---|
| Source | Our accountant/invoicing software | Supplier sends PDF |
| Anchor | Client contract (revenue) | Supplier contract (cost) |
| Money question | Did they pay us? When? | When must we pay? Did we? |
| Analysis | Billing completeness, DSO, aging | Committed spend vs actual, due-date planning |

### 2.2 Core fields

- **Identity:** direction, counterparty (required), contract (strongly encouraged, nullable — see §2.4), internal reference, **invoice number** (the printed one), invoice type (`invoice | credit_note | proforma | debit_note`), MARK (nullable, outgoing).
- **Dates:** issue date, due date (prefilled from the contract's payment terms — new contract field `payment_terms_days`, e.g. net 30), period covered (`period_from` / `period_to` — which service months this bills; essential for schedule matching).
- **Amounts:** currency, net, VAT amount + rate breakdown (24% / reverse-charge / exempt — reuse the contract's VAT treatment as default), gross, and for non-EUR an `fx_rate` + EUR-equivalent snapshot at issue date so reporting sums in one currency.
- **Status:** see lifecycle (§3).
- **File:** PDF (or image) in a private bucket — an invoice row *should* have a file; a file-less row is flagged `missing_document`, allowed (metadata can arrive before the PDF) but visibly incomplete. Original filename preserved; stored under a deterministic path (`invoices/{yyyy}/{direction}/{counterparty}/{number}.pdf`).
- **Dedup guard:** `UNIQUE (counterparty_id, direction, invoice_number)` — the classic AP failure is paying the same supplier invoice twice because it was uploaded twice.

### 2.3 Credit notes are first-class

A credit note is an invoice row with negative effect, `type = credit_note`, and a required link to the original invoice (`credits_invoice_id`). Reporting always nets them; the original invoice's "effective amount" displays net of its credit notes. Never model credits by editing the original's amounts.

### 2.4 Contract link — encouraged, not forced

Reality includes invoices with no contract: a one-off supplier purchase, a conference sponsorship. Rule: **counterparty always required; contract optional.** Contract-less invoices are permitted but appear in an admin "unlinked invoices" list — the goal is that the list trends to zero for recurring items, while genuinely one-off costs get a `category` tag instead (a small configurable list: infrastructure, travel, marketing, office, other) so budgeting still buckets them.

## 3. Lifecycle

```
[expected]* → registered → sent/received → partially_paid → paid
                   │                             │
                   ├──▶ disputed ──▶ resolved ───┘
                   └──▶ cancelled / fully credited
overdue = derived flag (due_date < today AND not paid), never a stored state
```

- `expected` is virtual — it's a revenue-schedule row with no matching invoice yet (§4), not an invoice record.
- **Payments** are child rows (`invoice_payments: date, amount, bank_reference, note`), enabling partial payment naturally; status derives from Σ payments vs gross. Payment recording is two clicks from the invoice row ("mark paid today, full amount" fast path).
- Overdue is computed, not stored — stored "overdue" states rot the moment a payment lands.
- Every status-affecting action is audit-logged (existing triggers, extended to the new tables).

## 4. Expected vs. actual — the feature that justifies the module

The pricing engine already generates `contract_revenue_schedule`: what *should* be invoiced, per contract, per month, on both directions. Invoices are matched against it:

- **Allocation model:** `invoice_allocations (invoice_id, contract_id, period, amount)` — an invoice may cover several schedule periods (quarterly billing = 3 periods) and, rarely, one period may receive several invoices (usage true-ups). Allocations default automatically from the invoice's `period_from/to` + contract, editable when reality is messier.
- **Per-contract billing view:** timeline of schedule periods, each colored: invoiced-and-paid / invoiced-unpaid / **uninvoiced-past** (the money being forgotten) / upcoming. The AR headline number: "€X of contracted revenue past-period and uninvoiced." The AP mirror: "supplier billed €Y vs €Z contracted" — over-billing surfaces immediately.
- **Variance tolerance:** allocation ≠ schedule amount within ±2% (configurable) shows as matched-with-variance; beyond it, flagged. Indexation, FX, and rounding make exact-match-only useless.
- **Monthly close ritual (dashboard widget):** "Month M: n schedule periods uninvoiced (AR), n invoices unpaid past due (AR), n supplier invoices due in 14 days (AP), n unlinked uploads." Five minutes, once a month, and the books stay honest — same operating philosophy as the ΕΡΓΑΝΗ and Attio drift widgets.

## 5. Storage & findability (the "common truth" job)

- **Global invoice register:** one dense, filterable table across everything — direction, counterparty, contract, status, period, amount range, category, free-text on number/notes. This page *is* the answer to "where's that invoice"; if a filter combination takes more than seconds to express, the register has failed.
- Bulk upload: drop N PDFs into an **inbox**; each becomes a stub row (`needs_metadata`) worked through a queue. *(Fast-follow, not v1: AI-assisted field extraction from the PDF via the Claude API — number, dates, amounts, counterparty guess — with human confirmation. The inbox flow is designed so extraction slots in without rework.)*
- Files are immutable once attached — replacing a PDF versions it (`invoice_documents` keeps history), never overwrites. Signed URLs only, short-lived, server-side authorization — identical to contract documents.
- **Accountant package** (existing monthly export) extends to include the period's invoice register (CSV) + a zip of the PDFs, both directions. This likely replaces an email-attachment ritual with one click.
- Retention: invoices are tax records — Greek retention obligations (typically 5+ years, confirm exact with the accountant) mean **no deletion path at all** in the UI; cancellation is a status.

## 6. Budgeting & analysis views

All computed from invoices + allocations + schedule — no new data entry:

- **Cashflow projection:** next 6–12 months of expected inflows (schedule AR + issued-unpaid by due date) vs outflows (schedule AP + received-unpaid by due date) — alongside the payroll burn from the compensation module, this completes Orbit's company-level cash picture.
- **AR aging:** buckets (current / 1–30 / 31–60 / 61–90 / 90+) by counterparty; DSO trend.
- **AP calendar:** what's due when, 30-day lookahead, feeding the daily digest.
- **Contracted vs invoiced vs collected** per contract, counterparty, and month — the three-line chart that answers "is revenue real."
- **Supplier budget vs actual:** committed cost (schedule) vs billed vs paid, per supplier and category — including the contract-less `category`-tagged invoices, so the full cost base is visible, not only the contracted part.
- Counterparty page (from the Attio guide) gains an Invoices tab and its rollups can extend with `orbit_unpaid_balance` pushed to Attio (add to the attribute list pending sales confirmation).

## 7. Notifications

| Event | Recipient |
|---|---|
| AR invoice overdue (crossed due date) | Admins — daily digest, escalating at 30/60 days |
| AP invoice due in 14 / 7 / 1 days | Admins — digest |
| Schedule period ended with no invoice (AR), 15 days grace | Admins — the "forgot to bill" alert |
| Inbox stub older than 7 days without metadata | Admins |
| Credit note registered against a paid invoice | Admins — refund/settlement needs a decision |

## 8. Permissions

Invoices are financial data: **admin-only**, both directions, same two-gate pattern as compensation (server-side reads with role check + RLS default-deny). Employees never see the module. If a future `finance_viewer` role appears for the accountant, it maps naturally here — not built now.

## 9. Schema sketch

```
invoices             id, direction, counterparty_id, contract_id (nullable),
                     type (invoice|credit_note|proforma|debit_note),
                     credits_invoice_id (nullable, required when credit_note),
                     invoice_number, mark, internal_ref, category (nullable),
                     issue_date, due_date, period_from, period_to,
                     currency, fx_rate, net, vat_amount, vat_rate, gross,
                     gross_eur, status, missing_document bool, notes,
                     created_by, created_at
                     UNIQUE (counterparty_id, direction, invoice_number)
invoice_documents    id, invoice_id, storage_path, version, uploaded_by, uploaded_at
invoice_payments     id, invoice_id, paid_on, amount, bank_reference, note
invoice_allocations  id, invoice_id, contract_id, period (YYYY-MM), amount
contracts            + payment_terms_days
```

## 10. Acceptance criteria

1. Uploading a supplier PDF, filling metadata, and linking it to the supplier contract takes under a minute; the contract's billing timeline immediately shows the period as invoiced.
2. Re-uploading the same supplier invoice number hits the dedup guard with a link to the existing row.
3. A quarterly AR invoice auto-allocates across its three schedule periods; the contract view shows all three matched.
4. A schedule period 15+ days past with no allocation appears in the monthly-close widget and the digest — the "forgot to bill Q3 maintenance" case is structurally impossible to miss.
5. A partial payment moves status to `partially_paid`; aging reflects the open remainder; a credit note nets the original everywhere without touching its stored amounts.
6. The register answers "all unpaid ΔΕΠΑ invoices from 2026" in one filter interaction; the accountant package for a month contains the register CSV + all PDFs in one download.
7. An employee session can reach no invoice row, file, or aggregate by any path (RLS test suite extended).
8. Cashflow view for next quarter = schedule expectations + open invoices by due date, and visibly shifts when a due date or payment is edited.

## 11. Open questions

1. **Payment terms defaults:** net-30 as the global default with per-contract override — confirm typical terms on both sides.
2. **Proforma handling:** track proformas at all, or only final invoices? (Recommend: allow the type, exclude from all financial aggregates.)
3. **FX source** for non-EUR invoices: manual entry per invoice (v1 recommendation) vs ECB daily rate lookup.
4. **Category list** for contract-less costs: agree the initial set with whoever does budgeting.
5. **myDATA read reconciliation** (validate the register against ΑΑΔΕ's ledger by MARK): confirm with the accountant what API access their software offers — schema is ready, build is deferred.
6. **AI extraction fast-follow:** priority call after v1 usage shows how much manual metadata entry actually hurts.
