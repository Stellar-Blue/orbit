# Orbit — Invoice MCP Server Requirements

**Status:** Draft v1.0
**Purpose:** expose Orbit's invoice registration and querying capabilities as an MCP server, so Claude (claude.ai, Claude Desktop/Cowork, Claude Code) can act as the invoice operator: read uploaded invoice PDFs natively, extract fields, match counterparties and contracts against Orbit's registry, register the invoice, and attach the document — with a human in the conversation as the confirmation step.
**Relationship to other docs:** implements the ingestion workflow for *Invoice Tracking Requirements* (invoices model, lifecycle, allocations, dedup rules all defined there — this doc adds no new invoice semantics). Follows the MCP pattern StellarBlue already operates (ATLAS MCP servers).
**Architecture decision:** Claude-mediated, human-initiated registration replaces (for now) the automatic server-side extraction pipeline. The pipeline remains a compatible future addition behind the same validation layer — nothing here forecloses it.

---

## 1. Design principles

1. **Claude extracts and proposes; Orbit validates and decides.** Every write tool re-validates everything server-side — arithmetic, dedup, referential integrity, enum values. The model is treated as a well-meaning but fallible operator, exactly like a human using the UI. No validation exists only in prompt instructions.
2. **Structured errors are part of the product.** Tools never fail with bare strings. Every rejection returns machine-readable `{code, field, message, hint, existing_record?}` so Claude can self-correct in the next turn or surface a precise question to the human ("this looks like a duplicate of #4521 from May — register anyway as a corrected re-issue, or skip?").
3. **Per-user auth, always.** Invoices are admin-only financial data. The MCP authenticates each connection to a specific Orbit admin via OAuth; there is **no shared service token**. Every write is attributed to that admin in the audit log, tagged `created_via = 'mcp'`.
4. **Read tools are half the value.** The same server answers "what's unbilled for ΔΕΠΑ in Q3" — querying is a first-class goal, not a by-product.
5. **Idempotency everywhere writes happen.** Conversations retry; networks flake. Every write tool takes an `idempotency_key`; replays return the original result, never a duplicate.

## 2. Tool surface (v1 — deliberately lean)

### 2.1 Read tools

**`search_counterparties`**
- Input: `query` (name fragment) **or** `afm` (VAT number, normalized server-side: strip country prefix, uppercase, trim).
- Output: matches with `id, legal_name, trade_name, afm, country, role (client|supplier|both), status, attio_linked`.
- ΑΦΜ search is exact-after-normalization; name search is fuzzy, capped at 10 results.
- **Convention (enforced via skill, §6):** Claude matches by ΑΦΜ extracted from the PDF whenever one is present — deterministic — and falls back to name only when the document lacks a VAT number (some non-EU suppliers).

**`get_contracts`**
- Input: `counterparty_id`, optional `direction (revenue|cost)`, optional `status` (default: active).
- Output: `id, reference, type, direction, status, starts_on, ends_on, billing_cadence, payment_terms_days, currency, vat_treatment`.
- Purpose: pick the anchor contract and inherit its defaults (due date from payment terms, VAT treatment).

**`get_billing_status`**
- Input: `contract_id`, optional period range (default: last 12 months + next 3).
- Output: per schedule period: `period, expected_amount, allocated_amount, invoice_refs[], state (invoiced_paid | invoiced_unpaid | uninvoiced_past | upcoming)`.
- Dual use: lets Claude propose the correct period allocation for a new invoice, and directly answers "what's still unbilled" questions.

**`search_invoices`**
- Input: any of `counterparty_id, contract_id, direction, status, period_from, period_to, invoice_number, category`; free-text `query` over number/notes.
- Output: register rows (no document content), including payment status and open amount.

**`list_inbox`**
- Output: stub invoices in `needs_metadata` with their document ids — so Claude can also work the existing upload-inbox queue, not only fresh conversational uploads.

**`get_invoice_document`**
- Input: `invoice_id` or `document_id`. Output: the PDF (base64) so Claude can re-read an already-stored document — required for the inbox workflow and for "double-check invoice #4521 against its PDF".

### 2.2 Write tools

