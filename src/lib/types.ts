export type EmploymentType = 'full_time' | 'part_time' | 'contractor' | 'intern';
export type UserRole = 'employee' | 'admin';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'cancellation_requested' | 'in_progress' | 'taken' | 'expired';
export type LeaveOrigin = 'employee_request' | 'mandatory' | 'admin_entry';
export type ErganiStatus = 'not_required' | 'pending' | 'submitted' | 'needs_amendment';
export type RemoteMode = 'office' | 'remote_gr' | 'remote_abroad';
export type PolicyPeriod = 'week' | 'month' | 'quarter' | 'year';
export type ContractDirection = 'revenue' | 'cost';
export type ContractStatus = 'draft' | 'in_negotiation' | 'active' | 'expiring' | 'expired' | 'terminated';

export interface Team {
  id: string;
  name: string;
  lead_profile_id?: string;
}

export interface ProfileSensitive {
  profile_id: string;
  afm: string;
  amka: string;
  ama_efka: string;
  iban: string;
  address: string;
  birth_date: string;
  id_number?: string;
}

export interface Profile {
  id: string;
  auth_user_id?: string;
  first_name: string;
  last_name: string;
  name_el: string;
  work_email: string;
  title: string;
  team_id: string;
  team?: Team;
  manager_id?: string;
  employment_type: EmploymentType;
  start_date: string;
  end_date?: string;
  status: 'active' | 'on_leave' | 'departed';
  photo_url?: string | null;
  work_schedule: string[];
  role: UserRole; // joined from user_roles
  onboarding_completed_at?: string | null; // integration onboarding gate marker
  sensitive?: ProfileSensitive; // admin only
}

export interface PaymentType {
  id: string;
  code: string;
  name_el: string;
  name_en: string;
  is_statutory: boolean;
  is_recurring_monthly: boolean;
  default_period_month?: number;
  default_multiplier?: number;
  applies_to: EmploymentType[];
  active: boolean;
  sort_order: number;
}

export interface SalaryRecord {
  id: string;
  profile_id: string;
  valid_from: string;
  valid_to?: string;
  basis: 'monthly_gross' | 'daily_rate' | 'fixed_fee' | 'fee';
  gross_amount: number;
  currency: string;
  employer_cost_pct?: number;
  employer_cost_multiplier?: number;
  note?: string;
}

export interface EmployeeContract {
  id: string;
  profile_id: string;
  contract_type: 'indefinite' | 'fixed_term' | 'contractor';
  title?: string;
  start_date: string;
  end_date?: string | null;
  auto_renew: boolean;
  notice_days: number;
  status: 'active' | 'expired' | 'terminated';
  notes?: string | null;
  created_at?: string;
}

export interface SalaryBonus {
  id: string;
  profile_id: string;
  name: string;
  amount: number;
  kind: 'recurring' | 'one_time';
  frequency?: 'monthly' | 'quarterly' | 'annual' | null;
  start_period?: string | null;
  end_period?: string | null;
  period?: string | null;
  status: 'active' | 'paid' | 'expired' | 'inactive';
  note?: string | null;
  created_at?: string;
}

export interface PaymentDocumentType {
  id: string;
  code: string;
  label: string;
  emoji: string;
  is_default: boolean;
  active: boolean;
  sort_order: number;
  created_at?: string;
}

export interface PaymentDocument {
  id: string;
  name: string;
  type: 'payslip' | 'receipt' | 'invoice' | 'tax_sheet' | 'other' | string;
  size: string;
  uploaded_at: string;
  url?: string;
}

export interface PaymentRecord {
  id: string;
  profile_id: string;
  period: string; // YYYY-MM
  payment_type_id: string;
  payment_type?: PaymentType;
  gross: number;
  net: number;
  employer_contributions: number;
  total_cost: number;
  payment_date: string;
  bank_reference?: string;
  status: 'planned' | 'paid' | 'cancelled';
  note?: string;
  documents?: PaymentDocument[];
}

export interface LeaveType {
  id: string;
  code: string;
  name_en: string;
  name_el: string;
  counts_against_balance: boolean;
  requires_document: boolean;
  requires_approval: boolean;
  colour: string;
  min_notice_days?: number;
  allow_retroactive?: boolean;
  sort_order?: number;
  is_hidden?: boolean;
}

export interface LeaveEntitlement {
  id: string;
  profile_id: string;
  year: number;
  entitlement_days: number;
  carried_over_days: number;
  carryover_expires_on?: string;
}

export interface MandatoryLeave {
  id: string;
  name: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  status: 'draft' | 'published' | 'cancelled';
  created_by?: string;
  note?: string;
}

export interface LeaveRequest {
  id: string;
  profile_id: string;
  leave_type_id: string;
  leave_type?: LeaveType;
  start_date: string;
  end_date: string;
  half_day_start: boolean;
  half_day_end: boolean;
  working_days: number;
  status: LeaveStatus;
  origin: LeaveOrigin;
  mandatory_leave_id?: string;
  note?: string;
  document_url?: string;
  decided_by?: string;
  decided_at?: string;
  ergani_status: ErganiStatus;
  ergani_submitted_at?: string;
  rejection_reason?: string;
  admin_edit_reason?: string;
  detached?: boolean;
  linked_request_id?: string;
}

