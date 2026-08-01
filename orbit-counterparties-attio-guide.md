# Orbit Developer Guide — Counterparties & the Attio Integration

**Audience:** Orbit developers.
**Problem observed:** every contract in the alpha currently hangs off a single counterparty ("ΔΕΠΑ"). Counterparties need to become a first-class registry of companies — clients, suppliers, and both — and stay in real-time sync with Attio, which remains StellarBlue's CRM. **Attio owns the relationship; Orbit owns the money.**

---

## 1. Fix the immediate defect first

All contracts pointing at one counterparty is almost certainly one of: a hardcoded/default `counterparty_id` in the contract form, a seed/import script that assigned the first row, or a picker that silently falls back. Required changes before anything else:

- `contracts.counterparty_id` is **mandatory with no default** — the form cannot submit without an explicit selection, and there is no "first row" fallback anywhere in code.
- The counterparty picker is a searchable combobox (name, ΑΦΜ, Attio link status shown inline) with a "create new" inline flow — never a plain dropdown preselecting index 0.
- **Data repair:** a one-off admin screen (or script + audit entries) listing all contracts currently on the wrong counterparty for bulk reassignment. Every reassignment writes to the audit log. Do this before the Attio sync goes live, or the bad links get pushed into the CRM rollups.

## 2. Counterparty model

### 2.1 One table, roles derived — never two tables

A company can be a client today and a supplier tomorrow (Volue is a live example: potential partner, supplier of PowerBot, and conceivably a channel client). Splitting clients and suppliers into separate tables forces duplicates and breaks netting views.

```
counterparties     id, legal_name, trade_name, country,
                   vat_number, vat_valid, vat_checked_at,        -- VIES
                   registration_number,                           -- non-VAT fallback
                   doy,                                           -- Greek tax office
                   address fields…, website_domain,
                   status (active | archived),
                   is_internal bool,                              -- e.g. Eunice JV entity
                   sync_to_attio bool DEFAULT true,
                   notes, created_by, created_at
counterparty_contacts   id, counterparty_id, name, email, phone, role,
                        attio_person_id (nullable)
```

- **Role (`client` / `supplier` / `both` / `none yet`) is derived, not stored:** computed from the `direction` of the counterparty's non-archived contracts. A stored role field goes stale the day the first supplier signs a revenue deal. Show it as a badge; filter on it via a view.
- **Identity & dedup:** the natural key is `(country, vat_number)` — unique partial index where `vat_number` is not null. Greek and EU counterparties get **VIES validation** on entry (you already have this pattern from the Eunice data work): normalize (strip country prefix, uppercase), call VIES, store `vat_valid` + `vat_checked_at`, and warn — don't block — on failure (VIES has downtime; a human can override with a note). Non-EU companies use `registration_number` + country, with a soft fuzzy-name duplicate warning at creation.
- **Archive, never delete:** a counterparty with any contract history is only archivable. Archiving hides it from pickers, keeps every report correct.
- **`is_internal`** flags related entities (Eunice JV, StellarBlue itself for intercompany) so revenue reports can exclude or segregate them — otherwise JV invoicing pollutes client-revenue dashboards.

### 2.2 Counterparty page

One page per company answering "what is our total relationship?": header (identity, VIES badge, role badge, Attio link with deep-link to the CRM record), tabs for Contracts (both directions, with committed value subtotals), Revenue/Cost (schedule rollup from the pricing engine — net position for `both`-role companies), Contacts, Documents, Activity (audit). This page is Orbit's answer; pipeline, emails, and relationship history stay in Attio — link out, don't replicate.

## 3. Attio integration

### 3.1 The ownership contract (the design's core)

Bidirectional sync dies by conflict. Avoid conflicts structurally: **every field has exactly one master system, and sync only flows from master to mirror.**