**`create_invoice`**
- Input: full payload per the invoice model — `direction, counterparty_id, contract_id?, type, credits_invoice_id?, invoice_number, mark?, category?, issue_date, due_date?, period_from, period_to, currency, fx_rate?, net, vat_amount, vat_rate, gross, notes?, allocations?[{contract_id, period, amount}]` — plus `idempotency_key`.
- Server-side validation (non-negotiable, mirrors the UI exactly):
  - `net + vat_amount = gross` (cent-exact after rounding rules);
  - dedup: `(counterparty_id, direction, invoice_number)` — violation returns `DUPLICATE_INVOICE` with the existing record summary;
  - dates sane (`issue_date ≤ due_date`, period range valid, issue date not > 30 days in the future);
  - `credit_note` requires a valid `credits_invoice_id` on the same counterparty; amount signs consistent;
  - counterparty exists and is active; contract (if given) belongs to the counterparty and direction matches;
  - allocations sum ≤ gross-net-of-credits and reference periods inside (or adjacent to, with warning) the contract's schedule;
  - defaults applied when omitted: `due_date` from contract `payment_terms_days`, `vat_rate` from contract VAT treatment.
- Output: the created invoice row (id, internal_ref, computed status, applied defaults, any non-blocking `warnings[]` — e.g. allocation variance beyond ±2% tolerance) with `missing_document = true` until §2.2's upload lands.

**`upload_invoice_document`**
- Input: `invoice_id`, `filename`, `content_base64`, `idempotency_key`.
- Limits: PDF/PNG/JPEG only, ≤ 10 MB decoded, magic-bytes checked server-side (not just extension). Stored via the existing private-bucket path convention; sets `missing_document = false`; re-upload creates a new version per the immutability rule (never overwrites).
- **Sequencing contract:** `create_invoice` first, then upload against the returned id. A failed upload leaves a valid invoice flagged `missing_document` — graceful degradation into the flow the base requirements already define, surfaced by the existing 7-day inbox notification.

**`record_payment`**
- Input: `invoice_id, paid_on, amount, bank_reference?, note?, idempotency_key`.
- Validation: amount > 0, cumulative payments ≤ gross (over-payment returns a structured error with the open amount), status recomputed. Included in v1 because "and mark the first two as paid" is a natural part of the same conversation.

Explicitly **not** in v1: no delete tool (invoices have no delete path anywhere), no counterparty/contract creation (those flows have their own review semantics — Attio queue, pricing configurator — that must not be bypassed conversationally), no status-forcing tool (status is always derived).

## 3. Authentication & authorization

- **OAuth 2.0 authorization-code flow** per the MCP spec: connecting the server from claude.ai/Desktop redirects to Orbit's Entra-ID-backed login; the resulting token maps the MCP session to one Orbit profile.
- The mapped profile must hold `admin`; otherwise every tool returns `FORBIDDEN` — including reads. Token lifetime ≤ 8h with refresh; revocation follows Entra (disabled employee = dead MCP session at next call).
- Same two-gate model as the UI: application-level role check in every tool handler **and** RLS underneath (the MCP server uses per-request user-scoped credentials, not the service role, wherever feasible; where the service role is unavoidable, the handler-level check is mandatory and tested).
- Rate limit per user (e.g. 60 tool calls/min) — protects against runaway agent loops.
- Server deployment: same pattern as the existing ATLAS MCP servers (HTTPS endpoint, e.g. `mcp-orbit.stellarblue.eu`), staging instance pointed at staging Orbit only.

## 4. Audit & observability

- Every write lands in the existing `audit_log` with `actor = mapped admin profile`, plus `via = 'mcp'` and the `idempotency_key` — "who registered this and through what channel" is always answerable.
- An `mcp_tool_calls` log (tool, user, duration, outcome code, no payload bodies for document content) feeds a small admin panel: calls/day, error-code distribution, top users. Error-code distribution is the tuning signal — a spike in `DUPLICATE_INVOICE` means the skill needs a better pre-check step, a spike in `VALIDATION_ARITHMETIC` means extraction quality dropped.
- Weekly digest line: "n invoices registered via MCP, n via UI, n validation rejections."

## 5. Error contract (canonical codes)

`DUPLICATE_INVOICE` (includes existing record summary) · `VALIDATION_ARITHMETIC` (field-level: expected vs got) · `VALIDATION_DATES` · `UNKNOWN_COUNTERPARTY` · `CONTRACT_MISMATCH` (contract/counterparty/direction disagreement) · `ALLOCATION_OUT_OF_RANGE` · `CREDIT_TARGET_INVALID` · `DOCUMENT_TOO_LARGE` · `DOCUMENT_TYPE_INVALID` · `OVERPAYMENT` · `FORBIDDEN` · `RATE_LIMITED` · `IDEMPOTENT_REPLAY` (success-class: returns original result).

