"use client";

import React, { createContext, useContext, useState, useEffect, useMemo, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { getSupabaseBrowserClient, setDemoDataMode, SIGNED_URL_TTL_SECONDS } from '@/lib/supabase/client';
import { 
  Profile, Team, PaymentType, SalaryRecord, PaymentRecord, PaymentDocument, 
  LeaveType, LeaveEntitlement, MandatoryLeave, LeaveRequest, 
  PublicHoliday, RemoteDay, RemotePattern, Counterparty, Contract, RemoteMode, RemotePolicy, RemoteAmendmentRequest, RemoteQuotaRequest,
  CounterpartyTierRow, CounterpartyTierHistoryRow, CounterpartyTierOverride, TierModelVersion,
  CatalogModule, CatalogItem, ContractLine, ContractLineGroup, ContractTimesheet, ContractSchedule, AttioLink, AttioEvent, CounterpartyContact,
  Invoice, InvoiceCategory, InvoiceDocument, InvoicePayment, InvoiceAllocation, PaymentDocumentType,
  Budget, BudgetCategory, BudgetLine, RecurringCommitment,
  EmployeeContract,
  JobRole, SeniorityLevel, ProfileRoleHistory, RateCard, RateCardEntry, Project, WorkItem, ProjectAssignment, ProjectRoleForecast, TimeEntry, TimesheetPeriod,
  Role, CounterpartyRole, CompanyProfile, LeavePolicy,
  CoverageGroup, CoverageGroupMember, CoverageLoadRow, LeaveExceptionRequest
} from './types';
import { coverageGroupsForProfile, toCoverageLoadRows, expandDateRange, type CoverageKind } from './coverage-rules';
import { toHiddenScreenKeys } from './screens';
import { slicesForPath, withDependencies, tablesForSlices, type DataSliceKey } from './data-slices';
import { isDemoMode, exitDemoMode } from './demo-mode';
import {
  MOCK_TEAMS, MOCK_PROFILES, MOCK_PAYMENT_TYPES, MOCK_SALARIES, MOCK_PAYMENTS,
  MOCK_LEAVE_TYPES, MOCK_ENTITLEMENTS, MOCK_MANDATORY_LEAVES,
  MOCK_PUBLIC_HOLIDAYS, MOCK_REMOTE_PATTERNS,
  MOCK_COUNTERPARTIES, MOCK_CONTRACTS,
} from './mock-data';
import { deductedDaysInYear, countWorkingDays, holidayDates, resolveWorkSchedule, needsWorkingDaysRecount, publishedClosureIds, mandatoryRowDeducts, splitAcrossYears } from './leave-days';
import {
  carryoverDays, carryoverExpiryDate, carryoverExpired, remainingOfYear, previousYearHasClosed,
  carryoverWarningLevel, autoCarryoverBookingPlan, groupAdjacentDays, DEFAULT_WARNING_MONTHS,
  type CarryoverPolicy, type CarryoverWarningLevel,
} from './leave-carryover';
import { calculateContractValuation } from './pricing-engine';
import { contractChargeMonths } from './revenue-schedule';
import { employerCostRatio, loadedMonthlyCost, isBaseSalary, loadedExtraCost } from './compensation';
import { startRealtimeSync } from './realtime-sync';
import { scoreCounterparty, buildHistoryDeltas, tierLabel, type TierModelConfig, type TierDataContext, type TierModel } from './tiering-engine';
import { enqueueStatusSync, athensTodayStr } from './integrations/client';
import { DEFAULT_SLACK_SETTINGS, EMPLOYEE_INTEGRATION_COLUMNS, type EmployeeIntegration, type IntegrationExemption, type IntegrationSettings } from './integrations/types';
import { notifySuccess } from './validation-modal';

/**
 * Every `profiles` column `authenticated` may read. `phone` is column-revoked (migration
 * 20261027104236) and mirrored in the RLS table `profile_phones`, so `select('*')` fails with
 * 42501 "permission denied for table profiles" — the whole directory (and with it the signed-in
 * identity) would come back empty. Reads must name the columns; `fetchProfilePhones` merges the
 * phone back in.
 */
const PROFILE_COLUMNS = [
  'id', 'auth_user_id', 'first_name', 'last_name', 'name_el', 'work_email', 'title',
  'team_id', 'manager_id', 'employment_type', 'start_date', 'end_date', 'status', 'photo_url',
  'work_schedule', 'created_at', 'onboarding_completed_at', 'seniority_level',
  'contracted_weekly_hours', 'slack_required',
].join(',');

/** `*` is not selectable on tables with column-level grants; use their explicit column lists. */
const selectForTable = (table: string, requested?: string): string =>
  requested || (table === 'profiles'
    ? PROFILE_COLUMNS
    : table === 'employee_integrations'
      ? EMPLOYEE_INTEGRATION_COLUMNS
      : '*');

/** Payload for create/update of a coverage group (rule + custom member list). */
export interface CoverageGroupInput {
  id?: string;
  name: string;
  scope_type: 'team' | 'custom';
  team_id: string | null;
  max_remote_per_day: number | null;
  max_leave_per_day: number | null;
  active?: boolean;
  /** Custom groups only: the complete replacement member list. */
  memberIds?: string[];
}

/** Payload for an employee's coverage exception request on a blocked leave request. */
export interface LeaveExceptionInput {
  profile_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  working_days: number;
  note?: string | null;
  reason?: string | null;
  group_id?: string | null;
}

/**
 * One line of the carry-over dry run: what the automatic rule derives for one (employee, year)
 * against what the entitlement record currently holds. `planLeaveCarryover` returns these read-only
 * and `syncLeaveCarryover` writes exactly them, so a preview can never disagree with the run.
 */
export interface CarryoverPlanRow {
  profileId: string;
  profileName: string;
  year: number;
  /** What the entitlement record holds today — `null` when there is no record for that year yet. */
  stored: number | null;
  /** What the automatic rule derives from the closed year's remainder, after the policy cap. */
  derived: number;
  /** An admin typed this value, so the recalculation never overwrites it. */
  isManual: boolean;
  /** Allowance the record has (or will keep, or will be created with). */
  entitlementDays: number;
  /** Due date the derived pot would get, when the policy sets one. */
  expiresOn?: string;
}

/** Outcome of a carry-over recalculation, including what actually moved. */
export interface CarryoverSyncResult {
  created: number;
  updated: number;
  /** Records skipped because an admin set them by hand. */
  manual: number;
  /** Only the records whose stored value actually changed. */
  changes: Array<{ profileId: string; profileName: string; year: number; from: number; to: number }>;
}

/**
 * A personal leave row whose stored `working_days` does not match the count its own dates imply.
 * The balance is deducted by the STORED number, so one of these quietly poisons the year it sits in
 * and every carry-over derived from that year.
 */
export interface StaleLeaveDayCount {
  id: string;
  profileId: string;
  profileName: string;
  startDate: string;
  endDate: string;
  stored: number;
  computed: number;
}

interface AppState {
  currentUser: Profile;
  profiles: Profile[];
  teams: Team[];
  paymentTypes: PaymentType[];
  salaries: SalaryRecord[];
  payments: PaymentRecord[];
  leaveTypes: LeaveType[];
  entitlements: LeaveEntitlement[];
  mandatoryLeaves: MandatoryLeave[];
  leaveRequests: LeaveRequest[];
  publicHolidays: PublicHoliday[];
  remoteDays: RemoteDay[];
  remotePatterns: RemotePattern[];
  remotePolicies: RemotePolicy[];
  remoteAmendmentRequests: RemoteAmendmentRequest[];
  remoteQuotaRequests: RemoteQuotaRequest[];
  coverageGroups: CoverageGroup[];
  coverageGroupMembers: CoverageGroupMember[];
  leaveExceptionRequests: LeaveExceptionRequest[];
  /** Keys of screens an admin has hidden from non-admins. Admins always see everything. */
  hiddenScreens: string[];
  counterparties: Counterparty[];
  counterpartyRoles: Role[];
  counterpartyRoleLinks: CounterpartyRole[];
  attioEvents: AttioEvent[];
  contracts: Contract[];
  catalogModules: CatalogModule[];
  catalogItems: CatalogItem[];
  contractLines: ContractLine[];
  contractSchedules: ContractSchedule[];
  tierModelVersions: TierModelVersion[];
  tierStates: CounterpartyTierRow[];
  tierHistory: CounterpartyTierHistoryRow[];
  tierOverrides: CounterpartyTierOverride[];
  invoices: Invoice[];
  invoiceCategories: InvoiceCategory[];
  invoiceDocuments: InvoiceDocument[];
  invoicePayments: InvoicePayment[];
  invoiceAllocations: InvoiceAllocation[];
  budgets: Budget[];
  budgetCategories: BudgetCategory[];
  budgetLines: BudgetLine[];
  recurringCommitments: RecurringCommitment[];
  updateInvoiceCategory: (invoiceId: string, categoryId: string | null) => Promise<boolean>;
  isDevMode: boolean;
  isViewAsEmployee: boolean;
  setIsViewAsEmployee: (val: boolean | ((prev: boolean) => boolean)) => void;
  realUserRole: 'admin' | 'employee' | string;
  /** Id of the specific employee currently being previewed (admin-only preview). */
  previewProfileId: string | null;
  startPreviewAs: (profileId: string) => void;
  stopPreview: () => void;
  isLoading: boolean;
  /** True inside the public `/demo` workspace: sample rows, no Supabase, actions are not saved. */
  isDemo: boolean;
  signOut: () => Promise<void> | void;
  companyProfile: CompanyProfile | null;
  updateCompanyProfile: (profile: Partial<CompanyProfile>) => Promise<boolean>;
  
  // Actions for immediate optimistic mutation in UI
  switchUser: (profileId: string) => void;
  updateProfile: (profile: Profile) => void;
  /** Self-service edits. `title` is intentionally absent: the legacy job title is replaced by the
   *  effective-dated Role & Seniority assignment, which only admins set. */
  updateMyProfile: (edits: Partial<Pick<Profile, 'first_name' | 'last_name' | 'name_el' | 'phone'>> & { photo_url?: string | null }) => Promise<boolean>;
  employeeIntegrations: EmployeeIntegration[];
  addProfile: (profile: Profile) => Promise<boolean>;
  deleteProfile: (profileId: string) => Promise<boolean>;
  addLeaveRequest: (req: Omit<LeaveRequest, 'id'>) => void;
  updateLeaveRequestStatus: (id: string, status: LeaveRequest['status'], rejectionReason?: string) => void;
  addMandatoryLeave: (ml: Omit<MandatoryLeave, 'id'>) => void;
  updateMandatoryLeave: (id: string, updated: Partial<MandatoryLeave>) => Promise<void>;
  deleteMandatoryLeave: (id: string) => Promise<void>;
  /** Re-runs the fan-out for every live mandatory closure (catch-up for new hires / reactivated staff). */
  syncAllMandatoryLeaves: () => Promise<{ closures: number; added: number; updated: number; removed: number }>;
  addPaymentRecord: (pay: Omit<PaymentRecord, 'id'>) => void;
  updatePaymentRecord: (id: string, updates: Partial<PaymentRecord>) => Promise<void>;
  deletePaymentRecord: (id: string) => Promise<void>;
  markAllPaidForPeriod: (period: string) => Promise<void>;
  addPaymentDocuments: (paymentId: string, docs: PaymentDocument[]) => void;
  updatePaymentDocumentType: (paymentId: string, documentId: string, type: string) => void;
  deletePaymentDocument: (paymentId: string, documentId: string) => void;
  generateDraftMonth: (period: string) => Promise<void>;
  backfillSalaryPayments: (salaryId: string) => Promise<{ created: number; skipped: number }>;
  addPaymentType: (type: Omit<PaymentType, 'id' | 'sort_order'>) => Promise<void>;
  updatePaymentType: (id: string, updates: Partial<PaymentType>) => Promise<boolean>;
  deletePaymentType: (id: string) => Promise<boolean>;
  documentTypes: PaymentDocumentType[];
  addDocumentType: (dt: Omit<PaymentDocumentType, 'id' | 'sort_order'>) => Promise<boolean>;
  updateDocumentType: (id: string, updates: Partial<PaymentDocumentType>) => Promise<boolean>;
  deleteDocumentType: (id: string) => Promise<boolean>;
  employeeContracts: EmployeeContract[];
  addEmployeeContract: (c: Omit<EmployeeContract, 'id'>) => Promise<boolean>;
  updateEmployeeContract: (id: string, updates: Partial<EmployeeContract>) => Promise<boolean>;
  addSalaryRecord: (record: Omit<SalaryRecord, 'id'>) => Promise<void>;
  updateSalaryRecord: (id: string, updates: Partial<SalaryRecord>) => Promise<void>;
  deleteSalaryRecord: (id: string) => Promise<boolean>;
  addContract: (cnt: Omit<Contract, 'id'>) => Promise<Contract | null>;
  updateContract: (cnt: Contract) => void;
  deleteContract: (id: string) => Promise<boolean>;
  addCounterparty: (cp: Partial<Counterparty>, attioRecordId?: string) => Promise<Counterparty | null>;
  updateCounterparty: (cp: Counterparty) => Promise<boolean>;
  deleteCounterparty: (id: string) => Promise<boolean>;
  deleteAllCounterparties: () => Promise<boolean>;
  syncAttioRoles: () => Promise<boolean>;
  linkToAttio: (counterpartyId: string, attioRecordId: string) => Promise<boolean>;
  processAttioReviewEvent: (eventId: string, action: 'confirm' | 'link' | 'skip', targetCpId?: string) => Promise<boolean>;
  reconcileAttio: () => Promise<void>;
  reassignContracts: (fromCpId: string, contractIds: string[], toCpId: string) => Promise<boolean>;
  mergeCounterparties: (targetId: string, sourceId: string) => Promise<{ ok: boolean; counts?: Record<string, unknown>; error?: string }>;
  addCounterpartyContact: (contact: Partial<CounterpartyContact>) => Promise<boolean>;
  recomputeTiers: (model: 'client' | 'supplier', cause: 'data_change' | 'config_change' | 'override') => Promise<{ ok: boolean; changes: CounterpartyTierHistoryRow[]; error?: string }>;
  applyTierModelConfig: (model: 'client' | 'supplier', config: Record<string, unknown>, tierCount: number) => Promise<{ ok: boolean; changes: CounterpartyTierHistoryRow[]; error?: string }>;
  setTierOverride: (counterpartyId: string, model: 'client' | 'supplier', tierIndex: number | null, reason: string, expiresOn?: string) => Promise<boolean>;
  updateErganiStatus: (id: string, entity: 'leave' | 'remote', status: 'not_required' | 'pending' | 'submitted' | 'needs_amendment') => void;
  saveRemotePattern: (profileId: string, patternEntries: { weekday: string; mode: RemoteMode }[]) => Promise<boolean>;
  updateRemotePolicy: (id: string, updated: Partial<RemotePolicy>) => Promise<void>;
  setEmployeeRemoteQuota: (profileId: string, quota: { max_days: number; period_type: RemotePolicy['period_type']; counts_leave: boolean } | null) => Promise<boolean>;
  addRemoteDay: (day: Omit<RemoteDay, 'id'> & { id?: string }) => void;
  bulkAddRemoteDays: (profileId: string, declarations: { date: string; mode: RemoteMode | 'office'; location?: string; note?: string }[]) => Promise<boolean>;
  timesheets: ContractTimesheet[];
  addTimesheet: (entry: Omit<ContractTimesheet, 'id' | 'created_at' | 'updated_at'> & { id?: string }) => Promise<boolean>;
  updateTimesheet: (id: string, updates: Partial<Pick<ContractTimesheet, 'hours' | 'note' | 'work_date' | 'contract_id' | 'contract_line_id'>>) => Promise<boolean>;
  deleteTimesheet: (id: string) => Promise<boolean>;
  jobRoles: JobRole[];
  seniorityLevels: SeniorityLevel[];
  profileRoleHistory: ProfileRoleHistory[];
  rateCards: RateCard[];
  rateCardEntries: RateCardEntry[];
  projects: Project[];
  workItems: WorkItem[];
  projectAssignments: ProjectAssignment[];
  timeEntries: TimeEntry[];
  timesheetPeriods: TimesheetPeriod[];
  saveJobRole: (r: Partial<JobRole> & { name: string }) => Promise<boolean>;
  deleteJobRole: (id: string) => Promise<boolean>;
  saveSeniorityLevel: (s: Partial<SeniorityLevel> & { name: string }) => Promise<boolean>;
  deleteSeniorityLevel: (id: string) => Promise<boolean>;
  setProfileRole: (profileId: string, jobRoleId: string | null, seniorityId: string | null, validFrom: string) => Promise<boolean>;
  updateProfileRoleHistory: (id: string, patch: Partial<ProfileRoleHistory>) => Promise<boolean>;
  deleteProfileRoleHistory: (id: string) => Promise<boolean>;
  leavePolicy: LeavePolicy | null;
  /** Company default annual leave days (fallback when an employee has no per-year record). */
  leaveDefaultDays: number;
  saveLeavePolicy: (updates: Partial<LeavePolicy>) => Promise<boolean>;
  saveLeaveEntitlement: (e: { id?: string; profile_id: string; year: number; entitlement_days: number; carried_over_days?: number; carryover_expires_on?: string | null }) => Promise<boolean>;
  deleteLeaveEntitlement: (id: string) => Promise<boolean>;
  saveRateCard: (c: Partial<RateCard> & { name: string }) => Promise<boolean>;
  deleteRateCard: (id: string) => Promise<boolean>;
  ensureContractRateCard: (contractId: string) => Promise<string | null>;
  saveRateCardEntry: (e: Omit<RateCardEntry, 'id'> & { id?: string }) => Promise<boolean>;
  deleteRateCardEntry: (id: string) => Promise<boolean>;
  saveProject: (p: Omit<Project, 'id'> & { id?: string }) => Promise<boolean>;
  deleteProject: (id: string) => Promise<boolean>;
  saveWorkItem: (w: Omit<WorkItem, 'id'> & { id?: string }) => Promise<boolean>;
  deleteWorkItem: (id: string) => Promise<boolean>;
  saveProjectAssignment: (a: Omit<ProjectAssignment, 'id'> & { id?: string }) => Promise<boolean>;
  deleteProjectAssignment: (id: string) => Promise<boolean>;
  projectRoleForecasts: ProjectRoleForecast[];
  saveProjectRoleForecast: (e: Omit<ProjectRoleForecast, 'id'> & { id?: string }) => Promise<boolean>;
  deleteProjectRoleForecast: (id: string) => Promise<boolean>;
  saveTimeEntry: (e: Omit<TimeEntry, 'id' | 'created_at' | 'updated_at'> & { id?: string }) => Promise<boolean>;
  deleteTimeEntry: (id: string) => Promise<boolean>;
  submitWeek: (profileId: string, from: string, to: string) => Promise<boolean>;
  decideTimeEntries: (ids: string[], status: 'approved' | 'rejected') => Promise<boolean>;
  requestRemoteAmendment: (payload: { date: string; requested_mode: RemoteMode | 'office'; reason: string; location?: string }) => Promise<boolean>;
  decideRemoteAmendment: (id: string, status: 'approved' | 'rejected') => Promise<boolean>;
  requestRemoteQuotaOverride: (payload: { date: string; requested_mode: RemoteMode | 'office'; location?: string; reason?: string; period_used?: number; period_max?: number }) => Promise<boolean>;
  decideRemoteQuotaRequest: (id: string, status: 'approved' | 'rejected') => Promise<boolean>;
  /** Employee withdraws their own still-pending remote-quota exception request. */
  cancelRemoteQuotaRequest: (id: string) => Promise<boolean>;
  editLeaveRequest: (id: string, updated: Partial<LeaveRequest>, editReason?: string) => void;
  requestLeaveCancellation: (id: string) => Promise<boolean>;
  decideLeaveCancellation: (id: string, approve: boolean) => void;
  /** Employee withdraws their own still-pending leave request. */
  cancelLeaveRequest: (id: string) => Promise<boolean>;
  deleteLeaveRequest: (id: string) => Promise<boolean>;
  splitAndAddLeaveRequest: (req: Omit<LeaveRequest, 'id'>, workSchedule: string[], holidays: PublicHoliday[]) => void;
  /** Admin: create or update a coverage group (rule + members) in one call. */
  saveCoverageGroup: (payload: CoverageGroupInput) => Promise<boolean>;
  deleteCoverageGroup: (id: string) => Promise<boolean>;
  /** Raw per-day absence counts for one group, straight from the coverage_load RPC. */
  getCoverageLoad: (groupId: string, from: string, to: string) => Promise<CoverageLoadRow[]>;
  /**
   * Per-day absence counts for every active coverage group containing this employee that
   * caps `kind`. Non-admins cannot read colleagues' rows, so this is the only way the
   * client can tell whether a declaration would break a rule.
   */
  getCoverageLoadForProfile: (profileId: string, kind: CoverageKind, from: string, to: string) => Promise<{ group: CoverageGroup; rows: CoverageLoadRow[] }[]>;
  /** Employee: ask an admin to override the coverage rule blocking a leave request. */
  requestLeaveException: (payload: LeaveExceptionInput) => Promise<boolean>;
  /** Admin: decide a leave coverage exception (approving files the leave as an admin entry). */
  decideLeaveException: (id: string, approve: boolean) => Promise<boolean>;
  /** Admin: hide or show one screen for every non-admin. */
  setScreenHidden: (screenKey: string, hidden: boolean) => Promise<boolean>;
  /** Carry-in for a year, derived live from the closed previous year's remainder (0 if none). */
  getDerivedCarryover: (profileId: string, year: number) => number;
  /** Write the derived carry-over into `leave_entitlements` rows (skips manually set values). */
  syncLeaveCarryover: (targetProfileId?: string) => Promise<CarryoverSyncResult | null>;
  /** The SAME walk as the sync, without writing — drives the preview table in Settings → Leaves. */
  planLeaveCarryover: (targetProfileId?: string) => CarryoverPlanRow[];
  /** Personal leave rows whose stored day count disagrees with their dates (see the type). */
  staleLeaveDayCounts: () => StaleLeaveDayCount[];
  /** Drop the MANUAL flag on one record and adopt the calculated value for it. */
  releaseLeaveEntitlementToAuto: (profileId: string, year: number) => Promise<boolean>;
  /** Due date, untaken days and warning level for an employee's expiring carry-over pot. */
  getCarryoverStatus: (profileId: string, year?: number) => {
    year: number;
    expiresOn: string | null;
    level: CarryoverWarningLevel;
    warningMonths: number;
    carryOver: number;
    daysAtRisk: number;
    expiredDays: number;
    autoBook: boolean;
  };
  /** Book whatever is left of an expiring carry-over pot on the last working days before it expires. */
  syncCarryoverExpiryBookings: (targetProfileId?: string) => Promise<{ rows: number; days: number; employees: number } | null>;
  addTeam: (name: string, leadProfileId?: string) => Promise<boolean>;
  updateTeam: (id: string, name: string, leadProfileId?: string) => Promise<boolean>;
  deleteTeam: (id: string) => Promise<boolean>;
  addLeaveType: (payload: Omit<LeaveType, 'id'>) => Promise<boolean>;
  updateLeaveType: (id: string, payload: Partial<LeaveType>) => Promise<boolean>;
  deleteLeaveType: (id: string) => Promise<boolean>;
  /**
   * Public-holiday calendar (Settings → Leaves → Public Holidays). Editing it re-costs the leave
   * rows the change reaches — see `syncLeaveCostsForHolidayChange`.
   */
  addPublicHoliday: (payload: Omit<PublicHoliday, 'id'>) => Promise<{ ok: boolean; recosted: number }>;
  updatePublicHoliday: (id: string, payload: Partial<PublicHoliday>) => Promise<{ ok: boolean; recosted: number }>;
  deletePublicHoliday: (id: string) => Promise<{ ok: boolean; recosted: number }>;
  getEmployeeLeaveBalance: (profileId: string, year: number) => {
    entitlement: number;
    carryOver: number;
    carryOverExpires: string;
    taken: number;
    reserved: number;
    mandatory: number;
    available: number;
  };
  saveContractPricing: (contractId: string, lines: Omit<ContractLine, 'id' | 'contract_id'>[], schedules: { period: string; amount: number }[], discount_pct: number, term_years: number, service_start_date: string, calculatedValue: number, groups?: Omit<ContractLineGroup, 'contract_id'>[]) => Promise<boolean>;
  saveCatalogModule: (module: Partial<CatalogModule> & { name: string }) => Promise<boolean>;
  deleteCatalogModule: (id: string) => Promise<boolean>;
  saveCatalogItem: (item: Partial<CatalogItem> & { module_id: string; name: string; default_unit_price: number; unit_label: string; default_frequency: 'monthly' | 'quarterly' | 'annual' | 'one_time' }) => Promise<boolean>;
  deleteCatalogItem: (id: string) => Promise<boolean>;
  addInvoice: (inv: Omit<Invoice, 'id' | 'created_at' | 'counterparty' | 'contract' | 'documents' | 'payments' | 'allocations'>) => Promise<Invoice | null>;
  updateInvoice: (id: string, updates: Partial<Invoice>) => Promise<boolean>;
  deleteInvoice: (id: string) => Promise<boolean>;
  updateInvoiceStatus: (id: string, status: Invoice['status'], notes?: string) => Promise<boolean>;
  linkInvoiceToContract: (invoiceId: string, contractId: string, allocations: { period: string; amount: number }[], markAsPaid: boolean) => Promise<boolean>;
  recordInvoicePayment: (invoiceId: string, paidOn: string, amount: number, bankRef?: string, note?: string) => Promise<boolean>;
  addInvoiceDocument: (invoiceId: string, doc: Omit<InvoiceDocument, 'id' | 'uploaded_at'>) => Promise<boolean>;
  saveInvoiceAllocation: (invoiceId: string, contractId: string, period: string, amount: number) => Promise<boolean>;
  generateBudgetFromContracts: (budgetId: string, fiscalYear: number) => Promise<boolean>;
  generateBudgetFromPayroll: (budgetId: string, fiscalYear: number) => Promise<boolean>;
  refreshBudget: (fiscalYear: number) => Promise<boolean>;
  addInvoiceCategory: (name: string, description?: string) => Promise<boolean>;
  deleteInvoiceCategory: (id: string) => Promise<boolean>;
  slackIntegration: EmployeeIntegration | null;
  myIntegrationExemption: IntegrationExemption | null;
  integrationSettings: IntegrationSettings;
  integrationExceptions: { exceptions: { id: string; type: string; profile_id: string | null; reason: string | null; created_at: string; orbit_kind: string; operation: string }[]; revoked: { id: string; profile_id: string; profile_name: string | null; revoked_at: string | null }[]; notConnectedCount: number };
  integrationLastReconciledAt: string | null;
  refreshIntegrationState: () => Promise<void>;
  syncSlackStatus: (profileId: string, date: string, orbitId?: string) => Promise<void>;
  revokeSlackConnection: () => Promise<void>;
  refreshInvoices: () => Promise<void>;
  /**
   * Load extra data on demand (with dependencies). Used by surfaces that need a slice the current
   * route does not render — the command palette searching contracts from any screen.
   */
  ensureData: (keys: DataSliceKey[]) => Promise<void>;
}

/**
 * Tables the boot slice always loads (directory + master data shared by every screen). They are
 * the only realtime subscriptions that exist before a route asks for its own slice.
 */
const CORE_TABLES = [
  'profiles', 'user_roles', 'profile_sensitive', 'teams',
  'job_roles', 'seniority_levels', 'profile_role_history',
  'screen_visibility', 'company_profile', 'leave_policy', 'integration_settings',
  'public_holidays', 'leave_types', 'employee_integrations', 'integration_exemptions',
];

const AuthContext = createContext<AppState | undefined>(undefined);

const generateUUID = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
};

const signInvoiceDocuments = async (
  supabase: ReturnType<typeof getSupabaseBrowserClient>,
  rows: InvoiceDocument[]
): Promise<InvoiceDocument[]> => {
  return Promise.all(rows.map(async (doc) => {
    const isMockPath = typeof doc.storage_path === 'string' && doc.storage_path.startsWith('mcp_invoices/');
    if (isMockPath || !doc.storage_path) {
      return { ...doc, url: undefined };
    }

    const { data: signed } = await supabase.storage
      .from('invoices')
      .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);

    return { ...doc, url: signed?.signedUrl || undefined };
  }));
};

/**
 * Phone numbers the caller is allowed to see: every row for an admin, own row for an employee.
 * `profiles.phone` is column-revoked from `authenticated`, so profile reads use `PROFILE_COLUMNS`
 * (never `*`) and the value is merged in from the admin/self-only RLS table `profile_phones`
 * (a row-level-secured mirror, migration 20261027104737).
 *
 * Returns `null` when the lookup itself is unavailable (migration not applied yet, or a transient
 * error): callers then keep whatever phone came back with the row. Never return an empty map for
 * "unavailable" — that would wipe every phone number on load.
 */
const fetchProfilePhones = async (
  supabase: ReturnType<typeof getSupabaseBrowserClient>
): Promise<Map<string, string | null> | null> => {
  try {
    const { data, error } = await supabase.from('profile_phones').select('id, phone');
    if (error) {
      console.warn('[profiles] phone directory unavailable, using row values:', error.message);
      return null;
    }
    return new Map((data || []).map((r: { id: string; phone: string | null }) => [r.id, r.phone]));
  } catch (e) {
    console.warn('[profiles] phone lookup failed, using row values:', e);
    return null;
  }
};

/**
 * The employee's own confirmed payment rows.
 *
 * `policy_payments_employee_select` (0008) keys on `profiles.auth_user_id`, which several
 * directory profiles still lack, so the browser's direct SELECT returns nothing for those
 * employees. The service-role route resolves the caller the same way current_profile_id()
 * does and returns only their own paid rows, so the "Confirmed Payment History" grid is not
 * hostage to the unlinked rows. Returns null when the read failed — callers must leave their
 * slice alone rather than blank it.
 */
