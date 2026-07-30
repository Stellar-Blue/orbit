# StellarBlue Internal Tool (Orbit) — Implementation Plan

Building an internal administrative web application for StellarBlue ("Orbit") to manage employees, compensation ledgers, leave tracking (including admin-declared mandatory leaves), remote work logs, and client/supplier contracts — with ΕΡΓΑΝΗ compliance reconciliation schema-ready in v1 and its UI deferred to post-v1.

The application is engineered for speed of operation, aesthetic excellence (StellarBlue cosmic/deep indigo brand theme, glassmorphism, responsive keyboard navigation), and airtight security around sensitive salary data via Supabase Row-Level Security (RLS) and server-side authorization checks.

## User Review Required

> [!IMPORTANT]
> **Authentication & Local Dev Mode**: Microsoft Entra ID OIDC via Supabase Auth is the target production identity provider. While Azure/Supabase credentials are being provisioned, local development uses a **build-time-guarded dev auth mode** with pre-seeded sample data so the complete UI can be evaluated immediately. Safety constraints on this mode (non-negotiable):
> - The flag is a **server-side** env var (`DEV_AUTH_MODE=true`), never `NEXT_PUBLIC_*` — an auth bypass must not be toggleable from anything that ships to the client bundle.
> - The bypass code path **hard-fails at startup** if `VERCEL_ENV === 'production'` or `NODE_ENV === 'production'`, regardless of the flag's value. A leaked env var must not be able to open the production app.
> - Dev mode signs in as seeded *fake* users via local Supabase — it exercises the same RLS policies and role checks as production, so what you evaluate locally is the real authorization behavior, not a mock that skips it.
> - Entra ID integration includes the requirements' mapping flow: tenant (`tid`) claim validation, auto-link to a pre-provisioned profile by work email, and **rejection of unknown users** (no auto-created profiles).

> [!CAUTION]
> **Compensation Data Security**: As mandated in the requirements, compensation tables (`salary_history`, `payments`) and sensitive PII (`profile_sensitive`) will have strict default-deny RLS policies. They will **never** be accessed via client-side anon queries; all compensation data fetching occurs via Next.js Server Actions using the Supabase Service Role key after verifying an explicit `admin` role in `user_roles`.

## Confirmed Decisions (2026-07-30)

- **Initial data**: no seeded entitlements or employee data — everything (profiles, entitlements, salary history, contracts) is entered manually through the UI once the app is running. Consequence: every module must handle the "not yet configured" state gracefully — in particular, an employee with no entitlement row for the current year sees "entitlement not set — contact an admin" instead of a zero balance, and the admin dashboard lists employees with missing entitlements at the start of each year.
- **Mandatory leave policy**: (a) negative balances are **allowed and flagged**, never blocked; (b) **part-time employees are included** in fan-out, with working-day deduction respecting their individual schedule. Consequence: `profiles` gains a `work_schedule` field (set of working weekdays, default Mon–Fri) used by *all* working-day calculations — regular leave, mandatory fan-out, and remote quotas — so part-time is handled once, centrally.
- **ΕΡΓΑΝΗ reconciliation**: **deferred**. The `ergani_*` tables and the `ergani_status` badges on leave/remote records ship now (cheap, and the drift-visibility widget still works); the upload parser, matching engine, and exceptions UI are built later, gated on obtaining a real sample export from the portal or the accountant's payroll software.

## Open Questions

1. **Credentials Configuration**: We will create `.env.local` and `config/credentials.template.md` for your Supabase URL, Anon Key, Service Role Key, Entra ID Client ID/Secret, and Resend API Key. Would you like us to proceed with applying local Docker Supabase migrations first, or will you supply a remote Vercel/Supabase dev project immediately after approval?

## Proposed Changes

### Foundation & Configuration (Phase 0)

