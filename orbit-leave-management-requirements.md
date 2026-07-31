# Orbit — Leave Management Requirements (v2 detail spec)

**Scope:** deepens the leave module now that the alpha is functional. Supersedes §3.3 of the original requirements where they conflict.
**Status:** Draft v1.0
**Inherits:** `work_schedule`-based working-day math, manual per-year entitlements, `origin` column, mandatory leaves fan-out, `ergani_status` tracking, admin-queue approvals (no manager role).

---

## 1. Request lifecycle (state machine)

Make the states explicit — most leave-system bugs are undefined transitions.

```
pending ──approve──▶ approved ──(start date passes)──▶ in_progress ──▶ taken
   │                    │                                   │
   ├─reject──▶ rejected ├─admin_edit──▶ approved (modified) │
   │                    │                                   │
   └─employee_cancel    ├─cancel──▶ cancelled               └─admin edit/
      ──▶ cancelled     └─employee cancel request               partial cancel
                           (future leave only) ──▶ admin decides
```

Rules:

- **`pending`**: employee may edit or cancel freely (edit = cancel + resubmit under the hood, keeping history simple). Admin may approve, reject (with an optional reason shown to the employee), or edit-then-approve in one step.
- **`approved`, future**: employee cannot edit directly; they may submit a **cancellation request** which lands in the admin queue (one click to accept). Rationale: an approved leave may already be filed in ΕΡΓΑΝΗ — silent self-service cancellation reintroduces drift.
- **`approved`, started or past**: admin-only territory (see §2).
- **`rejected` / `cancelled`**: terminal; days return to balance immediately and atomically. Record retained for history — never deleted.
- Every transition writes to the audit log with actor, timestamp, and before/after snapshot (existing trigger infrastructure covers this).

## 2. Admin post-approval editing ★ (your requirement #1)

Admins can modify any leave in any state, including approved, in-progress, and past leaves. This is the correction mechanism for reality diverging from plan (came back early, extended, sick note recategorized a day, data-entry error).