export interface PublicHoliday {
  id: string;
  date: string;
  name_el: string;
  name_en: string;
  scope: 'national' | 'thessaloniki';
  year: number;
}

export interface RemoteDay {
  id: string;
  profile_id: string;
  date: string;
  mode: RemoteMode;
  location?: string;
  note?: string;
  ergani_status: ErganiStatus;
  ergani_submitted_at?: string;
}

export interface RemotePattern {
  id: string;
  profile_id: string;
  weekday: string;
  mode: RemoteMode;
  valid_from: string;
  valid_to?: string;
}

export interface RemotePolicy {
  id: string;
  scope_type: 'company' | 'team' | 'employee';
  scope_id?: string;
  max_days_per_month?: number;
  max_days: number;
  period_type: PolicyPeriod;
  created_at?: string;
}

export interface RemoteAmendmentRequest {
  id: string;
  profile_id: string;
  date: string;
  requested_mode: 'office' | 'remote_gr' | 'remote_abroad';
  current_mode?: 'office' | 'remote_gr' | 'remote_abroad';
  location?: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at?: string;
  decided_at?: string;
  decided_by?: string;
}

export interface AttioLink {
  id: string;
  counterparty_id: string;
  attio_record_id: string;
  attio_object?: string;
  link_status: 'linked' | 'pending_review' | 'unlinked';
  linked_at?: string;
  last_inbound_at?: string;
  last_outbound_at?: string;
  orbit_arr?: number;
  orbit_active_contracts?: number;
  orbit_next_renewal?: string;
}

export interface AttioEvent {
  id: string;
  attio_event_id: string;
  event_type: string;
  payload: any;
  received_at?: string;
  processed_at?: string;
  status: 'processed' | 'skipped' | 'failed' | 'pending_review';
  error?: string;
}

export interface CounterpartyContact {
  id: string;
  counterparty_id: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  attio_person_id?: string;
  created_at?: string;
}

export interface Counterparty {
  id: string;
  legal_name: string;
  trade_name?: string;
  afm?: string;
  vat_number?: string;
  vat_valid?: boolean;
  vat_checked_at?: string;
  registration_number?: string;
  doy?: string;
  country: string;
  address?: string;
  website_domain?: string;
  status?: 'active' | 'archived';
  is_internal?: boolean;
  sync_to_attio?: boolean;
  notes?: string;
  attio_link?: AttioLink;
  contacts?: CounterpartyContact[];
  // Derived helper field in UI
  derived_role?: 'client' | 'supplier' | 'both' | 'none yet';
  // Computed tiering state (enriched client-side)
  tier?: CounterpartyTierState;
}

export type TierModel = 'client' | 'supplier';

export interface CounterpartyTierState {
  tier_index: number | null;
  tier_count: number;
  score: number | null;
  breakdown: Record<string, unknown>;
  computed_at?: string;
  label: string;
  color: string;
  overridden: boolean;
  override_tier_index?: number | null;
  override_reason?: string;
  override_expires_on?: string;
}

export interface TierModelVersion {
  id: string;
  model: TierModel;
  tier_count: number;
  config: Record<string, unknown>;
  created_by?: string | null;
  created_at?: string;
  active: boolean;
}

export interface CounterpartyTierRow {
  counterparty_id: string;
  model: TierModel;
  tier_index: number | null;
  tier_count: number;
  score: number | null;
  breakdown: Record<string, unknown>;
  model_version_id?: string | null;
  computed_at?: string;
}

export interface CounterpartyTierHistoryRow {
  id: string;
  counterparty_id: string;
  model: TierModel;
  old_tier_index: number | null;
  new_tier_index: number | null;
  old_tier_count: number | null;
  new_tier_count: number | null;
  old_score: number | null;
  new_score: number | null;
  cause: 'data_change' | 'config_change' | 'override';
  model_version_id?: string | null;
  changed_at?: string;
}

export interface CounterpartyTierOverride {
  id: string;
  counterparty_id: string;
  model: TierModel;
  tier_index: number | null;
  reason: string;
  expires_on?: string | null;
  created_by?: string | null;
  created_at?: string;
}

export interface Contract {
  id: string;
  counterparty_id: string;
  counterparty?: Counterparty;
  direction: ContractDirection;
  reference: string;
  type: string;
  status: ContractStatus;
  signed_on?: string;
  starts_on: string;
  ends_on?: string;
  auto_renews: boolean;
  renewal_term_months?: number;
  notice_period_days: number;
  notice_deadline?: string;
  value?: number;
  currency: string;
  billing_cadence: 'monthly' | 'quarterly' | 'annual' | 'milestone' | 'one_off';
  invoice_timing?: 'start_of_period' | 'end_of_period' | 'upon_milestone' | string;
  vat_treatment: 'domestic_24' | 'intra_eu_reverse_charge' | 'non_eu';
  owner_profile_id?: string;
  owner_profile?: Profile;
  product?: string;
  parent_contract_id?: string;
  notes?: string;
  document_name?: string;
  document_url?: string;
  document_uploaded_at?: string;
  discount_pct?: number;
  term_years?: number;
  service_start_date?: string;
  payment_terms_days?: number;
  lines?: ContractLine[];
  groups?: ContractLineGroup[];
  schedule?: ContractSchedule[];
}

