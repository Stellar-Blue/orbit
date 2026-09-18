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

export interface CompanyProfile {
  id: number;
  name: string;
  vat_number: string | null;
  logo_url: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ProfileSensitive {
  profile_id: string;
  afm: string;
  amka: string;
  ama_efka: string;
  iban: string;
  /** Payout bank name, e.g. Eurobank Ergasias. Optional. */
  bank_name?: string | null;
  /** SWIFT/BIC of the payout bank, 8 or 11 characters. Optional. */
  bank_swift?: string | null;
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
  /** Directory-level contact phone (non-sensitive, visible to staff like work email). */
  phone?: string | null;
  /**
   * Legacy free-text job title (defaulted to a meaningless "Team Member"). Superseded by the
   * effective-dated Role & Seniority assignment in `profile_role_history`; no longer written
   * from the People directory and only kept so historic rows still read back.
   */
  title?: string | null;
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
  contracted_weekly_hours?: number | null;
  onboarding_completed_at?: string | null; // integration onboarding gate marker
  slack_required?: boolean; // admin-controlled: must this user connect Slack?
  sensitive?: ProfileSensitive; // admin only
}

export interface PaymentType {
  id: string;
  code: string;
  name_el: string;
  name_en: string;
  is_statutory: boolean;
  is_recurring_monthly: boolean;
  /** `null` clears an existing statutory month (the DB column is nullable). */
  default_period_month?: number | null;
  default_multiplier?: number | null;
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
  employer_cost_pct?: number | null;
  employer_cost_multiplier?: number | null;
  /** Absolute monthly employer cost in EUR (full company cost − gross). Preferred over the legacy multiplier. */
  employer_cost_amount?: number | null;
  /**
   * Optional total company cost per month as the accountant bills it. Not always known, so it is
   * filled in later. `gross_amount` is the NET, the gross is derived (net + employer cost).
   */
  full_company_cost?: number | null;
  note?: string;
  /**
   * Ledger entry kind. `base` (default) = the base rate; `recurring_extra` = a contractual monthly
   * extra (benefit); `one_time_bonus` = a single-month bonus. Everything paid is a ledger row.
   */
  entry_type?: 'base' | 'recurring_extra' | 'one_time_bonus';
  /** Extra/bonus name — the payroll draft note. NULL for base rows. */
  label?: string | null;
  /** Optional Dynamic Payment Type a recurring extra / one-off bonus is filed under. */
  payment_type_id?: string | null;
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

/** Company-wide leave policy (singleton row). default_annual_days is the default per-year allowance. */
export interface LeavePolicy {
  id: boolean;
  default_annual_days: number;
  updated_at?: string;
  updated_by?: string | null;
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
  counts_leave?: boolean;
  /** Company-wide rule: remote days must be registered N calendar days in advance (0 = disabled). */
  registration_advance_days?: number;
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

export interface RemoteQuotaRequest {
  id: string;
  profile_id: string;
  date: string;
  requested_mode: 'office' | 'remote_gr' | 'remote_abroad';
  location?: string;
  reason?: string;
  period_used?: number;
  period_max?: number;
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

export interface Role {
  id: string;
  name: string;
  slug: string;
  attio_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CounterpartyRole {
  counterparty_id: string;
  role_id: string;
  role?: Role;
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
  // Multiple explicit roles
  roles?: Role[];
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
  pricing_kind?: 'unit' | 'man_hours';
  role?: string | null;
  seniority?: 'junior' | 'mid' | 'senior' | null;
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
  /** When this line is invoiced: 'start_of_period' (advance), 'end_of_period' (arrears) or null to inherit the contract's timing. */
  invoice_timing?: 'start_of_period' | 'end_of_period' | null;
  /** First month this line charges (YYYY-MM-DD); null = from the contract's own start. */
  starts_on?: string | null;
  /** Last month this line charges (YYYY-MM-DD, inclusive); null = until the contract's own end. */
  ends_on?: string | null;
  line_kind?: 'unit' | 'man_hours';
  role?: string | null;
  seniority?: 'junior' | 'mid' | 'senior' | null;
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
  contract_line_id?: string | null;
  work_date: string; // YYYY-MM-DD
  hours: number; // fractional hours, minutes supported (7.5 = 7h30m)
  note?: string | null;
  created_at?: string;
  updated_at?: string;
  contract?: Contract;
  contract_line?: ContractLine;
  profile?: Profile;
}

// --- Timesheet v2 (§13 of orbit-timesheet-requirements.md) ---
export interface JobRole {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
  created_at?: string;
}

export interface SeniorityLevel {
  id: string;
  name: string;
  rank: number;
  active: boolean;
  created_at?: string;
}

export interface ProfileRoleHistory {
  id: string;
  profile_id: string;
  job_role_id: string;
  seniority_id: string;
  valid_from: string;
  valid_to?: string | null;
  created_at?: string;
}

export interface RateCard {
  id: string;
  name: string;
  currency: string;
  contract_id?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  is_default: boolean;
  notes?: string | null;
  created_at?: string;
}

export interface RateCardEntry {
  id: string;
  rate_card_id: string;
  job_role_id: string;
  seniority_id: string;
  hourly_rate?: number | null;
  daily_rate?: number | null;
  created_at?: string;
}

export type ProjectStatus = 'planned' | 'in_progress' | 'done' | 'active' | 'on_hold' | 'completed' | 'archived';

/** Friendly labels + badge styling for the delivery lifecycle (legacy values included). */
export const PROJECT_STATUS_META: Record<ProjectStatus, { label: string; badge: string }> = {
  planned: { label: 'Planned', badge: 'bg-slate-100 text-slate-700 border-slate-200' },
  in_progress: { label: 'In Progress', badge: 'bg-blue-50 text-[#3D87D3] border-blue-200' },
  done: { label: 'Done', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  active: { label: 'Active (legacy)', badge: 'bg-blue-50 text-[#3D87D3] border-blue-200' },
  on_hold: { label: 'On Hold', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  completed: { label: 'Completed (legacy)', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  archived: { label: 'Archived', badge: 'bg-slate-100 text-slate-500 border-slate-200' },
};
export interface Project {
  id: string;
  contract_id?: string | null;
  name: string;
  code?: string | null;
  status: ProjectStatus;
  owner_profile_id?: string | null;
  default_billable: boolean;
  budget_hours?: number | null;
  /** Effort budget in days, entered alongside the hours budget. */
  budget_days?: number | null;
  budget_value?: number | null;
  /** Planned window (starts_on/ends_on) and the dates the work really ran. */
  starts_on?: string | null;
  ends_on?: string | null;
  actual_start_on?: string | null;
  actual_end_on?: string | null;
  created_at?: string;
  contract?: Contract;
  owner_profile?: Profile;
}

export interface ProjectLink {
  id: string;
  project_id: string;
  title?: string | null;
  url: string;
  /** Icon hint: 'linear' | 'docs' | 'repo' | 'other'. */
  kind?: string | null;
  created_at?: string;
  created_by?: string | null;
}

export interface ProjectDocument {
  id: string;
  project_id: string;
  file_name: string;
  storage_path: string;
  url?: string | null;
  file_size?: number | null;
  mime_type?: string | null;
  uploaded_by?: string | null;
  uploaded_at?: string;
}

export type WorkItemKind = 'feature' | 'epic' | 'task' | 'workstream';
export interface WorkItem {
  id: string;
  project_id: string;
  name: string;
  kind: WorkItemKind;
  linear_issue_id?: string | null;
  status: 'open' | 'in_progress' | 'done' | 'blocked';
  budget_hours?: number | null;
  created_at?: string;
}

export interface ProjectAssignment {
  id: string;
  project_id: string;
  profile_id: string;
  job_role_id: string;
  seniority_id: string;
  rate_override?: number | null;
  valid_from?: string | null;
  valid_to?: string | null;
  created_at?: string;
}

export interface ProjectRoleForecast {
  id: string;
  project_id: string;
  job_role_id: string;
  seniority_id: string;
  forecast_hours: number;
  created_at?: string;
  updated_at?: string;
}

export type TimeEntryStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'locked';
export interface TimeEntry {
  id: string;
  profile_id: string;
  work_date: string; // YYYY-MM-DD
  minutes: number;
  project_id: string;
  work_item_id?: string | null;
  note?: string | null;
  billable: boolean;
  status: TimeEntryStatus;
  job_role_id?: string | null;
  seniority_id?: string | null;
  billing_rate?: number | null;
  rate_source?: string | null;
  cost_rate?: number | null;
  currency: string;
  submitted_at?: string | null;
  decided_by?: string | null;
  decided_at?: string | null;
  locked_at?: string | null;
  invoice_id?: string | null;
  anomaly_flags?: unknown[];
  created_at?: string;
  updated_at?: string;
  project?: Project;
  work_item?: WorkItem;
}

export interface TimesheetPeriod {
  id: string;
  period: string; // YYYY-MM
  status: 'open' | 'closed';
  closed_by?: string | null;
  closed_at?: string | null;
  created_at?: string;
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

export interface InvoiceLink {
  id: string;
  invoice_id: string;
  title: string | null;
  url: string;
  created_at: string;
  created_by?: string;
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
  // AADE myDATA QR verification-page URL (myDATA-mirrored invoices only; opens the public
  // ΑΑΔΕ "Επιβεβαίωση Παραστατικού" page — the only document AADE serves for ERP-channel docs).
  qr_url?: string | null;
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
  notes?: string | null;
  status: InvoiceStatus;
  missing_document?: boolean;
  links?: InvoiceLink[];
  allocations?: InvoiceAllocation[];
  payments?: InvoicePayment[];
  category_id?: string | null;
  budget_category?: BudgetCategory;
  created_by?: string | null;
  created_via?: 'ui' | 'mcp' | 'api';
  created_at?: string;
  documents?: InvoiceDocument[];
}

export interface BudgetCategory {
  id: string;
  name: string;
  direction: 'expense' | 'income';
  sort_order: number;
  active: boolean;
  created_at?: string;
}

export interface Budget {
  id: string;
  fiscal_year: number;
  status: 'draft' | 'active' | 'archived';
  revision_of?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface BudgetLine {
  id: string;
  budget_id: string;
  category_id: string;
  period: string; // YYYY-MM
  amount: number;
  currency: string;
  source_type: 'manual' | 'contract' | 'payroll';
  source_id?: string | null;
  created_at?: string;
}

export interface RecurringCommitment {
  id: string;
  category_id: string;
  name: string;
  amount: number;
  frequency: 'monthly' | 'quarterly' | 'yearly';
  start_date: string;
  end_date?: string | null;
  created_at?: string;
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