async function fetchOwnPaidPayments(): Promise<PaymentRecord[] | null> {
  try {
    const res = await fetch('/api/compensation/payments', { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    return Array.isArray(json?.payments) ? (json.payments as PaymentRecord[]) : [];
  } catch (e) {
    console.warn('[payments] own-ledger fetch failed:', e);
    return null;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isDemo, setIsDemo] = useState<boolean>(false);
  /** Real Supabase auth user id — gates the live row-change subscription (anon has no rows to hear about). */
  const [liveSessionUserId, setLiveSessionUserId] = useState<string>('');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [isDevMode, setIsDevMode] = useState<boolean>(true);
  const [isViewAsEmployee, setIsViewAsEmployee] = useState<boolean>(false);
  const [previewProfileId, setPreviewProfileId] = useState<string | null>(null);
  const [realProfileId, setRealProfileId] = useState<string>('');
  /** The loader's authoritative answer (a `user_roles` lookup), mirrored for the live gate below. */
  const sessionIsAdminRef = useRef(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [paymentTypes, setPaymentTypes] = useState<PaymentType[]>([]);  const [salaries, setSalaries] = useState<SalaryRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [entitlements, setEntitlements] = useState<LeaveEntitlement[]>([]);
  const [mandatoryLeaves, setMandatoryLeaves] = useState<MandatoryLeave[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [publicHolidays, setPublicHolidays] = useState<PublicHoliday[]>([]);
  const [remoteDays, setRemoteDays] = useState<RemoteDay[]>([]);
  const [timesheets, setTimesheets] = useState<ContractTimesheet[]>([]);
  const [jobRoles, setJobRoles] = useState<JobRole[]>([]);
  const [seniorityLevels, setSeniorityLevels] = useState<SeniorityLevel[]>([]);
  const [profileRoleHistory, setProfileRoleHistory] = useState<ProfileRoleHistory[]>([]);
  const [rateCards, setRateCards] = useState<RateCard[]>([]);
  const [rateCardEntries, setRateCardEntries] = useState<RateCardEntry[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [projectAssignments, setProjectAssignments] = useState<ProjectAssignment[]>([]);
  const [projectRoleForecasts, setProjectRoleForecasts] = useState<ProjectRoleForecast[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [timesheetPeriods, setTimesheetPeriods] = useState<TimesheetPeriod[]>([]);
  const [remotePatterns, setRemotePatterns] = useState<RemotePattern[]>([]);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);
  const [leavePolicy, setLeavePolicy] = useState<LeavePolicy | null>(null);
  const leaveDefaultDays = Number(leavePolicy?.default_annual_days ?? 22);
  const [remotePolicies, setRemotePolicies] = useState<RemotePolicy[]>([]);
  const [remoteAmendmentRequests, setRemoteAmendmentRequests] = useState<RemoteAmendmentRequest[]>([]);
  const [remoteQuotaRequests, setRemoteQuotaRequests] = useState<RemoteQuotaRequest[]>([]);
  const [coverageGroups, setCoverageGroups] = useState<CoverageGroup[]>([]);
  const [coverageGroupMembers, setCoverageGroupMembers] = useState<CoverageGroupMember[]>([]);
  const [leaveExceptionRequests, setLeaveExceptionRequests] = useState<LeaveExceptionRequest[]>([]);
  const [hiddenScreens, setHiddenScreens] = useState<string[]>([]);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [counterpartyRoles, setCounterpartyRoles] = useState<Role[]>([]);
  const [counterpartyRoleLinks, setCounterpartyRoleLinks] = useState<CounterpartyRole[]>([]);
  const [attioEvents, setAttioEvents] = useState<AttioEvent[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [catalogModules, setCatalogModules] = useState<CatalogModule[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [contractLines, setContractLines] = useState<ContractLine[]>([]);
  const [contractSchedules, setContractSchedules] = useState<ContractSchedule[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [tierModelVersions, setTierModelVersions] = useState<TierModelVersion[]>([]);
  const [tierStates, setTierStates] = useState<CounterpartyTierRow[]>([]);
  const [tierHistory, setTierHistory] = useState<CounterpartyTierHistoryRow[]>([]);
  const [tierOverrides, setTierOverrides] = useState<CounterpartyTierOverride[]>([]);
  const [documentTypes, setDocumentTypes] = useState<PaymentDocumentType[]>([]);
  const [employeeContracts, setEmployeeContracts] = useState<EmployeeContract[]>([]);
  const [invoiceCategories, setInvoiceCategories] = useState<InvoiceCategory[]>([]);
  const [invoiceDocuments, setInvoiceDocuments] = useState<InvoiceDocument[]>([]);
  const [invoicePayments, setInvoicePayments] = useState<InvoicePayment[]>([]);
  const [invoiceAllocations, setInvoiceAllocations] = useState<InvoiceAllocation[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [budgetCategories, setBudgetCategories] = useState<BudgetCategory[]>([]);
  const [budgetLines, setBudgetLines] = useState<BudgetLine[]>([]);
  const [recurringCommitments, setRecurringCommitments] = useState<RecurringCommitment[]>([]);
  const [slackIntegration, setSlackIntegration] = useState<EmployeeIntegration | null>(null);
  const [employeeIntegrations, setEmployeeIntegrations] = useState<EmployeeIntegration[]>([]);
  const [myIntegrationExemption, setMyIntegrationExemption] = useState<IntegrationExemption | null>(null);
  const [integrationSettings, setIntegrationSettings] = useState<IntegrationSettings>(DEFAULT_SLACK_SETTINGS);
  const [integrationExceptions, setIntegrationExceptions] = useState<{
    exceptions: { id: string; type: string; profile_id: string | null; reason: string | null; created_at: string; orbit_kind: string; operation: string }[];
    revoked: { id: string; profile_id: string; profile_name: string | null; revoked_at: string | null }[];
    notConnectedCount: number;
  }>({ exceptions: [], revoked: [], notConnectedCount: 0 });
  const [integrationLastReconciledAt, setIntegrationLastReconciledAt] = useState<string | null>(null);

  /* ------------------------------------------------------------------------- *
   * Route-scoped data loading (catalogue: lib/data-slices.ts)
   *
   * Orbit used to select every table on every load, so the dashboard paid for payroll ledgers,
   * invoice PDFs and Attio mirrors it never renders. Each slice is fetched the first time a route
   * needs it and then served from memory for the rest of the session, so egress is paid once per
   * screen that actually renders the data.
   * ------------------------------------------------------------------------- */
  const pathname = usePathname();
  const [bootReady, setBootReady] = useState(false);
  /** Bumped whenever a slice lands, so realtime re-subscribes to the tables now in view. */
  const [dataVersion, setDataVersion] = useState(0);
  const loadedSlicesRef = useRef<Set<DataSliceKey>>(new Set());
  const sliceLoadsRef = useRef<Map<DataSliceKey, Promise<void>>>(new Map());
  /** Identity the slice queries gate on, captured during boot. */
  const identityRef = useRef<{ isAdmin: boolean; profileId: string }>({ isAdmin: false, profileId: '' });
  /**
   * Raw rows later slices join against (counterparties/contracts, payment and leave types). They
   * live in a ref because a slice loads inside one render, before React has published the previous
   * slice's state.
   */
  const rawRef = useRef<{
    profiles: Profile[];
    leaveTypes: LeaveType[];
    paymentTypes: PaymentType[];
    counterparties: Counterparty[];
    contracts: Contract[];
    cpRoles: Role[];
    cpRoleLinks: CounterpartyRole[];
    tierVersions: TierModelVersion[];
    tierStates: CounterpartyTierRow[];
    tierOverrides: CounterpartyTierOverride[];
    budgetCategories: BudgetCategory[];
  }>({
    profiles: [], leaveTypes: [], paymentTypes: [],
    counterparties: [], contracts: [], cpRoles: [], cpRoleLinks: [],
    tierVersions: [], tierStates: [], tierOverrides: [], budgetCategories: [],
  });

  /** Gate a query the way the old one-shot loader did: admins read the company, everyone else own rows. */
  const fetchRows = async (
    table: string,
    gate: 'all' | 'own' | 'self' | 'admin',
    opts: { select?: string; order?: [string, boolean?]; limit?: number } = {}
  ): Promise<any[]> => {
    const { isAdmin, profileId } = identityRef.current;
    if (gate === 'admin' && !isAdmin) return [];
    if ((gate === 'own' || gate === 'self') && !profileId) return [];
    try {
      const supabase = getSupabaseBrowserClient();
      let query = supabase
        .from(table)
        .select(selectForTable(table, opts.select));
      if ((gate === 'own' && !isAdmin) || gate === 'self') query = query.eq('profile_id', profileId);
      if (opts.order) query = query.order(opts.order[0], { ascending: opts.order[1] ?? true });
      if (opts.limit) query = query.limit(opts.limit);
      const { data, error } = await query;
      if (error) {
        console.warn(`[data] ${table} read failed:`, error.message);
        return [];
      }
      return data || [];
    } catch (error) {
      console.warn(`[data] ${table} read threw:`, error);
      return [];
    }
  };

  /** Counterparties joined for display: Attio mirror, contacts, explicit roles and tier state. */
  function assembleCounterparties(args: {
    cps: Counterparty[];
    cpRoleLinks: CounterpartyRole[];
    cpRoles: Role[];
    contractRows: Contract[];
    attioLinks: AttioLink[];
    contacts: CounterpartyContact[];
    tierVersions: TierModelVersion[];
    tierStates: CounterpartyTierRow[];
    tierOverrides: CounterpartyTierOverride[];
  }): Counterparty[] {
    const { cps, cpRoleLinks, cpRoles, contractRows, attioLinks, contacts, tierVersions, tierStates, tierOverrides } = args;
    return cps.map(cp => {
      const attio_link = attioLinks.find(l => l.counterparty_id === cp.id);
      const cpContacts = contacts.filter(ct => ct.counterparty_id === cp.id);
      const cpContracts = contractRows.filter(c => c.counterparty_id === cp.id && (c.status as string) !== 'archived');
      const hasRevenue = cpContracts.some(c => (c.direction as string) === 'revenue');
      const hasCost = cpContracts.some(c => ['cost', 'supplier'].includes(c.direction as string));

      const explicitRoles = cpRoleLinks
        .filter(l => l.counterparty_id === cp.id)
        .map(l => cpRoles.find(r => r.id === l.role_id))
        .filter(Boolean) as Role[];

      // Map to lowercase slugs for easier derived calculations
      const combinedSlugs = new Set(explicitRoles.map(r => r.slug.toLowerCase()));
      if (hasRevenue) combinedSlugs.add('client');
      if (hasCost) combinedSlugs.add('supplier');

      const finalSlugs = Array.from(combinedSlugs);
      let derived_role: 'client' | 'supplier' | 'both' | 'none yet' = 'none yet';
      if (finalSlugs.includes('client') && finalSlugs.includes('supplier')) derived_role = 'both';
      else if (finalSlugs.includes('client')) derived_role = 'client';
      else if (finalSlugs.includes('supplier')) derived_role = 'supplier';

      return {
        ...cp,
        attio_link,
        contacts: cpContacts,
        derived_role,
        roles: finalSlugs.map(slug => cpRoles.find(r => r.slug === slug)).filter(Boolean) as Role[],
        tier: attachTierToCounterparty(cp, tierVersions, tierStates, tierOverrides),
      };
    });
  }

  /** Contracts joined for display: counterparty, owner, pricing lines, groups and schedule. */
  function assembleContracts(args: {
    rows: Contract[];
    counterparties: Counterparty[];
    profiles: Profile[];
    lines: ContractLine[];
    groups: ContractLineGroup[];
    schedule: ContractSchedule[];
  }): Contract[] {
    const { rows, counterparties, profiles: people, lines, groups, schedule } = args;
    return rows.map(cnt => ({
      ...cnt,
      counterparty: counterparties.find(c => c.id === cnt.counterparty_id),
      owner_profile: people.find(p => p.id === cnt.owner_profile_id),
      lines: lines.filter(l => l.contract_id === cnt.id),
      groups: groups.filter(g => g.contract_id === cnt.id),
      schedule: schedule.filter(s => s.contract_id === cnt.id),
    }));
  }


  /**
   * Demo workspace hydration: the same shapes the slices produce, filled from `mock-data.ts`.
   * Nothing here touches the network, so a demo can never read — or write — company records.
   */
  function hydrateDemoWorkspace() {
    const teams = MOCK_TEAMS;
    const demoProfiles: Profile[] = MOCK_PROFILES.map(p => ({
      ...p,
      team: teams.find(t => t.id === p.team_id),
    }));
    setTeams(teams);
    setProfiles(demoProfiles);
    rawRef.current.profiles = demoProfiles;

    const leaveTypes = [...MOCK_LEAVE_TYPES].sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100));
    setLeaveTypes(leaveTypes);
    rawRef.current.leaveTypes = leaveTypes;

    // Attendance and leave are generated around TODAY, not from the frozen mock rows, so the demo
    // always has one person on leave, one at home and one out of town — otherwise every sample
    // date ages out and the status scene collapses to "everyone in the office".
    const dayFromToday = (offset: number) => {
      const day = new Date(`${athensTodayStr()}T00:00:00`);
      day.setDate(day.getDate() + offset);
      // Local parts, not toISOString(): local midnight is the previous day in UTC.
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
    };
    const demoLeave = (
      id: string, profileId: string, typeId: string, from: number, to: number,
      status: LeaveRequest['status'], note: string,
    ): LeaveRequest => {
      const start = dayFromToday(from);
      const end = dayFromToday(to);
      return {
        id, profile_id: profileId, leave_type_id: typeId, start_date: start, end_date: end,
        half_day_start: false, half_day_end: false,
        working_days: countWorkingDays(start, end),
        status, origin: 'employee_request', note, ergani_status: 'not_required',
      };
    };

    const demoRequests: LeaveRequest[] = [
      demoLeave('demo-lr-1', 'prof-maria', 'lt-annual', -2, 3, 'approved', 'Autumn break'),
      demoLeave('demo-lr-2', 'prof-dimitris', 'lt-annual', 9, 13, 'approved', 'Family trip'),
      demoLeave('demo-lr-3', 'prof-giorgis', 'lt-annual', 18, 22, 'pending', 'Long weekend away'),
      demoLeave('demo-lr-4', 'prof-eleni', 'lt-annual', 5, 9, 'approved', 'Autumn break'),
      demoLeave('demo-lr-5', 'prof-eleni', 'lt-annual', 16, 17, 'pending', 'Long weekend'),
    ];
    setLeaveRequests(demoRequests.map(r => ({
      ...r,
      leave_type: leaveTypes.find(lt => lt.id === r.leave_type_id),
    })));
    setEntitlements(MOCK_ENTITLEMENTS);
    setMandatoryLeaves(MOCK_MANDATORY_LEAVES);
    setPublicHolidays(MOCK_PUBLIC_HOLIDAYS);
    setRemoteDays([
      { id: 'demo-rd-1', profile_id: 'prof-dimitris', date: dayFromToday(0), mode: 'remote_gr', note: 'Working from home', ergani_status: 'submitted' },
      { id: 'demo-rd-2', profile_id: 'prof-yannis', date: dayFromToday(0), mode: 'remote_abroad', location: 'London, UK', note: 'Energy summit', ergani_status: 'pending' },
      { id: 'demo-rd-3', profile_id: 'prof-alexandra', date: dayFromToday(1), mode: 'remote_gr', ergani_status: 'not_required' },
    ]);
    setRemotePatterns(MOCK_REMOTE_PATTERNS);

    setPaymentTypes(MOCK_PAYMENT_TYPES);
    rawRef.current.paymentTypes = MOCK_PAYMENT_TYPES;
    setSalaries(MOCK_SALARIES);
    setPayments(MOCK_PAYMENTS.map(p => ({
      ...p,
      documents: p.documents || [],
      payment_type: MOCK_PAYMENT_TYPES.find(pt => pt.id === p.payment_type_id),
    })));

    rawRef.current.counterparties = MOCK_COUNTERPARTIES;
    rawRef.current.contracts = MOCK_CONTRACTS;
    setCounterparties(MOCK_COUNTERPARTIES);
    setContracts(MOCK_CONTRACTS);

    setHiddenScreens([]);
    setIntegrationSettings(DEFAULT_SLACK_SETTINGS);
  }

  /** Directory + master data every screen shares. Loaded once, before any slice. */
  async function loadCoreSlice(initial: { loadedProfiles: Profile[]; matchedId: string }) {
    const { loadedProfiles, matchedId } = initial;
    const supabase = getSupabaseBrowserClient();
    const [teamsRows, roleRows, sensitiveRows, jobRows, seniorityRows, historyRows, screenRows,
      companyRes, policyRes, settingsRows, holidayRows, leaveTypeRows, integrationRows, exemptionRows] = await Promise.all([
      fetchRows('teams', 'all'),
      fetchRows('user_roles', 'all'),
      fetchRows('profile_sensitive', 'own'),
      fetchRows('job_roles', 'all', { order: ['sort_order'] }),
      fetchRows('seniority_levels', 'all', { order: ['rank'] }),
      fetchRows('profile_role_history', 'all'),
      fetchRows('screen_visibility', 'all'),
      supabase.from('company_profile').select('*').eq('id', 1).maybeSingle(),
      supabase.from('leave_policy').select('*').eq('id', true).maybeSingle(),
      fetchRows('integration_settings', 'all'),
      fetchRows('public_holidays', 'all'),
      fetchRows('leave_types', 'all', { order: ['sort_order'] }),
      fetchRows('employee_integrations', 'self'),
      fetchRows('integration_exemptions', 'self'),
    ]);

    const loadedTeams: Team[] = teamsRows;
    setTeams(loadedTeams);

    const finalProfiles: Profile[] = loadedProfiles.map(p => ({
      ...p,
      role: roleRows.some(r => r.profile_id === p.id && r.role === 'admin') ? 'admin' : 'employee',
      sensitive: sensitiveRows.find(s => s.profile_id === p.id),
      team: loadedTeams.find(t => t.id === p.team_id),
    }));
    setProfiles(finalProfiles);
    rawRef.current.profiles = finalProfiles;

    setJobRoles(jobRows as JobRole[]);
    setSeniorityLevels(seniorityRows as SeniorityLevel[]);
    setProfileRoleHistory(historyRows as ProfileRoleHistory[]);
    setHiddenScreens(toHiddenScreenKeys(screenRows));
    setCompanyProfile(companyRes.data || null);
    setLeavePolicy((policyRes.data as LeavePolicy) || null);
    setPublicHolidays(holidayRows as PublicHoliday[]);

    const loadedLeaveTypes: LeaveType[] = (leaveTypeRows as LeaveType[])
      .sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100));
    setLeaveTypes(loadedLeaveTypes);
    rawRef.current.leaveTypes = loadedLeaveTypes;

    // Own integration rows only — the full company list is the `integrations` slice, loaded by the
    // screens that actually show other people's connections.
    const myIntegrationRows = integrationRows as EmployeeIntegration[];
    setEmployeeIntegrations(myIntegrationRows);
    setSlackIntegration(matchedId
      ? (myIntegrationRows.find(i => i.provider === 'slack' && i.profile_id === matchedId) || null)
      : null);
    const activeExemptions = (exemptionRows as IntegrationExemption[])
      .filter(x => x.provider === 'slack' && (!x.expires_at || new Date(x.expires_at) > new Date()));
    setMyIntegrationExemption(activeExemptions.sort((a, b) => (a.expires_at || '').localeCompare(b.expires_at || ''))[0] || null);

    const settingsMap: Record<string, string> = {};
    settingsRows.forEach(r => { settingsMap[r.key] = r.value; });
    setIntegrationSettings({
      leave_label: settingsMap.leave_label ?? DEFAULT_SLACK_SETTINGS.leave_label,
      leave_emoji: settingsMap.leave_emoji ?? DEFAULT_SLACK_SETTINGS.leave_emoji,
      remote_label: settingsMap.remote_label ?? DEFAULT_SLACK_SETTINGS.remote_label,
      remote_emoji: settingsMap.remote_emoji ?? DEFAULT_SLACK_SETTINGS.remote_emoji,
      half_day_label: settingsMap.half_day_label ?? DEFAULT_SLACK_SETTINGS.half_day_label,
    });
    setIntegrationLastReconciledAt(settingsMap.last_reconciled_at ?? null);
  }

  async function loadLeaveSlice() {
    const [requestRows, entitlementRows, mandatoryRows, groupRows, memberRows, exceptionRows] = await Promise.all([
      fetchRows('leave_requests', 'own'),
      fetchRows('leave_entitlements', 'own'),
      fetchRows('mandatory_leaves', 'all'),
      fetchRows('coverage_groups', 'all', { order: ['created_at'] }),
      fetchRows('coverage_group_members', 'all'),
      fetchRows('leave_exception_requests', 'all', { order: ['created_at', false] }),
    ]);
    const types = rawRef.current.leaveTypes;
    setLeaveRequests((requestRows as LeaveRequest[]).map(req => ({
      ...req,
      leave_type: types.find(lt => lt.id === req.leave_type_id),
    })));
    setEntitlements(entitlementRows as LeaveEntitlement[]);
    setMandatoryLeaves(mandatoryRows as MandatoryLeave[]);
    setCoverageGroups(groupRows as CoverageGroup[]);
    setCoverageGroupMembers(memberRows as CoverageGroupMember[]);
    setLeaveExceptionRequests(exceptionRows as LeaveExceptionRequest[]);
  }

  async function loadRemoteDaysSlice() {
    setRemoteDays((await fetchRows('remote_days', 'own')) as RemoteDay[]);
  }

  async function loadRemoteSlice() {
    setRemotePatterns((await fetchRows('remote_patterns', 'own')) as RemotePattern[]);
    // Both tables ship as separate migrations; a pending one must not break the screen.
    try {
      const supabase = getSupabaseBrowserClient();
      const amendmentsRes = await supabase.from('remote_amendments').select('*');
      if (amendmentsRes.data) setRemoteAmendmentRequests(amendmentsRes.data as RemoteAmendmentRequest[]);
    } catch {
      // table not created yet
    }
    try {
      const supabase = getSupabaseBrowserClient();
      const quotaRes = await supabase.from('remote_quota_requests').select('*');
      if (quotaRes.data) setRemoteQuotaRequests(quotaRes.data as RemoteQuotaRequest[]);
    } catch {
      // table not created yet
    }
  }

  async function loadSalarySlice() {
    const { isAdmin, profileId } = identityRef.current;
    const [typeRows, salaryRows, documentTypeRows] = await Promise.all([
      fetchRows('payment_types', 'all', { order: ['sort_order'] }),
      isAdmin
        ? fetchRows('salary_history', 'all')
        : (profileId ? fetchRows('my_compensation', 'all') : Promise.resolve([])),
      fetchRows('payment_document_types', 'all', { order: ['sort_order'] }),
    ]);
    setPaymentTypes(typeRows as PaymentType[]);
    rawRef.current.paymentTypes = typeRows as PaymentType[];
    setSalaries(salaryRows as SalaryRecord[]);
    setDocumentTypes(documentTypeRows as PaymentDocumentType[]);
  }

  async function loadPaymentsSlice() {
    const { isAdmin, profileId } = identityRef.current;
    const rows: PaymentRecord[] = isAdmin
      ? (await fetchRows('payments', 'all')) as PaymentRecord[]
      : (profileId ? (await fetchOwnPaidPayments()) || [] : []);
    const types = rawRef.current.paymentTypes;
    setPayments(rows.map(pay => ({
      ...pay,
      documents: pay.documents || [],
      payment_type: types.find(pt => pt.id === pay.payment_type_id),
    })));
  }

  /** Counterparties + contracts without their pricing children — what the dashboard needs. */
  async function loadContractsSlice() {
    const [cpRows, roleRows, cpLinkRows, contractRows, versionRows, tierRows, historyRows, overrideRows] = await Promise.all([
      fetchRows('counterparties', 'admin'),
      fetchRows('roles', 'all'),
      fetchRows('counterparty_roles', 'admin'),
      fetchRows('contracts', 'admin'),
      fetchRows('tier_model_versions', 'admin'),
      fetchRows('counterparty_tiers', 'admin'),
      fetchRows('counterparty_tier_history', 'admin', { order: ['changed_at', false], limit: 300 }),
      fetchRows('counterparty_tier_overrides', 'admin'),
    ]);
    rawRef.current.cpRoles = roleRows as Role[];
    rawRef.current.cpRoleLinks = cpLinkRows as CounterpartyRole[];
    rawRef.current.counterparties = cpRows as Counterparty[];
    rawRef.current.contracts = contractRows as Contract[];
    rawRef.current.tierVersions = versionRows as TierModelVersion[];
    rawRef.current.tierStates = tierRows as CounterpartyTierRow[];
    rawRef.current.tierOverrides = overrideRows as CounterpartyTierOverride[];

    setCounterpartyRoles(roleRows as Role[]);
    setCounterpartyRoleLinks(cpLinkRows as CounterpartyRole[]);
    setTierModelVersions(versionRows as TierModelVersion[]);
    setTierStates(tierRows as CounterpartyTierRow[]);
    setTierHistory(historyRows as CounterpartyTierHistoryRow[]);
    setTierOverrides(overrideRows as CounterpartyTierOverride[]);

    const counterparties = assembleCounterparties({
      cps: rawRef.current.counterparties,
      cpRoleLinks: cpLinkRows as CounterpartyRole[],
      cpRoles: rawRef.current.cpRoles,
      contractRows: rawRef.current.contracts,
      attioLinks: [],
      contacts: [],
      tierVersions: versionRows as TierModelVersion[],
      tierStates: tierRows as CounterpartyTierRow[],
      tierOverrides: overrideRows as CounterpartyTierOverride[],
    });
    setCounterparties(counterparties);
    setContracts(assembleContracts({
      rows: rawRef.current.contracts,
      counterparties,
      profiles: rawRef.current.profiles,
      lines: [],
      groups: [],
      schedule: [],
    }));
  }

  /** Everything the commercial screens join on top of `contracts`: catalog, pricing, Attio mirror. */
  async function loadCommercialSlice() {
    const [moduleRows, itemRows, lineRows, groupRows, scheduleRows, attioLinkRows, contactRows,
      eventRows, timesheetRows, cardRows, entryRows] = await Promise.all([
      fetchRows('catalog_modules', 'admin', { order: ['sort_order'] }),
      fetchRows('catalog_items', 'admin'),
      fetchRows('contract_lines', 'admin'),
      fetchRows('contract_line_groups', 'admin'),
      fetchRows('contract_schedule', 'admin', { order: ['period'] }),
      fetchRows('attio_links', 'admin'),
      fetchRows('counterparty_contacts', 'admin'),
      fetchRows('attio_events', 'admin'),
      fetchRows('contract_timesheets', 'own'),
      fetchRows('rate_cards', 'admin'),
      fetchRows('rate_card_entries', 'admin'),
    ]);
    setRateCards(cardRows as RateCard[]);
    setRateCardEntries(entryRows as RateCardEntry[]);
    setCatalogModules(moduleRows as CatalogModule[]);
    setCatalogItems(itemRows as CatalogItem[]);
    setContractLines(lineRows as ContractLine[]);
    setContractSchedules(scheduleRows as ContractSchedule[]);
    setAttioEvents(eventRows as AttioEvent[]);
    setTimesheets(timesheetRows as ContractTimesheet[]);

    const counterparties = assembleCounterparties({
      cps: rawRef.current.counterparties,
      cpRoleLinks: rawRef.current.cpRoleLinks,
      cpRoles: rawRef.current.cpRoles,
      contractRows: rawRef.current.contracts,
      attioLinks: attioLinkRows as AttioLink[],
      contacts: contactRows as CounterpartyContact[],
      tierVersions: rawRef.current.tierVersions,
      tierStates: rawRef.current.tierStates,
      tierOverrides: rawRef.current.tierOverrides,
    });
    setCounterparties(counterparties);
    setContracts(assembleContracts({
      rows: rawRef.current.contracts,
      counterparties,
      profiles: rawRef.current.profiles,
      lines: lineRows as ContractLine[],
      groups: groupRows as ContractLineGroup[],
      schedule: scheduleRows as ContractSchedule[],
    }));
  }

  async function loadInvoicesSlice() {
    const { isAdmin } = identityRef.current;
    const supabase = getSupabaseBrowserClient();
    const [invoiceRows, categoryRows, documentRows, paymentRows, allocationRows, budgetCategoryRows] = await Promise.all([
      isAdmin ? fetchRows('invoices', 'all', { select: '*, links:invoice_links(*)', order: ['issue_date', false] }) : Promise.resolve([]),
      fetchRows('invoice_categories', 'all', { order: ['name'] }),
      fetchRows('invoice_documents', 'admin'),
      fetchRows('invoice_payments', 'admin'),
      fetchRows('invoice_allocations', 'admin'),
      fetchRows('budget_categories', 'admin', { order: ['sort_order'] }),
    ]);

    const loadedCats: InvoiceCategory[] = categoryRows as InvoiceCategory[];
    if (loadedCats.length === 0) {
      setInvoiceCategories([
        { id: 'cat-1', name: 'Infrastructure & Hosting', description: 'Servers and cloud computing', is_default: true },
        { id: 'cat-2', name: 'Marketing & Sales', description: 'Advertising and campaigns', is_default: true },
        { id: 'cat-3', name: 'Office & Admin', description: 'Office rent and supplies', is_default: true },
        { id: 'cat-4', name: 'Travel & Expense', description: 'Corporate travel and flights', is_default: true },
        { id: 'cat-5', name: 'Legal & Accounting', description: 'Audit fees and advisory', is_default: true },
        { id: 'cat-6', name: 'Other Operational', description: 'Miscellaneous operational expenses', is_default: true },
      ]);
    } else {
      setInvoiceCategories(loadedCats);
    }

    const loadedDocs = await signInvoiceDocuments(supabase, documentRows as InvoiceDocument[]);
    const loadedPays = paymentRows as InvoicePayment[];
    const loadedAlloc = allocationRows as InvoiceAllocation[];
    const loadedBudgetCategories = budgetCategoryRows as BudgetCategory[];
    setInvoiceDocuments(loadedDocs);
    setInvoicePayments(loadedPays);
    setInvoiceAllocations(loadedAlloc);
    setBudgetCategories(loadedBudgetCategories);
    rawRef.current.budgetCategories = loadedBudgetCategories;

    setInvoices((invoiceRows as Invoice[]).map(inv => ({
      ...inv,
      counterparty: rawRef.current.counterparties.find(c => c.id === inv.counterparty_id),
      contract: rawRef.current.contracts.find(c => c.id === inv.contract_id),
      documents: loadedDocs.filter(d => d.invoice_id === inv.id),
      payments: loadedPays.filter(p => p.invoice_id === inv.id),
      allocations: loadedAlloc.filter(a => a.invoice_id === inv.id),
      qr_url: inv.qr_url || null,
      budget_category: loadedBudgetCategories.find(c => c.id === inv.category_id),
    })));
  }

  async function loadBudgetSlice() {
    const [budgetRows, lineRows, recurringRows] = await Promise.all([
      fetchRows('budgets', 'admin', { order: ['fiscal_year', false] }),
      fetchRows('budget_lines', 'admin'),
      fetchRows('recurring_commitments', 'admin'),
    ]);
    setBudgets(budgetRows as Budget[]);
    setBudgetLines(lineRows as BudgetLine[]);
    setRecurringCommitments(recurringRows as RecurringCommitment[]);
  }

  async function loadTimesheetsSlice() {
    const [projectRows, workItemRows, assignmentRows, forecastRows, entryRows, periodRows] = await Promise.all([
      fetchRows('projects', 'all'),
      fetchRows('work_items', 'all'),
      fetchRows('project_assignments', 'own'),
      fetchRows('project_role_forecasts', 'admin'),
      fetchRows('time_entries', 'own'),
      fetchRows('timesheet_periods', 'all'),
    ]);
    setProjects(projectRows as Project[]);
    setWorkItems(workItemRows as WorkItem[]);
    setProjectAssignments(assignmentRows as ProjectAssignment[]);
    setProjectRoleForecasts(forecastRows as ProjectRoleForecast[]);
    setTimeEntries(entryRows as TimeEntry[]);
    setTimesheetPeriods(periodRows as TimesheetPeriod[]);
  }

  async function loadPeopleSlice() {
    setEmployeeContracts((await fetchRows('employee_contracts', 'own')) as EmployeeContract[]);
  }

  async function loadIntegrationsSlice() {
    const [integrationRows, exemptionRows] = await Promise.all([
      fetchRows('employee_integrations', 'own'),
      fetchRows('integration_exemptions', 'own'),
    ]);
    const rows = integrationRows as EmployeeIntegration[];
    setEmployeeIntegrations(rows);
    const { profileId } = identityRef.current;
    setSlackIntegration(rows.find(i => i.provider === 'slack' && i.profile_id === profileId) || null);
    const active = (exemptionRows as IntegrationExemption[])
      .filter(x => x.provider === 'slack' && (!x.expires_at || new Date(x.expires_at) > new Date()))
      .sort((a, b) => (a.expires_at || '').localeCompare(b.expires_at || ''));
    setMyIntegrationExemption(active[0] || null);
  }

  /** Per-employee/company remote quotas — shown by the remote log, people and settings screens. */
  async function loadPoliciesSlice() {
    const policyRows = await fetchRows('remote_policies', 'all');
    setRemotePolicies((policyRows as any[]).map(p => ({
      ...p,
      max_days: p.max_days ?? p.max_days_per_month ?? 8,
      period_type: p.period_type || 'month',
    })) as RemotePolicy[]);
  }

  const SLICE_LOADERS: Record<DataSliceKey, () => Promise<void>> = {
    leave: loadLeaveSlice,
    remoteDays: loadRemoteDaysSlice,
    remote: loadRemoteSlice,
    salary: loadSalarySlice,
    payments: loadPaymentsSlice,
    contracts: loadContractsSlice,
    commercial: loadCommercialSlice,
    invoices: loadInvoicesSlice,
    budget: loadBudgetSlice,
    timesheets: loadTimesheetsSlice,
    people: loadPeopleSlice,
    integrations: loadIntegrationsSlice,
    policies: loadPoliciesSlice,
  };

  /** Public on-demand entry point for surfaces outside the route's slice list. */
  const ensureData = async (keys: DataSliceKey[]): Promise<void> => {
    for (const key of withDependencies(keys)) await loadSlice(key);
  };

  /** Load a slice once. Concurrent callers share the same promise; a loaded slice never refetches. */
  const loadSlice = (key: DataSliceKey): Promise<void> => {
    if (loadedSlicesRef.current.has(key)) return Promise.resolve();
    const inFlight = sliceLoadsRef.current.get(key);
    if (inFlight) return inFlight;
    const task = (async () => {
      try {
        await SLICE_LOADERS[key]();
      } catch (error) {
        console.error(`[data] slice "${key}" failed to load:`, error);
      } finally {
        // Settled either way: a permanent spinner is worse than a screen with an empty table, and
        // the bump is what clears it (and re-subscribes realtime to the new tables).
        loadedSlicesRef.current.add(key);
        sliceLoadsRef.current.delete(key);
        setDataVersion(v => v + 1);
      }
    })();
    sliceLoadsRef.current.set(key, task);
    return task;
  };

  /** Slices this route needs that are not in memory yet — drives the loading screen. */
  const missingSlices = bootReady
    ? withDependencies(slicesForPath(pathname)).filter(key => !loadedSlicesRef.current.has(key))
    : [];

  useEffect(() => {
    // Intercept OAuth authorization code if Supabase redirects to site root instead of /auth/callback
    if (typeof window !== 'undefined' && window.location.search.includes('code=') && !window.location.pathname.startsWith('/auth/callback')) {
      window.location.href = `/auth/callback${window.location.search}`;
      return;
    }

    // Detect environment: local dev mode vs production / Vercel cloud
    const isLocal = typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    setIsDevMode(isLocal && process.env.NODE_ENV !== 'production');

    const bootstrap = async () => {
      // Public demo: sample rows only. No session, no queries, no realtime.
      if (isDemoMode()) {
        setDemoDataMode(true);
        setIsDemo(true);
        setIsDevMode(false);
        setRealProfileId(MOCK_PROFILES[0]?.id || '');
        hydrateDemoWorkspace();
        // Nothing to fetch — mark every slice present so the route effect stays quiet.
        (Object.keys(SLICE_LOADERS) as DataSliceKey[]).forEach(key => loadedSlicesRef.current.add(key));
        setIsLoading(false);
        setBootReady(true);
        return;
      }

      const supabase = getSupabaseBrowserClient();
      try {
        // 1. Authenticate and determine admin status to prevent data leakage
        let matchedId = '';
        let isAdmin = false;
        const { data: { session } } = await supabase.auth.getSession();
        setLiveSessionUserId(session?.user?.id || '');

        // Repair this session's directory link BEFORE any own-row read. Policies on payments,
        // time entries, contract timesheets, project assignments and profile self-edit still key
        // on `auth_user_id`, and profiles provisioned before the callback linked it (10 of 15)
        // would otherwise read nothing. Idempotent; a no-op once linked.
        if (session?.user) {
          try {
            await fetch('/api/auth/link-profile', { method: 'POST' });
          } catch (linkError) {
            console.warn('[auth] profile link repair failed; own-row reads may be empty this session:', linkError);
          }
        }

        const initialProfilesRes = await supabase.from('profiles').select(PROFILE_COLUMNS);
        if (initialProfilesRes.error) {
          console.error('[profiles] directory read failed:', initialProfilesRes.error.message);
        }
        // The column list is a runtime string, so PostgREST's generated types cannot infer the row.
        const loadedProfiles = (initialProfilesRes.data || []) as unknown as Profile[];
        // Only overwrite when the view answered — otherwise keep the value the row already carries.
        const phones = await fetchProfilePhones(supabase);
        if (phones) loadedProfiles.forEach(p => { p.phone = phones.get(p.id) ?? null; });

        if (session?.user?.email) {
          const email = session.user.email.toLowerCase();
          const match = loadedProfiles.find(p => p.work_email?.toLowerCase() === email);
          if (match) matchedId = match.id;
        }
        if (!matchedId && loadedProfiles.length > 0 && isLocal) {
          matchedId = loadedProfiles[0].id;
        }

        if (matchedId) {
          const { data: roleRow } = await supabase.from('user_roles').select('role').eq('profile_id', matchedId).eq('role', 'admin').maybeSingle();
          isAdmin = !!roleRow;
          sessionIsAdminRef.current = isAdmin;
          setCurrentUserId(matchedId);
          setRealProfileId(matchedId);
        }
        identityRef.current = { isAdmin, profileId: matchedId };

        // 2. Directory + master data every screen shares; route slices load from here.
        await loadCoreSlice({ loadedProfiles, matchedId });
      } catch (err) {
        console.error("Live database sync exception:", err);
      } finally {
        setIsLoading(false);
        setBootReady(true);
      }
    };

    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch the active route's slices (and their dependencies) in dependency order.
  useEffect(() => {
    if (!bootReady) return;
    const needed = withDependencies(slicesForPath(pathname))
      .filter(key => !loadedSlicesRef.current.has(key));
    if (needed.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const key of needed) {
        if (cancelled) return;
        await loadSlice(key);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, bootReady]);

  // Derive active user
  const fallbackProfile: Profile = {
    id: '',
    first_name: 'Database Sync',
    last_name: '',
    name_el: '',
    title: 'Loading from Supabase...',
    work_email: '',
    role: 'employee',
    team_id: '',
    employment_type: 'full_time',
    start_date: '2026-01-01',
    status: 'active',
    work_schedule: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  };

  const baseCurrentUser = profiles.find(p => p.id === (previewProfileId || currentUserId)) || profiles[0] || fallbackProfile;
  // While previewing a SPECIFIC employee, keep exposing the real (logged-in admin) role so the
  // exit ribbon/controls stay available; otherwise the role follows the active identity.
  const realUserRole = previewProfileId
    ? (profiles.find(p => p.id === realProfileId)?.role || 'employee')
    : baseCurrentUser.role;
  const currentUser = useMemo(() => {
    if (previewProfileId) {
      // Force an employee lens: preview never grants admin powers.
      return { ...baseCurrentUser, role: 'employee' as const };
    }
    if (isViewAsEmployee && baseCurrentUser.role === 'admin') {
      return { ...baseCurrentUser, role: 'employee' as const };
    }
    return baseCurrentUser;
  }, [baseCurrentUser, isViewAsEmployee, previewProfileId]);

  const signOut = async () => {
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch (e) {
      console.error("Sign out exception:", e);
    } finally {
      // Leaving the demo must also drop its cookie, or the middleware would let this browser back in.
      if (isDemo) exitDemoMode();
      // Hard navigation, deliberately: the provider unmounts and every cached slice goes with it.
      // A client-side push left the one-shot loader un-rerun, so the next sign-in could serve the
      // previous user's rows from memory.
      window.location.href = '/login';
    }
  };

  const switchUser = (profileId: string) => {
    setCurrentUserId(profileId);
    setIsViewAsEmployee(false);
  };

  // Admin preview of a SPECIFIC employee (e.g. to verify what that person can see).
  const startPreviewAs = (profileId: string) => {
    if (!profileId) return;
    setPreviewProfileId(profileId);
    setIsViewAsEmployee(true);
  };
  const stopPreview = () => {
    setPreviewProfileId(null);
    setIsViewAsEmployee(false);
  };

  const updateProfile = async (updated: Profile) => {
    const supabase = getSupabaseBrowserClient();
    const { team, sensitive, role, id, ...changes } = updated as any;
    try {
      // 0063 revoked the table-wide UPDATE grant on `profiles`: only the columns an employee may
      // change on their own row are still granted, so an admin edit (team, employment type,
      // status, dates…) goes through the service-role route, which re-checks is_admin.
      const res = await fetch('/api/admin/profile-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: id, changes }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({} as { error?: string }));
        console.error('Failed to update profile in database:', err);
        alert(`Database Error: ${err.error || res.status}`);
        return;
      }
      if (role) {
        const { error: roleError } = await supabase.from('user_roles')
          .update({ role })
          .eq('profile_id', updated.id);
        if (roleError) {
          console.error('Failed to update user role in database:', roleError);
          alert(`Role Error: ${roleError.message}`);
          return;
        }
      }
      if (sensitive) {
        await supabase.from('profile_sensitive').upsert({ ...sensitive, profile_id: updated.id });
      }
      setProfiles(prev => prev.map(p => p.id === updated.id ? updated : p));
    } catch (e: any) {
      console.error('Failed to update profile in database:', e);
    }
  };

  const updateMyProfile = async (edits: Partial<Pick<Profile, 'first_name' | 'last_name' | 'name_el' | 'title' | 'phone'>> & { photo_url?: string | null }): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.from('profiles').update(edits).eq('id', currentUser.id);
      if (error) {
        console.error('Failed to update own profile:', error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      setProfiles(prev => prev.map(p => p.id === currentUser.id ? { ...p, ...edits } : p));
      return true;
    } catch (e) {
      console.error('Exception updating own profile:', e);
      return false;
    }
  };

  const deleteProfile = async (profileId: string): Promise<boolean> => {    const supabase = getSupabaseBrowserClient();
    try {
      const { data, error } = await supabase.rpc('admin_delete_profile', { target_profile_id: profileId });
      if (error) {
        console.error('Failed to delete profile:', error);
        alert(`Delete Error: ${error.message}`);
        return false;
      }
      if (data === false) {
        alert('Profile not found.');
        return false;
      }
      setProfiles(prev => prev.filter(p => p.id !== profileId));
      setLeaveRequests(prev => prev.filter(r => r.profile_id !== profileId && r.decided_by !== profileId));
      setSalaries(prev => prev.filter(s => s.profile_id !== profileId));
      setPayments(prev => prev.filter(p => p.profile_id !== profileId));
      setEntitlements(prev => prev.filter(e => e.profile_id !== profileId));
      setRemoteDays(prev => prev.filter(d => d.profile_id !== profileId));
      setTimesheets(prev => prev.filter(t => t.profile_id !== profileId));
      setTimeEntries(prev => prev.filter(t => t.profile_id !== profileId));
      setProjectAssignments(prev => prev.filter(a => a.profile_id !== profileId));
      setProfileRoleHistory(prev => prev.filter(h => h.profile_id !== profileId));
      setRemotePatterns(prev => prev.filter(p => p.profile_id !== profileId));
      return true;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error('Failed to delete profile:', e);
      alert(`Delete Error: ${errMsg}`);
      return false;
    }
  };

  const addProfile = async (newProf: Profile): Promise<boolean> => {
    const id = (newProf.id && newProf.id.includes('-') && newProf.id.length === 36) ? newProf.id : generateUUID();

    // `profiles.work_email` is UNIQUE. Catch the clash here so the admin gets told WHO already
    // owns the address (and where to go instead) rather than a raw Postgres 23505.
    const workEmail = (newProf.work_email || '').trim();
    if (!workEmail) {
      alert('VALIDATION ERROR: A work email is required — it is how the employee signs in and is matched on first login.');
      return false;
    }
    // Compared case-insensitively on purpose: the DB constraint is case-SENSITIVE, so
    // `Foo@x.eu` and `foo@x.eu` could otherwise become two profiles for one person, and the
    // first-login match (lower(work_email) = lower(jwt email)) would not know which to pick.
    const clash = profiles.find(p => (p.work_email || '').trim().toLowerCase() === workEmail.toLowerCase());
    if (clash) {
      alert(`DUPLICATE EMAIL: ${clash.first_name} ${clash.last_name} already uses ${clash.work_email}.\n\nOpen that person from the People Directory to edit them instead of creating a second record.`);
      return false;
    }

    const profWithId = { ...newProf, id, work_email: workEmail };
    const supabase = getSupabaseBrowserClient();
    const { team, sensitive, role, ...cleanProfile } = profWithId as any;
    try {
      const { error } = await supabase.from('profiles').insert(cleanProfile);
      if (error) {
        console.error('Failed to insert profile into database:', error);
        // 23505 = unique violation. `profiles` state can be stale (another admin just added
        // them), so the DB stays the source of truth for this check.
        if (error.code === '23505' && /work_email/i.test(error.message)) {
          alert(`DUPLICATE EMAIL: ${workEmail} already belongs to an existing employee.\n\nOpen that person from the People Directory instead of creating a second record.`);
        } else {
          alert(`Database Error: ${error.message}`);
        }
        return false;
      }
      if (role) {
        await supabase.from('user_roles').insert({ profile_id: id, role });
      }
      if (sensitive) {
        await supabase.from('profile_sensitive').insert({ ...sensitive, profile_id: id });
      }
      setProfiles(prev => [profWithId, ...prev]);

      // The database trigger `trg_mandatory_fanout_on_profile` gives a new employee a row for
      // every published company closure they are eligible for (see 0076). Those rows were created
      // on the server, so pull them in — otherwise the new hire shows up with no closure leave
      // until the page is reloaded.
      try {
        const { data: seeded } = await supabase.from('leave_requests').select('*').eq('profile_id', id);
        if (seeded && seeded.length > 0) {
          const enriched = (seeded as LeaveRequest[]).map(r => ({
            ...r,
            leave_type: leaveTypes.find(lt => lt.id === r.leave_type_id),
          }));
          setLeaveRequests(prev => [...enriched, ...prev.filter(r => r.profile_id !== id)]);
          if (seeded.some(r => r.origin === 'mandatory')) {
            notifySuccess(
              `Company closure leave assigned automatically (${seeded.filter(r => r.origin === 'mandatory').length} record(s)).`,
              'Mandatory leave applied',
            );
          }
        }
      } catch (seedError) {
        // The rows exist either way — this only affects what the current tab shows.
        console.warn('Could not load auto-assigned mandatory leave for the new profile:', seedError);
      }
      return true;
    } catch (e: any) {
      console.error('Failed to insert profile into database:', e);
      alert(`Database Error: ${e?.message || 'Unexpected error while creating the profile.'}`);
      return false;
    }
  };

  const crossesYearBoundary = (start?: string | null, end?: string | null) =>
    !!start && !!end && start.slice(0, 4) !== end.slice(0, 4);

  /** Single-row insert. Every leave write funnels through here so the split logic stays in one place. */
  const insertLeaveRow = async (newReq: LeaveRequest) => {
    const supabase = getSupabaseBrowserClient();
    const { leave_type, ...cleanReq } = newReq as any;
    try {
      const { error, data } = await supabase.from('leave_requests').insert(cleanReq).select();
      if (error) {
        console.error('Failed to insert leave request into database:', error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      const savedReq = (data && data[0]) ? { ...data[0], leave_type: leaveTypes.find(lt => lt.id === data[0].leave_type_id) } : newReq;
      setLeaveRequests(prev => [savedReq, ...prev]);
      if (savedReq.status === 'approved') {
        // Admin-created approved leave (e.g. admin_entry) mirrors immediately
        syncSlackStatus(savedReq.profile_id, athensTodayStr(), savedReq.id);
      }
      return true;
    } catch (e: any) {
      console.error('Failed to insert leave request into database:', e);
      return false;
    }
  };

  const addLeaveRequest = async (req: Omit<LeaveRequest, 'id'>) => {
    let finalTypeId = req.leave_type_id;
    if (finalTypeId === 'lt-annual' || !leaveTypes.some(lt => lt.id === finalTypeId)) {
      const validLt = leaveTypes.find(t => !t.is_hidden && (t.code === 'annual' || (t.name_en && t.name_en.toLowerCase().includes('annual')))) || leaveTypes.find(t => !t.is_hidden) || leaveTypes[0];
      if (validLt) finalTypeId = validLt.id;
    }

    // Invariant: a stored row never crosses 31 December (see migration 0082). Everyone who files
    // leave goes through here, so the split lives here rather than in each caller.
    if (crossesYearBoundary(req.start_date, req.end_date)) {
      await splitAndAddLeaveRequest(
        { ...req, leave_type_id: finalTypeId },
        resolveWorkSchedule(profiles.find(p => p.id === req.profile_id)?.work_schedule),
        publicHolidays || [],
      );
      return;
    }

    await insertLeaveRow({ ...req, leave_type_id: finalTypeId, id: generateUUID() });
  };

  const updateLeaveRequestStatus = async (id: string, status: LeaveRequest['status'], rejectionReason?: string) => {
    const decided_by = currentUser.id;
    const decided_at = new Date().toISOString().split('T')[0];
    const supabase = getSupabaseBrowserClient();
    try {
      const updateData: any = { status, decided_by, decided_at };
      if (rejectionReason) updateData.rejection_reason = rejectionReason;
      const { error } = await supabase.from('leave_requests').update(updateData).eq('id', id);
      if (error) {
        console.error('Failed to update leave request status:', error);
        alert(`Database Error: ${error.message}`);
        return;
      }
      setLeaveRequests(prev => prev.map(r => r.id === id ? { 
        ...r, 
        status, 
        decided_by, 
        decided_at, 
        rejection_reason: rejectionReason || r.rejection_reason 
      } : r));
      if (status === 'approved') {
        const target = leaveRequests.find(r => r.id === id);
        if (target) {
          syncSlackStatus(target.profile_id, athensTodayStr(), id);
        }
      }
    } catch (e: any) {
      console.error('Failed to update leave request status:', e);
    }
  };

  /**
   * Working days for one employee's date range: their scheduled days, minus public holidays and
   * company closures. Mirrors what the leave pages count when a request is first filed, so an
   * edited range is re-costed the same way a new one would be.
   */
  const countWorkingDaysForProfile = (start: string, end: string, profileId: string): number => {
    const prof = profiles.find(p => p.id === profileId);
    const excluded = new Set<string>(holidayDates(publicHolidays));
    mandatoryLeaves.forEach(m => expandDateRange(m.start_date, m.end_date).forEach(d => excluded.add(d)));
    return countWorkingDays(start, end, resolveWorkSchedule(prof?.work_schedule), excluded);
  };

  /**
   * Personal leave rows whose stored `working_days` no longer matches their own dates.
   *
   * The balance is deducted by the STORED number, so a row of this kind is invisible but poisons
   * everything built on it — on 2026-10-01 eight such rows made a 14-day 2024 read as 8 days and
   * carried 11 days instead of 5 into 2025, with nothing on screen to explain why.
   *
   * Compared the same way the app costs a row (scheduled days − holidays − closures). A row an
   * admin adjusted on purpose also shows up here, which is why this only ever WARNS: it takes the
   * audit trail to tell "deliberate" from "stale", and that is not a read the client can make.
   */
  const staleLeaveDayCounts = (): StaleLeaveDayCount[] =>
    leaveRequests
      .filter(r => r.origin !== 'mandatory'
        && !r.detached
        && !r.half_day_start
        && !r.half_day_end
        && !['rejected', 'cancelled', 'expired'].includes(r.status)
        // A leave type that does not count against the balance is never deducted at all.
        && (leaveTypes.find(t => t.id === r.leave_type_id)?.counts_against_balance !== false))
      .map(r => ({ r, computed: countWorkingDaysForProfile(r.start_date, r.end_date, r.profile_id) }))
      .filter(x => Number(x.r.working_days || 0) !== x.computed)
      .map(x => {
        const p = profiles.find(prof => prof.id === x.r.profile_id);
        return {
          id: x.r.id,
          profileId: x.r.profile_id,
          profileName: p ? `${p.first_name} ${p.last_name}` : 'Unknown employee',
          startDate: x.r.start_date,
          endDate: x.r.end_date,
          stored: Number(x.r.working_days || 0),
          computed: x.computed,
        };
      });

  const editLeaveRequest = async (id: string, updated: Partial<LeaveRequest>, editReason?: string) => {
    const supabase = getSupabaseBrowserClient();
    try {
      const target = leaveRequests.find(r => r.id === id);
      const newErganiStatus = (target?.ergani_status === 'submitted') ? 'needs_amendment' : target?.ergani_status;
      const { leave_type, ...cleanUpdate } = updated as any;

      // Moving the dates invalidates the stored day count, which is what the balance is deducted
      // by. Recompute it the same way the leave pages do (scheduled days minus public holidays and
      // company closures) unless the caller passed an explicit count of its own — otherwise a
      // shortened range keeps its old total and a lengthened one gains nothing. A caller that
      // passes `working_days` still wins, so deliberate manual adjustments are preserved.
      const nextStart = updated.start_date ?? target?.start_date;
      const nextEnd = updated.end_date ?? target?.end_date;
      const recount = needsWorkingDaysRecount({
        prevStart: target?.start_date,
        prevEnd: target?.end_date,
        nextStart,
        nextEnd,
        explicitWorkingDays: updated.working_days,
        origin: target?.origin,
      });
      const recomputedDays = recount && nextStart && nextEnd
        ? countWorkingDaysForProfile(nextStart, nextEnd, target!.profile_id)
        : null;

      // An edit that moves the range across 31 December has to become two linked rows, same as a
      // fresh filing — otherwise the row spans two entitlements again (migration 0082 invariant).
      if (recount && target && crossesYearBoundary(nextStart, nextEnd)) {
        await deleteLeaveRequest(id);
        await splitAndAddLeaveRequest(
          {
            ...target,
            ...cleanUpdate,
            start_date: nextStart!,
            end_date: nextEnd!,
            working_days: recomputedDays ?? Number(target.working_days || 0),
            admin_edit_reason: editReason || cleanUpdate.admin_edit_reason,
          },
          resolveWorkSchedule(profiles.find(p => p.id === target.profile_id)?.work_schedule),
          publicHolidays || [],
        );
        return;
      }

      const updateData = {
        ...cleanUpdate,
        ...(recomputedDays !== null ? { working_days: recomputedDays } : {}),
        admin_edit_reason: editReason || cleanUpdate.admin_edit_reason,
        ...(newErganiStatus !== target?.ergani_status ? { ergani_status: newErganiStatus } : {})
      };
      const { error } = await supabase.from('leave_requests').update(updateData).eq('id', id);
      if (error) {
        console.error('Failed to edit leave request in database:', error);
        alert(`Database Error: ${error.message}`);
        return;
      }
      setLeaveRequests(prev => prev.map(r => {
        if (r.id !== id) return r;
        const ergani = (r.ergani_status === 'submitted') ? 'needs_amendment' : r.ergani_status;
        return {
          ...r,
          ...updated,
          ...(recomputedDays !== null ? { working_days: recomputedDays } : {}),
          admin_edit_reason: editReason || updated.admin_edit_reason || r.admin_edit_reason,
          ergani_status: ergani
        };
      }));
      const targetBefore = leaveRequests.find(r => r.id === id);
      if (targetBefore && (targetBefore.status === 'approved' || updated.status === 'approved')) {
        syncSlackStatus(targetBefore.profile_id, athensTodayStr(), id);
      }
    } catch (e: any) {
      console.error('Failed to edit leave request in database:', e);
    }
  };

  const requestLeaveCancellation = async (id: string): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const { data, error } = await supabase
        .from('leave_requests')
        .update({ status: 'cancellation_requested' })
        .eq('id', id)
        .select('id');
      if (error) {
        console.error('Failed to request leave cancellation:', error);
        return false;
      }
      // RLS can silently match zero rows; surface that instead of a phantom success.
      if (!data || data.length === 0) {
        console.error('Leave cancellation request updated no rows (permission or missing row).');
        return false;
      }
      setLeaveRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'cancellation_requested' } : r));
      return true;
    } catch (e) {
      console.error('Failed to request leave cancellation:', e);
      return false;
    }
  };

  const decideLeaveCancellation = async (id: string, approve: boolean) => {
    const newStatus: LeaveRequest['status'] = approve ? 'cancelled' : 'approved';
    const supabase = getSupabaseBrowserClient();
    try {
      const target = leaveRequests.find(r => r.id === id);
      const ergani = (approve && target?.ergani_status === 'submitted') ? 'needs_amendment' : target?.ergani_status;
      const payload: any = { status: newStatus, decided_by: currentUser.id, decided_at: new Date().toISOString().split('T')[0] };
      if (ergani !== target?.ergani_status) payload.ergani_status = ergani;
      const { error } = await supabase.from('leave_requests').update(payload).eq('id', id);
      if (error) {
        console.error('Failed to decide leave cancellation:', error);
        alert(`Database Error: ${error.message}`);
        return;
      }
      setLeaveRequests(prev => prev.map(r => {
        if (r.id !== id) return r;
        const ergani = (approve && r.ergani_status === 'submitted') ? 'needs_amendment' : r.ergani_status;
        return { ...r, status: newStatus, ergani_status: ergani, decided_by: currentUser.id, decided_at: new Date().toISOString().split('T')[0] };
      }));
      if (approve && target) {
        syncSlackStatus(target.profile_id, athensTodayStr(), id);
      }
    } catch (e: any) {
      console.error('Failed to decide leave cancellation:', e);
    }
  };

  /** Employee withdraws their own still-pending leave request before it is decided. */
  const cancelLeaveRequest = async (id: string): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const { data, error } = await supabase
        .from('leave_requests')
        .update({ status: 'cancelled' })
        .eq('id', id)
        .select('id');
      if (error) {
        console.error('Failed to cancel leave request:', error);
        return false;
      }
      if (!data || data.length === 0) {
        console.error('Leave request cancel updated no rows (permission or missing row).');
        return false;
      }
      setLeaveRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'cancelled' } : r));
      return true;
    } catch (e) {
      console.error('Failed to cancel leave request:', e);
      return false;
    }
  };

  const deleteLeaveRequest = async (id: string): Promise<boolean> => {
    const target = leaveRequests.find(r => r.id === id);
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.from('leave_requests').delete().eq('id', id);
      if (error) {
        console.error('Failed to delete leave request:', error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      setLeaveRequests(prev => prev.filter(r => r.id !== id));
      if (target && (target.status === 'approved' || target.status === 'in_progress' || target.status === 'taken')) {
        syncSlackStatus(target.profile_id, athensTodayStr(), id);
      }
      return true;
    } catch (e: any) {
      console.error('Failed to delete leave request:', e);
      return false;
    }
  };

  /**
   * File a leave, split at 31 December when it crosses a year boundary: each half becomes its own
   * row (linked through `linked_request_id`) so it deducts from its own year's entitlement only.
   * The two halves always add back up to the day count the form showed.
   */
  /**
   * File a leave, split at 31 December when it crosses a year boundary: each half becomes its own
   * row (linked through `linked_request_id`) so it deducts from its own year's entitlement only.
   * The halves always add back up to the day count the form showed.
   */
  const splitAndAddLeaveRequest = async (req: Omit<LeaveRequest, 'id'>, workSchedule: string[], holidays: PublicHoliday[]) => {
    const excluded = new Set<string>(holidays.map(h => h.date));
    mandatoryLeaves.forEach(m => expandDateRange(m.start_date, m.end_date).forEach(d => excluded.add(d)));
    leaveRequests
      .filter(r => r.origin === 'mandatory' && r.profile_id === req.profile_id)
      .forEach(r => expandDateRange(r.start_date, r.end_date).forEach(d => excluded.add(d)));

    const segments = splitAcrossYears({
      start: req.start_date,
      end: req.end_date,
      workingDays: Number(req.working_days || 0),
      schedule: workSchedule,
      isExcludedDate: iso => excluded.has(iso),
    });

    // A split that finds deductible days in only one year is not a split at all — store it whole
    // and let the caller's edited range stand.
    if (segments.length <= 1) {
      const only = segments[0];
      await insertLeaveRow({
        ...req,
        id: generateUUID(),
        start_date: only?.start ?? req.start_date,
        end_date: only?.end ?? req.end_date,
        working_days: only ? only.workingDays : Number(req.working_days || 0),
      });
      return;
    }

    const ids = segments.map(() => generateUUID());
    const rows: LeaveRequest[] = segments.map((seg, i) => ({
      ...req,
      id: ids[i],
      start_date: seg.start,
      end_date: seg.end,
      working_days: seg.workingDays,
      linked_request_id: ids[(i + 1) % ids.length],
    }));

    const supabase = getSupabaseBrowserClient();
    try {
      const clean = rows.map(({ leave_type, ...rest }) => rest);
      const { error, data } = await supabase.from('leave_requests').insert(clean).select();
      if (error) {
        console.error('Failed to save year-boundary split leave requests:', error);
        alert(`Database Error: ${error.message}`);
        return;
      }
      const saved = (data && data.length > 0)
        ? data.map(row => ({ ...row, leave_type: leaveTypes.find(lt => lt.id === row.leave_type_id) }))
        : rows;
      setLeaveRequests(prev => [...saved].reverse().concat(prev));
    } catch (e) {
      console.error('Failed to save year-boundary split leave requests:', e);
    }
  };

  // ---- Automatic leave carry-over ---------------------------------------------------------
  // Policy knobs live on the `leave_policy` singleton; see src/lib/leave-carryover.ts for the maths.

  const carryoverPolicy = (): CarryoverPolicy => ({
    maxCarryoverDays: leavePolicy?.max_carryover_days ?? null,
    expiryMonths: leavePolicy?.carryover_expiry_months ?? null,
  });

  /**
   * Carry-in for a year, DERIVED live so nothing has to be run to keep balances right:
   * the remainder of the immediately preceding year, capped and expiry-aware.
   *
   * Returns 0 when the previous year has no explicit entitlement row (nothing was set up for it,
   * so there is no remainder to speak of) or when the previous year is still running.
   *
   * `carryInOverride` lets the materialise pass feed already-computed carry-ins down the chain so
   * a single run is exact instead of needing a second run to settle.
   */
  const getDerivedCarryover = (
    profileId: string,
    year: number,
    carryInOverride?: Map<string, number>,
  ): number => {
    const already = carryInOverride?.get(`${profileId}:${year}`);
    if (already !== undefined) return already;
    const prevRow = entitlements.find(e => e.profile_id === profileId && e.year === year - 1);
    if (!prevRow) return 0;
    if (!previousYearHasClosed(year, athensTodayStr())) return 0;

    const prev = computeBalance(profileId, year - 1, false, carryInOverride);
    return carryoverDays(
      remainingOfYear({ entitlement: prev.entitlement, carriedIn: prev.carryOver, used: prev.taken + prev.mandatory }),
      carryoverPolicy(),
    );
  };

  /**
   * Core balance maths for one (employee, year).
   *
   * `allowDerivedCarry: false` is used when probing the PREVIOUS year from inside the carry-over
   * calculation — it reads the stored carry-in instead of deriving it, so the recursion is bounded
   * to a single step.
   */
  const computeBalance = (
    profileId: string,
    year: number,
    allowDerivedCarry: boolean,
    carryInOverride?: Map<string, number>,
  ) => {
    const ent = entitlements.find(e => e.profile_id === profileId && e.year === year);
    const entitlement = ent?.entitlement_days ?? leaveDefaultDays;

    let carryOver = Number(ent?.carried_over_days ?? 0);
    const override = carryInOverride?.get(`${profileId}:${year}`);
    if (override !== undefined) carryOver = override;
    else if (allowDerivedCarry && !ent?.carryover_is_manual) carryOver = getDerivedCarryover(profileId, year, carryInOverride);

    // Expiry only bites on the live year: recomputing a past year must not rewrite history.
    const todayIso = athensTodayStr();
    const expiresOn = ent?.carryover_expires_on ?? carryoverExpiryDate(year, carryoverPolicy());
    if (carryOver > 0 && String(year) === todayIso.slice(0, 4) && carryoverExpired(expiresOn, todayIso)) {
      carryOver = 0;
    }
    const carryOverExpires = expiresOn || 'Never expires';

    const userReqs = leaveRequests.filter(r => {
      if (r.profile_id !== profileId) return false;
      if (!r.start_date || !r.end_date) return false;
      // OVERLAP the year, not just start in it. A leave or company closure straddling 31 Dec is
      // deducted from both years; which days belong to which year is worked out per request below.
      if (r.end_date < `${year}-01-01` || r.start_date > `${year}-12-31`) return false;
      const lt = leaveTypes.find(t => t.id === r.leave_type_id) || r.leave_type;
      return lt ? lt.counts_against_balance !== false : true;
    });

    const prof = profiles.find(p => p.id === profileId);
    const workSchedule = prof?.work_schedule || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const mandatoryList = [
      ...mandatoryLeaves.map(m => ({ start: m.start_date, end: m.end_date })),
      ...userReqs.filter(r => r.origin === 'mandatory').map(r => ({ start: r.start_date, end: r.end_date }))
    ];
    const holidaySet = new Set((publicHolidays || []).map(h => h.date));
    const isClosureDay = (iso: string) => mandatoryList.some(m => iso >= m.start && iso <= m.end);

    // Personal leave: a scheduled working day not swallowed by a company closure.
    const getEffectiveRegularDays = (r: LeaveRequest) => deductedDaysInYear({
      start: r.start_date,
      end: r.end_date,
      workingDays: Number(r.working_days || 0),
      year,
      schedule: workSchedule,
      isExcludedDate: isClosureDay,
    });
    // Company closure rows: their `working_days` was counted as scheduled days minus public
    // holidays (syncMandatoryFanout), so qualify the same way — a holiday inside the range must
    // not consume one of the N deducted slots and shift the year split.
    const getEffectiveClosureDays = (r: LeaveRequest) => deductedDaysInYear({
      start: r.start_date,
      end: r.end_date,
      workingDays: Number(r.working_days || 0),
      year,
      schedule: workSchedule,
      isExcludedDate: iso => holidaySet.has(iso),
    });

    const taken = userReqs
      .filter(r => (r.status === 'approved' || r.status === 'in_progress' || r.status === 'taken' || r.status === 'cancellation_requested') && r.origin !== 'mandatory')
      .reduce((sum, r) => sum + getEffectiveRegularDays(r), 0);

    const reserved = userReqs
      .filter(r => r.status === 'pending' && r.origin !== 'mandatory')
      .reduce((sum, r) => sum + getEffectiveRegularDays(r), 0);

    // A closure that is no longer published (draft / cancelled) must not deduct anything, even if
    // its fan-out rows are still in the table — they are cleaned up, but stale rows must never
    // inflate the deduction in the meantime.
    const liveClosureIds = publishedClosureIds(mandatoryLeaves);
    const mandatory = userReqs
      .filter(r => mandatoryRowDeducts(r, liveClosureIds))
      .reduce((sum, r) => sum + getEffectiveClosureDays(r), 0);

    const available = entitlement + carryOver - taken - reserved - mandatory;

    return { entitlement, carryOver, carryOverExpires, taken, reserved, mandatory, available };
  };

  const getEmployeeLeaveBalance = (profileId: string, year: number) =>
    computeBalance(profileId, year, true);

  /**
   * Anything an employee needs to know about a carried-over pot that has a DUE DATE:
   * when it expires, how many days are still untaken, and how loudly to warn (see
   * Settings → Leaves → warning window, default 3 months).
   *
   * The pot is treated as drained FIRST by any leave taken this year — that is what makes a
   * use-it-or-lose-it pot behave as one, and it is also what makes the automatic booking below
   * idempotent (booked days reduce the pot instead of eating the annual grant).
   */
  const getCarryoverStatus = (profileId: string, year: number = Number(athensTodayStr().slice(0, 4))) => {
    const ent = entitlements.find(e => e.profile_id === profileId && e.year === year);
    const expiresOn = ent?.carryover_expires_on ?? carryoverExpiryDate(year, carryoverPolicy());
    const bal = computeBalance(profileId, year, true);
    // Pot BEFORE the expiry rule zeroes it, so an expired pot can still be reported as lost.
    const pot = ent?.carryover_is_manual
      ? Number(ent?.carried_over_days ?? 0)
      : getDerivedCarryover(profileId, year);
    const untaken = Math.max(0, pot - (bal.taken + bal.mandatory));
    const warningMonths = leavePolicy?.carryover_warning_months ?? DEFAULT_WARNING_MONTHS;
    const level: CarryoverWarningLevel = carryoverWarningLevel(expiresOn, athensTodayStr(), warningMonths);
    return {
      year,
      expiresOn,
      level,
      warningMonths,
      /** Size of the pot carried into this year. */
      carryOver: pot,
      /** Untaken days that are still usable and will be lost on the due date. */
      daysAtRisk: level === 'expired' ? 0 : Math.max(0, Math.min(untaken, bal.available)),
      /** Untaken days that the due date already cancelled. */
      expiredDays: level === 'expired' ? untaken : 0,
      autoBook: leavePolicy?.carryover_auto_book !== false,
    };
  };

  /**
   * Save an expiring carry-over pot: book whatever is left on the last working days before the
   * due date. Runs by itself on load (see the effect below) and is idempotent, so it is safe to
   * call again — days already booked are excluded, which is what stops it booking twice.
   *
   * Without `targetProfileId` it covers every active employee, which needs the admin's wider
   * data access; an employee can only ever cover themselves.
   */
  const syncCarryoverExpiryBookings = async (
    targetProfileId?: string,
  ): Promise<{ rows: number; days: number; employees: number } | null> => {
    if (leavePolicy?.carryover_auto_book === false) return { rows: 0, days: 0, employees: 0 };
    const todayIso = athensTodayStr();
    const year = Number(todayIso.slice(0, 4));
    const expiryDefault = carryoverExpiryDate(year, carryoverPolicy());
    const holidaySet = new Set((publicHolidays || []).map(h => h.date));
    // Company closures are not bookable either — nobody works them.
    const closureDates = new Set<string>();
    mandatoryLeaves.forEach(m => expandDateRange(m.start_date, m.end_date).forEach(d => closureDates.add(d)));

    const targets = targetProfileId
      ? profiles.filter(p => p.id === targetProfileId)
      : profiles.filter(p => p.status === 'active' && p.employment_type !== 'contractor');

    const annualType =
      leaveTypes.find(t => !t.is_hidden && (t.code === 'annual' || (t.name_en || '').toLowerCase().includes('annual')))
      || leaveTypes.find(t => !t.is_hidden)
      || leaveTypes[0];

    const newRows: LeaveRequest[] = [];
    for (const p of targets) {
      const ent = entitlements.find(e => e.profile_id === p.id && e.year === year);
      const expiresOn = ent?.carryover_expires_on ?? expiryDefault;
      if (!expiresOn || !annualType) continue;

      const status = getCarryoverStatus(p.id, year);
      if (status.daysAtRisk <= 0) continue;

      // Never book over leave the employee already has (pending counts — it may be approved).
      const busy = new Set<string>();
      leaveRequests
        .filter(r => r.profile_id === p.id && r.origin !== 'mandatory' && !['rejected', 'cancelled', 'expired'].includes(r.status))
        .forEach(r => expandDateRange(r.start_date, r.end_date).forEach(d => busy.add(d)));

      const plan = autoCarryoverBookingPlan({
        remainingCarried: status.daysAtRisk,
        dueOn: expiresOn,
        todayIso,
        schedule: p.work_schedule,
        excludedDates: new Set<string>([...holidaySet, ...closureDates, ...busy]),
      });
      if (plan.length === 0) continue;

      groupAdjacentDays(plan).forEach(group => {
        newRows.push({
          id: generateUUID(),
          profile_id: p.id,
          leave_type_id: annualType.id,
          start_date: group[0],
          end_date: group[group.length - 1],
          half_day_start: false,
          half_day_end: false,
          // Every day in a group is a bookable working day (weekends and holidays never join a group).
          working_days: group.length,
          status: 'approved',
          origin: 'admin_entry',
          note: `Automatic: unused carried-over leave must be taken by ${expiresOn}`,
          ergani_status: 'pending',
          is_auto_carryover: true,
        });
      });
    }

    if (newRows.length === 0) return { rows: 0, days: 0, employees: 0 };
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.from('leave_requests').insert(newRows);
      if (error) {
        console.error('Failed to book expiring carry-over:', error);
        return null;
      }
      setLeaveRequests(prev => [...newRows, ...prev]);
      newRows.forEach(r => syncSlackStatus(r.profile_id, r.start_date, r.id));
      return {
        rows: newRows.length,
        days: newRows.reduce((sum, r) => sum + Number(r.working_days || 0), 0),
        employees: new Set(newRows.map(r => r.profile_id)).size,
      };
    } catch (e: any) {
      console.error('syncCarryoverExpiryBookings error:', e);
      return null;
    }
  };

  /**
   * The DRY RUN of `syncLeaveCarryover`: same walk, same maths, nothing written.
   *
   * Both functions call this one function, so the preview an admin approves is byte-for-byte what
   * the run writes — a second copy of the walk would drift the moment the policy changed.
   *
   * Who is in the plan, and why:
   *  - active, non-contractor employees only;
   *  - only years from the first year an employee has a record for, walking FORWARD, and only when
   *    the PRECEDING year has a record too — the explicit-record requirement is what stops every
   *    employee "carrying over" the company default from years nobody set up;
   *  - `carryover_is_manual` rows are included but flagged, so the UI can show them as protected.
   *
   * The `carryInOverride` map is load-bearing: a year that was just derived (or is about to be
   * written) must feed the next year in the same pass, otherwise a chain of years needs two runs to
   * settle. Manual rows deliberately do NOT enter the map — the balance reads their stored value,
   * and that is what the next year has to build on.
   */
  const planLeaveCarryover = (targetProfileId?: string): CarryoverPlanRow[] => {
    const currentYear = Number(athensTodayStr().slice(0, 4));
    const policyNow = carryoverPolicy();
    const carryInOverride = new Map<string, number>();
    const plan: CarryoverPlanRow[] = [];

    for (const p of profiles.filter(x => x.status === 'active' && x.employment_type !== 'contractor')) {
      if (targetProfileId && p.id !== targetProfileId) continue;
      const own = entitlements.filter(e => e.profile_id === p.id);
      if (own.length === 0) continue;
      const profileName = `${p.first_name} ${p.last_name}`;
      for (let y = Math.min(...own.map(e => e.year)) + 1; y <= currentYear; y++) {
        if (!own.some(e => e.year === y - 1)) continue; // chain starts where explicit setup starts
        const existing = own.find(e => e.year === y);
        const derived = getDerivedCarryover(p.id, y, carryInOverride);
        const row: CarryoverPlanRow = {
          profileId: p.id,
          profileName,
          year: y,
          stored: existing ? Number(existing.carried_over_days ?? 0) : null,
          derived,
          isManual: !!existing?.carryover_is_manual,
          // Keep an explicit allowance; otherwise the record is created on the company default.
          entitlementDays: existing?.entitlement_days ?? leaveDefaultDays,
          expiresOn: carryoverExpiryDate(y, policyNow) || undefined,
        };
        // Only a non-manual record has taken the derived value, so only it may feed the next year.
        if (!row.isManual) carryInOverride.set(`${p.id}:${y}`, derived);
        plan.push(row);
      }
    }
    return plan;
  };

  /**
   * Write the derived carry-over into `leave_entitlements` so it shows up (and stays editable) in
   * People → Edit Profile, and in the Excel exports that read the stored column.
   *
   * Idempotent, like the mandatory fan-out: safe to run any time. Rows flagged
   * `carryover_is_manual` are never touched. Pass a `targetProfileId` to recalculate one employee —
   * which is what you want after repairing that person's leave, since a company-wide run rewrites
   * every other record too.
   */
  const syncLeaveCarryover = async (targetProfileId?: string): Promise<CarryoverSyncResult | null> => {
    const supabase = getSupabaseBrowserClient();
    const plan = planLeaveCarryover(targetProfileId);
    // Manual values are the admin's own decision — they are reported, never written.
    const writes = plan.filter(r => !r.isManual);
    const manual = plan.length - writes.length;
    const changes = writes
      .filter(r => r.stored !== r.derived)
      .map(r => ({
        profileId: r.profileId,
        profileName: r.profileName,
        year: r.year,
        from: r.stored ?? 0,
        to: r.derived,
      }));
    if (writes.length === 0) return { created: 0, updated: 0, manual, changes };

    const rows: LeaveEntitlement[] = writes.map(r => {
      const existing = entitlements.find(e => e.profile_id === r.profileId && e.year === r.year);
      return {
        id: existing?.id || generateUUID(),
        profile_id: r.profileId,
        year: r.year,
        entitlement_days: r.entitlementDays,
        carried_over_days: r.derived,
        carryover_expires_on: r.expiresOn,
        carryover_is_manual: false,
      };
    });
    const created = writes.filter(r => r.stored === null).length;
    const updated = writes.length - created;

    try {
      const { error } = await supabase.from('leave_entitlements').upsert(
        rows.map(r => ({ ...r, carryover_expires_on: r.carryover_expires_on || null })),
        { onConflict: 'profile_id,year' },
      );
      if (error) {
        console.error('Failed to materialise leave carry-over:', error);
        alert(`Database Error: ${error.message}`);
        return null;
      }
      setEntitlements(prev => [
        ...prev.filter(x => !rows.some(r => r.profile_id === x.profile_id && r.year === x.year)),
        ...rows,
      ]);
      return { created, updated, manual, changes };
    } catch (e: any) {
      console.error('syncLeaveCarryover error:', e);
      alert(`Database Error: ${e.message}`);
      return null;
    }
  };

  /**
   * Drop the MANUAL flag on one record and adopt the calculated value for it.
   *
   * Until this existed a hand-set carry-over was a one-way door: `saveLeaveEntitlement` always sets
   * `carryover_is_manual = true`, the recalculation skips those rows, and nothing in the UI could
   * hand them back to the automatic rule — so an admin who wanted the newer calculated number had no
   * way to take it.
   */
  const releaseLeaveEntitlementToAuto = async (profileId: string, year: number): Promise<boolean> => {
    const existing = entitlements.find(e => e.profile_id === profileId && e.year === year);
    if (!existing) return false;
    const derived = planLeaveCarryover(profileId).find(r => r.year === year)?.derived ?? 0;
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase
        .from('leave_entitlements')
        .update({ carried_over_days: derived, carryover_is_manual: false, carryover_expires_on: carryoverExpiryDate(year, carryoverPolicy()) || null })
        .eq('profile_id', profileId)
        .eq('year', year);
      if (error) {
        console.error('Error releasing carry-over to automatic:', error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      setEntitlements(prev => prev.map(e => (
        e.profile_id === profileId && e.year === year
          ? { ...e, carried_over_days: derived, carryover_is_manual: false }
          : e
      )));
      return true;
    } catch (e: any) {
      console.error('Exception releasing carry-over to automatic:', e);
      alert(`Exception: ${e.message}`);
      return false;
    }
  };


  // Local yyyy-mm-dd (avoids UTC date shifts from toISOString() in positive timezones).
  const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  /**
   * Drop the automatic rows of a closure that is no longer published (draft / cancelled), so it
   * stops deducting days from every allowance. Admin-detached manual corrections are preserved.
   */
  const clearMandatoryFanout = async (mandatoryLeaveId: string): Promise<number> => {
    const rows = leaveRequests.filter(r =>
      r.mandatory_leave_id === mandatoryLeaveId && r.origin === 'mandatory' && !r.detached);
    if (rows.length === 0) return 0;
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from('leave_requests').delete().in('id', rows.map(r => r.id));
    if (error) {
      console.error('Failed to clear mandatory fan-out:', error);
      return 0;
    }
    setLeaveRequests(prev => prev.filter(r => !rows.some(t => t.id === r.id)));
    return rows.length;
  };

  /**
   * Correct + idempotent mandatory fan-out for one closure:
   *  - only employees ACTIVE (non-contractor) and employed during the closure get a row;
   *  - exactly one row each (skips existing; keeps admin 'detached' manual corrections);
   *  - row range clipped to the employee's start date;
   *  - working_days = the employee's scheduled weekdays in range that are NOT public holidays.
   */
  const syncMandatoryFanout = async (m: MandatoryLeave): Promise<{ added: number; updated: number; removed: number } | null> => {
    // Only a PUBLISHED closure deducts days; drafts and cancellations are cleared instead.
    if (!m || m.status !== 'published') return null;
    const supabase = getSupabaseBrowserClient();
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let added = 0, updated = 0, removed = 0;
    try {
      const eligible = profiles.filter(p =>
        p.status === 'active' &&
        p.employment_type !== 'contractor' &&
        p.start_date <= m.end_date &&
        (!p.end_date || p.end_date >= m.start_date)
      );
      const holidays = (publicHolidays || []).map(h => h.date);
      const wdFor = (p: Profile) => {
        const ws = (p.work_schedule && p.work_schedule.length ? p.work_schedule : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
        const from = new Date((m.start_date < p.start_date ? p.start_date : m.start_date) + 'T00:00:00');
        const to = new Date(m.end_date + 'T00:00:00');
        const d = new Date(from);
        let count = 0;
        while (d <= to) {
          if (ws.includes(dayNames[d.getDay()]) && !holidays.includes(localIso(d))) count++;
          d.setDate(d.getDate() + 1);
        }
        return count;
      };
      const note = `Company-wide mandatory leave: ${m.name}`;
      const existing = leaveRequests.filter(r => r.mandatory_leave_id === m.id && r.origin === 'mandatory');

      // 1) Drop rows whose employee is no longer eligible (never remove admin 'detached' corrections).
      const toDelete = existing.filter(r => {
        if (r.detached) return false;
        const p = profiles.find(x => x.id === r.profile_id);
        if (!p) return true;
        return !(p.status === 'active' && p.employment_type !== 'contractor' &&
                 p.start_date <= m.end_date && (!p.end_date || p.end_date >= m.start_date));
      });
      if (toDelete.length > 0) {
        await supabase.from('leave_requests').delete().in('id', toDelete.map(r => r.id));
        setLeaveRequests(prev => prev.filter(r => !toDelete.some(t => t.id === r.id)));
        removed += toDelete.length;
      }

      // 2) Ensure exactly one correct row per eligible employee PER CALENDAR YEAR. A closure that
      //    straddles 31 December (31/12/2025 → 02/01/2026) is stored as one row per year, linked to
      //    its sibling, so the 2025 allowance pays for 31 Dec and the 2026 allowance for 2 Jan.
      for (const p of eligible) {
        const start = m.start_date < p.start_date ? p.start_date : m.start_date;
        const schedule = p.work_schedule && p.work_schedule.length ? p.work_schedule : dayNames.slice(1, 6);
        const segments = splitAcrossYears({
          start,
          end: m.end_date,
          workingDays: wdFor(p),
          schedule,
          isExcludedDate: iso => holidays.includes(iso),
        });

        const mine = existing.filter(r => r.profile_id === p.id && !r.detached);
        /** Final row id per segment, in segment order. */
        const rowIds: string[] = [];

        for (const seg of segments) {
          // Match the row already covering this segment's year, so a re-sync patches instead of
          // duplicating.
          const row = mine.find(r => r.start_date.slice(0, 4) === seg.start.slice(0, 4));
          if (row) {
            const patch: Partial<LeaveRequest> = {};
            if (row.working_days !== seg.workingDays) patch.working_days = seg.workingDays;
            if (row.start_date !== seg.start) patch.start_date = seg.start;
            if (row.end_date !== seg.end) patch.end_date = seg.end;
            if (row.leave_type_id !== m.leave_type_id) patch.leave_type_id = m.leave_type_id;
            if (row.note !== note) patch.note = note;
            if (Object.keys(patch).length > 0) {
              await supabase.from('leave_requests').update(patch).eq('id', row.id);
              setLeaveRequests(prev => prev.map(r => r.id === row.id ? { ...r, ...patch } : r));
              updated++;
            }
            rowIds.push(row.id);
            continue;
          }

          const id = generateUUID();
          const newReq: LeaveRequest = {
            id,
            profile_id: p.id,
            leave_type_id: m.leave_type_id,
            start_date: seg.start,
            end_date: seg.end,
            half_day_start: false,
            half_day_end: false,
            working_days: seg.workingDays,
            status: 'approved',
            origin: 'mandatory',
            mandatory_leave_id: m.id,
            note,
            ergani_status: 'not_required',
          };
          await supabase.from('leave_requests').insert(newReq);
          setLeaveRequests(prev => [newReq, ...prev]);
          added++;
          rowIds.push(id);
        }

        // Rows left over from a shape this closure no longer produces (e.g. the old single
        // year-crossing row) would double-deduct, so retire them.
        const orphans = mine.filter(r => !rowIds.includes(r.id));
        if (orphans.length > 0) {
          await supabase.from('leave_requests').delete().in('id', orphans.map(r => r.id));
          setLeaveRequests(prev => prev.filter(r => !orphans.some(o => o.id === r.id)));
          removed += orphans.length;
        }

        // Wire the halves together so the UI can show them as one request.
        if (rowIds.length > 1) {
          for (let i = 0; i < rowIds.length; i++) {
            const target = rowIds[(i + 1) % rowIds.length];
            await supabase.from('leave_requests').update({ linked_request_id: target }).eq('id', rowIds[i]);
            setLeaveRequests(prev => prev.map(r => r.id === rowIds[i] ? { ...r, linked_request_id: target } : r));
          }
        }
      }

      return { added, updated, removed };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('syncMandatoryFanout error:', e);
      alert(`Mandatory fan-out failed: ${msg}`);
      return null;
    }
  };

  /**
   * Catch-up sync: re-runs the idempotent fan-out for EVERY live closure. Use after hiring or
   * re-activating employees post-publication, or to repair a closure whose rows drifted.
   */
  const syncAllMandatoryLeaves = async () => {
    let closures = 0, added = 0, updated = 0, removed = 0;
    for (const m of mandatoryLeaves) {
      // Unpublished closures must contribute nothing — repair also clears their leftover rows.
      if (m.status !== 'published') {
        removed += await clearMandatoryFanout(m.id);
        continue;
      }
      const res = await syncMandatoryFanout(m);
      if (!res) continue; // deleted / failed
      closures++;
      added += res.added; updated += res.updated; removed += res.removed;
    }
    return { closures, added, updated, removed };
  };

  const addMandatoryLeave = async (ml: Omit<MandatoryLeave, 'id'>) => {
    let finalTypeId = ml.leave_type_id;
    if (finalTypeId === 'lt-annual' || !leaveTypes.some(lt => lt.id === finalTypeId)) {
      const validLt = leaveTypes.find(t => !t.is_hidden && (t.code === 'annual' || (t.name_en && t.name_en.toLowerCase().includes('annual')))) || leaveTypes.find(t => !t.is_hidden) || leaveTypes[0];
      if (validLt) finalTypeId = validLt.id;
    }
    const newMl: MandatoryLeave = { ...ml, leave_type_id: finalTypeId, id: generateUUID() };
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.from('mandatory_leaves').insert(newMl);
      if (error) {
        console.error('Failed to insert mandatory leave:', error);
        alert(`Database Error: ${error.message}`);
        return;
      }
      setMandatoryLeaves(prev => [newMl, ...prev]);
    } catch (e) {
      console.error('Failed to insert mandatory leave:', e);
      return;
    }

    // Fan out once (idempotent) — only when actually published.
    if (newMl.status === 'published') await syncMandatoryFanout(newMl);
  };

  const updateMandatoryLeave = async (id: string, updated: Partial<MandatoryLeave>) => {
    const supabase = getSupabaseBrowserClient();
    try {
      const prev = mandatoryLeaves.find(m => m.id === id);
      const eff = prev ? ({ ...prev, ...updated } as MandatoryLeave) : null;
      const { error } = await supabase.from('mandatory_leaves').update(updated).eq('id', id);
      if (error) {
        console.error('Failed to update mandatory leave:', error);
        alert(`Database Error: ${error.message}`);
        return;
      }
      setMandatoryLeaves(prevList => prevList.map(m => m.id === id ? { ...m, ...updated } : m));
      // Published → (re)fan out; unpublished (draft / cancelled) → stop deducting immediately.
      if (eff) {
        if (eff.status === 'published') await syncMandatoryFanout(eff);
        else await clearMandatoryFanout(eff.id);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('Failed to update mandatory leave:', e);
      alert(`Database Error: ${msg}`);
    }
  };

  const deleteMandatoryLeave = async (id: string) => {
    const supabase = getSupabaseBrowserClient();
    try {
      await supabase.from('leave_requests').delete().eq('mandatory_leave_id', id);
      setLeaveRequests(prev => prev.filter(r => r.mandatory_leave_id !== id));

      const { error } = await supabase.from('mandatory_leaves').delete().eq('id', id);
      if (error) {
        console.error('Failed to delete mandatory leave:', error);
        alert(`Database Error: ${error.message}`);
        return;
      }
      setMandatoryLeaves(prev => prev.filter(m => m.id !== id));
    } catch (e: any) {
      console.error('Failed to delete mandatory leave:', e);
    }
  };

  const backfillSalaryPayments = async (salaryId: string): Promise<{ created: number; skipped: number }> => {
    const sal = salaries.find(s => s.id === salaryId);
    if (!sal) return { created: 0, skipped: 0 };
    const prof = profiles.find(p => p.id === sal.profile_id);
    if (!prof) return { created: 0, skipped: 0 };

    const pt = paymentTypes.find(t => t.code === (prof.employment_type === 'contractor' ? 'contractor_invoice' : 'salary'));
    if (!pt) return { created: 0, skipped: 0 };

    const isContractor = prof.employment_type === 'contractor';
    const totalCost = isContractor ? sal.gross_amount : loadedMonthlyCost(sal);
    const employerContrib = isContractor ? 0 : Number((totalCost - sal.gross_amount).toFixed(2));
    const net = isContractor ? sal.gross_amount : Number((sal.gross_amount * 0.72).toFixed(2));

    const startPeriod = sal.valid_from.slice(0, 7);
    const endPeriod = sal.valid_to ? sal.valid_to.slice(0, 7) : new Date().toISOString().slice(0, 7);

    const newPays: PaymentRecord[] = [];
    let period = startPeriod;
    let guard = 0;
    while (period <= endPeriod && guard < 600) {
      const exists = payments.some(p => p.profile_id === sal.profile_id && p.payment_type_id === pt.id && p.period === period);
      if (!exists) {
        newPays.push({
          id: generateUUID(),
          profile_id: sal.profile_id,
          period,
          payment_type_id: pt.id,
          payment_type: pt,
          gross: sal.gross_amount,
          net,
          employer_contributions: employerContrib,
          total_cost: totalCost,
          payment_date: `${period}-28`,
          status: 'planned',
          documents: []
        });
      }
      const [y, m] = period.split('-').map(Number);
      period = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
      guard++;
    }

    if (newPays.length > 0) {
      const supabase = getSupabaseBrowserClient();
      const clean = newPays.map(({ payment_type, ...p }) => ({ ...p, documents: p.documents || [] }));
      const { error } = await supabase.from('payments').insert(clean);
      if (error) {
        console.error('Failed to backfill salary payments:', error);
        alert(`Database Error: ${error.message}`);
        return { created: 0, skipped: newPays.length };
      }
      setPayments(prev => [...newPays, ...prev]);
    }
    return { created: newPays.length, skipped: 0 };
  };

  const addPaymentRecord = async (pay: Omit<PaymentRecord, 'id'>) => {
    const newPay: PaymentRecord = { documents: [], ...pay, id: generateUUID() };
    const supabase = getSupabaseBrowserClient();
    const { payment_type, ...cleanPay } = newPay as any;
    try {
      const { error } = await supabase.from('payments').insert(cleanPay);
      if (error) {
        console.error('Failed to insert payment record:', error);
        alert(`Database Error: ${error.message}`);
        return;
      }
      setPayments(prev => [newPay, ...prev]);
    } catch (e: any) {
      console.error('Failed to insert payment record:', e);
    }
  };

  const updatePaymentRecord = async (id: string, updates: Partial<PaymentRecord>) => {
    setPayments(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    const supabase = getSupabaseBrowserClient();
    try {
      const { payment_type, ...cleanUpdates } = updates as any;
      // JSON.stringify drops `undefined`, so a cleared optional field (bank reference, note) would
      // silently keep its previous value. PostgREST needs null to actually empty the column.
      const payload = Object.fromEntries(
        Object.entries(cleanUpdates).map(([k, v]) => [k, v === undefined ? null : v])
      );
      await supabase.from('payments').update(payload).eq('id', id);
    } catch (e) {
      console.error('Failed to update payment in database:', e);
    }
  };

  const deletePaymentRecord = async (id: string) => {
    setPayments(prev => prev.filter(p => p.id !== id));
    const supabase = getSupabaseBrowserClient();
    try {
      await supabase.from('payments').delete().eq('id', id);
    } catch (e) {
      console.error('Failed to delete payment in database:', e);
    }
  };

  const markAllPaidForPeriod = async (period: string) => {
    setPayments(prev => prev.map(p => (p.period === period && p.status === 'planned') ? { ...p, status: 'paid' } : p));
    const supabase = getSupabaseBrowserClient();
    try {
      await supabase.from('payments').update({ status: 'paid' }).eq('period', period).eq('status', 'planned');
    } catch (e) {
      console.error('Failed to mark all paid in database:', e);
    }
  };

  const addPaymentType = async (pt: Omit<PaymentType, 'id' | 'sort_order'>) => {
    const newPt: PaymentType = {
      ...pt,
      id: generateUUID(),
      sort_order: paymentTypes.length + 1
    };
    setPaymentTypes(prev => [...prev, newPt]);
    const supabase = getSupabaseBrowserClient();
    try {
      await supabase.from('payment_types').insert(newPt);
    } catch (e) {
      console.error('Failed to insert payment type:', e);
    }
  };

  const updatePaymentType = async (id: string, updates: Partial<PaymentType>): Promise<boolean> => {
    setPaymentTypes(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.from('payment_types').update(updates).eq('id', id);
      if (error) {
        console.error('Failed to update payment type:', error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      return true;
    } catch (e) {
      console.error('Exception updating payment type:', e);
      return false;
    }
  };

  /**
   * Delete a Dynamic Payment Type. The DB refuses this when payment rows still reference it
   * (payments.payment_type_id is a NOT NULL FK with no cascade) — callers should offer
   * deactivation instead. Contractual extras that reference it are un-linked by the FK.
   * State is only updated after the DB accepted, so a failed delete changes nothing locally.
   */
  const deletePaymentType = async (id: string): Promise<boolean> => {
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.from('payment_types').delete().eq('id', id);
      if (error) {
        console.error('Failed to delete payment type:', error);
        alert(`Cannot delete this payment category:\n\n${error.message}`);
        return false;
      }
      setPaymentTypes(prev => prev.filter(t => t.id !== id));
      // Ledger entries that referenced it are un-linked by the FK (ON DELETE SET NULL).
      setSalaries(prev => prev.map(s => s.payment_type_id === id ? { ...s, payment_type_id: null } : s));
      return true;
    } catch (e) {
      console.error('Exception deleting payment type:', e);
      return false;
    }
  };

  const addDocumentType = async (dt: Omit<PaymentDocumentType, 'id' | 'sort_order'>): Promise<boolean> => {
    const newDt: PaymentDocumentType = { ...dt, id: generateUUID(), sort_order: documentTypes.length + 1 };
    setDocumentTypes(prev => [...prev, newDt]);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.from('payment_document_types').insert(newDt);
      if (error) {
        console.error('Failed to insert document type:', error);
        alert(`Database Error: ${error.message}`);
        setDocumentTypes(prev => prev.filter(d => d.id !== newDt.id));
        return false;
      }
      return true;
    } catch (e) {
      console.error('Exception inserting document type:', e);
      return false;
    }
  };

  const updateDocumentType = async (id: string, updates: Partial<PaymentDocumentType>): Promise<boolean> => {
    setDocumentTypes(prev => prev.map(d => d.id === id ? { ...d, ...updates } : d));
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.from('payment_document_types').update(updates).eq('id', id);
      if (error) {
        console.error('Failed to update document type:', error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      return true;
    } catch (e) {
      console.error('Exception updating document type:', e);
      return false;
    }
  };

  const deleteDocumentType = async (id: string): Promise<boolean> => {
    setDocumentTypes(prev => prev.filter(d => d.id !== id));
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.from('payment_document_types').delete().eq('id', id);
      if (error) {
        console.error('Failed to delete document type:', error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      return true;
    } catch (e) {
      console.error('Exception deleting document type:', e);
      return false;
    }
  };

  const addEmployeeContract = async (c: Omit<EmployeeContract, 'id'>): Promise<boolean> => {
    const newC: EmployeeContract = { ...c, id: generateUUID() };
    setEmployeeContracts(prev => [...prev, newC]);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.from('employee_contracts').insert(newC);
      if (error) {
        console.error('Failed to insert employee contract:', error);
        alert(`Database Error: ${error.message}`);
        setEmployeeContracts(prev => prev.filter(x => x.id !== newC.id));
        return false;
      }
      return true;
    } catch (e) {
      console.error('Exception inserting employee contract:', e);
      return false;
    }
  };

  const updateEmployeeContract = async (id: string, updates: Partial<EmployeeContract>): Promise<boolean> => {
    setEmployeeContracts(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.from('employee_contracts').update(updates).eq('id', id);
      if (error) {
        console.error('Failed to update employee contract:', error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      return true;
    } catch (e) {
      console.error('Exception updating employee contract:', e);
      return false;
    }
  };

  /**
   * Append an effective-dated ledger entry (base rate, contractual extra or one-off bonus).
   * Never edits in place: for a BASE row the previous open base rate is closed first, so raises
   * build a complete history. Extras/bonuses are additive and never close anything.
   */
  const addSalaryRecord = async (rec: Omit<SalaryRecord, 'id'>) => {
    const newSal: SalaryRecord = { ...rec, id: generateUUID() };
    const supabase = getSupabaseBrowserClient();

    if (isBaseSalary(newSal)) {
      const oldSal = salaries.find(s => s.profile_id === rec.profile_id && isBaseSalary(s) && !s.valid_to);
      if (oldSal) {
        const closeDate = rec.valid_from;
        setSalaries(prev => prev.map(s => s.id === oldSal.id ? { ...s, valid_to: closeDate } : s));
        try {
          await supabase.from('salary_history').update({ valid_to: closeDate }).eq('id', oldSal.id);
        } catch (e) {
          console.error('Failed to close old salary record in database:', e);
        }
      }
    }

    setSalaries(prev => [newSal, ...prev]);
    try {
      const { error } = await supabase.from('salary_history').insert(newSal);
      if (error) {
        console.error('Failed to insert new salary record:', error);
        alert(`Database Error: ${error.message}`);
        setSalaries(prev => prev.filter(s => s.id !== newSal.id));
      }
    } catch (e) {
      console.error('Failed to insert new salary record:', e);
    }
  };

  const updateSalaryRecord = async (id: string, updates: Partial<SalaryRecord>) => {
    setSalaries(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    const supabase = getSupabaseBrowserClient();
    try {
      await supabase.from('salary_history').update(updates).eq('id', id);
    } catch (e) {
      console.error('Failed to update salary record in database:', e);
    }
  };

  /**
   * Delete an effective-dated salary record. Generated payment rows are NOT touched — the
   * payment ledger is a historical record of what was actually paid.
   */
  const deleteSalaryRecord = async (id: string): Promise<boolean> => {
    setSalaries(prev => prev.filter(s => s.id !== id));
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.from('salary_history').delete().eq('id', id);
      if (error) {
        console.error('Failed to delete salary record:', error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      return true;
    } catch (e) {
      console.error('Exception deleting salary record:', e);
      return false;
    }
  };

  const addPaymentDocuments = async (paymentId: string, docs: PaymentDocument[]) => {
    let updatedDocs: PaymentDocument[] = [];
    setPayments(prev => prev.map(p => {
      if (p.id === paymentId) {
        updatedDocs = [...(p.documents || []), ...docs];
        return { ...p, documents: updatedDocs };
      }
      return p;
    }));
    const supabase = getSupabaseBrowserClient();
    try {
      await supabase.from('payments').update({ documents: updatedDocs }).eq('id', paymentId);
    } catch (e) {
      console.error('Failed to persist added payment documents:', e);
    }
  };

  const deletePaymentDocument = async (paymentId: string, documentId: string) => {
    let updatedDocs: PaymentDocument[] = [];
    setPayments(prev => prev.map(p => {
      if (p.id === paymentId) {
        updatedDocs = (p.documents || []).filter(d => d.id !== documentId);
        return { ...p, documents: updatedDocs };
      }
      return p;
    }));
    const supabase = getSupabaseBrowserClient();
    try {
      await supabase.from('payments').update({ documents: updatedDocs }).eq('id', paymentId);
    } catch (e) {
      console.error('Failed to delete payment document in database:', e);
    }
  };

  const updatePaymentDocumentType = async (paymentId: string, documentId: string, type: string) => {
    let updatedDocs: PaymentDocument[] = [];
    setPayments(prev => prev.map(p => {
      if (p.id === paymentId) {
        updatedDocs = (p.documents || []).map(d => d.id === documentId ? { ...d, type } : d);
        return {
          ...p,
          documents: updatedDocs
        };
      }
      return p;
    }));
    const supabase = getSupabaseBrowserClient();
    try {
      await supabase.from('payments').update({ documents: updatedDocs }).eq('id', paymentId);
    } catch (e) {
      console.error('Failed to update payment document category in database:', e);
    }
  };

  const generateDraftMonth = async (period: string) => {
    const activeStaff = profiles.filter(p => p.status === 'active');
    const newPays: PaymentRecord[] = [];
    const monthNum = parseInt(period.split('-')[1], 10);

    activeStaff.forEach(p => {
      const sal = salaries.find(s => s.profile_id === p.id && isBaseSalary(s) && !s.valid_to);
      if (!sal) return;

      // The base ledger row names the Dynamic Payment Type the money is filed under (set in the
      // raise modal). Rows recorded before that existed fall back to the conventional code.
      const basePaymentType = (fallbackCode: string) =>
        (sal.payment_type_id ? paymentTypes.find(t => t.id === sal.payment_type_id) : undefined)
        || paymentTypes.find(t => t.code === fallbackCode);

      if (p.employment_type === 'contractor') {
        const pt = basePaymentType('contractor_invoice');
        if (pt) {
          const duplicate = payments.some(exist => exist.profile_id === p.id && exist.payment_type_id === pt.id && exist.period === period);
          if (!duplicate && !newPays.some(n => n.profile_id === p.id && n.payment_type_id === pt.id)) {
            newPays.push({
              id: generateUUID(),
              profile_id: p.id,
              period,
              payment_type_id: pt.id,
              payment_type: pt,
              gross: sal.gross_amount,
              net: sal.gross_amount,
              employer_contributions: 0,
              total_cost: sal.gross_amount,
              payment_date: `${period}-28`,
              status: 'planned',
              documents: []
            });
          }
        }
      } else {
        const ptSalary = basePaymentType('salary');
        const mult = employerCostRatio(sal);
        
        if (ptSalary) {
          const duplicate = payments.some(exist => exist.profile_id === p.id && exist.payment_type_id === ptSalary.id && exist.period === period);
          if (!duplicate && !newPays.some(n => n.profile_id === p.id && n.payment_type_id === ptSalary.id)) {
            const total_cost = Number((sal.gross_amount * mult).toFixed(2));
            const employer_contributions = Number((total_cost - sal.gross_amount).toFixed(2));
            const net = Number((sal.gross_amount * 0.72).toFixed(2));
            newPays.push({
              id: generateUUID(),
              profile_id: p.id,
              period,
              payment_type_id: ptSalary.id,
              payment_type: ptSalary,
              gross: sal.gross_amount,
              net,
              employer_contributions,
              total_cost,
              payment_date: `${period}-28`,
              status: 'planned',
              documents: []
            });
          }
        }

        // Statutory Extras check (Easter bonus in month 4, Holiday allowance in month 7, Christmas bonus in month 12)
        const statutoryTypes = paymentTypes.filter(t => t.is_statutory && !t.is_recurring_monthly && t.default_period_month === monthNum);
        statutoryTypes.forEach(ptStat => {
          const duplicateStat = payments.some(exist => exist.profile_id === p.id && exist.payment_type_id === ptStat.id && exist.period === period);
          if (!duplicateStat && !newPays.some(n => n.profile_id === p.id && n.payment_type_id === ptStat.id)) {
            const statGross = Number((sal.gross_amount * (ptStat.default_multiplier ?? 1.0)).toFixed(2));
            const statTotalCost = Number((statGross * mult).toFixed(2));
            const statEmployerContrib = Number((statTotalCost - statGross).toFixed(2));
            const statNet = Number((statGross * 0.72).toFixed(2));
            newPays.push({
              id: generateUUID(),
              profile_id: p.id,
              period,
              payment_type_id: ptStat.id,
              payment_type: ptStat,
              gross: statGross,
              net: statNet,
              employer_contributions: statEmployerContrib,
              total_cost: statTotalCost,
              payment_date: `${period}-28`,
              status: 'planned',
              note: `Statutory Item: ${ptStat.name_en}`,
              documents: []
            });
          }
        });

        // Contractual extras & one-off bonuses live in the salary ledger as effective-dated rows.
        // A month is covered when valid_from <= month end and valid_to is open or within the month.
        // An entry naming a Dynamic Payment Type is filed under that category, else the generic 'bonus'.
        const ptBonus = paymentTypes.find(t => t.code === 'bonus');
        if (ptBonus) {
          const monthStart = `${period}-01`;
          const monthEnd = new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0).toISOString().slice(0, 10);
          const dueExtras = salaries.filter(s =>
            s.profile_id === p.id && !isBaseSalary(s) &&
            s.valid_from <= monthEnd && (!s.valid_to || s.valid_to >= monthStart)
          );
          dueExtras.forEach(x => {
            const payType = (x.payment_type_id ? paymentTypes.find(t => t.id === x.payment_type_id) : undefined) || ptBonus;
            const note = `Extra: ${x.label || 'Contractual extra'}`;
            const duplicateBonus = payments.some(exist =>
              exist.profile_id === p.id && exist.payment_type_id === payType.id &&
              exist.period === period && exist.note === note
            );
            if (duplicateBonus || newPays.some(n => n.profile_id === p.id && n.payment_type_id === payType.id && n.note === note)) return;
            const extraAmount = Number(x.gross_amount);
            const extraTotalCost = Number((extraAmount * mult).toFixed(2));
            const extraEmployer = Number((extraTotalCost - extraAmount).toFixed(2));
            const extraNet = Number((extraAmount * 0.72).toFixed(2));
            newPays.push({
              id: generateUUID(),
              profile_id: p.id,
              period,
              payment_type_id: payType.id,
              payment_type: payType,
              gross: extraAmount,
              net: extraNet,
              employer_contributions: extraEmployer,
              total_cost: extraTotalCost,
              payment_date: `${period}-28`,
              status: 'planned',
              note,
              documents: []
            });
          });
        }
      }
    });

    if (newPays.length === 0) {
      alert(`No new draft payments to generate for period ${period}! Duplicate guard active: all required salary, fee, and statutory payment rows already exist in the ledger.`);
      return;
    }

    const supabase = getSupabaseBrowserClient();
    try {
      const cleanPays = newPays.map(({ payment_type, ...p }: any) => ({ ...p, documents: p.documents || [] }));
      if (cleanPays.length > 0) {
        const { error } = await supabase.from('payments').insert(cleanPays);
        if (error) {
          console.error('Failed to batch insert draft payments:', error);
        }
      }
      setPayments(prev => [...newPays, ...prev]);
      notifySuccess(`Generated ${newPays.length} draft payment row(s) for ${period}.`);
    } catch (e: any) {
      console.error('Failed to batch insert draft payments:', e);
    }
  };

  const addContract = async (cnt: Omit<Contract, 'id'>) => {
    const newCnt: Contract = { ...cnt, id: generateUUID() };
    const supabase = getSupabaseBrowserClient();
    const { counterparty, owner_profile, lines, groups, schedule, notice_deadline, ...cleanCnt } = newCnt as any;
    try {
      const { error, data } = await supabase.from('contracts').insert(cleanCnt).select().single();
      if (error) {
        console.error('Failed to insert contract:', error);
        alert(`Database Error: ${error.message}`);
        return;
      }
      const savedCnt = data ? { ...newCnt, ...data, counterparty: newCnt.counterparty, owner_profile: newCnt.owner_profile, lines: lines || [], schedule: schedule || [] } : newCnt;
      setContracts(prev => [savedCnt, ...prev]);
      return savedCnt;
    } catch (e: any) {
      console.error('Failed to insert contract:', e);
      return null;
    }
  };

  /**
   * Rewrites a contract's monthly projection from scratch. `contract_schedule` is a projection of the
   * current price sheet and term dates, not a ledger — keeping old months when pricing changes is what
   * made the revenue schedule disagree with the contract. Actuals live in invoices.
   */
  const rebuildContractSchedule = async (contract: Contract): Promise<ContractSchedule[]> => {
    const supabase = getSupabaseBrowserClient();
    const months = contractChargeMonths({ ...contract, schedule: [] }, catalogModules, catalogItems);
    const rows: ContractSchedule[] = Object.entries(months)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, amount]) => ({ id: generateUUID(), contract_id: contract.id, period, amount }));

    const { error: clearErr } = await supabase.from('contract_schedule').delete().eq('contract_id', contract.id);
    if (clearErr) console.error('[contract_schedule] clear failed:', clearErr.message);
    if (rows.length > 0) {
      const { error } = await supabase.from('contract_schedule').insert(rows);
      if (error) console.error('[contract_schedule] rebuild failed:', error.message);
    }
    setContractSchedules(prev => [...prev.filter(s => s.contract_id !== contract.id), ...rows]);
    return rows;
  };

  const updateContract = async (updated: Contract) => {
    const supabase = getSupabaseBrowserClient();
    const { counterparty, owner_profile, lines, groups, schedule: _ignoredSchedule, notice_deadline, ...cleanCnt } = updated as any;
    try {
      const { error, data } = await supabase.from('contracts').update(cleanCnt).eq('id', updated.id).select().single();
      if (error) {
        console.error('Failed to update contract:', error);
        alert(`Database Error: ${error.message}`);
        return;
      }
      // Any edit — term dates, cadence, value or the price sheet itself — reflows every month.
      const rebuilt = await rebuildContractSchedule({
        ...updated,
        lines: lines || [],
        groups: groups || [],
        schedule: [],
      });
      const savedCnt = data
        ? { ...updated, ...data, counterparty: updated.counterparty, owner_profile: updated.owner_profile, lines: lines || [], groups: groups || [], schedule: rebuilt }
        : { ...updated, lines: lines || [], groups: groups || [], schedule: rebuilt };
      setContracts(prev => prev.map(c => c.id === updated.id ? savedCnt : c));
    } catch (e: any) {
      console.error('Failed to update contract:', e);
    }
  };

  const deleteContract = async (id: string): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      await supabase.from('contract_lines').delete().eq('contract_id', id);
      await supabase.from('contract_line_groups').delete().eq('contract_id', id);
      await supabase.from('contract_schedule').delete().eq('contract_id', id);
      const { error } = await supabase.from('contracts').delete().eq('id', id);
      if (error) {
        console.error('Failed to delete contract:', error);
        alert(`Database Error deleting contract: ${error.message}`);
        return false;
      }
      setContracts(prev => prev.filter(c => c.id !== id));
      setContractLines(prev => prev.filter(l => l.contract_id !== id));
      setContractSchedules(prev => prev.filter(s => s.contract_id !== id));
      return true;
    } catch (e: any) {
      console.error('Failed to delete contract:', e);
      return false;
    }
  };

  const saveContractPricing = async (
    contractId: string, 
    lines: Omit<ContractLine, 'id' | 'contract_id'>[], 
    schedules: { period: string; amount: number }[], 
    discount_pct: number, 
    term_years: number, 
    service_start_date: string, 
    calculatedValue: number,
    groups: Omit<ContractLineGroup, 'contract_id'>[] = []
  ): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      await supabase.from('contracts').update({
        discount_pct,
        term_years,
        service_start_date,
        value: calculatedValue
      }).eq('id', contractId);

      await supabase.from('contract_lines').delete().eq('contract_id', contractId);
      await supabase.from('contract_line_groups').delete().eq('contract_id', contractId);

      const groupsToInsert = groups.map(g => ({
        id: g.id,
        contract_id: contractId,
        name: g.name,
        min_monthly_charge: (g.min_monthly_charge && Number(g.min_monthly_charge) > 0) ? Number(g.min_monthly_charge) : null,
        sort_order: g.sort_order || 0
      }));
      if (groupsToInsert.length > 0) {
        await supabase.from('contract_line_groups').insert(groupsToInsert);
      }

      const linesToInsert = lines.map(l => ({
        id: generateUUID(),
        contract_id: contractId,
        catalog_item_id: l.catalog_item_id || null,
        group_id: l.group_id || null,
        name: l.name,
        unit_price: l.unit_price,
        quantity: l.quantity,
        unit_label: l.unit_label,
        frequency: l.frequency,
        note: l.note || null,
        monthly_quantities: l.monthly_quantities || null,
        apply_discount: l.apply_discount !== false,
        min_monthly_charge: null,
        invoice_timing: l.invoice_timing || null,
        starts_on: l.starts_on || null,
        ends_on: l.ends_on || null,
        line_kind: l.line_kind || 'unit',
        role: l.role || null,
        seniority: l.seniority || null
      }));
      if (linesToInsert.length > 0) {
        const { error: linesErr } = await supabase.from('contract_lines').insert(linesToInsert);
        if (linesErr) {
          console.error('[contract_lines] insert failed', linesErr, linesToInsert);
          // Never leave the contract line-less (the previous rows are already deleted), but be loud about
          // it: retry once without the newest columns, and only when the error is about those columns.
          const aboutNewColumns = /invoice_timing|starts_on|ends_on/i.test(linesErr.message || '');
          if (aboutNewColumns) {
            const { error: retryErr } = await supabase.from('contract_lines').insert(linesToInsert.map(l => {
              const copy: Record<string, unknown> = { ...l };
              delete copy.invoice_timing;
              delete copy.starts_on;
              delete copy.ends_on;
              return copy;
            }));
            alert(
              retryErr
                ? `Could not save the contract lines: ${retryErr.message}`
                : `Saved the price sheet, but NOT the per-line invoicing timing / active windows: ${linesErr.message}\n\nApply supabase/migrations/20260917130000_contract_line_invoice_timing.sql and 20260917140000_contract_line_active_window.sql, then save again.`
            );
          } else {
            alert(`Could not save the contract lines: ${linesErr.message}`);
          }
        }
      }

      // Rebuild the whole projection: months outside the new term must disappear and every remaining
      // month must reflect the current lines, even ones already in the past.
      await supabase.from('contract_schedule').delete().eq('contract_id', contractId);

      const schedsToInsert = schedules
        .filter(s => s.period && Number.isFinite(Number(s.amount)))
        .map(s => ({
          id: generateUUID(),
          contract_id: contractId,
          period: s.period,
          amount: s.amount
        }));

      if (schedsToInsert.length > 0) {
        await supabase.from('contract_schedule').insert(schedsToInsert);
      }

      const finalLines = linesToInsert;
      const finalGroups = groupsToInsert.map(g => ({ ...g, contract_id: contractId }));
      const finalSchedule = [...schedsToInsert].sort((a, b) => a.period.localeCompare(b.period));

      setContractLines(prev => [...prev.filter(l => l.contract_id !== contractId), ...finalLines]);
      setContractSchedules(prev => [...prev.filter(s => s.contract_id !== contractId), ...finalSchedule]);
      setContracts(prev => prev.map(c => c.id === contractId ? {
        ...c,
        discount_pct,
        term_years,
        service_start_date,
        value: calculatedValue,
        lines: finalLines,
        groups: finalGroups,
        schedule: finalSchedule
      } : c));
      return true;
    } catch (err: any) {
      console.error('saveContractPricing error:', err);
      alert(`Error saving contract pricing: ${err.message}`);
      return false;
    }
  };

  const addCounterparty = async (cp: Partial<Counterparty>, attioRecordId?: string): Promise<Counterparty | null> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const id = generateUUID();
      let vat_number = cp.vat_number || cp.afm || undefined;
      if (vat_number && (vat_number === 'N/A in Attio' || vat_number === 'N/A' || vat_number.trim() === '')) {
        vat_number = undefined;
      }
      let vat_valid = true;
      let vat_checked_at = new Date().toISOString();

      if (vat_number && (cp.country === 'Greece' || cp.country?.toUpperCase() === 'EL' || cp.country === 'Germany' || cp.country === 'Norway' || cp.country === 'Luxembourg' || vat_number.startsWith('EL') || vat_number.startsWith('DE') || vat_number.startsWith('LU') || vat_number.startsWith('NO'))) {
        vat_valid = vat_number.length >= 7;
      }

      const row = {
        id,
        legal_name: cp.legal_name || 'Unnamed Entity',
        trade_name: cp.trade_name || cp.legal_name || null,
        afm: vat_number || null,
        vat_number: vat_number || null,
        vat_valid,
        vat_checked_at,
        registration_number: cp.registration_number || null,
        doy: cp.doy || null,
        country: cp.country || 'Greece',
        address: cp.address || null,
        website_domain: cp.website_domain || null,
        status: cp.status || 'active',
        is_internal: cp.is_internal || false,
        sync_to_attio: cp.sync_to_attio ?? true,
        notes: cp.notes || null,
      };

      const { data, error } = await supabase.from('counterparties').insert(row).select().single();
      if (error) {
        console.error('Error inserting counterparty:', error);
        alert(`Failed to create counterparty: ${error.message} (Check for duplicate VAT/country key)`);
        return null;
      }

      let attio_link: AttioLink | undefined = undefined;
      if (attioRecordId || row.sync_to_attio) {
        const linkRow = {
          id: generateUUID(),
          counterparty_id: id,
          attio_record_id: attioRecordId || `attio_rec_orbit_${id.slice(0, 8)}`,
          link_status: 'linked' as const,
          orbit_arr: 0,
          orbit_active_contracts: 0
        };
        const { data: lData } = await supabase.from('attio_links').insert(linkRow).select().single();
        if (lData) attio_link = lData as AttioLink;
      }

      if (cp.roles && cp.roles.length > 0) {
        const roleInserts = cp.roles.map(r => ({ counterparty_id: id, role_id: r.id }));
        await supabase.from('counterparty_roles').insert(roleInserts);
        setCounterpartyRoleLinks(prev => [...prev, ...roleInserts]);
      }

      const newCp: Counterparty = {
        ...(data || row),
        attio_link,
        contacts: [],
        roles: cp.roles || [],
        derived_role: 'none yet'
      };
      setCounterparties(prev => [newCp, ...prev]);
      return newCp;
    } catch (e: any) {
      console.error(e);
      return null;
    }
  };

  const updateCounterparty = async (cp: Counterparty): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const { attio_link, contacts, derived_role, roles, tier, ...cleanRow } = cp as any;
      await supabase.from('counterparties').update(cleanRow).eq('id', cp.id);
      
      const newRoles = roles || [];
      await supabase.from('counterparty_roles').delete().eq('counterparty_id', cp.id);
      if (newRoles.length > 0) {
        const roleInserts = newRoles.map((r: Role) => ({ counterparty_id: cp.id, role_id: r.id }));
        await supabase.from('counterparty_roles').insert(roleInserts);
        setCounterpartyRoleLinks(prev => [...prev.filter(l => l.counterparty_id !== cp.id), ...roleInserts]);
      } else {
        setCounterpartyRoleLinks(prev => prev.filter(l => l.counterparty_id !== cp.id));
      }
      
      setCounterparties(prev => prev.map(c => c.id === cp.id ? cp : c));
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  const deleteCounterparty = async (id: string): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      await supabase.from('attio_links').delete().eq('counterparty_id', id);
      await supabase.from('counterparty_contacts').delete().eq('counterparty_id', id);
      const { error } = await supabase.from('counterparties').delete().eq('id', id);
      if (error) throw error;
      setCounterparties(prev => prev.filter(c => c.id !== id));
      return true;
    } catch (e) {
      console.error('Error deleting counterparty:', e);
      return false;
    }
  };

  const deleteAllCounterparties = async (): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      await supabase.from('attio_links').delete().neq('counterparty_id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('counterparty_contacts').delete().neq('counterparty_id', '00000000-0000-0000-0000-000000000000');
      const { error } = await supabase.from('counterparties').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) throw error;
      setCounterparties([]);
      return true;
    } catch (e) {
      console.error('Error deleting all counterparties:', e);
      return false;
    }
  };

  const syncAttioRoles = async (): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const { data: mcpTokens } = await supabase.from('mcp_oauth_tokens').select('*').eq('provider', 'attio').limit(1);
      const token = mcpTokens && mcpTokens.length > 0 ? mcpTokens[0].access_token : undefined;
      
      const res = await fetch('/api/v1/attio/attributes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const data = await res.json();
      if (data.success && data.attributes) {
        const relationshipAttr = data.attributes.find((a: any) => a.api_slug === 'relationship_type');
        if (relationshipAttr && relationshipAttr.options) {
          const options = relationshipAttr.options;
          const roleInserts = options.map((opt: any) => ({
            id: generateUUID(),
            attio_id: opt.id,
            name: opt.title,
            slug: (opt.title || opt.id).toLowerCase().replace(/[^a-z0-9]+/g, '-')
          }));
          
          for (const row of roleInserts) {
            await supabase.from('roles').upsert({
              attio_id: row.attio_id,
              name: row.name,
              slug: row.slug
            }, { onConflict: 'slug' });
          }
          
          // Re-fetch roles
          const { data: newRoles } = await supabase.from('roles').select('*');
          if (newRoles) setCounterpartyRoles(newRoles);
          
          return true;
        }
      }
      return false;
    } catch (e) {
      console.error('Failed to sync attio roles:', e);
      return false;
    }
  };

  const linkToAttio = async (counterpartyId: string, attioRecordId: string): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const linkRow = {
        id: generateUUID(),
        counterparty_id: counterpartyId,
        attio_record_id: attioRecordId,
        link_status: 'linked' as const,
        orbit_arr: 0,
        orbit_active_contracts: 0
      };
      await supabase.from('attio_links').delete().eq('counterparty_id', counterpartyId);
      const { data } = await supabase.from('attio_links').insert(linkRow).select().single();
      const l: AttioLink = (data || linkRow) as AttioLink;
      setCounterparties(prev => prev.map(c => c.id === counterpartyId ? { ...c, attio_link: l, sync_to_attio: true } : c));
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  const processAttioReviewEvent = async (eventId: string, action: 'confirm' | 'link' | 'skip', targetCpId?: string): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const event = attioEvents.find(e => e.id === eventId || e.attio_event_id === eventId);
      if (!event) return false;

      let payloadObj: any = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;

      if (action === 'confirm') {
        await addCounterparty({
          legal_name: payloadObj?.name || 'New Attio Company',
          website_domain: payloadObj?.domain || '',
          country: payloadObj?.country || 'Greece',
          vat_number: payloadObj?.vat_guess || '',
          sync_to_attio: true
        }, payloadObj?.record_id);
      } else if (action === 'link' && targetCpId) {
        await linkToAttio(targetCpId, payloadObj?.record_id || 'attio_linked_rec');
      }

      const status = action === 'skip' ? 'skipped' : 'processed';
      await supabase.from('attio_events').update({ status, processed_at: new Date().toISOString() }).eq('attio_event_id', event.attio_event_id);
      setAttioEvents(prev => prev.map(e => e.attio_event_id === event.attio_event_id ? { ...e, status: status as any, processed_at: new Date().toISOString() } : e));
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  function attachTierToCounterparty(
    cp: Counterparty,
    versions: TierModelVersion[],
    states: CounterpartyTierRow[],
    overrides: CounterpartyTierOverride[]
  ): Counterparty['tier'] {
    const clientVersion = versions.find(v => v.model === 'client' && v.active);
    const state = states.find(t => t.counterparty_id === cp.id && t.model === 'client');
    if (!state) {
      return {
        tier_index: null, tier_count: clientVersion?.tier_count || 4, score: null,
        breakdown: {}, label: 'Unrated', color: '#94a3b8',
        overridden: false
      };
    }
    const config = (clientVersion?.config || {}) as unknown as { tiers?: Array<{ color?: string }> };
    const rawBreakdown = state.breakdown as unknown;
    const breakdown = typeof rawBreakdown === 'string'
      ? (JSON.parse(rawBreakdown) as Record<string, unknown>)
      : (rawBreakdown as Record<string, unknown>);
    const tierColor = config.tiers?.[state.tier_index ?? -1]?.color || (state.tier_index === null ? '#94a3b8' : '#64748b');
    const today = new Date().toISOString().split('T')[0];
    const override = overrides.find(o => o.counterparty_id === cp.id && o.model === 'client' && (!o.expires_on || o.expires_on >= today));
    const displayIndex = override ? override.tier_index : state.tier_index;
    return {
      tier_index: state.tier_index,
      tier_count: state.tier_count,
      score: state.score,
      breakdown,
      computed_at: state.computed_at,
      label: tierLabel(displayIndex, state.tier_count),
      color: override ? (config.tiers?.[override.tier_index ?? -1]?.color || tierColor) : tierColor,
      overridden: !!override,
      override_tier_index: override?.tier_index,
      override_reason: override?.reason,
      override_expires_on: override?.expires_on || undefined
    };
  };

  const recomputeTiers = async (
    model: TierModel,
    cause: 'data_change' | 'config_change' | 'override'
  ): Promise<{ ok: boolean; changes: CounterpartyTierHistoryRow[]; error?: string }> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const activeVersion = tierModelVersions.find(v => v.model === model && v.active);
      if (!activeVersion) return { ok: false, changes: [], error: 'No active model configuration found.' };
      const config = activeVersion.config as unknown as TierModelConfig;
      const ctx: TierDataContext = {
        contracts, invoices, schedule: contractSchedules,
        catalogModules, catalogItems
      };

      const today = new Date().toISOString().split('T')[0];
      const activeOverrides = tierOverrides.filter(o => o.model === model && (!o.expires_on || o.expires_on >= today));

      const currentMap = new Map<string, { tier_index: number | null; tier_count: number; score: number | null }>();
      tierStates.filter(t => t.model === model).forEach(t => currentMap.set(t.counterparty_id, { tier_index: t.tier_index, tier_count: t.tier_count, score: t.score }));

      const newStates: CounterpartyTierRow[] = counterparties.map(cp => {
        const result = scoreCounterparty(model, cp.id, config, ctx);
        const override = activeOverrides.find(o => o.counterparty_id === cp.id);
        const tierIndex = override ? override.tier_index : result.tierIndex;
        return {
          counterparty_id: cp.id,
          model,
          tier_index: tierIndex,
          tier_count: config.tiers.length,
          score: result.score,
          breakdown: result.breakdown as unknown as Record<string, unknown>,
          model_version_id: activeVersion.id
        };
      });

      const deltas = buildHistoryDeltas(
        model,
        newStates.map(s => ({ counterparty_id: s.counterparty_id, tier_index: s.tier_index, tier_count: s.tier_count, score: s.score })),
        currentMap,
        cause
      );

      const rowsToInsert = newStates.map(s => ({ ...s, breakdown: s.breakdown }));
      const { error: upsertError } = await supabase.from('counterparty_tiers').upsert(rowsToInsert, { onConflict: 'counterparty_id,model' });
      if (upsertError) throw upsertError;

      const historyRows = deltas.map(d => ({ ...d, id: generateUUID() }));
      if (historyRows.length > 0) {
        const { error: historyError } = await supabase.from('counterparty_tier_history').insert(historyRows);
        if (historyError) throw historyError;
      }

      setTierStates(newStates);
      if (historyRows.length > 0) setTierHistory(prev => [...historyRows, ...prev].slice(0, 300));
      setCounterparties(prev => prev.map(cp => {
        const state = newStates.find(s => s.counterparty_id === cp.id);
        if (!state) return cp;
        return { ...cp, tier: attachTierToCounterparty(cp, tierModelVersions, newStates, tierOverrides) };
      }));

      // Persist tier label on the Attio link and push to CRM (best-effort, silent)
      try {
        const linked = counterparties.filter(cp => cp.attio_link?.attio_record_id && cp.attio_link.link_status === 'linked');
        if (linked.length > 0) {
          const syncRecords: Array<{ record_id: string; tier_label: string }> = [];
          for (const cp of linked) {
            const state = newStates.find(s => s.counterparty_id === cp.id);
            const label = tierLabel(state?.tier_index ?? null, state?.tier_count ?? config.tiers.length);
            syncRecords.push({ record_id: cp.attio_link!.attio_record_id!, tier_label: label });
            await supabase.from('attio_links').update({ orbit_tier: label, last_outbound_at: new Date().toISOString() })
              .eq('counterparty_id', cp.id);
          }
          const apiToken = typeof window !== 'undefined' ? localStorage.getItem('orbit_attio_api_key') || '' : '';
          if (apiToken) {
            fetch('/api/v1/attio/sync-tiers', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: apiToken, records: syncRecords, tierCount: config.tiers.length })
            }).catch(err => console.warn('[tier-sync] Attio push failed:', err));
          }
        }
      } catch (syncErr) {
        console.warn('[tier-sync] Attio link update failed:', syncErr);
      }

      return { ok: true, changes: historyRows };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error('recomputeTiers error:', e);
      return { ok: false, changes: [], error: errMsg || 'Recompute failed' };
    }
  };

  const applyTierModelConfig = async (
    model: TierModel,
    config: Record<string, unknown>,
    tierCount: number
  ): Promise<{ ok: boolean; changes: CounterpartyTierHistoryRow[]; error?: string }> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const versionId = generateUUID();
      const { error: deactivateError } = await supabase.from('tier_model_versions')
        .update({ active: false }).eq('model', model).eq('active', true);
      if (deactivateError) throw deactivateError;

      const { error: insertError } = await supabase.from('tier_model_versions').insert({
        id: versionId, model, tier_count: tierCount, config,
        created_by: currentUser?.id || null, active: true
      });
      if (insertError) throw insertError;

      setTierModelVersions(prev => [
        ...prev.map(v => v.model === model ? { ...v, active: false } : v),
        { id: versionId, model, tier_count: tierCount, config, active: true, created_by: currentUser?.id }
      ]);

      const result = await recomputeTiers(model, 'config_change');
      return result;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error('applyTierModelConfig error:', e);
      return { ok: false, changes: [], error: errMsg || 'Failed to apply configuration' };
    }
  };

  const setTierOverride = async (
    counterpartyId: string,
    model: TierModel,
    tierIndex: number | null,
    reason: string,
    expiresOn?: string
  ): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      if (tierIndex === null || reason.trim() === '') {
        const { error } = await supabase.from('counterparty_tier_overrides')
          .delete().eq('counterparty_id', counterpartyId).eq('model', model);
        if (error) throw error;
        setTierOverrides(prev => prev.filter(o => !(o.counterparty_id === counterpartyId && o.model === model)));
      } else {
        const overrideRow: CounterpartyTierOverride = {
          id: generateUUID(), counterparty_id: counterpartyId, model,
          tier_index: tierIndex, reason: reason.trim(), expires_on: expiresOn || null,
          created_by: currentUser?.id || null
        };
        const { error } = await supabase.from('counterparty_tier_overrides').upsert(
          { ...overrideRow, expires_on: overrideRow.expires_on || undefined },
          { onConflict: 'id' }
        );
        if (error) throw error;
        setTierOverrides(prev => [...prev.filter(o => !(o.counterparty_id === counterpartyId && o.model === model)), overrideRow]);
      }
      const recompute = await recomputeTiers(model, 'override');
      return recompute.ok;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error('setTierOverride error:', e);
      alert(`Override error: ${errMsg}`);
      return false;
    }
  };

  const reconcileAttio = async (): Promise<void> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const updatedCps = await Promise.all(counterparties.map(async (cp) => {
        if (!cp.attio_link || !cp.sync_to_attio) return cp;
        const activeContracts = contracts.filter(c => c.counterparty_id === cp.id && c.status === 'active');
        const activeRevContracts = activeContracts.filter(c => c.direction === 'revenue');
        const count = activeContracts.length;
        
        let orbit_arr = 0;
        activeRevContracts.forEach(c => {
          const val = calculateContractValuation(c.lines || [], c.discount_pct || 0, c.term_years || 1, c.service_start_date || c.starts_on, catalogModules, catalogItems, c.value || 0, c.billing_cadence);
          orbit_arr += val.netARR;
        });

        const sortedRenewals = activeContracts
          .map(c => c.ends_on)
          .filter(Boolean)
          .sort() as string[];
        const orbit_next_renewal = sortedRenewals[0] || undefined;

        const newLink: AttioLink = {
          ...cp.attio_link,
          orbit_arr,
          orbit_active_contracts: count,
          orbit_next_renewal,
          last_outbound_at: new Date().toISOString()
        };

        await supabase.from('attio_links').update({
          orbit_arr,
          orbit_active_contracts: count,
          orbit_next_renewal: orbit_next_renewal || null,
          last_outbound_at: new Date().toISOString()
        }).eq('counterparty_id', cp.id);

        return { ...cp, attio_link: newLink };
      }));

      setCounterparties(updatedCps);
      notifySuccess('Attio nightly reconciliation completed.');
    } catch (e) {
      console.error(e);
      alert("Error executing Attio reconciliation.");
    }
  };

  const reassignContracts = async (fromCpId: string, contractIds: string[], toCpId: string): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.from('contracts').update({ counterparty_id: toCpId }).in('id', contractIds);
      if (error) throw error;

      const targetCp = counterparties.find(c => c.id === toCpId);
      setContracts(prev => prev.map(c => contractIds.includes(c.id) ? { ...c, counterparty_id: toCpId, counterparty: targetCp } : c));
      
      setTimeout(() => {
        setCounterparties(prevCps => prevCps.map(cp => {
          const cpContracts = contracts.map(c => (contractIds.includes(c.id) ? { ...c, counterparty_id: toCpId } : c))
            .filter((cnt: any) => cnt.counterparty_id === cp.id && cnt.status !== 'archived');
          const hasRev = cpContracts.some((cnt: any) => cnt.direction === 'revenue');
          const hasCost = cpContracts.some((cnt: any) => cnt.direction === 'cost' || cnt.direction === 'supplier');
          let derived_role: 'client' | 'supplier' | 'both' | 'none yet' = 'none yet';
          if (hasRev && hasCost) derived_role = 'both';
          else if (hasRev) derived_role = 'client';
          else if (hasCost) derived_role = 'supplier';
          return { ...cp, derived_role };
        }));
      }, 50);

      return true;
    } catch (e: any) {
      console.error(e);
      alert(`Reassignment failed: ${e.message}`);
      return false;
    }
  };

  const mergeCounterparties = async (targetId: string, sourceId: string): Promise<{ ok: boolean; counts?: Record<string, unknown>; error?: string }> => {
    try {
      const res = await fetch('/api/counterparties/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId, sourceId }),
      });
      const data = await res.json();
      if (!res.ok || data.ok !== true) {
        return { ok: false, error: data.error || 'Merge failed' };
      }
      // The auth context caches the whole registry in memory; the page triggers a reload
      // after the success toast so every table (counterparties, contracts, invoices, links,
      // tiers) is re-synced consistently.
      return { ok: true, counts: data.counts };
    } catch (e: any) {
      console.error('Merge counterparties error:', e);
      return { ok: false, error: e?.message || 'Merge request failed' };
    }
  };

  const addCounterpartyContact = async (contact: Partial<CounterpartyContact>): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      if (!contact.counterparty_id || !contact.name) return false;
      const row = {
        id: generateUUID(),
        counterparty_id: contact.counterparty_id,
        name: contact.name,
        email: contact.email || null,
        phone: contact.phone || null,
        role: contact.role || null,
        attio_person_id: contact.attio_person_id || `person_${Math.floor(Math.random()*90000+10000)}`,
        created_at: new Date().toISOString()
      };
      await supabase.from('counterparty_contacts').insert(row);
      setCounterparties(prev => prev.map(c => c.id === contact.counterparty_id ? { ...c, contacts: [...(c.contacts || []), row as CounterpartyContact] } : c));
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  const saveCatalogModule = async (module: Partial<CatalogModule> & { name: string }): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      if (module.id) {
        const { error, data } = await supabase.from('catalog_modules').update(module).eq('id', module.id).select().single();
        if (error) throw error;
        setCatalogModules(prev => prev.map(m => m.id === module.id ? data || { ...m, ...module } : m));
      } else {
        const payload = { ...module, id: generateUUID(), sort_order: module.sort_order ?? 10, active: module.active ?? true };
        const { error, data } = await supabase.from('catalog_modules').insert(payload).select().single();
        if (error) throw error;
        setCatalogModules(prev => [...prev, data || payload]);
      }
      return true;
    } catch (err: any) {
      alert(`Error saving module: ${err.message}`);
      return false;
    }
  };

  const deleteCatalogModule = async (id: string): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.from('catalog_modules').delete().eq('id', id);
      if (error) throw error;
      setCatalogModules(prev => prev.filter(m => m.id !== id));
      setCatalogItems(prev => prev.filter(i => i.module_id !== id));
      return true;
    } catch (err: any) {
      alert(`Error deleting module: ${err.message}`);
      return false;
    }
  };

  const saveCatalogItem = async (item: Partial<CatalogItem> & { module_id: string; name: string; default_unit_price: number; unit_label: string; default_frequency: 'monthly' | 'quarterly' | 'annual' | 'one_time' }): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      if (item.id) {
        const { error, data } = await supabase.from('catalog_items').update(item).eq('id', item.id).select().single();
        if (error) throw error;
        setCatalogItems(prev => prev.map(i => i.id === item.id ? data || { ...i, ...item } : i));
      } else {
        const payload = { ...item, id: generateUUID(), active: item.active ?? true };
        const { error, data } = await supabase.from('catalog_items').insert(payload).select().single();
        if (error) throw error;
        setCatalogItems(prev => [...prev, data || payload]);
      }
      return true;
    } catch (err: any) {
      alert(`Error saving item: ${err.message}`);
      return false;
    }
  };

  const deleteCatalogItem = async (id: string): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.from('catalog_items').delete().eq('id', id);
      if (error) throw error;
      setCatalogItems(prev => prev.filter(i => i.id !== id));
      return true;
    } catch (err: any) {
      alert(`Error deleting item: ${err.message}`);
      return false;
    }
  };

  const updateErganiStatus = async (id: string, entity: 'leave' | 'remote', status: 'not_required' | 'pending' | 'submitted' | 'needs_amendment') => {
    const submittedAt = status === 'submitted' ? new Date().toISOString().split('T')[0] : undefined;
    const supabase = getSupabaseBrowserClient();

    if (entity === 'leave') {
      try {
        const { error } = await supabase.from('leave_requests').update({ ergani_status: status, ergani_submitted_at: submittedAt }).eq('id', id);
        if (error) {
          alert(`Database Error: ${error.message}`);
          return;
        }
        setLeaveRequests(prev => prev.map(r => r.id === id ? { ...r, ergani_status: status, ergani_submitted_at: submittedAt } : r));
      } catch (e: any) {
        console.error('Failed to update ergani status for leave request:', e);
      }
    } else {
      try {
        const { error } = await supabase.from('remote_days').update({ ergani_status: status, ergani_submitted_at: submittedAt }).eq('id', id);
        if (error) {
          alert(`Database Error: ${error.message}`);
          return;
        }
        setRemoteDays(prev => prev.map(r => r.id === id ? { ...r, ergani_status: status, ergani_submitted_at: submittedAt } : r));
      } catch (e: any) {
        console.error('Failed to update ergani status for remote day:', e);
      }
    }
  };

  const addTeam = async (name: string, leadProfileId?: string): Promise<boolean> => {
    const newId = generateUUID();
    const supabase = getSupabaseBrowserClient();
    try {
      const payload = { id: newId, name, lead_profile_id: leadProfileId || null };
      const { error, data } = await supabase.from('teams').insert(payload).select().single();
      if (error) {
        console.error("Error creating team:", error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      const created = (data as Team) || payload;
      setTeams(prev => [...prev, created]);
      return true;
    } catch (e: any) {
      console.error("Exception adding team:", e);
      alert(`Exception: ${e.message}`);
      return false;
    }
  };

  const updateTeam = async (id: string, name: string, leadProfileId?: string): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const payload = { name, lead_profile_id: leadProfileId || null };
      const { error } = await supabase.from('teams').update(payload).eq('id', id);
      if (error) {
        console.error("Error updating team:", error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      setTeams(prev => prev.map(t => t.id === id ? { ...t, name, lead_profile_id: leadProfileId } : t));
      return true;
    } catch (e: any) {
      console.error("Exception updating team:", e);
      alert(`Exception: ${e.message}`);
      return false;
    }
  };

  const deleteTeam = async (id: string): Promise<boolean> => {
    const members = profiles.filter(p => p.team_id === id || p.team?.id === id);
    if (members.length > 0) {
      alert(`DELETION BLOCKED: There are currently ${members.length} employee(s) assigned to this team (${members.map(m => `${m.first_name} ${m.last_name}`).join(', ')}). Please reassign them in the People Directory before deleting the team.`);
      return false;
    }
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.from('teams').delete().eq('id', id);
      if (error) {
        console.error("Error deleting team:", error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      setTeams(prev => prev.filter(t => t.id !== id));
      return true;
    } catch (e: any) {
      console.error("Exception deleting team:", e);
      alert(`Exception: ${e.message}`);
      return false;
    }
  };

  const addLeaveType = async (payload: Omit<LeaveType, 'id'>): Promise<boolean> => {
    const newId = generateUUID();
    const supabase = getSupabaseBrowserClient();
    try {
      const fullPayload = { id: newId, ...payload };
      const { error, data } = await supabase.from('leave_types').insert(fullPayload).select().single();
      if (error) {
        console.error("Error creating leave type:", error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      const created = (data as LeaveType) || fullPayload;
      setLeaveTypes(prev => [...prev, created].sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100)));
      return true;
    } catch (e: any) {
      console.error("Exception adding leave type:", e);
      alert(`Exception: ${e.message}`);
      return false;
    }
  };

  const updateLeaveType = async (id: string, payload: Partial<LeaveType>): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.from('leave_types').update(payload).eq('id', id);
      if (error) {
        console.error("Error updating leave type:", error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      setLeaveTypes(prev => prev.map(t => t.id === id ? { ...t, ...payload } : t).sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100)));
      return true;
    } catch (e: any) {
      console.error("Exception updating leave type:", e);
      alert(`Exception: ${e.message}`);
      return false;
    }
  };

  const deleteLeaveType = async (id: string): Promise<boolean> => {
    const used = leaveRequests.filter(r => r.leave_type_id === id || r.leave_type?.id === id);
    if (used.length > 0) {
      alert(`DELETION BLOCKED: There are currently ${used.length} logged leave request(s) utilizing this leave category. You cannot delete an actively referenced leave type.`);
      return false;
    }
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.from('leave_types').delete().eq('id', id);
      if (error) {
        console.error("Error deleting leave type:", error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      setLeaveTypes(prev => prev.filter(t => t.id !== id));
      return true;
    } catch (e: any) {
      console.error("Exception deleting leave type:", e);
      alert(`Exception: ${e.message}`);
      return false;
    }
  };

  // ---- Public holidays (Settings → Leaves → Public Holidays) ---------------------------------

  const sortHolidays = (a: PublicHoliday, b: PublicHoliday) =>
    a.date.localeCompare(b.date) || a.scope.localeCompare(b.scope);

  /**
   * Re-cost the personal leave rows a change to the holiday calendar invalidates.
   *
   * `leave_requests.working_days` is the STORED deduction — the balance is subtracted by it — so a
   * row filed while a holiday was missing keeps charging that day no matter what the calendar says
   * now (the leave pages only clamp the DISPLAY to `min(stored, recount)`, which is why 15 August
   * 2024 sat there deducting a day for everyone).
   *
   * The rule is deliberately narrow — touch a row only when its stored count equals the cost
   * counted against the calendar as it was BEFORE the change, and only when the cost actually moves:
   *
   *   before = scheduled days − (previous holidays + company closures)
   *   after  = scheduled days − (next holidays + company closures)
   *   update where stored = before and before ≠ after
   *
   * `stored = before` is the "this row was costed correctly at the time" test. Rows that disagree
   * with the old calendar are legacy (the pre-2026-09-15 broken counter wrote 1 day for a whole
   * range) or a deliberate admin adjustment, so they are left alone — the 0078 migration applies
   * this same rule to the historical rows.
   *
   * Returns how many rows were re-costed.
   */
  const syncLeaveCostsForHolidayChange = async (previousDates: string[], nextDates: string[]): Promise<number> => {
    const touched = [
      ...nextDates.filter(d => !previousDates.includes(d)),
      ...previousDates.filter(d => !nextDates.includes(d)),
    ];
    if (touched.length === 0) return 0;

    // Company closures are not bookable either — personal leave is costed net of them.
    const closures = new Set<string>();
    mandatoryLeaves.forEach(m => expandDateRange(m.start_date, m.end_date).forEach(d => closures.add(d)));
    const excluded = (holidays: string[]) => new Set<string>([...holidays, ...closures]);

    const targets = leaveRequests.filter(r =>
      r.origin !== 'mandatory'
      && !r.detached
      && !['rejected', 'cancelled', 'expired'].includes(r.status)
      && !r.half_day_start
      && !r.half_day_end
      // Only rows the changed date can reach.
      && touched.some(d => d >= r.start_date && d <= r.end_date)
    );
    if (targets.length === 0) return 0;

    const updates = targets.flatMap(r => {
      const schedule = resolveWorkSchedule(profiles.find(p => p.id === r.profile_id)?.work_schedule);
      const beforeDays = countWorkingDays(r.start_date, r.end_date, schedule, excluded(previousDates));
      if (Number(r.working_days || 0) !== beforeDays) return [];
      const afterDays = countWorkingDays(r.start_date, r.end_date, schedule, excluded(nextDates));
      return afterDays === beforeDays ? [] : [{ id: r.id, afterDays }];
    });
    if (updates.length === 0) return 0;

    const supabase = getSupabaseBrowserClient();
    for (const u of updates) {
      const { error } = await supabase.from('leave_requests').update({ working_days: u.afterDays }).eq('id', u.id);
      if (error) {
        console.error('Failed to re-cost leave after a holiday change:', error);
        continue;
      }
      setLeaveRequests(prev => prev.map(r => (r.id === u.id ? { ...r, working_days: u.afterDays } : r)));
    }
    return updates.length;
  };

  const addPublicHoliday = async (payload: Omit<PublicHoliday, 'id'>): Promise<{ ok: boolean; recosted: number }> => {
    const supabase = getSupabaseBrowserClient();
    const created: PublicHoliday = {
      id: generateUUID(),
      ...payload,
      year: Number(payload.date.slice(0, 4)),
    };
    try {
      const { error } = await supabase.from('public_holidays').insert(created);
      if (error) {
        console.error('Error creating public holiday:', error);
        alert(`Database Error: ${error.message}`);
        return { ok: false, recosted: 0 };
      }
      // Re-cost BEFORE publishing the new calendar, so the rows are judged against the old one.
      const recosted = await syncLeaveCostsForHolidayChange(holidayDates(publicHolidays), [...holidayDates(publicHolidays), created.date]);
      setPublicHolidays(prev => [...prev, created].sort(sortHolidays));
      return { ok: true, recosted };
    } catch (e: any) {
      console.error('Exception adding public holiday:', e);
      alert(`Exception: ${e.message}`);
      return { ok: false, recosted: 0 };
    }
  };

  const updatePublicHoliday = async (id: string, payload: Partial<PublicHoliday>): Promise<{ ok: boolean; recosted: number }> => {
    const supabase = getSupabaseBrowserClient();
    const target = publicHolidays.find(h => h.id === id);
    if (!target) return { ok: false, recosted: 0 };
    const nextDate = payload.date ?? target.date;
    const update = { ...payload, ...(payload.date ? { year: Number(nextDate.slice(0, 4)) } : {}) };
    try {
      const { error } = await supabase.from('public_holidays').update(update).eq('id', id);
      if (error) {
        console.error('Error updating public holiday:', error);
        alert(`Database Error: ${error.message}`);
        return { ok: false, recosted: 0 };
      }
      const prevDates = holidayDates(publicHolidays);
      const recosted = await syncLeaveCostsForHolidayChange(prevDates, prevDates.filter(d => d !== target.date).concat(nextDate));
      setPublicHolidays(prev =>
        prev.map(h => (h.id === id ? { ...h, ...update } : h)).sort(sortHolidays)
      );
      return { ok: true, recosted };
    } catch (e: any) {
      console.error('Exception updating public holiday:', e);
      alert(`Exception: ${e.message}`);
      return { ok: false, recosted: 0 };
    }
  };

  const deletePublicHoliday = async (id: string): Promise<{ ok: boolean; recosted: number }> => {
    const supabase = getSupabaseBrowserClient();
    const target = publicHolidays.find(h => h.id === id);
    if (!target) return { ok: false, recosted: 0 };
    try {
      const { error } = await supabase.from('public_holidays').delete().eq('id', id);
      if (error) {
        console.error('Error deleting public holiday:', error);
        alert(`Database Error: ${error.message}`);
        return { ok: false, recosted: 0 };
      }
      const prevDates = holidayDates(publicHolidays);
      const recosted = await syncLeaveCostsForHolidayChange(prevDates, prevDates.filter(d => d !== target.date));
      setPublicHolidays(prev => prev.filter(h => h.id !== id));
      return { ok: true, recosted };
    } catch (e: any) {
      console.error('Exception deleting public holiday:', e);
      alert(`Exception: ${e.message}`);
      return { ok: false, recosted: 0 };
    }
  };

  const saveRemotePattern = async (profileId: string, patternEntries: { weekday: string; mode: RemoteMode }[]): Promise<boolean> => {
    // Enforce Company Remote Quota
    const employeePolicy = remotePolicies.find(p => p.scope_type === 'employee' && p.scope_id === profileId);
    const companyPolicy = remotePolicies.find(p => p.scope_type === 'company');
    const effectivePolicy = employeePolicy || companyPolicy;
    if (effectivePolicy) {
      const quotaMaxDays = effectivePolicy.max_days ?? effectivePolicy.max_days_per_month ?? 8;
      const quotaPeriod = effectivePolicy.period_type || 'month';

      let maxAllowedWeekly = quotaMaxDays;
      if (quotaPeriod === 'month') maxAllowedWeekly = Math.floor(quotaMaxDays / 4);
      else if (quotaPeriod === 'quarter') maxAllowedWeekly = Math.floor(quotaMaxDays / 13);
      else if (quotaPeriod === 'year') maxAllowedWeekly = Math.floor(quotaMaxDays / 52);

      const weeklyRemoteCount = patternEntries.filter(pe => pe.mode === 'remote_gr' || pe.mode === 'remote_abroad').length;
      if (weeklyRemoteCount > maxAllowedWeekly) {
        alert(`POLICY VIOLATION: You attempted to configure ${weeklyRemoteCount} remote days per week, but the company policy allows a maximum of ${maxAllowedWeekly} remote day(s) per week (configured as ${quotaMaxDays} days per ${quotaPeriod}). Saving is blocked.`);
        return false;
      }
    }

    const validFrom = new Date().toISOString().split('T')[0];
    const supabase = getSupabaseBrowserClient();
    try {
      const payload = patternEntries.map(pe => ({
        profile_id: profileId,
        weekday: pe.weekday,
        mode: pe.mode,
        valid_from: validFrom
      }));
      // Replace semantics: drop pattern weekdays that were removed in the editor,
      // otherwise stale rows keep the old weekday remote in the Outlook work plan
      const existingWeekdays = remotePatterns.filter(rp => rp.profile_id === profileId).map(rp => rp.weekday);
      const removedWeekdays = existingWeekdays.filter(w => !patternEntries.some(pe => pe.weekday === w));
      if (removedWeekdays.length > 0) {
        await supabase.from('remote_patterns').delete().eq('profile_id', profileId).in('weekday', removedWeekdays);
      }
      const { error, data } = await supabase.from('remote_patterns').upsert(payload, { onConflict: 'profile_id,weekday' }).select();
      if (error) {
        console.error("Failed to persist remote pattern in Supabase:", error);
        alert(`Database Error: ${error.message}`);
        return false;
      } else if (data && data.length > 0) {
        setRemotePatterns(prev => {
          const filtered = prev.filter(p => p.profile_id !== profileId || !patternEntries.some(pe => pe.weekday === p.weekday));
          return [...filtered, ...(data as RemotePattern[])];
        });
        // Pattern change alters future remote events — resync immediately
        syncSlackStatus(profileId, athensTodayStr());
        return true;
      }
    } catch (e: any) {
      console.error("Exception saving remote patterns:", e);
      alert(`Database exception: ${e.message}`);
      return false;
    }
    return true;
  };

  const addRemoteDay = async (day: Omit<RemoteDay, 'id'> & { id?: string }) => {
    const newDay: RemoteDay = {
      ...day,
      id: day.id || generateUUID()
    };
    const supabase = getSupabaseBrowserClient();
    try {
      const { error, data } = await supabase.from('remote_days').upsert({
        id: newDay.id,
        profile_id: newDay.profile_id,
        date: newDay.date,
        mode: newDay.mode,
        location: newDay.location || null,
        note: newDay.note || null,
        ergani_status: newDay.ergani_status
      }, { onConflict: 'profile_id,date' }).select();
      if (error) {
        console.error("Failed to persist remote day override:", error);
        alert(`Database Error: ${error.message}`);
        return;
      }
      setRemoteDays(prev => {
        const filtered = prev.filter(d => !(d.profile_id === newDay.profile_id && d.date === newDay.date));
        return [newDay, ...filtered];
      });
      // Day-scoped mirror: only a change to today flips Slack now. A remote day for another day
      // waits for the morning job on that day (enqueueStatusSync enforces this too).
      if (newDay.date === athensTodayStr()) {
        syncSlackStatus(newDay.profile_id, newDay.date);
      }
    } catch (e: any) {
      console.error("Exception saving remote day:", e);
    }
  };

  const addTimesheet = async (entry: Omit<ContractTimesheet, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<boolean> => {
    const newEntry: ContractTimesheet = { ...entry, id: entry.id || generateUUID(), hours: Number(entry.hours) || 0 };
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.from('contract_timesheets').upsert({
        id: newEntry.id,
        profile_id: newEntry.profile_id,
        contract_id: newEntry.contract_id,
        contract_line_id: newEntry.contract_line_id || null,
        work_date: newEntry.work_date,
        hours: newEntry.hours,
        note: newEntry.note || null
      }, { onConflict: 'profile_id,contract_id,work_date' }).select();
      if (error) {
        console.error("Failed to persist timesheet entry:", error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      setTimesheets(prev => {
        const filtered = prev.filter(t => !(t.profile_id === newEntry.profile_id && t.contract_id === newEntry.contract_id && t.work_date === newEntry.work_date));
        return [newEntry, ...filtered];
      });
      return true;
    } catch (e: any) {
      console.error("Exception saving timesheet entry:", e);
      return false;
    }
  };

  const updateTimesheet = async (id: string, updates: Partial<Pick<ContractTimesheet, 'hours' | 'note' | 'work_date' | 'contract_id' | 'contract_line_id'>>): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    const payload: any = { ...updates, updated_at: new Date().toISOString() };
    if (updates.hours !== undefined) payload.hours = Number(updates.hours);
    try {
      const { error } = await supabase.from('contract_timesheets').update(payload).eq('id', id);
      if (error) {
        console.error("Failed to update timesheet entry:", error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      setTimesheets(prev => prev.map(t => t.id === id ? { ...t, ...payload } : t));
      return true;
    } catch (e: any) {
      console.error("Exception updating timesheet entry:", e);
      return false;
    }
  };

  const deleteTimesheet = async (id: string): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.from('contract_timesheets').delete().eq('id', id);
      if (error) {
        console.error("Failed to delete timesheet entry:", error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      setTimesheets(prev => prev.filter(t => t.id !== id));
      return true;
    } catch (e: any) {
      console.error("Exception deleting timesheet entry:", e);
      return false;
    }
  };

  // ---- Timesheet v2 (roles, seniorities, rate cards, projects, entries) ----
  const upsertRow = async (table: string, row: Record<string, any>, conflict?: string): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await (conflict
        ? supabase.from(table as any).upsert(row, { onConflict: conflict })
        : supabase.from(table as any).upsert(row));
      if (error) { console.error(`Failed to persist ${table}:`, error); alert(`Database Error: ${error.message}`); return false; }
      return true;
    } catch (e: any) { console.error(`Exception saving ${table}:`, e); return false; }
  };
  const deleteRow = async (table: string, id: string): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.from(table as any).delete().eq('id', id);
      if (error) { console.error(`Failed to delete ${table}:`, error); alert(`Database Error: ${error.message}`); return false; }
      return true;
    } catch (e: any) { console.error(`Exception deleting ${table}:`, e); return false; }
  };

  const saveJobRole = async (r: Partial<JobRole> & { name: string }): Promise<boolean> => {
    const row = { id: r.id || generateUUID(), name: r.name, active: r.active ?? true, sort_order: r.sort_order ?? 0 };
    const ok = await upsertRow('job_roles', row);
    if (ok) setJobRoles(prev => prev.some(x => x.id === row.id) ? prev.map(x => x.id === row.id ? { ...x, ...row } : x) : [...prev, row as JobRole]);
    return ok;
  };
  const deleteJobRole = async (id: string): Promise<boolean> => {
    const ok = await deleteRow('job_roles', id);
    if (ok) setJobRoles(prev => prev.filter(x => x.id !== id));
    return ok;
  };

  const saveSeniorityLevel = async (s: Partial<SeniorityLevel> & { name: string }): Promise<boolean> => {
    const row = { id: s.id || generateUUID(), name: s.name, rank: s.rank ?? 0, active: s.active ?? true };
    const ok = await upsertRow('seniority_levels', row);
    if (ok) setSeniorityLevels(prev => prev.some(x => x.id === row.id) ? prev.map(x => x.id === row.id ? { ...x, ...row } : x) : [...prev, row as SeniorityLevel]);
    return ok;
  };
  const deleteSeniorityLevel = async (id: string): Promise<boolean> => {
    const ok = await deleteRow('seniority_levels', id);
    if (ok) setSeniorityLevels(prev => prev.filter(x => x.id !== id));
    return ok;
  };

  // Assign an employee a (role, seniority) from an effective date. Effective-dated:
  // closes any open history row the day before, then inserts the new one (never edits).
  // Returns false (and surfaces the real error) on ANY failure — never a silent success.
  const setProfileRole = async (profileId: string, jobRoleId: string | null, seniorityId: string | null, validFrom: string): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const closeDate = (() => { const d = new Date(validFrom + 'T00:00:00'); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
      const openRows = profileRoleHistory.filter(h => h.profile_id === profileId && !h.valid_to);
      for (const h of openRows) {
        const { error } = await supabase.from('profile_role_history').update({ valid_to: closeDate }).eq('id', h.id);
        if (error) {
          console.error('setProfileRole close error:', error);
          alert(`Database Error: ${error.message}`);
          return false;
        }
      }
      if (jobRoleId && seniorityId) {
        const { error: insErr } = await supabase.from('profile_role_history').insert({
          id: generateUUID(), profile_id: profileId, job_role_id: jobRoleId, seniority_id: seniorityId, valid_from: validFrom, valid_to: null
        });
        if (insErr) {
          console.error('setProfileRole insert error:', insErr);
          alert(`Database Error: ${insErr.message}`);
          return false;
        }
      }
      const { data, error: selErr } = await supabase.from('profile_role_history').select('*').eq('profile_id', profileId);
      if (selErr) {
        console.error('setProfileRole select error:', selErr);
        alert(`Database Error: ${selErr.message}`);
        return false;
      }
      setProfileRoleHistory(prev => [...prev.filter(h => h.profile_id !== profileId), ...((data || []) as ProfileRoleHistory[])]);
      return true;
    } catch (e: any) { console.error('setProfileRole error:', e); alert(`Database Error: ${e.message}`); return false; }
  };

  // Directly edit one history row (role/seniority/dates) — used by the history table.
  const updateProfileRoleHistory = async (id: string, patch: Partial<ProfileRoleHistory>): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.from('profile_role_history').update(patch).eq('id', id);
      if (error) {
        console.error('updateProfileRoleHistory error:', error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      setProfileRoleHistory(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
      return true;
    } catch (e: any) {
      console.error('updateProfileRoleHistory error:', e);
      alert(`Database Error: ${e.message}`);
      return false;
    }
  };

  const deleteProfileRoleHistory = async (id: string): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.from('profile_role_history').delete().eq('id', id);
      if (error) {
        console.error('deleteProfileRoleHistory error:', error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      setProfileRoleHistory(prev => prev.filter(r => r.id !== id));
      return true;
    } catch (e: any) {
      console.error('deleteProfileRoleHistory error:', e);
      alert(`Database Error: ${e.message}`);
      return false;
    }
  };

  const saveRateCard = async (c: Partial<RateCard> & { name: string }): Promise<boolean> => {
    const row = { id: c.id || generateUUID(), name: c.name, currency: c.currency || 'EUR', valid_from: c.valid_from || null, valid_to: c.valid_to || null, is_default: c.is_default ?? false, notes: c.notes || null };
    const ok = await upsertRow('rate_cards', row);
    if (ok) setRateCards(prev => prev.some(x => x.id === row.id) ? prev.map(x => x.id === row.id ? { ...x, ...row } : x) : [...prev, row as RateCard]);
    return ok;
  };
  const deleteRateCard = async (id: string): Promise<boolean> => {
    const ok = await deleteRow('rate_cards', id);
    if (ok) { setRateCards(prev => prev.filter(x => x.id !== id)); setRateCardEntries(prev => prev.filter(e => e.rate_card_id !== id)); }
    return ok;
  };

  // Create (lazily) the rate card owned by a contract, seeded from the global default card.
  const ensureContractRateCard = async (contractId: string): Promise<string | null> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const existing = rateCards.find(c => c.contract_id === contractId);
      if (existing) return existing.id;
      const defaultCard = rateCards.find(c => !c.contract_id && c.is_default) || rateCards.find(c => !c.contract_id);
      const cardId = generateUUID();
      await supabase.from('rate_cards').insert({ id: cardId, name: 'Contract rates', currency: 'EUR', contract_id: contractId, is_default: false });
      if (defaultCard) {
        const defaults = rateCardEntries.filter(e => e.rate_card_id === defaultCard.id);
        if (defaults.length > 0) {
          await supabase.from('rate_card_entries').insert(defaults.map(e => ({
            id: generateUUID(), rate_card_id: cardId, job_role_id: e.job_role_id, seniority_id: e.seniority_id, hourly_rate: e.hourly_rate, daily_rate: e.daily_rate
          })));
        }
      }
      const { data: cards } = await supabase.from('rate_cards').select('*');
      const { data: entries } = await supabase.from('rate_card_entries').select('*');
      if (cards) setRateCards(cards as RateCard[]);
      if (entries) setRateCardEntries(entries as RateCardEntry[]);
      return cardId;
    } catch (e: any) { console.error('ensureContractRateCard error:', e); return null; }
  };
  const saveRateCardEntry = async (e: Omit<RateCardEntry, 'id'> & { id?: string }): Promise<boolean> => {
    const row = { id: e.id || generateUUID(), rate_card_id: e.rate_card_id, job_role_id: e.job_role_id, seniority_id: e.seniority_id, hourly_rate: e.hourly_rate ?? null, daily_rate: e.daily_rate ?? null };
    const ok = await upsertRow('rate_card_entries', row, 'rate_card_id,job_role_id,seniority_id');
    if (ok) setRateCardEntries(prev => prev.some(x => x.id === row.id) ? prev.map(x => x.id === row.id ? { ...x, ...row } : x) : [...prev, row as RateCardEntry]);
    return ok;
  };
  const deleteRateCardEntry = async (id: string): Promise<boolean> => {
    const ok = await deleteRow('rate_card_entries', id);
    if (ok) setRateCardEntries(prev => prev.filter(x => x.id !== id));
    return ok;
  };

  const saveProject = async (p: Omit<Project, 'id'> & { id?: string }): Promise<boolean> => {
    // Every delivery field must be listed here: this builds the row explicitly, so a field missing
    // from this map is silently dropped on save (it happened with the line windows).
    const row = {
      id: p.id || generateUUID(),
      contract_id: p.contract_id || null,
      name: p.name,
      code: p.code || null,
      status: p.status || 'planned',
      owner_profile_id: p.owner_profile_id || null,
      default_billable: p.default_billable !== false,
      budget_hours: p.budget_hours ?? null,
      budget_days: p.budget_days ?? null,
      budget_value: p.budget_value ?? null,
      starts_on: p.starts_on || null,
      ends_on: p.ends_on || null,
      actual_start_on: p.actual_start_on || null,
      actual_end_on: p.actual_end_on || null
    };
    const ok = await upsertRow('projects', row);
    if (ok) setProjects(prev => prev.some(x => x.id === row.id) ? prev.map(x => x.id === row.id ? { ...x, ...row } : x) : [...prev, row as Project]);
    return ok;
  };
  const deleteProject = async (id: string): Promise<boolean> => {
    const ok = await deleteRow('projects', id);
    if (ok) { setProjects(prev => prev.filter(x => x.id !== id)); setWorkItems(prev => prev.filter(w => w.project_id !== id)); setProjectAssignments(prev => prev.filter(a => a.project_id !== id)); setProjectRoleForecasts(prev => prev.filter(f => f.project_id !== id)); }
    return ok;
  };

  const saveWorkItem = async (w: Omit<WorkItem, 'id'> & { id?: string }): Promise<boolean> => {
    const row = { id: w.id || generateUUID(), project_id: w.project_id, name: w.name, kind: w.kind || 'feature', linear_issue_id: w.linear_issue_id || null, status: w.status || 'open', budget_hours: w.budget_hours ?? null };
    const ok = await upsertRow('work_items', row);
    if (ok) setWorkItems(prev => prev.some(x => x.id === row.id) ? prev.map(x => x.id === row.id ? { ...x, ...row } : x) : [...prev, row as WorkItem]);
    return ok;
  };
  const deleteWorkItem = async (id: string): Promise<boolean> => {
    const ok = await deleteRow('work_items', id);
    if (ok) setWorkItems(prev => prev.filter(x => x.id !== id));
    return ok;
  };

  const saveProjectAssignment = async (a: Omit<ProjectAssignment, 'id'> & { id?: string }): Promise<boolean> => {
    const row = { id: a.id || generateUUID(), project_id: a.project_id, profile_id: a.profile_id, job_role_id: a.job_role_id, seniority_id: a.seniority_id, rate_override: a.rate_override ?? null, valid_from: a.valid_from || null, valid_to: a.valid_to || null };
    const ok = await upsertRow('project_assignments', row, 'project_id,profile_id');
    if (ok) setProjectAssignments(prev => prev.some(x => x.id === row.id) ? prev.map(x => x.id === row.id ? { ...x, ...row } : x) : [...prev, row as ProjectAssignment]);
    return ok;
  };
  const deleteProjectAssignment = async (id: string): Promise<boolean> => {
    const ok = await deleteRow('project_assignments', id);
    if (ok) setProjectAssignments(prev => prev.filter(x => x.id !== id));
    return ok;
  };

  const saveProjectRoleForecast = async (e: Omit<ProjectRoleForecast, 'id'> & { id?: string }): Promise<boolean> => {
    const row = { id: e.id || generateUUID(), project_id: e.project_id, job_role_id: e.job_role_id, seniority_id: e.seniority_id, forecast_hours: Number(e.forecast_hours) || 0 };
    const ok = await upsertRow('project_role_forecasts', row, 'project_id,job_role_id,seniority_id');
    if (ok) setProjectRoleForecasts(prev => prev.some(x => x.id === row.id) ? prev.map(x => x.id === row.id ? { ...x, ...row } : x) : [...prev, row as ProjectRoleForecast]);
    return ok;
  };
  const deleteProjectRoleForecast = async (id: string): Promise<boolean> => {
    const ok = await deleteRow('project_role_forecasts', id);
    if (ok) setProjectRoleForecasts(prev => prev.filter(x => x.id !== id));
    return ok;
  };

  const saveTimeEntry = async (e: Omit<TimeEntry, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<boolean> => {
    const row: any = {
      id: e.id || generateUUID(),
      profile_id: e.profile_id,
      work_date: e.work_date,
      minutes: Math.round(Number(e.minutes) || 0),
      project_id: e.project_id,
      work_item_id: e.work_item_id || null,
      note: e.note || null,
      billable: e.billable !== false,
      status: e.status || 'draft',
      currency: e.currency || 'EUR',
      anomaly_flags: e.anomaly_flags || []
    };
    const ok = await upsertRow('time_entries', row, 'profile_id,work_date,project_id,work_item_id');
    if (ok) setTimeEntries(prev => {
      const filtered = prev.filter(t => !(t.profile_id === row.profile_id && t.work_date === row.work_date && t.project_id === row.project_id && (t.work_item_id || null) === row.work_item_id));
      return [row as TimeEntry, ...filtered];
    });
    return ok;
  };
  const deleteTimeEntry = async (id: string): Promise<boolean> => {
    const ok = await deleteRow('time_entries', id);
    if (ok) setTimeEntries(prev => prev.filter(t => t.id !== id));
    return ok;
  };

  const submitWeek = async (profileId: string, from: string, to: string): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.from('time_entries' as any)
        .update({ status: 'submitted', submitted_at: new Date().toISOString() })
        .eq('profile_id', profileId)
        .gte('work_date', from).lte('work_date', to)
        .in('status', ['draft', 'rejected']);
      if (error) { alert(`Database Error: ${error.message}`); return false; }
      setTimeEntries(prev => prev.map(t =>
        (t.profile_id === profileId && t.work_date >= from && t.work_date <= to && (t.status === 'draft' || t.status === 'rejected'))
          ? { ...t, status: 'submitted' as const, submitted_at: new Date().toISOString() } : t));
      return true;
    } catch (e: any) { console.error('submitWeek error:', e); return false; }
  };

  const decideTimeEntries = async (ids: string[], status: 'approved' | 'rejected'): Promise<boolean> => {
    if (ids.length === 0) return true;
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.from('time_entries' as any)
        .update({ status, decided_by: currentUser.id, decided_at: new Date().toISOString() })
        .in('id', ids).eq('status', 'submitted');
      if (error) { alert(`Database Error: ${error.message}`); return false; }
      setTimeEntries(prev => prev.map(t => ids.includes(t.id) ? { ...t, status, decided_by: currentUser.id, decided_at: new Date().toISOString() } : t));
      return true;
    } catch (e: any) { console.error('decideTimeEntries error:', e); return false; }
  };

  const updateRemotePolicy = async (id: string, updated: Partial<RemotePolicy>) => {
    try {
      const supabase = getSupabaseBrowserClient();
      const payload: any = { ...updated };
      if (updated.max_days !== undefined && !updated.max_days_per_month) {
        payload.max_days_per_month = updated.max_days;
      }
      const { error } = await supabase.from('remote_policies').update(payload).eq('id', id);
      if (error) {
        alert(`Database Error: ${error.message}`);
        return;
      }
      setRemotePolicies(prev => prev.map(p => p.id === id ? { ...p, ...updated } : p));
    } catch (e: any) {
      console.error("Exception updating remote policy:", e);
      alert("Unexpected error occurred while saving policy.");
    }
  };

  // Set (or clear) an employee-specific remote quota. null => delete the row, falling
  // back to the company default.
  const setEmployeeRemoteQuota = async (profileId: string, quota: { max_days: number; period_type: RemotePolicy['period_type']; counts_leave: boolean } | null): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const existing = remotePolicies.find(p => p.scope_type === 'employee' && p.scope_id === profileId);
      if (quota === null) {
        if (existing) await supabase.from('remote_policies').delete().eq('id', existing.id);
      } else if (existing) {
        await supabase.from('remote_policies').update({ max_days: quota.max_days, period_type: quota.period_type, counts_leave: quota.counts_leave }).eq('id', existing.id);
      } else {
        await supabase.from('remote_policies').insert({
          id: generateUUID(), scope_type: 'employee', scope_id: profileId,
          max_days: quota.max_days, period_type: quota.period_type, counts_leave: quota.counts_leave
        });
      }
      const { data } = await supabase.from('remote_policies').select('*');
      setRemotePolicies((data || []).map((p: any) => ({ ...p, max_days: p.max_days ?? p.max_days_per_month ?? 8, period_type: p.period_type || 'month' })) as RemotePolicy[]);
      return true;
    } catch (e: any) {
      console.error('setEmployeeRemoteQuota error:', e);
      alert(`Database Error: ${e.message}`);
      return false;
    }
  };

  const bulkAddRemoteDays = async (profileId: string, declarations: { date: string; mode: RemoteMode | 'office'; location?: string; note?: string }[]): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const toDeleteDates = declarations.filter(d => d.mode === 'office').map(d => d.date);
      const toUpsert = declarations.filter(d => d.mode !== 'office').map(d => ({
        id: remoteDays.find(r => r.profile_id === profileId && r.date === d.date)?.id || generateUUID(),
        profile_id: profileId,
        date: d.date,
        mode: d.mode as RemoteMode,
        location: d.location || null,
        note: d.note || null,
        ergani_status: 'pending' as const
      }));

      if (toDeleteDates.length > 0) {
        await supabase.from('remote_days').delete().eq('profile_id', profileId).in('date', toDeleteDates);
      }
      if (toUpsert.length > 0) {
        await supabase.from('remote_days').upsert(toUpsert, { onConflict: 'profile_id,date' });
      }

      setRemoteDays(prev => {
        const affectedDates = new Set(declarations.map(d => d.date));
        const filtered = prev.filter(r => !(r.profile_id === profileId && affectedDates.has(r.date)));
        return [...(toUpsert as RemoteDay[]), ...filtered];
      });
      // Any change (add, remove-to-office, edit) — sync now; Outlook horizon + today's Slack status
      syncSlackStatus(profileId, athensTodayStr());
      return true;
    } catch (e: any) {
      console.error("Bulk add remote days error:", e);
      return false;
    }
  };

  const requestRemoteAmendment = async (payload: { date: string; requested_mode: RemoteMode | 'office'; reason: string; location?: string }): Promise<boolean> => {
    const current = remoteDays.find(r => r.profile_id === currentUser.id && r.date === payload.date);
    const req: RemoteAmendmentRequest = {
      id: generateUUID(),
      profile_id: currentUser.id,
      date: payload.date,
      requested_mode: payload.requested_mode,
      current_mode: current ? (current.mode as any) : 'office',
      location: payload.location,
      reason: payload.reason,
      status: 'pending',
      created_at: new Date().toISOString()
    };
    setRemoteAmendmentRequests(prev => [req, ...prev]);
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.from('remote_amendments').insert([req]);
    } catch (e) {
      console.log("Locally logged amendment request");
    }
    return true;
  };

  const decideRemoteAmendment = async (id: string, status: 'approved' | 'rejected'): Promise<boolean> => {
    const req = remoteAmendmentRequests.find(r => r.id === id);
    if (!req) return false;

    setRemoteAmendmentRequests(prev => prev.map(r => r.id === id ? { ...r, status, decided_at: new Date().toISOString(), decided_by: currentUser.id } : r));

    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.from('remote_amendments').update({ status, decided_at: new Date().toISOString(), decided_by: currentUser.id }).eq('id', id);
    } catch (e) {
      console.log("Locally updated amendment request");
    }

    if (status === 'approved') {
      await bulkAddRemoteDays(req.profile_id, [{
        date: req.date,
        mode: req.requested_mode,
        location: req.location,
        note: `Approved Past Amendment: ${req.reason}`
      }]);
    }
    return true;
  };

  const requestRemoteQuotaOverride = async (payload: { date: string; requested_mode: RemoteMode | 'office'; location?: string; reason?: string; period_used?: number; period_max?: number }): Promise<boolean> => {
    const req: RemoteQuotaRequest = {
      id: generateUUID(),
      profile_id: currentUser.id,
      date: payload.date,
      requested_mode: payload.requested_mode,
      location: payload.location,
      reason: payload.reason,
      period_used: payload.period_used,
      period_max: payload.period_max,
      status: 'pending',
      created_at: new Date().toISOString()
    };
    setRemoteQuotaRequests(prev => [req, ...prev]);
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.from('remote_quota_requests').insert([req]);
    } catch (e) {
      console.log("Locally logged remote quota request");
    }
    return true;
  };

  const decideRemoteQuotaRequest = async (id: string, status: 'approved' | 'rejected'): Promise<boolean> => {
    const req = remoteQuotaRequests.find(r => r.id === id);
    if (!req) return false;

    setRemoteQuotaRequests(prev => prev.map(r => r.id === id ? { ...r, status, decided_at: new Date().toISOString(), decided_by: currentUser.id } : r));

    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.from('remote_quota_requests').update({ status, decided_at: new Date().toISOString(), decided_by: currentUser.id }).eq('id', id);
    } catch (e) {
      console.log("Locally updated remote quota request");
    }

    if (status === 'approved') {
      await bulkAddRemoteDays(req.profile_id, [{
        date: req.date,
        mode: req.requested_mode,
        location: req.location,
        note: `Approved quota exception: ${req.reason || 'Quota exceeded'}`
      }]);
    }
    return true;
  };

  /** Employee withdraws their own still-pending remote-quota exception request. */
  const cancelRemoteQuotaRequest = async (id: string): Promise<boolean> => {
    const previous = remoteQuotaRequests;
    setRemoteQuotaRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'cancelled', decided_at: new Date().toISOString() } : r));
    try {
      // 0063 makes every write to remote_quota_requests admin-only and the live status CHECK
      // rejects 'cancelled', so the withdrawal runs through the service-role route instead.
      const res = await fetch('/api/remote/quota-withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => ({} as { error?: string; mode?: string }));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      // Pre-migration the route had to delete the row; drop it from view so the list matches.
      if (data?.mode === 'deleted') {
        setRemoteQuotaRequests(prev => prev.filter(r => r.id !== id));
      }
      return true;
    } catch (e) {
      console.error('Failed to cancel remote quota request:', e);
      setRemoteQuotaRequests(previous);
      return false;
    }
  };

  // ---- Coverage rules: at most N members of a group away on the same day ----

  /** Admin: upsert a coverage group and, for custom groups, replace its member list. */
  const saveCoverageGroup = async (payload: CoverageGroupInput): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const id = payload.id || generateUUID();
      const row = {
        id,
        name: payload.name.trim(),
        scope_type: payload.scope_type,
        team_id: payload.scope_type === 'team' ? payload.team_id : null,
        max_remote_per_day: payload.max_remote_per_day,
        max_leave_per_day: payload.max_leave_per_day,
        active: payload.active ?? true
      };
      const { error } = await supabase.from('coverage_groups').upsert(row);
      if (error) {
        console.error('Failed to save coverage group:', error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      if (payload.scope_type === 'custom' && payload.memberIds) {
        await supabase.from('coverage_group_members').delete().eq('group_id', id);
        if (payload.memberIds.length > 0) {
          const { error: memberError } = await supabase.from('coverage_group_members')
            .insert(payload.memberIds.map(profile_id => ({ group_id: id, profile_id })));
          if (memberError) {
            console.error('Failed to save coverage group members:', memberError);
            alert(`Database Error: ${memberError.message}`);
            return false;
          }
        }
      }
      // Small tables: reload so membership and caps stay truthful for every caller.
      const [{ data: groups }, { data: members }] = await Promise.all([
        supabase.from('coverage_groups').select('*').order('created_at', { ascending: true }),
        supabase.from('coverage_group_members').select('*'),
      ]);
      setCoverageGroups((groups || []) as CoverageGroup[]);
      setCoverageGroupMembers((members || []) as CoverageGroupMember[]);
      return true;
    } catch (e: any) {
      console.error('saveCoverageGroup error:', e);
      alert(`Database Error: ${e.message}`);
      return false;
    }
  };

  const deleteCoverageGroup = async (id: string): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.from('coverage_groups').delete().eq('id', id);
      if (error) {
        console.error('Failed to delete coverage group:', error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      setCoverageGroups(prev => prev.filter(g => g.id !== id));
      setCoverageGroupMembers(prev => prev.filter(m => m.group_id !== id));
      return true;
    } catch (e: any) {
      console.error('deleteCoverageGroup error:', e);
      return false;
    }
  };

  const getCoverageLoad = async (groupId: string, from: string, to: string): Promise<CoverageLoadRow[]> => {
    if (!groupId || !from || !to) return [];
    const { data, error } = await getSupabaseBrowserClient()
      .rpc('coverage_load', { p_group_id: groupId, p_from: from, p_to: to });
    if (error) {
      console.error('coverage_load failed:', error);
      return [];
    }
    return toCoverageLoadRows(data);
  };

  const getCoverageLoadForProfile = async (profileId: string, kind: CoverageKind, from: string, to: string) => {
    const profile = profiles.find(p => p.id === profileId);
    const groups = coverageGroupsForProfile(profileId, profile?.team_id, coverageGroups, coverageGroupMembers, kind);
    if (groups.length === 0) return [];
    const loads = await Promise.all(groups.map(async group => ({ group, rows: await getCoverageLoad(group.id, from, to) })));
    return loads.filter(l => l.rows.length > 0);
  };

  const requestLeaveException = async (payload: LeaveExceptionInput): Promise<boolean> => {
    const row: LeaveExceptionRequest = {
      id: generateUUID(),
      profile_id: payload.profile_id,
      leave_type_id: payload.leave_type_id,
      start_date: payload.start_date,
      end_date: payload.end_date,
      working_days: payload.working_days,
      note: payload.note || null,
      reason: payload.reason || null,
      group_id: payload.group_id || null,
      status: 'pending',
      created_at: new Date().toISOString()
    };
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.from('leave_exception_requests').insert(row);
      if (error) {
        console.error('Failed to file leave coverage exception:', error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      setLeaveExceptionRequests(prev => [row, ...prev]);
      return true;
    } catch (e: any) {
      console.error('requestLeaveException error:', e);
      return false;
    }
  };

  const decideLeaveException = async (id: string, approve: boolean): Promise<boolean> => {
    const target = leaveExceptionRequests.find(r => r.id === id);
    if (!target) return false;
    const supabase = getSupabaseBrowserClient();
    const status: LeaveExceptionRequest['status'] = approve ? 'approved' : 'rejected';
    const decided_at = new Date().toISOString();
    try {
      const { error } = await supabase.from('leave_exception_requests')
        .update({ status, decided_at, decided_by: currentUser.id }).eq('id', id);
      if (error) {
        console.error('Failed to decide leave coverage exception:', error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      setLeaveExceptionRequests(prev => prev.map(r => r.id === id ? { ...r, status, decided_at, decided_by: currentUser.id } : r));
      if (approve) {
        // Admins are the exception path: file the leave they just authorised.
        addLeaveRequest({
          profile_id: target.profile_id,
          leave_type_id: target.leave_type_id,
          start_date: target.start_date,
          end_date: target.end_date,
          half_day_start: false,
          half_day_end: false,
          working_days: Number(target.working_days) || 0,
          status: 'approved',
          origin: 'admin_entry',
          note: `Coverage exception approved${target.note ? ` — ${target.note}` : ''}`,
          ergani_status: 'pending'
        });
      }
      return true;
    } catch (e: any) {
      console.error('decideLeaveException error:', e);
      return false;
    }
  };

  // ---- Screen visibility: admins hide whole screens from non-admins ----

  /**
   * Admin: hide or show one screen for every non-admin.
   * The row is upserted rather than deleted so `updated_by` keeps a record of the change.
   */
  const setScreenHidden = async (screenKey: string, hidden: boolean): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.from('screen_visibility').upsert({
        screen_key: screenKey,
        hidden,
        updated_at: new Date().toISOString(),
        updated_by: realProfileId
      }, { onConflict: 'screen_key' });
      if (error) {
        console.error('Failed to update screen visibility:', error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      setHiddenScreens(prev => hidden
        ? (prev.includes(screenKey) ? prev : [...prev, screenKey])
        : prev.filter(k => k !== screenKey));
      return true;
    } catch (e: any) {
      console.error('setScreenHidden error:', e);
      alert(`Database Error: ${e.message}`);
      return false;
    }
  };

  const addInvoice = async (inv: Omit<Invoice, 'id' | 'created_at' | 'counterparty' | 'contract' | 'documents' | 'payments' | 'allocations'>): Promise<Invoice | null> => {    const id = generateUUID();
    const newInv: Invoice = {
      ...inv,
      id,
      created_at: new Date().toISOString(),
      counterparty: counterparties.find(c => c.id === inv.counterparty_id),
      contract: contracts.find(c => c.id === inv.contract_id),
      documents: [],
      payments: [],
      allocations: []
    };
    setInvoices(prev => [newInv, ...prev]);
    try {
      const supabase = getSupabaseBrowserClient();
      const row = {
        id,
        direction: inv.direction,
        counterparty_id: inv.counterparty_id,
        contract_id: inv.contract_id || null,
        type: inv.type,
        credits_invoice_id: inv.credits_invoice_id || null,
        invoice_number: inv.invoice_number,
        mark: inv.mark || null,
        internal_ref: inv.internal_ref || null,
        category: inv.category || null,
        issue_date: inv.issue_date,
        due_date: inv.due_date,
        period_from: inv.period_from || null,
        period_to: inv.period_to || null,
        reference_period: inv.reference_period || null,
        currency: inv.currency,
        fx_rate: inv.fx_rate,
        net: inv.net,
        vat_amount: inv.vat_amount,
        vat_rate: inv.vat_rate,
        gross: inv.gross,
        gross_eur: inv.gross_eur,
        status: inv.status,
        missing_document: inv.missing_document,
        notes: inv.notes || null
      };
      const { error } = await supabase.from('invoices').insert([row]);
      if (error) {
        console.error("Supabase insert invoice error:", error.message);
        alert(`Database Error saving invoice: ${error.message}`);
        setInvoices(prev => prev.filter(inv => inv.id !== id));
        return null;
      }
      
      if (inv.links && inv.links.length > 0) {
        const toInsert = inv.links.map(l => ({
          invoice_id: id,
          title: l.title || null,
          url: l.url,
          created_by: currentUser?.id || null
        }));
        await supabase.from('invoice_links').insert(toInsert);
      }
    } catch (e: any) {
      console.error(e);
      alert(`Error saving invoice: ${e.message || e}`);
      setInvoices(prev => prev.filter(inv => inv.id !== id));
      return null;
    }
    return newInv;
  };

  const updateInvoice = async (id: string, updates: Partial<Invoice>): Promise<boolean> => {
    const previousInvoices = invoices;
    setInvoices(prev => prev.map(inv => {
      if (inv.id !== id) return inv;
      const updated = { ...inv, ...updates };
      if (updates.counterparty_id) {
        updated.counterparty = counterparties.find(c => c.id === updates.counterparty_id);
      }
      if (updates.contract_id !== undefined) {
        updated.contract = contracts.find(c => c.id === updates.contract_id);
      }
      return updated;
    }));
    try {
      const supabase = getSupabaseBrowserClient();
      const payload: any = { ...updates };
      delete payload.id;
      delete payload.created_at;
      delete payload.counterparty;
      delete payload.contract;
      delete payload.documents;
      delete payload.payments;
      delete payload.allocations;
      delete payload.links;

      const { error } = await supabase.from('invoices').update(payload).eq('id', id);
      if (error) {
        console.error("Supabase update invoice error:", error.message);
        alert(`Database Error updating invoice: ${error.message}`);
        setInvoices(previousInvoices);
        return false;
      }

      if (updates.links !== undefined) {
        await supabase.from('invoice_links').delete().eq('invoice_id', id);
        if (updates.links.length > 0) {
          const toInsert = updates.links.map(l => ({
            invoice_id: id,
            title: l.title || null,
            url: l.url,
            created_by: currentUser?.id || null
          }));
          await supabase.from('invoice_links').insert(toInsert);
        }
      }
    } catch (e: any) {
      console.error("updateInvoice exception:", e);
      alert(`Error updating invoice: ${e.message || e}`);
      setInvoices(previousInvoices);
      return false;
    }
    return true;
  };

  const deleteInvoice = async (id: string): Promise<boolean> => {
    setInvoices(prev => prev.filter(inv => inv.id !== id));
    setInvoiceDocuments(prev => prev.filter(d => d.invoice_id !== id));
    setInvoicePayments(prev => prev.filter(p => p.invoice_id !== id));
    setInvoiceAllocations(prev => prev.filter(a => a.invoice_id !== id));
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.from('invoices').delete().eq('id', id);
      if (error) console.error("Supabase delete invoice error:", error.message);
    } catch (e) {
      console.error("deleteInvoice exception:", e);
      return false;
    }
    return true;
  };

  const updateInvoiceStatus = async (id: string, status: Invoice['status'], notes?: string): Promise<boolean> => {
    const previousInvoices = invoices;
    setInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, status, notes: notes !== undefined ? notes : inv.notes } : inv));
    try {
      const supabase = getSupabaseBrowserClient();
      const updatePayload: any = { status };
      if (notes !== undefined) updatePayload.notes = notes;
      const { error } = await supabase.from('invoices').update(updatePayload).eq('id', id);
      if (error) {
        console.error("Supabase update invoice status error:", error.message);
        alert(`Database Error updating status: ${error.message}`);
        setInvoices(previousInvoices);
        return false;
      }
    } catch (e: any) {
      console.error(e);
      alert(`Error updating status: ${e.message || e}`);
      setInvoices(previousInvoices);
      return false;
    }
    return true;
  };

  const linkInvoiceToContract = async (invoiceId: string, contractId: string, allocations: { period: string; amount: number }[], markAsPaid: boolean): Promise<boolean> => {
    try {
      const supabase = getSupabaseBrowserClient();
      
      // 1. Prepare invoice update
      const invoice = invoices.find(i => i.id === invoiceId);
      const contract = contracts.find(c => c.id === contractId);
      
      const updatePayload: any = { contract_id: contractId };
      if (markAsPaid) updatePayload.status = 'paid';
      
      let inheritedCategoryId = invoice?.category_id;
      if (contract && (!inheritedCategoryId || invoice?.category_id === null)) {
        const isRevenue = contract.direction === 'revenue';
        const defaultCat = budgetCategories.find(c => c.direction === (isRevenue ? 'income' : 'expense'));
        if (defaultCat) {
          inheritedCategoryId = defaultCat.id;
          updatePayload.category_id = defaultCat.id;
        }
      }

      // 2. Perform DB updates
      const { error: invErr } = await supabase.from('invoices').update(updatePayload).eq('id', invoiceId);
      if (invErr) throw invErr;

      const newAllocations: InvoiceAllocation[] = allocations.map(a => ({
        id: generateUUID(),
        invoice_id: invoiceId,
        contract_id: contractId,
        period: a.period,
        amount: a.amount,
        created_at: new Date().toISOString()
      }));

      if (newAllocations.length > 0) {
        const { error: allocErr } = await supabase.from('invoice_allocations').insert(
          newAllocations.map(a => ({
            id: a.id, invoice_id: a.invoice_id, contract_id: a.contract_id, period: a.period, amount: a.amount
          }))
        );
        if (allocErr) throw allocErr;
      }

      // 3. Update local state
      setInvoices(prev => prev.map(inv => {
        if (inv.id !== invoiceId) return inv;
        return {
          ...inv,
          contract_id: contractId,
          ...(markAsPaid ? { status: 'paid' as Invoice['status'] } : {}),
          ...(inheritedCategoryId ? { category_id: inheritedCategoryId } : {}),
          allocations: [...(inv.allocations || []), ...newAllocations]
        };
      }));
      setInvoiceAllocations(prev => [...prev, ...newAllocations]);

      return true;
    } catch (e: any) {
      console.error('linkInvoiceToContract error:', e);
      alert(`Error linking invoice: ${e.message || e}`);
      return false;
    }
  };

  const recordInvoicePayment = async (invoiceId: string, paidOn: string, amount: number, bankRef?: string, note?: string): Promise<boolean> => {
    const payId = generateUUID();
    const newPay: InvoicePayment = {
      id: payId,
      invoice_id: invoiceId,
      paid_on: paidOn,
      amount,
      bank_reference: bankRef || null,
      note: note || null,
      created_at: new Date().toISOString()
    };
    setInvoicePayments(prev => [...prev, newPay]);

    setInvoices(prev => prev.map(inv => {
      if (inv.id !== invoiceId) return inv;
      const allPays = [...(inv.payments || []), newPay];
      const totalPaid = allPays.reduce((sum, p) => sum + p.amount, 0);
      let newStatus = inv.status;
      if (inv.status !== 'cancelled') {
        if (totalPaid >= inv.gross - 0.5) newStatus = 'paid';
        else if (totalPaid > 0) newStatus = 'partially_paid';
      }
      return { ...inv, status: newStatus, payments: allPays };
    }));

    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.from('invoice_payments').insert([{
        id: payId,
        invoice_id: invoiceId,
        paid_on: paidOn,
        amount,
        bank_reference: bankRef || null,
        note: note || null
      }]);
      const targetInv = invoices.find(i => i.id === invoiceId);
      if (targetInv) {
        const totalPaid = (targetInv.payments || []).reduce((sum, p) => sum + p.amount, 0) + amount;
        let newStatus = targetInv.status;
        if (targetInv.status !== 'cancelled') {
          if (totalPaid >= targetInv.gross - 0.5) newStatus = 'paid';
          else if (totalPaid > 0) newStatus = 'partially_paid';
        }
        await supabase.from('invoices').update({ status: newStatus }).eq('id', invoiceId);
      }
    } catch (e) {
      console.error(e);
    }
    return true;
  };

  const addInvoiceDocument = async (invoiceId: string, doc: Omit<InvoiceDocument, 'id' | 'uploaded_at'>): Promise<boolean> => {
    const docId = generateUUID();
    const newDoc: InvoiceDocument = {
      ...doc,
      id: docId,
      uploaded_at: new Date().toISOString()
    };
    setInvoiceDocuments(prev => [...prev, newDoc]);
    setInvoices(prev => prev.map(inv => inv.id === invoiceId ? { ...inv, missing_document: false, documents: [...(inv.documents || []), newDoc] } : inv));
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.from('invoice_documents').insert([{
        id: docId,
        invoice_id: invoiceId,
        storage_path: doc.storage_path,
        file_name: doc.file_name,
        version: doc.version
      }]);
      await supabase.from('invoices').update({ missing_document: false }).eq('id', invoiceId);
    } catch (e) {
      console.error(e);
    }
    return true;
  };

  const updateInvoiceCategory = async (invoiceId: string, categoryId: string | null): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase
        .from('invoices')
        .update({ category_id: categoryId })
        .eq('id', invoiceId);
      if (error) throw error;
      setInvoices(prev => prev.map(i => {
        if (i.id !== invoiceId) return i;
        const budgetCat = budgetCategories.find(c => c.id === categoryId);
        return { ...i, category_id: categoryId, budget_category: budgetCat };
      }));
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  const generateBudgetFromContracts = async (budgetId: string, fiscalYear: number): Promise<boolean> => {
    try {
      const supabase = getSupabaseBrowserClient();
      
      // 1. Get active contracts for the year
      const activeContracts = contracts.filter(c => c.status === 'active');
      
      // 2. Prepare budget lines
      const newBudgetLines: Omit<BudgetLine, 'id' | 'created_at'>[] = [];
      
      activeContracts.forEach(contract => {
        const isRevenue = contract.direction === 'revenue';
        
        // If contract has explicit schedules in DB, use them
        const schedules = contract.schedule || [];
        if (schedules.length > 0) {
          schedules.forEach(sched => {
            if (sched.period.startsWith(fiscalYear.toString())) {
              // We need to map to a budget_category. For auto-gen, we use a fallback category based on direction
              // Ideally, the contract itself should have a budget_category, but we'll use a default mapping
              const defaultCat = budgetCategories.find(c => c.direction === (isRevenue ? 'income' : 'expense'));
              if (defaultCat) {
                newBudgetLines.push({
                  budget_id: budgetId,
                  category_id: defaultCat.id,
                  period: sched.period,
                  amount: sched.amount,
                  currency: contract.currency || 'EUR',
                  source_type: 'contract',
                  source_id: sched.id
                });
              }
            }
          });
        } else {
          // No schedule. Generate dynamically based on value & cadence for the given year
          if (!contract.value || !contract.starts_on) return;
          
          let monthlyAmount = contract.value;
          if (contract.billing_cadence === 'annual') monthlyAmount = contract.value / 12;
          if (contract.billing_cadence === 'quarterly') monthlyAmount = contract.value / 3;

          const defaultCat = budgetCategories.find(c => c.direction === (isRevenue ? 'income' : 'expense'));
          if (defaultCat) {
            for (let m = 1; m <= 12; m++) {
              const periodStr = `${fiscalYear}-${m.toString().padStart(2, '0')}`;
              // Simple check if period is after starts_on
              if (periodStr >= contract.starts_on.substring(0, 7)) {
                newBudgetLines.push({
                  budget_id: budgetId,
                  category_id: defaultCat.id,
                  period: periodStr,
                  amount: monthlyAmount,
                  currency: contract.currency || 'EUR',
                  source_type: 'contract',
                  source_id: contract.id // Using contract.id as source_id for dynamic schedules
                });
              }
            }
          }
        }
      });
      
      if (newBudgetLines.length === 0) return true;

      // 3. Delete existing contract-sourced lines for this budget
      await supabase.from('budget_lines')
        .delete()
        .eq('budget_id', budgetId)
        .eq('source_type', 'contract');

      // 4. Insert new lines
      const { error } = await supabase.from('budget_lines').insert(
        newBudgetLines.map(l => ({ ...l, id: generateUUID() }))
      );
      
      if (error) throw error;
      
      // Update local state
      const { data: updatedLines } = await supabase.from('budget_lines').select('*');
      if (updatedLines) setBudgetLines(updatedLines);

      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  const generateBudgetFromPayroll = async (budgetId: string, fiscalYear: number): Promise<boolean> => {
    try {
      const supabase = getSupabaseBrowserClient();
      const personnelCategory = budgetCategories.find(c => c.name.toLowerCase().includes('payroll') || c.name.toLowerCase().includes('personnel'));
      if (!personnelCategory) return false;

      const newBudgetLines: Omit<BudgetLine, 'id' | 'created_at'>[] = [];
      const activeSalaries = salaries.filter(s => {
        if (s.valid_to) {
          const endDate = new Date(s.valid_to);
          return endDate >= new Date(`${fiscalYear}-01-01`);
        }
        return true;
      });

      activeSalaries.forEach(salary => {
        // Base rates carry their own employer cost; extras inherit the employee's base ratio.
        const baseCost = isBaseSalary(salary)
          ? loadedMonthlyCost(salary)
          : loadedExtraCost(salaries, salary.profile_id, Number(salary.gross_amount) || 0);

        for (let m = 1; m <= 12; m++) {
          let monthMultiplier = 1.0;
          if (m === 4) monthMultiplier += 0.5; // Easter
          if (m === 7) monthMultiplier += 0.5; // Summer
          if (m === 12) monthMultiplier += 1.0; // Christmas

          const periodAmount = baseCost * monthMultiplier;
          const periodStr = `${fiscalYear}-${m.toString().padStart(2, '0')}`;

          newBudgetLines.push({
            budget_id: budgetId,
            category_id: personnelCategory.id,
            period: periodStr,
            amount: periodAmount,
            currency: salary.currency || 'EUR',
            source_type: 'payroll',
            source_id: salary.id
          });
        }
      });

      if (newBudgetLines.length === 0) return true;

      // Delete existing payroll lines
      await supabase.from('budget_lines')
        .delete()
        .eq('budget_id', budgetId)
        .eq('source_type', 'payroll');

      // Insert new lines
      const { error } = await supabase.from('budget_lines').insert(
        newBudgetLines.map(l => ({ ...l, id: generateUUID() }))
      );

      if (error) throw error;

      // Update local state
      const { data: updatedLines } = await supabase.from('budget_lines').select('*');
      if (updatedLines) setBudgetLines(updatedLines);

      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  const refreshBudget = async (fiscalYear: number): Promise<boolean> => {
    try {
      liveBudgetYearRef.current = fiscalYear;
      const supabase = getSupabaseBrowserClient();
      let activeBudget = budgets.find(b => b.fiscal_year === fiscalYear && b.status === 'active');
      
      if (!activeBudget) {
        const newBudget = {
          id: generateUUID(),
          fiscal_year: fiscalYear,
          status: 'active'
        };
        const { error } = await supabase.from('budgets').insert([newBudget]);
        if (error) throw error;
        activeBudget = newBudget as any;
        setBudgets(prev => [...prev, activeBudget!]);
      }

      if (activeBudget) {
        await generateBudgetFromContracts(activeBudget.id, fiscalYear);
        await generateBudgetFromPayroll(activeBudget.id, fiscalYear);
      }
      
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  const saveInvoiceAllocation = async (invoiceId: string, contractId: string, period: string, amount: number): Promise<boolean> => {
    const allocId = generateUUID();
    const newAlloc: InvoiceAllocation = {
      id: allocId,
      invoice_id: invoiceId,
      contract_id: contractId,
      period,
      amount,
      created_at: new Date().toISOString()
    };
    setInvoiceAllocations(prev => [...prev, newAlloc]);
    setInvoices(prev => prev.map(inv => inv.id === invoiceId ? { ...inv, allocations: [...(inv.allocations || []), newAlloc] } : inv));
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.from('invoice_allocations').insert([{
        id: allocId,
        invoice_id: invoiceId,
        contract_id: contractId,
        period,
        amount
      }]);
    } catch (e) {
      console.error(e);
    }
    return true;
  };

  const addInvoiceCategory = async (name: string, description?: string): Promise<boolean> => {
    const catId = generateUUID();
    const newCat: InvoiceCategory = {
      id: catId,
      name,
      description: description || null,
      is_default: false,
      created_at: new Date().toISOString()
    };
    setInvoiceCategories(prev => [...prev, newCat].sort((a, b) => a.name.localeCompare(b.name)));
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.from('invoice_categories').insert([{
        id: catId,
        name,
        description: description || null,
        is_default: false
      }]);
    } catch (e) {
      console.error(e);
    }
    return true;
  };

  const deleteInvoiceCategory = async (id: string): Promise<boolean> => {
    setInvoiceCategories(prev => prev.filter(c => c.id !== id));
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.from('invoice_categories').delete().eq('id', id);
    } catch (e) {
      console.error(e);
    }
    return true;
  };

  const refreshIntegrationState = async (): Promise<void> => {
    try {
      const supabase = getSupabaseBrowserClient();
      const [{ data: integRows }, { data: exemptRows }, { data: settingsRows }] = await Promise.all([
        supabase.from('employee_integrations').select(EMPLOYEE_INTEGRATION_COLUMNS),
        supabase.from('integration_exemptions').select('*'),
        supabase.from('integration_settings').select('*'),
      ]);
      const rows = (integRows || []) as EmployeeIntegration[];
      setEmployeeIntegrations(rows);
      // Scope to my own row — an admin loads every employee's rows here.
      const mine = rows.find(i => i.provider === 'slack' && i.profile_id === currentUser.id) || null;
      setSlackIntegration(mine);
      const active = ((exemptRows || []) as IntegrationExemption[])
        .filter(x => x.provider === 'slack' && (!x.expires_at || new Date(x.expires_at) > new Date()))
        .sort((a, b) => (a.expires_at || '').localeCompare(b.expires_at || ''));
      setMyIntegrationExemption(active[0] || null);
      const settingsMap: Record<string, string> = {};
      (settingsRows || []).forEach((r: any) => { settingsMap[r.key] = r.value; });
      setIntegrationSettings({
        leave_label: settingsMap.leave_label ?? DEFAULT_SLACK_SETTINGS.leave_label,
        leave_emoji: settingsMap.leave_emoji ?? DEFAULT_SLACK_SETTINGS.leave_emoji,
        remote_label: settingsMap.remote_label ?? DEFAULT_SLACK_SETTINGS.remote_label,
        remote_emoji: settingsMap.remote_emoji ?? DEFAULT_SLACK_SETTINGS.remote_emoji,
        half_day_label: settingsMap.half_day_label ?? DEFAULT_SLACK_SETTINGS.half_day_label,
      });
      setIntegrationLastReconciledAt(settingsMap.last_reconciled_at ?? null);
      if (currentUser.role === 'admin') {
        const res = await fetch('/api/integrations/exceptions');
        if (res.ok) {
          const data = await res.json();
          setIntegrationExceptions(data);
        }
      }
    } catch (e) {
      console.error('refreshIntegrationState error:', e);
    }
  };

  const syncSlackStatus = async (profileId: string, date: string, orbitId?: string): Promise<void> => {
    await enqueueStatusSync(profileId, date, orbitId);
  };

  const revokeSlackConnection = async (): Promise<void> => {
    try {
      const res = await fetch('/api/slack/revoke', { method: 'POST' });
      if (res.ok) {
        await refreshIntegrationState();
      }
    } catch (e) {
      console.error('revokeSlackConnection error:', e);
    }
  };

  const refreshInvoices = async (): Promise<void> => {
    if (currentUser?.role !== 'admin') return;
    try {
      const supabase = getSupabaseBrowserClient();
      const [invRes, docRes, payRes, allocRes] = await Promise.all([
        supabase.from('invoices').select('*, links:invoice_links(*)').order('issue_date', { ascending: false }),
        supabase.from('invoice_documents').select('*'),
        supabase.from('invoice_payments').select('*'),
        supabase.from('invoice_allocations').select('*'),
      ]);
      
      const loadedDocs: InvoiceDocument[] = await signInvoiceDocuments(supabase, docRes.data || []);
      setInvoiceDocuments(loadedDocs);
      
      const loadedPays: InvoicePayment[] = payRes.data || [];
      setInvoicePayments(loadedPays);
      const loadedAlloc: InvoiceAllocation[] = allocRes.data || [];
      setInvoiceAllocations(loadedAlloc);

      const enrichedInvoices: Invoice[] = (invRes.data || []).map((inv: any) => {
        const cp = counterparties.find(c => c.id === inv.counterparty_id);
        const cnt = contracts.find(c => c.id === inv.contract_id);
        const docs = loadedDocs.filter(d => d.invoice_id === inv.id);
        const pays = loadedPays.filter(p => p.invoice_id === inv.id);
        const allocs = loadedAlloc.filter(a => a.invoice_id === inv.id);
        return { ...inv, counterparty: cp, contract: cnt, documents: docs, payments: pays, allocations: allocs };
      });
      setInvoices(enrichedInvoices);
    } catch (e) {
      console.error('refreshInvoices error:', e);
    }
  };

  const refreshInvoicesRef = useRef(refreshInvoices);
  useEffect(() => {
    refreshInvoicesRef.current = refreshInvoices;
  }, [refreshInvoices]);

  /* ---------------------------------------------------------------------------
   * Live data sync — Supabase Realtime, i.e. this stack's equivalent of a SignalR hub.
   *
   * Every grid in Orbit renders from this context, so pushing row changes straight into the
   * matching slice keeps every screen current without a full refresh: one WebSocket carries
   * postgres_changes for the published tables (migration 0068), each event reloads only the
   * slice it feeds, and bursts of writes per table are debounced into a single reload.
   *
   * This covers writes by any client — this tab, another user, a cron route or the MCP server —
   * and delivery still obeys RLS, so an employee only hears about rows they may read.
   * ------------------------------------------------------------------------- */
  const liveReloadersRef = useRef<Record<string, Array<() => void | Promise<void>>>>({});
  /** Fiscal year the budget screen last asked for, so a budget change reloads the same year. */
  const liveBudgetYearRef = useRef(0);
  /** Carry-over expiry bookings run at most once per mount — they are a scheduled obligation. */
  const carryoverBookingRanRef = useRef(false);
  // Combining both sources keeps the reload gate in step with what was actually loaded: the
  // `user_roles` answer above, or a role the profiles slice happens to carry. Either alone can
  // read false (profiles not yet enriched), and a false here narrows `own` to the admin's own
  // rows — which is an empty ledger, not a smaller one.
  const liveIsAdmin = sessionIsAdminRef.current
    || (!!realProfileId && profiles.some(p => p.id === realProfileId && p.role === 'admin'));
  const liveProfileId = realProfileId || currentUserId || '';
  const liveAdminRef = useRef(liveIsAdmin);
  const liveProfileIdRef = useRef(liveProfileId);
  liveAdminRef.current = liveIsAdmin;
  liveProfileIdRef.current = liveProfileId;

  /**
   * Re-runs one table's query with the same admin / own-row gating the first load used.
   *
   * Returns `null` when the read did not happen — blocked by the gate or the request failed.
   * That is deliberately NOT the same as an empty array: callers must leave their slice alone
   * instead of overwriting good rows with nothing. Returning `[]` on error used to blank the
   * whole payment ledger whenever a save's realtime event failed to refetch `payments` (a 15 MB
   * table, because attached documents live in the row as base64 data URLs).
   */
  // Rows are loosely typed: callers map them onto the entity shape they already know.
  const reloadLiveTable = async (table: string, gate: 'all' | 'own' | 'admin'): Promise<any[] | null> => {
    const admin = liveAdminRef.current;
    const myId = liveProfileIdRef.current;
    if (gate === 'admin' && !admin) return null;
    if (gate === 'own' && !admin && !myId) {
      console.warn(`[live] not reloading ${table}: no admin rights and no profile id yet`);
      return null;
    }
    try {
      const supabase = getSupabaseBrowserClient();
      // employee_integrations (no `token_ref`) and profiles (no `phone`) are column-granted, where
      // `*` would return 42501 and the directory would silently look empty.
      let query = supabase.from(table).select(selectForTable(table));
      if (gate === 'own' && !admin) query = query.eq('profile_id', myId);
      const { data, error } = await query;
      if (error) {
        console.warn(`[live] reload of ${table} failed:`, error.message);
        return null;
      }
      // An empty answer is only believable for a live session. With the token gone the request
      // goes out anonymous, RLS returns nothing, and applying that would erase the screen —
      // silently, because it is not an error. (getSession stays local unless it must refresh.)
      if (!data?.length) {
        const { data: auth } = await supabase.auth.getSession();
        if (!auth.session) {
          console.warn(`[live] not reloading ${table}: no session, so the empty result is not real`);
          return null;
        }
      }
      return data || [];
    } catch (e) {
      console.warn(`[live] reload of ${table} threw:`, e);
      return null;
    }
  };

  // Profiles embed their role, sensitive record and team, so all three tables feed one reloader.
  const reloadLiveProfiles = async () => {
    const [rows, roleRows, sensitiveRows, teamRows, phoneMap] = await Promise.all([
      reloadLiveTable('profiles', 'all'),
      reloadLiveTable('user_roles', 'all'),
      reloadLiveTable('profile_sensitive', 'own'),
      reloadLiveTable('teams', 'all'),
      fetchProfilePhones(getSupabaseBrowserClient()),
    ]);
    if (!rows || !roleRows || !sensitiveRows || !teamRows) return;
    setProfiles(rows.map(p => ({
      ...p,
      // Same rule as the initial load: a missing view must not blank the phone.
      ...(phoneMap ? { phone: phoneMap.get(p.id) ?? null } : {}),
      role: roleRows.some(r => r.profile_id === p.id && r.role === 'admin') ? 'admin' : 'employee',
      sensitive: sensitiveRows.find(s => s.profile_id === p.id),
      team: teamRows.find(t => t.id === p.team_id),
    })));
  };

  const reloadLivePayments = async () => {
    const [rows, types] = await Promise.all([
      liveAdminRef.current ? reloadLiveTable('payments', 'own') : fetchOwnPaidPayments(),
      reloadLiveTable('payment_types', 'all'),
    ]);
    if (!rows || !types) return;
    setPayments(rows.map(p => ({ ...p, documents: p.documents || [], payment_type: types.find(t => t.id === p.payment_type_id) })));
  };

  const reloadLiveLeaveRequests = async () => {
    const [rows, types] = await Promise.all([
      reloadLiveTable('leave_requests', 'own'),
      reloadLiveTable('leave_types', 'all'),
    ]);
    if (!rows || !types) return;
    setLeaveRequests(rows.map(r => ({ ...r, leave_type: types.find(t => t.id === r.leave_type_id) })));
  };

  // Counterparties and contracts are enriched from each other plus their child rows, so one
  // reloader keeps the whole commercial picture consistent.
  const reloadLiveCommercial = async () => {
    const [cpRows, attioLinks, contacts, roleLinks, cpRoles, tierStates, tierVersions, tierOverrides,
      contractRows, lineRows, groupRows, scheduleRows, profileRows] = await Promise.all([
      reloadLiveTable('counterparties', 'admin'),
      reloadLiveTable('attio_links', 'admin'),
      reloadLiveTable('counterparty_contacts', 'admin'),
      reloadLiveTable('counterparty_roles', 'admin'),
      reloadLiveTable('roles', 'all'),
      reloadLiveTable('counterparty_tiers', 'admin'),
      reloadLiveTable('tier_model_versions', 'admin'),
      reloadLiveTable('counterparty_tier_overrides', 'admin'),
      reloadLiveTable('contracts', 'admin'),
      reloadLiveTable('contract_lines', 'admin'),
      reloadLiveTable('contract_line_groups', 'admin'),
      reloadLiveTable('contract_schedule', 'admin'),
      reloadLiveTable('profiles', 'all'),
    ]);
    // Every input feeds the joins below; a partial read would publish half-built counterparties.
    if (!cpRows || !attioLinks || !contacts || !roleLinks || !cpRoles || !tierStates || !tierVersions
      || !tierOverrides || !contractRows || !lineRows || !groupRows || !scheduleRows || !profileRows) return;

    const enrichedCps = cpRows.map(cp => {
      const cpContracts = contractRows.filter(c => c.counterparty_id === cp.id && c.status !== 'archived');
      const explicitSlugs = roleLinks
        .filter(l => l.counterparty_id === cp.id)
        .map(l => cpRoles.find(r => r.id === l.role_id)?.slug?.toLowerCase())
        .filter(Boolean) as string[];
      const slugs = new Set<string>(explicitSlugs);
      if (cpContracts.some(c => c.direction === 'revenue')) slugs.add('client');
      if (cpContracts.some(c => c.direction === 'cost' || c.direction === 'supplier')) slugs.add('supplier');
      const finalSlugs = Array.from(slugs);
      let derived_role: 'client' | 'supplier' | 'both' | 'none yet' = 'none yet';
      if (finalSlugs.includes('client') && finalSlugs.includes('supplier')) derived_role = 'both';
      else if (finalSlugs.includes('client')) derived_role = 'client';
      else if (finalSlugs.includes('supplier')) derived_role = 'supplier';
      return {
        ...cp,
        attio_link: attioLinks.find(l => l.counterparty_id === cp.id),
        contacts: contacts.filter(ct => ct.counterparty_id === cp.id),
        derived_role,
        roles: finalSlugs.map(slug => cpRoles.find(r => r.slug === slug)).filter(Boolean),
        tier: attachTierToCounterparty(cp, tierVersions, tierStates, tierOverrides),
      };
    });
    setCounterparties(enrichedCps);
    setContracts(contractRows.map(cnt => ({
      ...cnt,
      counterparty: enrichedCps.find(c => c.id === cnt.counterparty_id),
      owner_profile: profileRows.find(p => p.id === cnt.owner_profile_id),
      lines: lineRows.filter(l => l.contract_id === cnt.id),
      groups: groupRows.filter(g => g.contract_id === cnt.id),
      schedule: scheduleRows.filter(s => s.contract_id === cnt.id),
    })));
  };

  const reloadLiveCompanyProfile = async () => {
    const { data } = await getSupabaseBrowserClient().from('company_profile').select('*').eq('id', 1).maybeSingle();
    if (data) setCompanyProfile(data as CompanyProfile);
  };

  const reloadLiveLeavePolicy = async () => {
    const { data } = await getSupabaseBrowserClient().from('leave_policy').select('*').eq('id', true).maybeSingle();
    if (data) setLeavePolicy(data as LeavePolicy);
  };

  const reloadLiveRemoteRequests = async () => {
    const [amendments, quotas] = await Promise.all([
      reloadLiveTable('remote_amendments', 'own') as Promise<RemoteAmendmentRequest[]>,
      reloadLiveTable('remote_quota_requests', 'own') as Promise<RemoteQuotaRequest[]>,
    ]);
    if (!amendments || !quotas) return;
    setRemoteAmendmentRequests(amendments);
    setRemoteQuotaRequests(quotas);
  };

  const reloadLiveBudget = async () => {
    const year = liveBudgetYearRef.current;
    if (year) await refreshBudget(year);
  };

  // Rebuilt every render so the reloaders always join against the latest state. Running without a
  // dependency list is deliberate: the reloaders are only ever *called* from the channel handler,
  // and a stale closure here would write old data back over fresh state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const map: Record<string, Array<() => void | Promise<void>>> = {};
    const on = (table: string, reload: () => void | Promise<void>) => {
      (map[table] ||= []).push(reload);
    };

    /** Flat slices: one table, one state slice. */
    (
      [
        ['teams', 'all', setTeams],
        ['payment_types', 'all', setPaymentTypes],
        ['salary_history', 'own', setSalaries],
        ['leave_types', 'all', setLeaveTypes],
        ['leave_entitlements', 'own', setEntitlements],
        ['mandatory_leaves', 'all', setMandatoryLeaves],
        ['public_holidays', 'all', setPublicHolidays],
        ['remote_days', 'own', setRemoteDays],
        ['remote_patterns', 'own', setRemotePatterns],
        ['contract_timesheets', 'own', setTimesheets],
        ['roles', 'all', setCounterpartyRoles],
        ['counterparty_roles', 'admin', setCounterpartyRoleLinks],
        ['catalog_modules', 'admin', setCatalogModules],
        ['catalog_items', 'admin', setCatalogItems],
        ['contract_lines', 'admin', setContractLines],
        ['contract_schedule', 'admin', setContractSchedules],
        ['attio_events', 'admin', setAttioEvents],
        ['tier_model_versions', 'admin', setTierModelVersions],
        ['counterparty_tiers', 'admin', setTierStates],
        ['counterparty_tier_history', 'admin', setTierHistory],
        ['counterparty_tier_overrides', 'admin', setTierOverrides],
        ['employee_integrations', 'own', setEmployeeIntegrations],
        ['integration_exemptions', 'own', setIntegrationExceptions],
        ['integration_settings', 'all', setIntegrationSettings],
        ['payment_document_types', 'all', setDocumentTypes],
        ['employee_contracts', 'own', setEmployeeContracts],
        ['job_roles', 'all', setJobRoles],
        ['seniority_levels', 'all', setSeniorityLevels],
        ['profile_role_history', 'all', setProfileRoleHistory],
        ['rate_cards', 'admin', setRateCards],
        ['rate_card_entries', 'admin', setRateCardEntries],
        ['projects', 'all', setProjects],
        ['work_items', 'all', setWorkItems],
        ['project_assignments', 'own', setProjectAssignments],
        ['project_role_forecasts', 'admin', setProjectRoleForecasts],
        ['time_entries', 'own', setTimeEntries],
        ['timesheet_periods', 'all', setTimesheetPeriods],
        ['remote_policies', 'all', setRemotePolicies],
        ['invoice_categories', 'all', setInvoiceCategories],
      ] as Array<[string, 'all' | 'own' | 'admin', (rows: any[]) => void]>
    ).forEach(([table, gate, apply]) => on(table, async () => {
      const rows = await reloadLiveTable(table, gate);
      if (rows) apply(rows);
    }));

    // Derived / enriched slices (see each reloader).
    on('profiles', reloadLiveProfiles);
    on('user_roles', reloadLiveProfiles);
    on('profile_sensitive', reloadLiveProfiles);
    on('teams', reloadLiveProfiles);
    on('payments', reloadLivePayments);
    on('leave_requests', reloadLiveLeaveRequests);
    ['counterparties', 'counterparty_contacts', 'counterparty_tiers', 'counterparty_tier_history',
      'counterparty_tier_overrides', 'tier_model_versions', 'attio_links', 'contracts',
      'contract_lines', 'contract_line_groups', 'contract_schedule', 'counterparty_roles',
    ].forEach(table => on(table, reloadLiveCommercial));
    ['invoices', 'invoice_documents', 'invoice_payments', 'invoice_allocations', 'invoice_links']
      .forEach(table => on(table, () => refreshInvoicesRef.current()));
    ['budgets', 'budget_lines', 'budget_categories', 'recurring_commitments']
      .forEach(table => on(table, reloadLiveBudget));
    on('company_profile', reloadLiveCompanyProfile);
    on('leave_policy', reloadLiveLeavePolicy);
    on('remote_amendments', reloadLiveRemoteRequests);
    on('remote_quota_requests', reloadLiveRemoteRequests);

    liveReloadersRef.current = map;
  });

  useEffect(() => {
    if (!liveSessionUserId) return;
    const supabase = getSupabaseBrowserClient();
    // Only tables a loaded slice owns are subscribed, so a screen never pays for changes to data
    // it has not fetched. Re-runs when a slice lands (`dataVersion`) to add its tables.
    const allowed = new Set([...CORE_TABLES, ...tablesForSlices(loadedSlicesRef.current)]);
    const tables = Object.keys(liveReloadersRef.current).filter(table => allowed.has(table));
    return startRealtimeSync(
      supabase,
      tables.map(table => ({
        table,
        onChange: () => {
          (liveReloadersRef.current[table] || []).forEach(reload => { void reload(); });
        },
      }))
    );
  }, [liveSessionUserId, dataVersion]);

  const updateCompanyProfile = async (updates: Partial<CompanyProfile>): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const { error, data } = await supabase.from('company_profile').update(updates).eq('id', 1).select().single();
      if (error) {
        alert(`Error updating corporate profile: ${error.message}`);
        return false;
      }
      setCompanyProfile(data);
      return true;
    } catch (err: any) {
      alert(`Exception updating corporate profile: ${err.message}`);
      return false;
    }
  };

  // Company-wide default annual leave days (used when an employee has no per-year record).
  const saveLeavePolicy = async (updates: Partial<LeavePolicy>): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const payload = { ...updates, updated_at: new Date().toISOString(), updated_by: currentUser.id };
      const { error, data } = await supabase.from('leave_policy').update(payload).eq('id', true).select().single();
      if (error) {
        alert(`Database Error: ${error.message}`);
        return false;
      }
      setLeavePolicy(data || null);
      return true;
    } catch (err: any) {
      alert(`Exception saving leave policy: ${err.message}`);
      return false;
    }
  };

  // Upsert a per-employee per-year allowance (the ACTUAL days that employee gets that year).
  const saveLeaveEntitlement = async (e: { id?: string; profile_id: string; year: number; entitlement_days: number; carried_over_days?: number; carryover_expires_on?: string | null; carryover_is_manual?: boolean }): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    const row: LeaveEntitlement = {
      id: e.id || generateUUID(),
      profile_id: e.profile_id,
      year: e.year,
      entitlement_days: Number(e.entitlement_days) || 0,
      carried_over_days: Number(e.carried_over_days ?? 0) || 0,
      carryover_expires_on: e.carryover_expires_on || undefined,
      // Saving from the UI IS an admin decision about that year's carry-over, so protect it from
      // the automatic calculation unless the caller explicitly says otherwise.
      carryover_is_manual: e.carryover_is_manual ?? true,
    };
    try {
      const { error } = await supabase.from('leave_entitlements').upsert({ ...row, carryover_expires_on: row.carryover_expires_on || null }, { onConflict: 'profile_id,year' }).select();
      if (error) {
        alert(`Database Error: ${error.message}`);
        return false;
      }
      setEntitlements(prev => [...prev.filter(x => !(x.profile_id === row.profile_id && x.year === row.year)), row]);
      return true;
    } catch (err: any) {
      alert(`Exception saving leave entitlement: ${err.message}`);
      return false;
    }
  };

  const deleteLeaveEntitlement = async (id: string): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.from('leave_entitlements').delete().eq('id', id);
      if (error) {
        alert(`Database Error: ${error.message}`);
        return false;
      }
      setEntitlements(prev => prev.filter(x => x.id !== id));
      return true;
    } catch (err: any) {
      alert(`Exception deleting leave entitlement: ${err.message}`);
      return false;
    }
  };

  /**
   * Scheduled obligation: once the data is loaded, save any carried-over pot that is about to be
   * forfeited by booking it on the remaining working days before its due date.
   *
   * Deliberately silent and fire-and-forget — it is a no-op unless a pot has actually run out of
   * room, it runs at most once per mount, and the rows it writes are marked `is_auto_carryover`
   * so admins can see and undo them. Admins cover everyone; an employee only ever covers
   * themselves, because RLS hides colleagues' leave.
   */
  useEffect(() => {
    if (isLoading || !currentUser?.id) return;
    // Nothing to book until the leave slice has actually arrived: on a screen that never shows
    // leave, running now would find no entitlements and burn the once-per-mount flag.
    if (!loadedSlicesRef.current.has('leave')) return;
    if (carryoverBookingRanRef.current) return;
    if (leavePolicy?.carryover_auto_book === false) return;
    carryoverBookingRanRef.current = true;
    const scope = currentUser.role === 'admin' ? undefined : currentUser.id;
    void syncCarryoverExpiryBookings(scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, currentUser?.id, currentUser?.role, leavePolicy?.carryover_auto_book, dataVersion]);

  return (
    <AuthContext.Provider value={{
      currentUser,
      companyProfile,
      updateCompanyProfile,
      leavePolicy,
      leaveDefaultDays,
      saveLeavePolicy,
      saveLeaveEntitlement,
      deleteLeaveEntitlement,
      isViewAsEmployee,
      setIsViewAsEmployee,
      realUserRole,
      previewProfileId,
      startPreviewAs,
      stopPreview,
      profiles,
      teams,
      paymentTypes,
      salaries,
      payments,
      leaveTypes,
      entitlements,
      mandatoryLeaves,
      leaveRequests,
      publicHolidays,
      remoteDays,
      timesheets,
      jobRoles,
      seniorityLevels,
      profileRoleHistory,
      rateCards,
      rateCardEntries,
      projects,
      workItems,
      projectAssignments,
      projectRoleForecasts,
      timeEntries,
      timesheetPeriods,
      remotePatterns,
      remotePolicies,
      remoteAmendmentRequests,
      remoteQuotaRequests,
      coverageGroups,
      coverageGroupMembers,
      leaveExceptionRequests,
      hiddenScreens,
      counterparties,
      counterpartyRoles,
      counterpartyRoleLinks,
      attioEvents,
      contracts,
      catalogModules,
      catalogItems,
      contractLines,
      contractSchedules,
      tierModelVersions,
      tierStates,
      tierHistory,
      tierOverrides,
      invoices,
      invoiceCategories,
      invoiceDocuments,
      invoicePayments,
      invoiceAllocations,
      budgets,
      budgetCategories,
      budgetLines,
      recurringCommitments,
      isDevMode,
      signOut,
      switchUser,
      updateProfile,
      updateMyProfile,
      addProfile,
      deleteProfile,
      addLeaveRequest,
      updateLeaveRequestStatus,
      addMandatoryLeave,
      updateMandatoryLeave,
      deleteMandatoryLeave,
      syncAllMandatoryLeaves,
      addPaymentRecord,
      updatePaymentRecord,
      deletePaymentRecord,
      markAllPaidForPeriod,
      addPaymentDocuments,
      updatePaymentDocumentType,
      deletePaymentDocument,
      generateDraftMonth,
      backfillSalaryPayments,
      addPaymentType,
      updatePaymentType,
      deletePaymentType,
      documentTypes,
      addDocumentType,
      updateDocumentType,
      deleteDocumentType,
      employeeContracts,
      addEmployeeContract,
      updateEmployeeContract,
      addSalaryRecord,
      updateSalaryRecord,
      deleteSalaryRecord,
      addContract,
      updateContract,
      deleteContract,
      addCounterparty,
      updateCounterparty,
      deleteCounterparty,
      deleteAllCounterparties,
      syncAttioRoles,
      linkToAttio,
      processAttioReviewEvent,
      reconcileAttio,
      recomputeTiers,
      applyTierModelConfig,
      setTierOverride,
      reassignContracts,
      mergeCounterparties,
      addCounterpartyContact,
      saveContractPricing,
      saveCatalogModule,
      deleteCatalogModule,
      saveCatalogItem,
      deleteCatalogItem,
      updateErganiStatus,
      saveRemotePattern,
      updateRemotePolicy,
      setEmployeeRemoteQuota,
      addRemoteDay,
      bulkAddRemoteDays,
      addTimesheet,
      updateTimesheet,
      deleteTimesheet,
      saveJobRole,
      deleteJobRole,
      saveSeniorityLevel,
      deleteSeniorityLevel,
      setProfileRole,
      updateProfileRoleHistory,
      deleteProfileRoleHistory,
      saveRateCard,
      deleteRateCard,
      ensureContractRateCard,
      saveRateCardEntry,
      deleteRateCardEntry,
      saveProject,
      deleteProject,
      saveWorkItem,
      deleteWorkItem,
      saveProjectAssignment,
      deleteProjectAssignment,
      saveProjectRoleForecast,
      deleteProjectRoleForecast,
      saveTimeEntry,
      deleteTimeEntry,
      submitWeek,
      decideTimeEntries,
      requestRemoteAmendment,
      decideRemoteAmendment,
      requestRemoteQuotaOverride,
      decideRemoteQuotaRequest,
      cancelRemoteQuotaRequest,
      saveCoverageGroup,
      deleteCoverageGroup,
      getCoverageLoad,
      getCoverageLoadForProfile,
      requestLeaveException,
      decideLeaveException,
      setScreenHidden,
      getDerivedCarryover,
      syncLeaveCarryover,
      planLeaveCarryover,
      staleLeaveDayCounts,
      releaseLeaveEntitlementToAuto,
      getCarryoverStatus,
      syncCarryoverExpiryBookings,
      editLeaveRequest,
      requestLeaveCancellation,
      decideLeaveCancellation,
      cancelLeaveRequest,
      deleteLeaveRequest,
      splitAndAddLeaveRequest,
      addTeam,
      updateTeam,
      deleteTeam,
      addLeaveType,
      updateLeaveType,
      deleteLeaveType,
      addPublicHoliday,
      updatePublicHoliday,
      deletePublicHoliday,
      getEmployeeLeaveBalance,
      addInvoice,
      updateInvoice,
      deleteInvoice,
      updateInvoiceStatus,
      linkInvoiceToContract,
      recordInvoicePayment,
      addInvoiceDocument,
      updateInvoiceCategory,
      saveInvoiceAllocation,
      generateBudgetFromContracts,
      generateBudgetFromPayroll,
      refreshBudget,
      addInvoiceCategory,
      deleteInvoiceCategory,
      slackIntegration,
      employeeIntegrations,
      myIntegrationExemption,
      integrationSettings,
      integrationExceptions,
      integrationLastReconciledAt,
      refreshIntegrationState,
      syncSlackStatus,
      revokeSlackConnection,
      refreshInvoices,
      // A first visit to a route waits for its slices; a revisit is already in memory.
      isLoading: isLoading || missingSlices.length > 0,
      isDemo,
      ensureData,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