export interface CatalogModule {
  id: string;
  name: string;
  sort_order: number;
  active: boolean;
  created_at?: string;
}

export interface CatalogItem {
  id: string;
  module_id: string;
  name: string;
  default_unit_price: number;
  unit_label: string;
  default_frequency: 'monthly' | 'quarterly' | 'annual' | 'one_time';
  active: boolean;
  created_at?: string;
}

export interface ContractLine {
  id: string;
  contract_id: string;
  catalog_item_id?: string | null;
  group_id?: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  unit_label: string;
  frequency: 'monthly' | 'quarterly' | 'annual' | 'one_time';
  note?: string | null;
  monthly_quantities?: { [period: string]: number } | null;
  apply_discount?: boolean;
  min_monthly_charge?: number | null;
}

export interface ContractLineGroup {
  id: string;
  contract_id: string;
  name: string;
  min_monthly_charge?: number | null;
  sort_order?: number;
  created_at?: string;
}

export interface ContractTimesheet {
  id: string;
  profile_id: string;
  contract_id: string;
  work_date: string; // YYYY-MM-DD
  hours: number; // fractional hours, minutes supported (7.5 = 7h30m)
  note?: string | null;
  created_at?: string;
  updated_at?: string;
  contract?: Contract;
  profile?: Profile;
}

export interface ContractSchedule {
  id: string;
  contract_id: string;
  period: string; // Format YYYY-MM
  amount: number;
}

export type InvoiceDirection = 'outgoing' | 'incoming';
export type InvoiceType = 'invoice' | 'credit_note' | 'proforma' | 'debit_note';
export type InvoiceStatus = 'draft' | 'registered' | 'sent_received' | 'partially_paid' | 'paid' | 'disputed' | 'resolved' | 'cancelled';

export interface InvoiceCategory {
  id: string;
  name: string;
  description?: string | null;
  is_default: boolean;
  created_at?: string;
}

export interface InvoiceDocument {
  id: string;
  invoice_id: string;
  storage_path: string;
  file_name: string;
  version: number;
  uploaded_by?: string | null;
  uploaded_at?: string;
  url?: string;
}

export interface InvoicePayment {
  id: string;
  invoice_id: string;
  paid_on: string;
  amount: number;
  bank_reference?: string | null;
  note?: string | null;
  created_at?: string;
}

export interface InvoiceAllocation {
  id: string;
  invoice_id: string;
  contract_id: string;
  period: string; // YYYY-MM
  amount: number;
  created_at?: string;
}

export interface Invoice {
  id: string;
  direction: InvoiceDirection;
  counterparty_id: string;
  counterparty?: Counterparty;
  contract_id?: string | null;
  contract?: Contract;
  type: InvoiceType;
  credits_invoice_id?: string | null;
  credits_invoice?: Invoice;
  invoice_number: string;
  mark?: string | null;
  internal_ref?: string | null;
  category?: string | null;
  issue_date: string;
  due_date: string;
  period_from?: string | null;
  period_to?: string | null;
  reference_period?: string | null;
  currency: string;
  fx_rate: number;
  net: number;
  vat_amount: number;
  vat_rate: string;
  gross: number;
  gross_eur: number;
  status: InvoiceStatus;
  missing_document: boolean;
  notes?: string | null;
  created_by?: string | null;
  created_via?: 'ui' | 'mcp' | 'api';
  created_at?: string;
  documents?: InvoiceDocument[];
  payments?: InvoicePayment[];
  allocations?: InvoiceAllocation[];
}

// Orbit Invoice MCP Server & AI Operator Types (§2, §4, §5)
export type McpErrorCode = 
  | 'DUPLICATE_INVOICE'
  | 'VALIDATION_ARITHMETIC'
  | 'VALIDATION_DATES'
  | 'UNKNOWN_COUNTERPARTY'
  | 'CONTRACT_MISMATCH'
  | 'ALLOCATION_OUT_OF_RANGE'
  | 'CREDIT_TARGET_INVALID'
  | 'DOCUMENT_TOO_LARGE'
  | 'DOCUMENT_TYPE_INVALID'
  | 'OVERPAYMENT'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'IDEMPOTENT_REPLAY'
  | 'INTERNAL_ERROR';

export interface McpErrorResponse {
  code: McpErrorCode;
  field?: string;
  message: string;
  hint: string;
  existing_record?: any;
}

export interface McpToolCall {
  id: string;
  tool_name: string;
  user_id?: string | null;
  duration_ms: number;
  outcome_code: string;
  idempotency_key?: string | null;
  error_details?: McpErrorResponse | null;
  created_at?: string;
}