| Data | Master | Mirrored to | Notes |
|---|---|---|---|
| Company identity (name, domain, address) | **Attio** | Orbit | Sales maintains it where they live |
| ΑΦΜ / VAT, ΔΟΥ, registration number | **Orbit** | Attio (custom attributes) | Financial identity, VIES-validated in Orbit |
| People / contacts | **Attio** | Orbit (read-mostly) | Orbit stores a light mirror for contract contact fields |
| Contracts, line items, pricing | **Orbit** | Attio (rollup attributes only) | Never contract detail into the CRM |
| Financial rollups: ARR/MRR, active contracts count, committed value, next renewal date, notice deadline | **Orbit** | Attio (custom attributes, e.g. `orbit_arr`, `orbit_next_renewal`) | This is what makes the CRM smarter |
| Pipeline stage, deal notes, emails | **Attio** | — (not synced) | Orbit links out |

Orbit-owned attributes in Attio are created via the API under an `orbit_` prefix and treated as read-only by convention in the CRM (documented for the team; Attio can't hard-enforce it — the reconciliation job re-asserts Orbit's values, so manual edits in Attio self-heal within a day).

### 3.2 Link model

```
attio_links        id, counterparty_id UNIQUE, attio_record_id UNIQUE,
                   attio_object ('companies'), link_status
                   (linked | pending_review | unlinked),
                   linked_by, linked_at, last_inbound_at, last_outbound_at
attio_events       id, attio_event_id UNIQUE,    -- idempotency key
                   event_type, payload jsonb, received_at,
                   processed_at, status (processed | skipped | failed), error
attio_outbox       id, counterparty_id, operation, payload jsonb,
                   attempts, next_retry_at, status
```

### 3.3 Inbound: Attio → Orbit (webhooks)

- Register webhooks via Attio's API for `record.created` / `record.updated` / `record.deleted` on the `companies` object (and `people` if contact mirroring is enabled), using Attio's **API-configurable filters** to subscribe narrowly rather than firehosing.
- Endpoint: `/api/webhooks/attio` — verify the webhook secret/signature, insert into `attio_events` with the event id as idempotency key (duplicate delivery = skip), return 200 immediately, process async. Never do sync work inside the request handler; Attio retries on slow responses and you'll process twice.
- **Out-of-order protection:** apply an inbound update only if the payload's record timestamp ≥ the last applied one for that link; otherwise skip. Webhooks guarantee delivery attempts, not order.
- `record.created` in Attio does **not** auto-create an Orbit counterparty. It lands in a **review queue**: an admin confirms "this is a real counterparty" and either links to an existing Orbit record (match suggestions by domain / normalized name / any VAT attribute Attio holds) or creates one — at which point Orbit's identity fields (ΑΦΜ, VIES) get filled properly. Rationale: Attio will contain prospects, partners, and noise; only a subset ever becomes a financial counterparty. Auto-creation would silt Orbit's registry.
- `record.deleted` / archived in Attio: mark the link `unlinked`, flag for admin review — **never** archive an Orbit counterparty with contracts because a CRM record was cleaned up.

### 3.4 Outbound: Orbit → Attio (API)

