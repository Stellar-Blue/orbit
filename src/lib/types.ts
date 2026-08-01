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
  photo_url?: string;
  work_schedule: string[];
  role: UserRole; // joined from user_roles
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

export interface Counterparty {
  id: string;
  legal_name: string;
  afm?: string;
  doy?: string;
  country: string;
  address?: string;
  notes?: string;
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
  lines?: ContractLine[];
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
  name: string;
  unit_price: number;
  quantity: number;
  unit_label: string;
  frequency: 'monthly' | 'quarterly' | 'annual' | 'one_time';
  note?: string | null;
}

export interface ContractSchedule {
  id: string;
  contract_id: string;
  period: string; // Format YYYY-MM
  amount: number;
}