#### [NEW] [package.json](file:///Users/zafeirisbampos/Projects/orbit/package.json)
- Initialize Next.js 15 App Router with TypeScript, Tailwind CSS, shadcn/ui, Lucide icons, Framer Motion for micro-animations, TanStack Table for dense keyboard-friendly data tables, and `date-fns` for date arithmetic only — **the `public_holidays` table is the single source of truth for holidays**; nothing computes Orthodox Easter in application code, avoiding two sources that can disagree.
- All leave/remote/holiday columns are Postgres `date` (never `timestamptz`) and date math is done on calendar dates — eliminates the classic off-by-one where a leave day shifts across midnight UTC for a UTC+2/+3 team.
- Add dependencies for file parsing and export: `xlsx`, `papaparse`, `@supabase/ssr`, `@supabase/supabase-js`.

#### [NEW] [credentials.example.env](file:///Users/zafeirisbampos/Projects/orbit/config/credentials.example.env)
- Documented template for all required Supabase, Vercel, Entra ID OIDC, Resend, and Cron credentials.

#### [NEW] [0001_initial_schema.sql](file:///Users/zafeirisbampos/Projects/orbit/supabase/migrations/0001_initial_schema.sql)
- Full SQL schema for all 7 modules:
  - **People & Roles**: `profiles` (including `work_schedule` — set of working weekdays, default Mon–Fri, the single input for all working-day calculations across leave, mandatory fan-out, and remote quotas), `profile_sensitive`, `user_roles`, `teams`.
  - **Compensation**: `payment_types` (dynamic, admin-managed — see below), `salary_history`, `payments`.
    - **Payment types are data, not schema.** No hardcoded enum for `dwro_xristougennwn` / `dwro_pasxa` / `epidoma_adeias`. Instead a `payment_types` table: `id, code, name_el, name_en, is_statutory, is_recurring_monthly, default_period_month, default_multiplier (nullable), applies_to (employment_type[]), active, sort_order`. `payments.payment_type_id` is an FK. The Greek statutory items ship as *seed rows* (e.g. Δώρο Χριστουγέννων: `default_period_month = 12`, `default_multiplier = 1.0`; Δώρο Πάσχα: `0.5`; Επίδομα αδείας: `0.5`), fully editable, and admins can add new types (one-off allowance, referral bonus, …) without a migration. The bulk "Generate Draft Month" reads this table: monthly recurring types always, statutory types when the period matches their default month — the multiplier is a *prefill*, never an enforced calculation (the real amounts come from the accountant).
    - Uniqueness guard: `UNIQUE (profile_id, period, payment_type_id)` (partial, excluding cancelled rows) so a month can't silently double-pay a type.
  - **Leave**: `leave_types`, `leave_entitlements`, `leave_requests` (with stored calculated `working_days` and an `origin` column: `employee_request | mandatory | admin_entry`), `mandatory_leaves` (see below), `public_holidays` (with national and Thessaloniki scope).
    - **Mandatory leaves (new module):** admin-declared company-wide leave (e.g. Christmas closure, mandatory August week) applied to every active non-contractor employee — full-time **and part-time (confirmed)**, with deductions computed against each person's `work_schedule` — **counting against each person's regular annual balance**. Table: `mandatory_leaves (id, name, leave_type_id, start_date, end_date, status, created_by, note)`. On publish, the system fans out one `approved` `leave_requests` row per eligible employee with `origin = 'mandatory'` and `mandatory_leave_id` set — so balances, the team calendar, ΕΡΓΑΝΗ tracking, and reporting all flow through the existing leave machinery with no special-casing downstream. Fan-out rules:
      - **Overlap:** if an employee already has approved/pending leave covering part of the range, only the uncovered working days are deducted (generated request trimmed; fully covered → no row).
      - **Insufficient balance (confirmed policy):** deduction still applies (it's mandatory); balance goes negative and the case is flagged in an admin exceptions list — never blocked.
      - **New hires:** fan-out is idempotent (keyed on `mandatory_leave_id + profile_id`); an employee activated after publish but before the range gets their row generated at activation.
      - **Cancellation/edit:** cancelling or re-dating a mandatory leave cascades to its generated rows and restores balances; generated rows are not individually cancellable by employees.
      - Generated rows are read-only for employees, shown in their history with a "company-wide" badge, and carry `ergani_status` like any other leave (they still need Ε11 filing).
  - **Remote**: `remote_days` (requiring location when `remote_abroad`), `remote_patterns`, `remote_policies`.
  - **Contracts**: `counterparties`, `contacts`, `contracts` (featuring PostgreSQL generated indexed column `notice_deadline = ends_on - notice_period_days`), `contract_clauses`, `contract_documents`.
  - **ΕΡΓΑΝΗ**: `ergani_imports`, `ergani_records`, `ergani_exceptions`.
  - **Audit & Audit Triggers**: `audit_log`, `notifications`, plus automated Postgres trigger functions capturing `BEFORE/AFTER JSONB` snapshots on any mutations to salary, payments, payment types, leave decisions, mandatory leaves, and contracts.
- Explicit RLS policies enforcing admin-only restrictions on sensitive tables and role-scoped reads on team calendars and directory records.

#### [NEW] [0002_seed_data.sql](file:///Users/zafeirisbampos/Projects/orbit/supabase/migrations/0002_seed_data.sql)
- **Reference data (ships to production):** 2026/2027 Greek public holidays (Orthodox Easter movable feasts and Thessaloniki local holiday Oct 26 — plus a documented yearly process for seeding the next year), leave type definitions, and the statutory `payment_types` rows (Δώρο Χριστουγέννων, Δώρο Πάσχα, Επίδομα αδείας, salary, bonus, overtime, contractor_invoice, severance).
- **Sample data (dev/staging only, separate seed file, never applied to production):** *fictional* teams and ~11 *fictional* employee profiles covering all employment types, sample contracts, salary ledgers, leave history, and one sample mandatory leave. Real employee data — names, ΑΦΜ, IBANs, salaries — must never appear in migrations or the repo; it is entered through the UI in production per the requirements' manual-setup decision.

---

### UI System, Shell & Dashboard (Phase 0 & 7)

#### [NEW] [layout.tsx](file:///Users/zafeirisbampos/Projects/orbit/src/app/layout.tsx) & [page.tsx](file:///Users/zafeirisbampos/Projects/orbit/src/app/page.tsx)
- Application shell with persistent sidebar navigation, brand header with StellarBlue logo aesthetic, user theme toggle (Dark/Light/Cosmic), and global Quick Search modal (`⌘K`).
- **Design constraint**: glassmorphism/translucency is limited to the shell, cards, and dialogs — dense operator tables (people, ledger, contracts) render on solid high-contrast surfaces. Blurred translucent backgrounds behind small numeric text is a legibility tax on exactly the screens used most.
- **First-run onboarding (manual-setup decision)**: since all real data is entered manually post-deploy, every module ships purposeful empty states with a direct "add your first X" action, and the admin dashboard includes a setup checklist (profiles → entitlements → salary history → contracts) tracking what's been populated. This turns the manual import from a chore into a guided sequence.
- **Role-Aware Dashboard**:
  - **Admin View**: Monthly fully-loaded cost cards, 12-month forward burn chart preview, active headcount, 90-day Contract Alert widget (renewals and closing notice windows), Shared Admin Leave Approval Queue, missing-entitlements list (start of year), and ΕΡΓΑΝΗ drift status warning.
  - **Employee View**: Personal leave balance cards (or "entitlement not set — contact an admin" when no entitlement row exists for the year), upcoming team out-of-office calendar, one-click leave request dialog, and weekly remote pattern manager.
  - Contractor UI auto-filtering: Hides leave and remote sections automatically when `employment_type == 'contractor'`.

---

### People & Directory (Phase 1)

#### [NEW] [page.tsx](file:///Users/zafeirisbampos/Projects/orbit/src/app/people/page.tsx)
- Employee Directory grid and dense keyboard-friendly operator table.
- Filterable by team, employment type (`full_time`, `part_time`, `contractor`, `intern`), and status (`active`, `on_leave`, `departed`).
- Profile detail views with clean tabbed interface. Admin-only tabs securely reveal `profile_sensitive` fields (ΑΦΜ, ΑΜΚΑ, IBAN, Address), compensation history, per-year leave entitlements (manual entry per the confirmed decision), and the `work_schedule` editor (working weekdays — drives all working-day math for part-timers).
- `profile_sensitive` fields are excluded from every export path, including the accountant package and generic table CSV exports.

---

### Contract Management (Phase 2 - Highest ROI)

#### [NEW] [page.tsx](file:///Users/zafeirisbampos/Projects/orbit/src/app/contracts/page.tsx)
- Client (Revenue) and Supplier (Cost) contract registry with bi-directional toggle.
- Interactive Kanban Pipeline Board by status (`draft`, `in_negotiation`, `active`, `expiring`, `expired`, `terminated`) and Timeline Gantt preview.
- **Alert Engine**: Visual flags for notice deadlines within 30/60/90 days.
- Contract detail page featuring clause highlighting, self-referencing parent contract links (amendments/SOWs), and versioned PDF document uploading to private Supabase storage with server-side signed URL generation.

---

### Leave & Remote Work Tracking (Phases 3 & 4)

#### [NEW] [page.tsx](file:///Users/zafeirisbampos/Projects/orbit/src/app/leave/page.tsx) & [page.tsx](file:///Users/zafeirisbampos/Projects/orbit/src/app/remote/page.tsx)
- **Leave Module**: Request filing in <30 seconds with automatic working-day deduction against Greek public holidays. Team month calendar hiding medical/private notes from colleagues. Shared admin approval queue with one-click approve/reject and optimistic UI updates.
- **Mandatory Leaves (admin)**: Admin screen to declare a company-wide leave (name, type, date range) with a **preview-before-publish** step showing per-employee impact: working days deducted, trims due to overlapping existing leave, and anyone whose balance would go negative. Publish fans out approved requests to all eligible employees; the event appears as a distinct band on the team calendar and each generated entry shows a "company-wide" badge in employees' histories. Cancelling/re-dating cascades and restores balances. Publishing triggers a notification email to all affected employees.
- **Remote Module**: One-click recurring pattern setting ("Remote every Tue & Thu"), daily calendar overrides, mandatory location enforcement for `remote_abroad`, and soft warnings when monthly quota is exceeded.
- All modules display clear `ergani_status` badges (`not_required`, `pending`, `submitted`) with an admin widget listing approved items pending filing — mandatory-leave-generated entries included.

---

### Compensation & Payment Ledger (Phase 5)

#### [NEW] [page.tsx](file:///Users/zafeirisbampos/Projects/orbit/src/app/payroll/page.tsx)
- **Salary History**: Effective-dated salary and fee records per person with burn calculation capabilities.
- **Payment Types (admin settings)**: CRUD screen for the dynamic `payment_types` table — add/rename/deactivate types, set statutory defaults (month, multiplier prefill), scope by employment type. Deactivation hides a type from new entries without touching historical rows.
- **Payment Ledger**: One row per payment against a dynamic payment type; supports gross/net, employer EFKA contributions, and the statutory 13th/14th items via seeded types.
- **Bulk Generator**: "Generate Draft Month" auto-creates planned rows for all active staff driven by the `payment_types` table: monthly recurring types from current salary history, statutory types auto-included when the period matches their configured month (amounts prefilled from the multiplier, always editable before marking paid). The 12-month burn projection uses the same table, so a newly added recurring type is reflected in forecasts without code changes.
- **Accountant Package Export**: One-click generation of XLSX/CSV export bundles containing monthly ledgers and active contractor invoices without exposing app access to external accountants.

---

### Scheduled Tasks & Operations (Phase 6)

#### [NEW] Cron route handlers
- `/api/cron/alerts` (nightly contract notice-deadline/renewal scan → email + dashboard), `/api/cron/rollover` (Jan 1 leave carry-over), `/api/cron/mandatory-leave-fanout` (new-hire catch-up). All cron endpoints authenticate via a `CRON_SECRET` bearer check — Vercel Cron URLs are otherwise publicly invokable, and `rollover` mutates balances.

#### Operations baseline (from requirements — ships with Phase 0/6)
- Separate Supabase projects for staging and production; Vercel preview deployments point **only** at staging. Migrations applied via Supabase CLI in CI — never through the dashboard.
- Weekly `pg_dump` to independent storage (GitHub Actions cron → object storage) in addition to Supabase's automated backups, with one documented and *executed* restore test before real salary data is entered.

---

### ΕΡΓΑΝΗ Reconciliation — DEFERRED (post-v1)

Schema (`ergani_imports`, `ergani_records`, `ergani_exceptions`) and the `ergani_status` badges/widget ship in v1 so drift stays visible from day one. The rest is built later, gated on obtaining a real sample export:

#### [DEFERRED] [page.tsx](file:///Users/zafeirisbampos/Projects/orbit/src/app/reconciliation/page.tsx)
- Drag-and-drop file upload interface for monthly ΕΡΓΑΝΗ submitted form exports (Excel/CSV).
- Matching engine aligning internal leave and remote records against ΕΡΓΑΝΗ filings by `ΑΦΜ + Form Type + Date Range` (with adjustable day tolerance).
- Exception management interface highlighting drift (e.g., approved internally but missing in ΕΡΓΑΝΗ) with audit-tracked one-click resolution.
- **Prerequisite before build**: a sample (anonymized) export from the ΕΡΓΑΝΗ ΙΙ portal or the accountant's payroll software placed in a reference folder — the parser and column auto-mapper are designed around the real file, not a guess at it.

## Verification Plan

### Automated Tests
- **Database & RLS Verification Script**: `npm run test:rls` runs against a **real local Supabase instance with real per-role JWTs** — not a mocked client, which would bypass RLS and test nothing. For each role (`employee`, `admin`, anon) it queries every table and asserts the expected outcome, explicitly including: `employee` reads of `salary_history`, `payments`, `payment_types` amounts, and `profile_sensitive` return 0 rows/denied while `admin` succeeds; an `employee` cannot UPDATE or DELETE a `leave_requests` row with `origin = 'mandatory'`; an `employee` cannot INSERT into `mandatory_leaves` or `payment_types`. Runs in CI on every PR.
- **Mandatory-leave fan-out tests**: unit tests for the fan-out edge cases — overlap trimming, negative-balance flagging, idempotent re-publish, new-hire catch-up, cancellation restoring balances, and **part-time deduction** (an employee working Mon/Wed/Fri loses 2 days from a Thu–Fri closure spanning a holiday, not 2.5 or 3). These are the trickiest invariants in the app; they should not be verified only by hand.
- **Rollover tests**: Jan 1 carry-over job is idempotent (safe to re-run), respects per-type `counts_against_balance`, applies the carry-over expiry date, and never touches contractors.
- **Build & TypeScript Integrity**: Run `npm run build` and `npm run lint` to guarantee type safety and ensure no server secrets appear in client bundle configurations (`NEXT_PUBLIC_*`), and that the dev auth bypass module is excluded from production builds.

### Manual Verification
- **UI & UX Testing in Dev Mode**: Launch the local development server (`npm run dev`) with sample seed data.
  - Verify role switching (toggle between Founder/Admin view and Employee view in the UI).
  - **Fresh-database walkthrough**: with zero data, follow the setup checklist end-to-end (create profile → set entitlement → add salary record → add contract) and confirm every empty state offers a direct action — this is the exact path the real manual setup will take.
  - Verify that an employee submitting a leave request correctly excludes public holidays from working days, and that a part-time profile's request only deducts their scheduled weekdays.
  - Verify an employee with no entitlement row for the year sees the "entitlement not set" state (not a zero balance) and cannot submit a balance-counting request.
  - **Declare a mandatory leave** (e.g. a 3-day Christmas closure): confirm the preview shows correct per-employee deductions (part-timers deducted per their schedule), publish it, and verify every eligible employee's balance dropped, contractors were skipped, an employee with overlapping pre-approved leave was trimmed, and cancelling it restores all balances.
  - **Add a custom payment type** in settings (e.g. "Referral bonus") and confirm it appears in the ledger entry form and the next "Generate Draft Month" run without any code change; deactivate it and confirm historical rows are untouched.
  - Test the "Generate Draft Month" button in a December period and confirm Δώρο Χριστουγέννων rows are auto-included from the seeded statutory type.
  - Verify that auto-renewing contracts nearing their notice deadline appear prominently in the Dashboard Alert Widget and triggers a notification.
  - Confirm the accountant export package and generic CSV exports contain no `profile_sensitive` fields.
  - *(Deferred with the module)*: ΕΡΓΑΝΗ reconciliation upload/matching verification moves to the post-v1 phase once a real sample export exists.
