import { McpErrorCode, McpErrorResponse } from '@/lib/types';

/**
 * Orbit MCP Error Contract (§5 of requirements)
 * Every rejection returns machine-readable {code, field, message, hint, existing_record?} 
 * so Claude can self-correct or surface a precise question to the human operator.
 */

export function createMcpError(
  code: McpErrorCode,
  message: string,
  hint: string,
  field?: string,
  existingRecord?: any
): McpErrorResponse {
  return {
    code,
    ...(field ? { field } : {}),
    message,
    hint,
    ...(existingRecord ? { existing_record: existingRecord } : {})
  };
}

export const McpErrors = {
  duplicateInvoice: (invoiceNumber: string, existingRecord: any) =>
    createMcpError(
      'DUPLICATE_INVOICE',
      `An invoice with number "${invoiceNumber}" for this counterparty and direction already exists in Orbit's common registry.`,
      'A matching invoice already exists in Orbit. Present this existing record summary to the human operator and ask if they wish to proceed with a corrected re-issue under a modified reference number or abort.',
      'invoice_number',
      existingRecord
    ),

  validationArithmetic: (net: number, vat: number, expectedGross: number, actualGross: number) =>
    createMcpError(
      'VALIDATION_ARITHMETIC',
      `Arithmetic mismatch: net (€${net.toFixed(2)}) + VAT (€${vat.toFixed(2)}) equals €${(net + vat).toFixed(2)}, but gross amount was specified as €${actualGross.toFixed(2)}.`,
      'Check the math on the scanned document. In Orbit, net + vat_amount must equal gross exactly to the cent after accounting for standard European rounding rules.',
      'gross'
    ),

  validationDates: (message: string, field: string = 'issue_date') =>
    createMcpError(
      'VALIDATION_DATES',
      `Date validation failure: ${message}.`,
      'Ensure issue_date is prior to or equal to due_date and is not dated more than 30 days into the future.',
      field
    ),

  unknownCounterparty: (query: string) =>
    createMcpError(
      'UNKNOWN_COUNTERPARTY',
      `No active corporate entity matched "${query}" in Orbit's verified Counterparty Registry.`,
      'No active counterparty exists with this identifier or ΑΦΜ in Orbit. Stop and ask the human operator for guidance; never fabricate or guess an unverified entity name.',
      'counterparty_id'
    ),

  contractMismatch: (contractRef: string, reason: string) =>
    createMcpError(
      'CONTRACT_MISMATCH',
      `Contract relationship mismatch for "${contractRef}": ${reason}.`,
      'Verify that the selected contract ID is assigned to the identical counterparty and that its revenue/cost direction aligns with the invoice direction.',
      'contract_id'
    ),

  allocationOutOfRange: (message: string) =>
    createMcpError(
      'ALLOCATION_OUT_OF_RANGE',
      `Schedule allocation failure: ${message}.`,
      'Ensure that scheduled period allocations sum to less than or equal to the total invoice gross net of credit notes, and map to valid billing horizons.',
      'allocations'
    ),

  creditTargetInvalid: (targetId: string) =>
    createMcpError(
      'CREDIT_TARGET_INVALID',
      `Credit note references invalid or mismatched parent invoice ID "${targetId}".`,
      'A credit note must reference an existing active invoice ID assigned to the identical corporate counterparty.',
      'credits_invoice_id'
    ),

  documentTooLarge: (sizeMb: number) =>
    createMcpError(
      'DOCUMENT_TOO_LARGE',
      `Decoded file size (${sizeMb.toFixed(2)} MB) exceeds the maximum allowed upload limit of 10.00 MB.`,
      'Invoice tax document attachments must not exceed 10 MB decoded.',
      'content_base64'
    ),

  documentTypeInvalid: (detectedType: string) =>
    createMcpError(
      'DOCUMENT_TYPE_INVALID',
      `Unsupported archive file format detected: "${detectedType}". Only PDF, PNG, and JPEG formats are accepted.`,
      'Only valid PDF (.pdf), PNG (.png), and JPEG (.jpg/.jpeg) files verified via magic bytes are acceptable as official tax archives.',
      'filename'
    ),

  overpayment: (attempted: number, remaining: number) =>
    createMcpError(
      'OVERPAYMENT',
      `Payment amount (€${attempted.toFixed(2)}) exceeds the open receivable/payable balance of €${remaining.toFixed(2)}.`,
      'Check the open balance on the invoice; cumulative settlement payments cannot exceed the contractual invoice gross amount.',
      'amount'
    ),

  forbidden: () =>
    createMcpError(
      'FORBIDDEN',
      'Access denied. Your mapped Orbit OAuth session does not possess systemic admin authorization.',
      'Invoices and financial registries are admin-only corporate capabilities. Only verified administrators can execute this MCP server tool.',
      'auth'
    ),

  rateLimited: (limit: number) =>
    createMcpError(
      'RATE_LIMITED',
      `Rate limit exceeded (${limit} tool invocations/min).`,
      'You are issuing automated tool calls too quickly. Pause briefly before attempting your next execution turn.',
      'system'
    ),

  internalError: (message: string) =>
    createMcpError(
      'INTERNAL_ERROR',
      `An internal system processing exception occurred: ${message}.`,
      'Report this failure trace to systemic engineering if persistent.',
      'system'
    )
};
