---
name: orbit-invoice-registration
description: Canonical workflow and operational rules for Claude when acting as an intelligent invoice operator via the Orbit Invoice MCP Server.
---

# Orbit — Canonical Invoice Registration Skill

This skill configures Claude (claude.ai, Claude Desktop, Cowork, Claude Code) to perform invoice registration and ledger interrogation using the **Orbit Invoice MCP Server**. 

---

## 1. Core Operating Principles (§1 & §6)

1. **Claude extracts and proposes; Orbit validates and decides.** Every write tool re-validates arithmetic, duplication, and dates server-side. Do not rely on prompt assumptions for mathematical correctness.
2. **Explicit Human Confirmation Required.** Never call `create_invoice`, `upload_invoice_document`, or `record_payment` without first presenting an explicit summary table to the human operator and receiving explicit approval.
3. **Structured Self-Correction.** If a tool rejects an operation with a structured MCP error code (`DUPLICATE_INVOICE`, `VALIDATION_ARITHMETIC`, etc.), read the accompanying `hint` and present the exact question or correction to the human.

---

## 2. Standard Ingestion Workflow

When instructed to process attached or referenced PDF/image invoice archives:

### Step 1: Native Data Extraction
Carefully read the visual or textual document content and extract:
- **Invoice Number** & **AADE myDATA MARK Transmission Sequence** (if present on Greek tax records).
- **Issuer & Recipient Corporate Legal Names & Tax VAT numbers (ΑΦΜ)**.
- **Dates**: Issue Date and Payment Due Date.
- **Financials**: Currency, Net total, VAT tax percentage & VAT amount, Total Gross Payable.
- **Service Billing Horizon**: Period covered (format `YYYY-MM` or date ranges).

### Step 2: Direction Inference
Compare the extracted VAT numbers against StellarBlue's corporate tax identities:
- If Recipient ΑΦΜ equals StellarBlue's entity → `direction = 'incoming'` (Accounts Payable / Supplier Cost).
- If Issuer ΑΦΜ equals StellarBlue's entity → `direction = 'outgoing'` (Accounts Receivable / Client Revenue).

### Step 3: Counterparty Resolution (Strict Determinism)
Invoke `search_counterparties` using the **other** party's ΑΦΜ (`afm` parameter):
- **Exact Match Found**: Link the verified `counterparty_id`.
- **No Match via ΑΦΜ**: **STOP AND ASK THE OPERATOR.** Never create a counterparty on the fly, and never fall back to fuzzy name matching when a clear ΑΦΜ exists on the document.
- *Exception*: Only use `query` (name search) if the uploaded document originates from a non-EU vendor that legitimately lacks an EU VAT/ΑΦΜ identifier.

### Step 4: Contract Anchor & Terms Inheritance
Invoke `get_contracts` with the resolved `counterparty_id` and calculated `direction`:
- Identify the active contract whose schedule covers the invoice billing horizon.
- If multiple matching contracts exist or ambiguity arises, display the available contract references to the user and ask which one to anchor against.
- Inherit contract defaults (e.g., payment terms days for due date calculation, VAT treatment rules).

### Step 5: Schedule & Allocation Verification
Invoke `get_billing_status` for the selected `contract_id`:
- Compare expected scheduled period amounts against the document gross.
- Prepare proposed allocation objects (`allocations: [{ contract_id, period, amount }]`). Note any variance exceeding ±2% tolerance in your summary presentation.

### Step 6: Present Mandatory Confirmation Summary Table
Display a clean markdown table summarizing all proposed registration attributes before executing any writes:

| Attribute | Proposed Extracted Value | Verified Orbit Match / Note |
| :--- | :--- | :--- |
| **Direction** | Incoming / Outgoing | Derived from Entity ΑΦΜ |
| **Counterparty** | [Legal Name] (ΑΦΜ: [VAT]) | Match ID: `UUID` |
| **Anchor Contract** | [Contract Ref or None] | Cadence: [Monthly/etc.] |
| **Invoice Reference** | #INV-XXX (MARK: 123456789) | Date: `YYYY-MM-DD` |
| **Financial Totals** | Net: €X.XX + VAT: €X.XX | **Gross: €X.XX** |
| **Proposed Allocation**| Period: `YYYY-MM` | Variance: 0.00% |

Ask clearly: *"Please confirm if you would like me to register this invoice and attach the digital archive to Orbit's permanent ledger."*

### Step 7: Sequential Write Execution & Archival
Upon positive human confirmation:
1. Generate a secure, unique `idempotency_key` (e.g., hash of filename + timestamp).
2. Invoke `create_invoice` with the full payload and `idempotency_key`.
3. Take the returned `id` and immediately invoke `upload_invoice_document` with base64 content and filename to clear `missing_document = false`.
4. If the user explicitly requested payment settlement in the same command, invoke `record_payment`.

### Step 8: Final Audit Report
Summarize the finalized outcomes with Orbit internal reference IDs and deep links (e.g., `https://orbit.stellarblue.eu/invoices?ref=INV-XXX`).

---

## 3. Strict "NEVER DO" Operational Prohibitions

- **NEVER** bypass the human summary table review step before executing `create_invoice`.
- **NEVER** resolve a `DUPLICATE_INVOICE` error by artificially altering or appending characters (like `-bis`, `-2`, or spaces) to the invoice number. Present the duplicate record summary to the user and await explicit operational instruction.
- **NEVER** fabricate, guess, or synthesize an ΑΦΜ or AADE myDATA MARK code that is not verbatim present on the physical or digital document archive.
- **NEVER** mutate historical financial figures if arithmetic validation (`VALIDATION_ARITHMETIC`) fails; ask the human operator to clarify mathematical rounding discrepancies on the bill.