- **Editable:** date range, half-day flags, leave type, note, attached document.
- **Balance integrity:** working days are recomputed on every edit (against `public_holidays` + the employee's `work_schedule` *as of the leave dates*) and the balance delta is applied atomically with the edit. Changing type between balance-counting and non-counting types (e.g. annual → sick) restores/deducts accordingly.
- **Partial cancellation:** first-class action, not a workaround — "employee returned early on the 3rd day" shrinks the range and refunds the remainder. UI offers "end leave on date X" directly.
- **ΕΡΓΑΝΗ consistency — the critical rule:** if a leave with `ergani_status = submitted` is edited or cancelled, the status automatically flips to **`needs_amendment`** (new enum value) and the record appears in the admin ΕΡΓΑΝΗ-drift widget until re-marked. An edit that silently leaves a stale filing marked "submitted" is exactly the drift this system exists to prevent.
- **Transparency:** the employee is notified on any admin edit to their leave (what changed, by whom); the edit history is visible on the request detail to both parties. Admin edits carry a mandatory short reason field.
- Mandatory-leave-generated rows (`origin = 'mandatory'`) are editable per-employee by admins too (e.g. one person worked through the closure by agreement) — the edit detaches that row from cascade behavior (flagged `detached = true`) so a later cancellation of the mandatory leave doesn't clobber the manual correction.

## 3. Minimum notice rule ★ (your requirement #2)

Employees cannot submit a request whose start date is fewer than **N days** in the future.

- **Per-type, not global:** `leave_types.min_notice_days`. Defaults: annual leave **7**, unpaid **7**, special leaves (γάμου, φοιτητική) **7**; **sick leave 0**, bereavement (πένθους) **0**, blood-donation (αιμοδοσίας) **0**. A global 7-day rule would make it impossible to report being sick today — the exception must be structural, not remembered.
- **Enforcement:** validated at submission (server-side, not just form UX). The form communicates the earliest selectable start date per type up front rather than erroring after fill-in.
- **Admin bypass:** admins can always create or approve a leave inside the notice window on an employee's behalf (`origin = 'admin_entry'`) — real life produces legitimate late requests, and the pressure valve should be an admin action, not a rule employees learn to route around by mislabeling leave type.
- **Retroactive entries:** sick leave is frequently reported after the fact; types with `min_notice_days = 0` also get `allow_retroactive = true` (bounded, e.g. up to 30 days back). Retroactive annual leave is admin-entry only.

## 4. Calendar view ★ (your requirement #3)

One calendar, three lenses — not three calendars.

- **Month grid (default):** all approved leave as horizontal bars, color-coded by leave type; public holidays shaded with name on hover; mandatory-leave ranges rendered as a full-width company band; today marker; Monday-first weeks (Greek convention).
- **Week/agenda lens** for the near term; **year heat lens** per employee (admin) showing distribution of days taken — useful for spotting untaken leave in Q4.
- **Filters:** team, leave type, status (include/exclude pending — pending shown hatched/translucent), specific people.
- **Privacy:** non-admins see *who* is away and the date range only — no leave type, no notes, no documents. Colleagues need "Maria is out Thu–Fri", not why. Admins see full detail. (This tightens the original spec, which colored by type publicly — type itself leaks medical information.)
- **Capacity signal:** a configurable threshold (e.g. >40% of a team absent on a day) tints the day and warns the *approving admin* on requests that would cross it. Signal, not a block.
- **Interactions:** click a day → detail popover; drag across days (employee view) → prefilled request dialog; keyboard navigable months.
- **ICS feed:** read-only ICS subscription URL for the company out-of-office calendar (names + dates only), so it lives inside Outlook/Teams where people already look — natural fit with the Entra ID workspace. The URL carries a long random token, is revocable/regenerable in settings, and contains no type/reason data. Personal ICS feed per employee for their own leave.
- **Sane volume:** at ≤20 people a month view stays legible; no need for pagination/virtualization. Mobile: the calendar is the primary read surface — must work well on a phone.

## 5. Validation & business rules (the "boring" essentials)

- **Overlap prevention:** a new request cannot overlap the same employee's existing pending or approved leave (any type). Clear error naming the conflicting request.
- **Zero-working-day guard:** a request whose range contains no working days (all holidays/weekends/non-schedule days) is rejected at submission with an explanation — otherwise it burns an ΕΡΓΑΝΗ-tracking row for nothing.
- **Year-boundary split:** a request spanning Dec→Jan is automatically split into two linked records, each deducting from its own year's entitlement. Displayed as one item in UI, stored as two rows (`linked_request_id`). Without this, December requests corrupt next year's balance.
- **Balance check at submission:** for balance-counting types, the request is validated against *remaining = entitlement + carry-over − taken − pending*. Insufficient balance blocks employee submission (unlike mandatory leaves, a voluntary request should not go negative); admins can override on entry.
- **Carry-over expiry:** carried-over days are consumed **first** (FIFO) and expire on their configured date; the balance card shows them separately with the expiry ("4 days from 2026 — expire Mar 31").
- **Pending-request hygiene:** requests still pending 3 days before their start date escalate in the admin digest; requests whose start date passes while pending flip to `expired` and refund nothing (they never deducted — pending days are *reserved*, shown as such in the balance breakdown, and released on any terminal state).
- **Half-days:** count as 0.5 working days; allowed at range start and/or end only. ΕΡΓΑΝΗ note field auto-hints half-day filings.
- **Documents:** types with `requires_document = true` (sick > N days, per current Greek practice — confirm N with the accountant) accept upload at submission *or* within a grace window after; missing document past the window flags in the admin queue, doesn't auto-reject.
- **Departing employees:** setting an end date on a profile surfaces any approved leave after that date for admin resolution, and the profile's balance card shows the προσαύξηση/pro-rata situation as a note for the accountant conversation — the app still does not compute Greek termination-leave payouts.

## 6. Notifications (complete matrix)

| Event | Employee | Admins |
|---|---|---|
| Request submitted | confirmation | queue email (batched, not one-per-request) |
| Approved / rejected | ✉ with dates (+ reason if rejected) | — |
| Admin edited a leave | ✉ what changed + reason | audit only |
| Cancellation request | confirmation | queue |
| Leave starts tomorrow | — | daily "who's out tomorrow" digest (opt-in) |
| Pending & start date −3 days | — | escalation in digest |
| `needs_amendment` created | — | ΕΡΓΑΝΗ widget + weekly digest |
| Mandatory leave published | ✉ all affected | — |

All emails deep-link to the exact record. Slack webhook mirrors the admin queue events (already planned infrastructure).

## 7. Balance display (employee-facing clarity)

The number-one support question in any leave system is "why is my balance X?" — pre-empt it. The balance card shows the full equation, not just a number: entitlement + carry-over (with expiry) − taken − reserved (pending) − upcoming mandatory = available. Every figure clicks through to the underlying records. If any admin edit changed history, the affected entries carry the edit marker.

## 8. Reporting (admin)

- Per-employee year statement: entitlement, taken by type, remaining, carry-over status — exportable, matches what the accountant needs for the yearly Ε11.
- Company view: leave liability (untaken days × people), Q4 untaken-leave risk list, absence rate by month.
- All exports respect the existing rule: no `profile_sensitive` fields anywhere.

## 9. Explicit non-goals (unchanged, restated for this module)

- No accrual computation — entitlements remain manual per employee-year.
- No ΕΡΓΑΝΗ submission — `needs_amendment` tells a human to act; the app never files.
- No multi-step approval chains — the admin queue remains the single gate.
- No termination payout calculation.

## 10. Acceptance criteria (delta over alpha)

1. Admin edits an approved, ΕΡΓΑΝΗ-submitted leave → balance adjusts atomically, employee is notified with the reason, record shows `needs_amendment`, drift widget lists it.
2. Employee attempts annual leave starting in 3 days → blocked server-side with the earliest valid date; same employee logs sick leave for *today* → accepted; admin enters annual leave for tomorrow on their behalf → accepted as `admin_entry`.
3. Employee returns early from a 5-day leave → admin ends it on day 3 in two clicks; 2 days return to balance; ΕΡΓΑΝΗ flag flips.
4. A Dec 29–Jan 3 request deducts correctly from both years' entitlements and renders as one calendar item.
5. Colleague view of the calendar reveals no leave types or reasons; the ICS feed in Outlook shows names and dates only, and regenerating the token invalidates the old URL.
6. A request over Καθαρά Δευτέρα deducts zero for that day; a Mon/Wed/Fri part-timer requesting Mon–Fri is deducted 3 days.
7. Cancelling a pending request instantly releases reserved days; the balance equation view reflects it without refresh.