- Trigger points: counterparty identity change (Orbit-owned fields), any event that changes a rollup — contract signed/edited/terminated, revenue schedule regenerated, renewal date shifted.
- Writes go through the **`attio_outbox`** (transactional outbox — same pattern as Atlas's RabbitMQ work): the domain transaction inserts an outbox row; a worker delivers via `PATCH /v2/objects/companies/records/{id}` with exponential backoff, marking `last_outbound_at`. No direct API calls inside domain transactions — an Attio outage must never fail a contract save.
- Rollups are **debounced** (e.g. 30s per counterparty): one contract edit can touch schedule + committed value + renewal date; send one PATCH, not five. "Real-time" here means seconds, which is what a CRM needs.
- Orbit-created counterparties with `sync_to_attio = true` (default) are pushed via Attio's **assert endpoint** (`PUT /v2/objects/companies/records` with `matching_attribute: domain`) so a company sales already added isn't duplicated. Pure suppliers you don't want cluttering the CRM: set `sync_to_attio = false` — they exist only in Orbit, and that's fine.

### 3.5 Reconciliation (the part that makes it trustworthy)

Webhooks get missed; API calls fail after retries; humans edit Orbit-owned attributes in Attio. A **nightly reconciliation job** diffs the full linked set both ways: pulls all linked Attio records (paginated), compares Attio-mastered fields against Orbit mirrors and Orbit-mastered attributes against Attio's values, applies master-wins fixes, and reports anything ambiguous to an admin exceptions list. Dashboard widget: "Attio sync: last reconciled {date}, {n} pending review, {n} outbox failures." Same philosophy as the ΕΡΓΑΝΗ drift widget — assume drift, detect it, surface it.

### 3.6 Security & ops

- Attio API key (or OAuth token) server-side only, in Vercel env vars; webhook secret likewise. The webhook route is the only unauthenticated-user-facing entry — signature check before touching the body, reject oversized payloads, rate-limit.
- Respect Attio rate limits in the outbox worker (serialize per workspace, backoff on 429).
- All inbound-applied changes and outbound pushes write to Orbit's audit log with actor `attio-sync`, so "why did this name change" is always answerable.
- Staging Orbit points at a **separate Attio workspace** (or a sandboxed object) — never at the production CRM.

## 4. Acceptance tests

1. Creating a contract without selecting a counterparty is impossible at both form and API level; no code path supplies a default.
2. A company signed as a client and later added as a supplier shows role `both`, one record, contracts split by direction, and a correct net position on its page.
3. Two entry attempts with the same normalized ΑΦΜ collide on the unique index and the UI routes to the existing record; VIES-down entry succeeds with `vat_valid = null` and a visible "unverified" badge.
4. Sales creates a company in Attio → it appears in Orbit's review queue within seconds (not as a counterparty); confirming it creates the counterparty, the link, and backfills Orbit-owned attributes into Attio.
5. Signing a contract in Orbit updates `orbit_arr`, `orbit_active_contracts`, and `orbit_next_renewal` on the Attio record within a minute; five rapid contract edits result in one debounced PATCH.
6. Replaying the same webhook delivery twice produces one applied change; delivering an older update after a newer one produces zero changes.
7. With Attio unreachable, contract saves succeed, outbox rows accumulate with retries, the dashboard shows the failure count, and recovery drains the queue in order.
8. Manually editing `orbit_arr` in Attio is reverted by the nightly reconciliation and logged.
9. Archiving a company in Attio never archives an Orbit counterparty with contract history; it flags for review.

## 5. Build order

1. Counterparty model hardening: derived roles, VIES validation, unique index, mandatory-picker fix, **data repair of the ΔΕΠΑ situation**.
2. Counterparty page (contracts + rollups from the existing revenue schedule).
3. Link table + manual linking UI (search Attio, link by hand) — proves the mapping before any automation.
4. Outbound: outbox + rollup attributes in Attio (this is the visible win for sales — CRM records showing live ARR).
5. Inbound webhooks + review queue.
6. Nightly reconciliation + dashboard widget.

Sequencing rationale: outbound-before-inbound because Orbit→Attio rollups deliver the business value and are simpler (one master, no review queue); inbound automation rides on a linking model already proven manually in step 3.

## 6. Open questions

1. **Contact mirroring depth:** mirror Attio people into `counterparty_contacts` automatically, or keep contacts manual in Orbit and just deep-link? (Recommended start: manual + deep-link; auto-mirror is a fast follow.)
2. **Which rollup attributes does sales actually want on the Attio company card?** Propose: ARR, active contract count, committed remaining, next renewal, notice deadline, "has expiring contract in 90d" flag. Confirm with whoever runs Attio before creating attributes.
3. **Deals ↔ contracts:** should winning an Attio deal open a pre-filled draft contract in Orbit (deal → `pricing_mode: modular` draft)? Natural v2; keep out of v1.
4. **Eunice JV records:** does the JV entity live in Attio at all, or only in Orbit as `is_internal`?
