import { McpErrors } from './errors';
import { McpErrorResponse, Invoice, Contract, Counterparty } from '@/lib/types';

/**
 * Orbit MCP & UI Server-side Validation Layer (§1 & §2.2)
 * Ensures 100% adherence to financial arithmetic, date boundaries, referential consistency,
 * and canonical VAT normalization without duplicating rules between UI and AI operators.
 */

export function normalizeAfm(vat: string | undefined | null): string {
  if (!vat) return '';
  let cleaned = vat.trim().toUpperCase();
  // Remove common country codes if prefixing a numeric sequence
  cleaned = cleaned.replace(/^(EL|GR|NL|DE|FR|IT|ES|CY|GB|UK)\s*/, '');
  // Remove spaces and hyphens
  cleaned = cleaned.replace(/[-\s]/g, '');
  return cleaned;
}

export interface InvoiceCreationPayload {
  direction: 'outgoing' | 'incoming';
  counterparty_id: string;
  contract_id?: string | null;
  type?: 'invoice' | 'credit_note' | 'proforma' | 'debit_note';
  credits_invoice_id?: string | null;
  invoice_number: string;
  mark?: string | null;
  category?: string | null;
  issue_date: string;
  due_date?: string;
  period_from?: string | null;
  period_to?: string | null;
  currency?: string;
  fx_rate?: number;
  net: number;
  vat_amount: number;
  vat_rate?: string;
  gross: number;
  notes?: string | null;
  allocations?: Array<{
    contract_id: string;
    period: string;
    amount: number;
  }>;
}

export function validateInvoiceCreation(
  payload: InvoiceCreationPayload,
  existingInvoices: Invoice[],
  counterparty?: Counterparty,
  contract?: Contract
): { valid: true; warnings: string[]; applied_defaults: Record<string, any> } | { valid: false; error: McpErrorResponse } {
  const warnings: string[] = [];
  const applied_defaults: Record<string, any> = {};

  // 1. Check if Counterparty exists and is valid
  if (!counterparty && !payload.counterparty_id) {
    return { valid: false, error: McpErrors.unknownCounterparty(payload.counterparty_id || 'unspecified') };
  }

  // 2. Arithmetic validation: Net + VAT == Gross (cent exact after European rounding)
  const expectedGross = Number((payload.net + payload.vat_amount).toFixed(2));
  const actualGross = Number(payload.gross.toFixed(2));
  if (Math.abs(expectedGross - actualGross) > 0.01) {
    return {
      valid: false,
      error: McpErrors.validationArithmetic(payload.net, payload.vat_amount, expectedGross, actualGross)
    };
  }

  // 3. Date sanity check
  const issueDateObj = new Date(payload.issue_date);
  if (isNaN(issueDateObj.getTime())) {
    return { valid: false, error: McpErrors.validationDates('issue_date is not a valid date format', 'issue_date') };
  }
  
  // Issue date not > 30 days in future
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
  if (issueDateObj > thirtyDaysFromNow) {
    return { valid: false, error: McpErrors.validationDates('issue_date cannot be more than 30 days into the future', 'issue_date') };
  }

  // Due date check or default application
  let effectiveDueDate = payload.due_date;
  if (!effectiveDueDate) {
    // Default due date from contract payment terms days (or Net 30 default)
    const termsDays = contract?.payment_terms_days || 30;
    const dueObj = new Date(issueDateObj);
    dueObj.setDate(dueObj.getDate() + termsDays);
    effectiveDueDate = dueObj.toISOString().slice(0, 10);
    applied_defaults.due_date = effectiveDueDate;
  } else {
    const dueObj = new Date(effectiveDueDate);
    if (isNaN(dueObj.getTime())) {
      return { valid: false, error: McpErrors.validationDates('due_date is not a valid date format', 'due_date') };
    }
    if (dueObj < issueDateObj) {
      return { valid: false, error: McpErrors.validationDates('due_date cannot precede issue_date', 'due_date') };
    }
  }

  // 4. Duplicate Check: (counterparty_id, direction, invoice_number)
  const duplicate = existingInvoices.find(
    inv =>
      inv.counterparty_id === payload.counterparty_id &&
      inv.direction === payload.direction &&
      inv.invoice_number.trim().toLowerCase() === payload.invoice_number.trim().toLowerCase() &&
      inv.status !== 'cancelled'
  );

  if (duplicate) {
    return { valid: false, error: McpErrors.duplicateInvoice(payload.invoice_number, duplicate) };
  }

  // 5. Contract Relationship Consistency
  if (contract && payload.contract_id) {
    if (contract.counterparty_id && contract.counterparty_id !== payload.counterparty_id) {
      return { valid: false, error: McpErrors.contractMismatch(contract.reference || contract.id, 'Contract counterparty does not match invoice counterparty.') };
    }
    if (payload.direction === 'outgoing' && contract.direction === 'cost') {
      return { valid: false, error: McpErrors.contractMismatch(contract.reference || contract.id, 'Cannot register outgoing AR revenue invoice against a Supplier Cost contract.') };
    }
    if (payload.direction === 'incoming' && contract.direction === 'revenue') {
      return { valid: false, error: McpErrors.contractMismatch(contract.reference || contract.id, 'Cannot register incoming AP supplier invoice against a Client Revenue contract.') };
    }
    // Apply contract defaults if missing in payload
    if (!payload.vat_rate && contract.vat_treatment) {
      applied_defaults.vat_rate = (contract.vat_treatment === 'intra_eu_reverse_charge' || contract.vat_treatment === 'non_eu') ? '0% (Reverse Charge / Exempt)' : '24%';
    }
  }

  // 6. Credit Note Target Validation
  if (payload.type === 'credit_note') {
    if (!payload.credits_invoice_id) {
      return { valid: false, error: McpErrors.creditTargetInvalid('Unspecified Target Invoice ID') };
    }
    const parent = existingInvoices.find(i => i.id === payload.credits_invoice_id);
    if (!parent || parent.counterparty_id !== payload.counterparty_id) {
      return { valid: false, error: McpErrors.creditTargetInvalid(payload.credits_invoice_id) };
    }
  }

  // 7. Allocations Sum Check
  if (payload.allocations && payload.allocations.length > 0) {
    const sumAllocated = payload.allocations.reduce((acc, a) => acc + (Number(a.amount) || 0), 0);
    if (sumAllocated > actualGross + 0.01) {
      return { valid: false, error: McpErrors.allocationOutOfRange(`Total allocated amount (€${sumAllocated.toFixed(2)}) exceeds invoice gross (€${actualGross.toFixed(2)})`) };
    }
    // Tolerance warning check
    if (Math.abs(sumAllocated - actualGross) / actualGross > 0.02) {
      warnings.push(`Allocation total variance from invoice gross exceeds ±2% tolerance limit (€${sumAllocated.toFixed(2)} vs €${actualGross.toFixed(2)}).`);
    }
  }

  return { valid: true, warnings, applied_defaults };
}