Every code carries `message` (human-readable, English), `hint` (what Claude should do next), and structured context. This contract is versioned with the API — skills depend on it.

## 6. The organization skill (ships with the server)

The MCP provides capability; a skill provides consistency. An `invoice-registration` organization skill (same mechanism as the existing changelog/docs-export skills) encodes the canonical workflow:

1. For each attached/uploaded PDF: extract `invoice_number, issuer + recipient ΑΦΜ, issue/due dates, period covered, currency, net/VAT/gross per rate`.
2. Infer direction: recipient ΑΦΜ = StellarBlue's → `incoming`; issuer ΑΦΜ = StellarBlue's → `outgoing`.
3. `search_counterparties(afm)` with the *other* party's ΑΦΜ; no match → **stop and ask** (never create, never guess by name when an ΑΦΜ exists).
4. `get_contracts` → pick anchor by direction + period; ambiguity → show options, ask.
5. `get_billing_status` → propose allocations; note variance beyond tolerance.
6. Present a summary table (all fields, matched counterparty, contract, allocations, flags) → **explicit human confirmation** → `create_invoice` → `upload_invoice_document` → `record_payment` if instructed.
7. Final report: registered / skipped / needs-attention, with internal refs and deep links.
8. House conventions baked in: VAT treatment mapping, category tags for contract-less invoices, Greek+English document handling, "ask, don't assume" list.

The skill also defines what Claude must **never** do: register without showing the summary first, resolve a `DUPLICATE_INVOICE` by mutating the number, or fabricate an ΑΦΜ/MARK not present in the document.

## 7. Acceptance criteria

1. An admin connects the MCP from claude.ai via OAuth; a non-admin's connection authenticates but every tool returns `FORBIDDEN`; disabling the admin in Entra kills the session's next call.
2. Conversation test — three supplier PDFs attached, "register these": Claude matches all three counterparties by ΑΦΜ, proposes contracts and allocations, shows the summary, and after confirmation all three exist in Orbit with documents attached, correct audit actor, `via = 'mcp'`.
3. One of the three is a duplicate: `create_invoice` returns `DUPLICATE_INVOICE` with the existing record; Claude surfaces it as a question rather than retrying; nothing is double-registered.
4. A PDF with no ΑΦΜ for the counterparty: the flow stops at step 3 and asks; no name-guess registration occurs.
5. Replaying `create_invoice` with the same `idempotency_key` (simulated retry) returns the original invoice, count unchanged.
6. `upload_invoice_document` with a 25 MB file and with a renamed .exe both fail with the correct codes; the invoice survives as `missing_document` and appears in the existing inbox notification.
7. "What's still unbilled for ΔΕΠΑ this year?" is answered correctly from `get_billing_status` alone, with figures matching the UI's billing view exactly.
8. Payload arithmetic off by one cent → `VALIDATION_ARITHMETIC` names the fields; Claude corrects from the PDF and succeeds — observable as two calls in `mcp_tool_calls`.
9. RLS/authz test suite extended: MCP handler paths for every tool asserted under admin, non-admin, and unauthenticated contexts.

## 8. Build order

1. Error contract + validation layer as a shared module (`create_invoice` validation extracted so UI and MCP call the identical code — one source of truth).
2. Read tools (§2.1) + OAuth — immediately useful for querying alone, zero write risk.
3. Write tools + idempotency + audit tagging.
4. `mcp_tool_calls` logging + admin panel widget.
5. The `invoice-registration` skill, iterated against a real batch of last month's invoices as the test set.
6. Acceptance tests 1–9 in CI where automatable (1, 5, 6, 8, 9), scripted-manual for the conversational ones.

## 9. Open questions

1. **StellarBlue's own ΑΦΜ** as config: single value, or multiple (if any related entity ever invoices through Orbit)? Determines direction-inference logic.
2. **Scope creep guard:** first requests will come for `create_counterparty` and contract tools "while we're at it." Position: counterparty creation stays in the UI/Attio review flow for v1 — revisit only with a concrete recurring need.
3. **Non-admin read-only tier later?** If a `finance_viewer` role ever materializes, read tools could open to it — noted so the authz layer keys on capabilities, not a hardcoded admin check.
4. **Claude Tag / Slack:** should the same server be reachable from Claude Tag so invoice registration can happen in a Slack thread? Nothing in the design prevents it; decide when Tag usage patterns are clearer.
