"use client";

import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { 
  Profile, Team, PaymentType, SalaryRecord, PaymentRecord, PaymentDocument, 
  LeaveType, LeaveEntitlement, MandatoryLeave, LeaveRequest, 
  PublicHoliday, RemoteDay, RemotePattern, Counterparty, Contract, RemoteMode, RemotePolicy, RemoteAmendmentRequest, RemoteQuotaRequest,
  CounterpartyTierRow, CounterpartyTierHistoryRow, CounterpartyTierOverride, TierModelVersion,
  CatalogModule, CatalogItem, ContractLine, ContractLineGroup, ContractTimesheet, ContractSchedule, AttioLink, AttioEvent, CounterpartyContact,
  Invoice, InvoiceCategory, InvoiceDocument, InvoicePayment, InvoiceAllocation, PaymentDocumentType,
  EmployeeContract, SalaryBonus,
  JobRole, SeniorityLevel, ProfileRoleHistory, RateCard, RateCardEntry, Project, WorkItem, ProjectAssignment, ProjectRoleForecast, TimeEntry, TimesheetPeriod
} from './types';
import { calculateContractValuation } from './pricing-engine';
import { scoreCounterparty, buildHistoryDeltas, tierLabel, type TierModelConfig, type TierDataContext, type TierModel } from './tiering-engine';
import { enqueueStatusSync, athensTodayStr } from './integrations/client';
import { DEFAULT_SLACK_SETTINGS, type EmployeeIntegration, type IntegrationExemption, type IntegrationSettings } from './integrations/types';
import { notifySuccess } from './validation-modal';

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
  counterparties: Counterparty[];
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
  isDevMode: boolean;
  isViewAsEmployee: boolean;
  setIsViewAsEmployee: (val: boolean | ((prev: boolean) => boolean)) => void;
  realUserRole: 'admin' | 'employee' | string;
  signOut: () => Promise<void> | void;
  
  // Actions for immediate optimistic mutation in UI
  switchUser: (profileId: string) => void;
  updateProfile: (profile: Profile) => void;
  updateMyProfile: (edits: Partial<Pick<Profile, 'first_name' | 'last_name' | 'name_el' | 'title'>> & { photo_url?: string | null }) => Promise<boolean>;
  employeeIntegrations: EmployeeIntegration[];
  addProfile: (profile: Profile) => void;
  deleteProfile: (profileId: string) => Promise<boolean>;
  addLeaveRequest: (req: Omit<LeaveRequest, 'id'>) => void;
  updateLeaveRequestStatus: (id: string, status: LeaveRequest['status'], rejectionReason?: string) => void;
  addMandatoryLeave: (ml: Omit<MandatoryLeave, 'id'>) => void;
  updateMandatoryLeave: (id: string, updated: Partial<MandatoryLeave>) => Promise<void>;
  deleteMandatoryLeave: (id: string) => Promise<void>;
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
  documentTypes: PaymentDocumentType[];
  addDocumentType: (dt: Omit<PaymentDocumentType, 'id' | 'sort_order'>) => Promise<boolean>;
  updateDocumentType: (id: string, updates: Partial<PaymentDocumentType>) => Promise<boolean>;
  deleteDocumentType: (id: string) => Promise<boolean>;
  employeeContracts: EmployeeContract[];
  addEmployeeContract: (c: Omit<EmployeeContract, 'id'>) => Promise<boolean>;
  updateEmployeeContract: (id: string, updates: Partial<EmployeeContract>) => Promise<boolean>;
  salaryBonuses: SalaryBonus[];
  addSalaryBonus: (b: Omit<SalaryBonus, 'id'>) => Promise<boolean>;
  updateSalaryBonus: (id: string, updates: Partial<SalaryBonus>) => Promise<boolean>;
  deleteSalaryBonus: (id: string) => Promise<boolean>;
  addSalaryRecord: (record: Omit<SalaryRecord, 'id'>) => Promise<void>;
  updateSalaryRecord: (id: string, updates: Partial<SalaryRecord>) => Promise<void>;
  addContract: (cnt: Omit<Contract, 'id'>) => void;
  updateContract: (cnt: Contract) => void;
  deleteContract: (id: string) => Promise<boolean>;
  addCounterparty: (cp: Partial<Counterparty>, attioRecordId?: string) => Promise<Counterparty | null>;
  updateCounterparty: (cp: Counterparty) => Promise<boolean>;
  deleteCounterparty: (id: string) => Promise<boolean>;
  deleteAllCounterparties: () => Promise<boolean>;
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
  editLeaveRequest: (id: string, updated: Partial<LeaveRequest>, editReason?: string) => void;
  requestLeaveCancellation: (id: string) => void;
  decideLeaveCancellation: (id: string, approve: boolean) => void;
  deleteLeaveRequest: (id: string) => Promise<boolean>;
  splitAndAddLeaveRequest: (req: Omit<LeaveRequest, 'id'>, workSchedule: string[], holidays: PublicHoliday[]) => void;
  addTeam: (name: string, leadProfileId?: string) => Promise<boolean>;
  updateTeam: (id: string, name: string, leadProfileId?: string) => Promise<boolean>;
  deleteTeam: (id: string) => Promise<boolean>;
  addLeaveType: (payload: Omit<LeaveType, 'id'>) => Promise<boolean>;
  updateLeaveType: (id: string, payload: Partial<LeaveType>) => Promise<boolean>;
  deleteLeaveType: (id: string) => Promise<boolean>;
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
  recordInvoicePayment: (invoiceId: string, paidOn: string, amount: number, bankRef?: string, note?: string) => Promise<boolean>;
  addInvoiceDocument: (invoiceId: string, doc: Omit<InvoiceDocument, 'id' | 'uploaded_at'>) => Promise<boolean>;
  saveInvoiceAllocation: (invoiceId: string, contractId: string, period: string, amount: number) => Promise<boolean>;
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
}

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

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [isDevMode, setIsDevMode] = useState<boolean>(true);
  const [isViewAsEmployee, setIsViewAsEmployee] = useState<boolean>(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [paymentTypes, setPaymentTypes] = useState<PaymentType[]>([]);
  const [salaries, setSalaries] = useState<SalaryRecord[]>([]);
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
  const [remotePolicies, setRemotePolicies] = useState<RemotePolicy[]>([]);
  const [remoteAmendmentRequests, setRemoteAmendmentRequests] = useState<RemoteAmendmentRequest[]>([]);
  const [remoteQuotaRequests, setRemoteQuotaRequests] = useState<RemoteQuotaRequest[]>([]);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
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
  const [salaryBonuses, setSalaryBonuses] = useState<SalaryBonus[]>([]);
  const [invoiceCategories, setInvoiceCategories] = useState<InvoiceCategory[]>([]);
  const [invoiceDocuments, setInvoiceDocuments] = useState<InvoiceDocument[]>([]);
  const [invoicePayments, setInvoicePayments] = useState<InvoicePayment[]>([]);
  const [invoiceAllocations, setInvoiceAllocations] = useState<InvoiceAllocation[]>([]);
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

    const fetchLiveSupabaseData = async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const [
          teamsRes, profilesRes, rolesRes, sensitiveRes, paymentTypesRes, salariesRes,
          paymentsRes, leaveTypesRes, entitlementsRes, mandatoryRes, leaveRequestsRes,
          holidaysRes, remoteDaysRes, remotePatternsRes, timesheetsRes, counterpartiesRes, contractsRes, remotePoliciesRes,
          catalogModulesRes, catalogItemsRes, contractLinesRes, contractLineGroupsRes, contractScheduleRes, attioLinksRes, cpContactsRes, attioEventsRes,
          tierModelVersionsRes, counterpartyTiersRes, tierHistoryRes, tierOverridesRes,
          integrationsRes, exemptionsRes, integrationSettingsRes, documentTypesRes, contractsRes2, bonusesRes,
          jobRolesRes, seniorityLevelsRes, profileRoleHistoryRes, rateCardsRes, rateCardEntriesRes, projectsRes, workItemsRes, projectAssignmentsRes, projectRoleForecastsRes, timeEntriesRes, timesheetPeriodsRes
        ] = await Promise.all([
          supabase.from('teams').select('*'),
          supabase.from('profiles').select('*'),
          supabase.from('user_roles').select('*'),
          supabase.from('profile_sensitive').select('*'),
          supabase.from('payment_types').select('*').order('sort_order', { ascending: true }),
          supabase.from('salary_history').select('*'),
          supabase.from('payments').select('*'),
          supabase.from('leave_types').select('*').order('sort_order', { ascending: true }),
          supabase.from('leave_entitlements').select('*'),
          supabase.from('mandatory_leaves').select('*'),
          supabase.from('leave_requests').select('*'),
          supabase.from('public_holidays').select('*'),
          supabase.from('remote_days').select('*'),
          supabase.from('remote_patterns').select('*'),
          supabase.from('contract_timesheets').select('*'),
          supabase.from('counterparties').select('*'),
          supabase.from('contracts').select('*'),
          supabase.from('remote_policies').select('*'),
          supabase.from('catalog_modules').select('*').order('sort_order', { ascending: true }),
          supabase.from('catalog_items').select('*'),
          supabase.from('contract_lines').select('*'),
          supabase.from('contract_line_groups').select('*'),
          supabase.from('contract_schedule').select('*').order('period', { ascending: true }),
          supabase.from('attio_links').select('*'),
          supabase.from('counterparty_contacts').select('*'),
          supabase.from('attio_events').select('*'),
          supabase.from('tier_model_versions').select('*'),
          supabase.from('counterparty_tiers').select('*'),
          supabase.from('counterparty_tier_history').select('*').order('changed_at', { ascending: false }).limit(300),
          supabase.from('counterparty_tier_overrides').select('*'),
          supabase.from('employee_integrations').select('*'),
          supabase.from('integration_exemptions').select('*'),
          supabase.from('integration_settings').select('*'),
          supabase.from('payment_document_types').select('*').order('sort_order', { ascending: true }),
          supabase.from('employee_contracts').select('*'),
          supabase.from('salary_bonuses').select('*'),
          supabase.from('job_roles').select('*').order('sort_order', { ascending: true }),
          supabase.from('seniority_levels').select('*').order('rank', { ascending: true }),
          supabase.from('profile_role_history').select('*'),
          supabase.from('rate_cards').select('*'),
          supabase.from('rate_card_entries').select('*'),
          supabase.from('projects').select('*'),
          supabase.from('work_items').select('*'),
          supabase.from('project_assignments').select('*'),
          supabase.from('project_role_forecasts').select('*'),
          supabase.from('time_entries').select('*'),
          supabase.from('timesheet_periods').select('*')
        ]);

        const loadedAttioLinks: AttioLink[] = (attioLinksRes.data || []) as AttioLink[];
        const loadedContacts: CounterpartyContact[] = (cpContactsRes.data || []) as CounterpartyContact[];
        setAttioEvents((attioEventsRes.data || []) as AttioEvent[]);

        const loadedTierVersions: TierModelVersion[] = (tierModelVersionsRes?.data || []) as TierModelVersion[];
        const loadedTierStates: CounterpartyTierRow[] = (counterpartyTiersRes?.data || []) as CounterpartyTierRow[];
        const loadedTierHistory: CounterpartyTierHistoryRow[] = (tierHistoryRes?.data || []) as CounterpartyTierHistoryRow[];
        const loadedTierOverrides: CounterpartyTierOverride[] = (tierOverridesRes?.data || []) as CounterpartyTierOverride[];
        setTierModelVersions(loadedTierVersions);
        setTierStates(loadedTierStates);
        setTierHistory(loadedTierHistory);
        setTierOverrides(loadedTierOverrides);

        const loadedTeams: Team[] = teamsRes.data || [];
        setTeams(loadedTeams);

        const loadedPaymentTypes: PaymentType[] = paymentTypesRes.data || [];
        setPaymentTypes(loadedPaymentTypes);

        const loadedSalaries: SalaryRecord[] = salariesRes.data || [];
        setSalaries(loadedSalaries);

        const loadedLeaveTypes: LeaveType[] = ((leaveTypesRes.data || []) as LeaveType[]).sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100));
        setLeaveTypes(loadedLeaveTypes);

        const loadedEntitlements: LeaveEntitlement[] = entitlementsRes.data || [];
        setEntitlements(loadedEntitlements);

        const loadedMandatory: MandatoryLeave[] = mandatoryRes.data || [];
        setMandatoryLeaves(loadedMandatory);

        const loadedHolidays: PublicHoliday[] = holidaysRes.data || [];
        setPublicHolidays(loadedHolidays);

        const loadedRemoteDays: RemoteDay[] = remoteDaysRes.data || [];
        setRemoteDays(loadedRemoteDays);

        const loadedTimesheets: ContractTimesheet[] = (timesheetsRes?.data || []) as ContractTimesheet[];
        setTimesheets(loadedTimesheets);

        const loadedRemotePatterns: RemotePattern[] = remotePatternsRes.data || [];
        setRemotePatterns(loadedRemotePatterns);

        const loadedCounterparties: Counterparty[] = counterpartiesRes.data || [];
        setCounterparties(loadedCounterparties);

        let loadedProfiles: Profile[] = [];
        if (profilesRes.data && profilesRes.data.length > 0) {
          const roles = rolesRes.data || [];
          const sensitives = sensitiveRes.data || [];
          loadedProfiles = profilesRes.data.map((p: any) => {
            const userRoles = roles.filter((r: any) => r.profile_id === p.id);
            const role = userRoles.some((r: any) => r.role === 'admin') ? 'admin' : 'employee';
            const sensitive = sensitives.find((s: any) => s.profile_id === p.id);
            const team = loadedTeams.find(t => t.id === p.team_id);
            return { ...p, role, sensitive, team };
          });
          setProfiles(loadedProfiles);
        }

        const enrichedPayments = (paymentsRes.data || []).map((pay: any) => {
          const payment_type = loadedPaymentTypes.find(pt => pt.id === pay.payment_type_id);
          return { ...pay, documents: pay.documents || [], payment_type };
        });
        setPayments(enrichedPayments);

        const enrichedRequests = (leaveRequestsRes.data || []).map((req: any) => {
          const leave_type = loadedLeaveTypes.find(lt => lt.id === req.leave_type_id);
          return { ...req, leave_type };
        });
        setLeaveRequests(enrichedRequests);

        const loadedCatalogModules: CatalogModule[] = catalogModulesRes?.data || [];
        setCatalogModules(loadedCatalogModules);

        const loadedCatalogItems: CatalogItem[] = catalogItemsRes?.data || [];
        setCatalogItems(loadedCatalogItems);

        const loadedContractLines: ContractLine[] = contractLinesRes?.data || [];
        setContractLines(loadedContractLines);

        const loadedContractSchedules: ContractSchedule[] = contractScheduleRes?.data || [];
        setContractSchedules(loadedContractSchedules);

        const enrichedCounterparties = loadedCounterparties.map(cp => {
          const attio_link = loadedAttioLinks.find(l => l.counterparty_id === cp.id);
          const contacts = loadedContacts.filter(ct => ct.counterparty_id === cp.id);
          const cpContracts = (contractsRes.data || []).filter((cnt: any) => cnt.counterparty_id === cp.id && cnt.status !== 'archived');
          const hasRevenue = cpContracts.some((cnt: any) => cnt.direction === 'revenue');
          const hasCost = cpContracts.some((cnt: any) => cnt.direction === 'cost' || cnt.direction === 'supplier');
          let derived_role: 'client' | 'supplier' | 'both' | 'none yet' = 'none yet';
          if (hasRevenue && hasCost) derived_role = 'both';
          else if (hasRevenue) derived_role = 'client';
          else if (hasCost) derived_role = 'supplier';
          const tier = attachTierToCounterparty(cp, loadedTierVersions, loadedTierStates, loadedTierOverrides);
          return { ...cp, attio_link, contacts, derived_role, tier };
        });
        setCounterparties(enrichedCounterparties);

        const enrichedContracts = (contractsRes.data || []).map((cnt: any) => {
          const counterparty = enrichedCounterparties.find(c => c.id === cnt.counterparty_id);
          const owner_profile = loadedProfiles.find(p => p.id === cnt.owner_profile_id);
          const lines = loadedContractLines.filter(l => l.contract_id === cnt.id);
          const groups = (contractLineGroupsRes?.data || []).filter((g: ContractLineGroup) => g.contract_id === cnt.id);
          const schedule = loadedContractSchedules.filter(s => s.contract_id === cnt.id);
          return { ...cnt, counterparty, owner_profile, lines, groups, schedule };
        });
        setContracts(enrichedContracts);

        const loadedPolicies: RemotePolicy[] = (remotePoliciesRes.data || []).map((p: any) => ({
          ...p,
          max_days: p.max_days ?? p.max_days_per_month ?? 8,
          period_type: p.period_type || 'month'
        }));
        setRemotePolicies(loadedPolicies);

        try {
          const amendmentsRes = await supabase.from('remote_amendments').select('*');
          if (amendmentsRes.data) {
            setRemoteAmendmentRequests(amendmentsRes.data as RemoteAmendmentRequest[]);
          }
        } catch {
          // Graceful fallback if remote_amendments table is not created yet
        }

        try {
          const quotaRes = await supabase.from('remote_quota_requests').select('*');
          if (quotaRes.data) {
            setRemoteQuotaRequests(quotaRes.data as RemoteQuotaRequest[]);
          }
        } catch {
          // Graceful fallback if remote_quota_requests table is not created yet
        }

        try {
          const [invRes, catRes, docRes, payRes, allocRes] = await Promise.all([
            supabase.from('invoices').select('*').order('issue_date', { ascending: false }),
            supabase.from('invoice_categories').select('*').order('name', { ascending: true }),
            supabase.from('invoice_documents').select('*'),
            supabase.from('invoice_payments').select('*'),
            supabase.from('invoice_allocations').select('*'),
          ]);
          
          const loadedCats: InvoiceCategory[] = catRes.data || [];
          if (loadedCats.length === 0) {
            const defaultCats: InvoiceCategory[] = [
              { id: 'cat-1', name: 'Infrastructure & Hosting', description: 'Servers and cloud computing', is_default: true },
              { id: 'cat-2', name: 'Marketing & Sales', description: 'Advertising and campaigns', is_default: true },
              { id: 'cat-3', name: 'Office & Admin', description: 'Office rent and supplies', is_default: true },
              { id: 'cat-4', name: 'Travel & Expense', description: 'Corporate travel and flights', is_default: true },
              { id: 'cat-5', name: 'Legal & Accounting', description: 'Audit fees and advisory', is_default: true },
              { id: 'cat-6', name: 'Other Operational', description: 'Miscellaneous operational expenses', is_default: true },
            ];
            setInvoiceCategories(defaultCats);
          } else {
            setInvoiceCategories(loadedCats);
          }
          const loadedDocs: InvoiceDocument[] = (docRes.data || []).map((doc: any) => {
            // Resolve the real public URL from storage so the preview modal renders the actual PDF,
            // not the metadata fallback sheet. The table only persists storage_path, not url.
            // MCP-mock records (mcp_invoices/*) have no backing object in storage, so leave those without a URL.
            const isMockPath = typeof doc.storage_path === 'string' && doc.storage_path.startsWith('mcp_invoices/');
            const { data: pubData } = isMockPath
              ? { data: null }
              : supabase.storage.from('invoices').getPublicUrl(doc.storage_path);
            return { ...doc, url: pubData?.publicUrl || undefined };
          });
          setInvoiceDocuments(loadedDocs);
          const loadedPays: InvoicePayment[] = payRes.data || [];
          setInvoicePayments(loadedPays);
          const loadedAlloc: InvoiceAllocation[] = allocRes.data || [];
          setInvoiceAllocations(loadedAlloc);

          const enrichedInvoices: Invoice[] = (invRes.data || []).map((inv: any) => {
            const cp = enrichedCounterparties.find(c => c.id === inv.counterparty_id);
            const cnt = enrichedContracts.find(c => c.id === inv.contract_id);
            const docs = loadedDocs.filter(d => d.invoice_id === inv.id);
            const pays = loadedPays.filter(p => p.invoice_id === inv.id);
            const allocs = loadedAlloc.filter(a => a.invoice_id === inv.id);
            return { ...inv, counterparty: cp, contract: cnt, documents: docs, payments: pays, allocations: allocs };
          });
          setInvoices(enrichedInvoices);
        } catch (e) {
          console.warn('Invoice tracking tables sync notice (migration pending):', e);
        }

        setDocumentTypes((documentTypesRes?.data || []) as PaymentDocumentType[]);
        setEmployeeContracts((contractsRes2?.data || []) as EmployeeContract[]);
        setSalaryBonuses((bonusesRes?.data || []) as SalaryBonus[]);

        setJobRoles((jobRolesRes?.data || []) as JobRole[]);
        setSeniorityLevels((seniorityLevelsRes?.data || []) as SeniorityLevel[]);
        setProfileRoleHistory((profileRoleHistoryRes?.data || []) as ProfileRoleHistory[]);
        setRateCards((rateCardsRes?.data || []) as RateCard[]);
        setRateCardEntries((rateCardEntriesRes?.data || []) as RateCardEntry[]);
        setProjects((projectsRes?.data || []) as Project[]);
        setWorkItems((workItemsRes?.data || []) as WorkItem[]);
        setProjectAssignments((projectAssignmentsRes?.data || []) as ProjectAssignment[]);
        setProjectRoleForecasts((projectRoleForecastsRes?.data || []) as ProjectRoleForecast[]);
        setTimeEntries((timeEntriesRes?.data || []) as TimeEntry[]);
        setTimesheetPeriods((timesheetPeriodsRes?.data || []) as TimesheetPeriod[]);

        const myIntegrationRows: EmployeeIntegration[] = (integrationsRes?.data || []) as EmployeeIntegration[];
        setEmployeeIntegrations(myIntegrationRows);
        const myExemptions: IntegrationExemption[] = (exemptionsRes?.data || []) as IntegrationExemption[];
        const myInteg = myIntegrationRows.find(i => i.provider === 'slack') || null;
        setSlackIntegration(myInteg);
        const activeExemptions = myExemptions.filter(x => x.provider === 'slack' && (!x.expires_at || new Date(x.expires_at) > new Date()));
        setMyIntegrationExemption(activeExemptions.sort((a, b) => (a.expires_at || '').localeCompare(b.expires_at || ''))[0] || null);
        const settingsMap: Record<string, string> = {};
        (integrationSettingsRes?.data || []).forEach((r: any) => { settingsMap[r.key] = r.value; });
        setIntegrationSettings({
          leave_label: settingsMap.leave_label ?? DEFAULT_SLACK_SETTINGS.leave_label,
          leave_emoji: settingsMap.leave_emoji ?? DEFAULT_SLACK_SETTINGS.leave_emoji,
          remote_label: settingsMap.remote_label ?? DEFAULT_SLACK_SETTINGS.remote_label,
          remote_emoji: settingsMap.remote_emoji ?? DEFAULT_SLACK_SETTINGS.remote_emoji,
          half_day_label: settingsMap.half_day_label ?? DEFAULT_SLACK_SETTINGS.half_day_label,
        });
        setIntegrationLastReconciledAt(settingsMap.last_reconciled_at ?? null);

        let matchedId = '';
        const { data: { session } } = await supabase.auth.getSession();
        if (session && session.user && session.user.email) {
          const email = session.user.email.toLowerCase();
          const match = loadedProfiles.find(p => p.work_email?.toLowerCase() === email);
          if (match) {
            matchedId = match.id;
          }
        }
        if (!matchedId && loadedProfiles.length > 0) {
          matchedId = loadedProfiles[0].id;
        }
        if (matchedId) {
          setCurrentUserId(matchedId);
        }
      } catch (err) {
        console.error("Live database sync exception:", err);
      }
    };

    fetchLiveSupabaseData();
  }, []);

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

  const baseCurrentUser = profiles.find(p => p.id === currentUserId) || profiles[0] || fallbackProfile;
  const realUserRole = baseCurrentUser.role;
  const currentUser = useMemo(() => {
    if (isViewAsEmployee && baseCurrentUser.role === 'admin') {
      return { ...baseCurrentUser, role: 'employee' as const };
    }
    return baseCurrentUser;
  }, [baseCurrentUser, isViewAsEmployee]);

  const signOut = async () => {
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch (e) {
      console.error("Sign out exception:", e);
    } finally {
      router.push("/login");
    }
  };

  const switchUser = (profileId: string) => {
    setCurrentUserId(profileId);
    setIsViewAsEmployee(false);
  };

  const updateProfile = async (updated: Profile) => {
    const supabase = getSupabaseBrowserClient();
    const { team, sensitive, role, ...cleanProfile } = updated as any;
    try {
      const { error } = await supabase.from('profiles').update(cleanProfile).eq('id', updated.id);
      if (error) {
        console.error('Failed to update profile in database:', error);
        alert(`Database Error: ${error.message}`);
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

  const updateMyProfile = async (edits: Partial<Pick<Profile, 'first_name' | 'last_name' | 'name_el' | 'title'>> & { photo_url?: string | null }): Promise<boolean> => {
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

  const addProfile = async (newProf: Profile) => {
    const id = (newProf.id && newProf.id.includes('-') && newProf.id.length === 36) ? newProf.id : generateUUID();
    const profWithId = { ...newProf, id };
    const supabase = getSupabaseBrowserClient();
    const { team, sensitive, role, ...cleanProfile } = profWithId as any;
    try {
      const { error } = await supabase.from('profiles').insert(cleanProfile);
      if (error) {
        console.error('Failed to insert profile into database:', error);
        alert(`Database Error: ${error.message}`);
        return;
      }
      if (role) {
        await supabase.from('user_roles').insert({ profile_id: id, role });
      }
      if (sensitive) {
        await supabase.from('profile_sensitive').insert({ ...sensitive, profile_id: id });
      }
      setProfiles(prev => [profWithId, ...prev]);
    } catch (e: any) {
      console.error('Failed to insert profile into database:', e);
    }
  };

  const addLeaveRequest = async (req: Omit<LeaveRequest, 'id'>) => {
    let finalTypeId = req.leave_type_id;
    if (finalTypeId === 'lt-annual' || !leaveTypes.some(lt => lt.id === finalTypeId)) {
      const validLt = leaveTypes.find(t => !t.is_hidden && (t.code === 'annual' || (t.name_en && t.name_en.toLowerCase().includes('annual')))) || leaveTypes.find(t => !t.is_hidden) || leaveTypes[0];
      if (validLt) finalTypeId = validLt.id;
    }
    const newReq: LeaveRequest = { ...req, leave_type_id: finalTypeId, id: generateUUID() };
    const supabase = getSupabaseBrowserClient();
    const { leave_type, ...cleanReq } = newReq as any;
    try {
      const { error, data } = await supabase.from('leave_requests').insert(cleanReq).select();
      if (error) {
        console.error('Failed to insert leave request into database:', error);
        alert(`Database Error: ${error.message}`);
        return;
      }
      const savedReq = (data && data[0]) ? { ...data[0], leave_type: leaveTypes.find(lt => lt.id === data[0].leave_type_id) } : newReq;
      setLeaveRequests(prev => [savedReq, ...prev]);
      if (savedReq.status === 'approved') {
        // Admin-created approved leave (e.g. admin_entry) mirrors immediately
        syncSlackStatus(savedReq.profile_id, athensTodayStr(), savedReq.id);
      }
    } catch (e: any) {
      console.error('Failed to insert leave request into database:', e);
    }
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

  const editLeaveRequest = async (id: string, updated: Partial<LeaveRequest>, editReason?: string) => {
    const supabase = getSupabaseBrowserClient();
    try {
      const target = leaveRequests.find(r => r.id === id);
      const newErganiStatus = (target?.ergani_status === 'submitted') ? 'needs_amendment' : target?.ergani_status;
      const { leave_type, ...cleanUpdate } = updated as any;
      const updateData = {
        ...cleanUpdate,
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

  const requestLeaveCancellation = async (id: string) => {
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.from('leave_requests').update({ status: 'cancellation_requested' }).eq('id', id);
      if (error) {
        console.error('Failed to request leave cancellation:', error);
        alert(`Database Error: ${error.message}`);
        return;
      }
      setLeaveRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'cancellation_requested' } : r));
    } catch (e: any) {
      console.error('Failed to request leave cancellation:', e);
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

  const splitAndAddLeaveRequest = async (req: Omit<LeaveRequest, 'id'>, workSchedule: string[], holidays: PublicHoliday[]) => {
    const startYear = new Date(req.start_date).getFullYear();
    const endYear = new Date(req.end_date).getFullYear();

    if (startYear === endYear || isNaN(startYear) || isNaN(endYear)) {
      await addLeaveRequest(req);
      return;
    }

    const endOfFirstYear = `${startYear}-12-31`;
    const startOfSecondYear = `${endYear}-01-01`;
    
    const calcDays = (s: string, e: string) => {
      let d = new Date(s);
      const endD = new Date(e);
      let count = 0;
      while (d <= endD) {
        const dStr = d.toISOString().split('T')[0];
        const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
        const isHol = holidays.some(h => h.date === dStr);
        const isMandatory = mandatoryLeaves.some(m => dStr >= m.start_date && dStr <= m.end_date) ||
                            leaveRequests.some(r => r.origin === 'mandatory' && r.profile_id === req.profile_id && dStr >= r.start_date && dStr <= r.end_date);
        if (!isHol && !isMandatory && workSchedule.includes(dayOfWeek)) count++;
        d.setDate(d.getDate() + 1);
      }
      return count;
    };

    const firstId = generateUUID();
    const secondId = generateUUID();

    const req1: LeaveRequest = {
      ...req,
      id: firstId,
      end_date: endOfFirstYear,
      working_days: calcDays(req.start_date, endOfFirstYear),
      linked_request_id: secondId
    };

    const req2: LeaveRequest = {
      ...req,
      id: secondId,
      start_date: startOfSecondYear,
      working_days: calcDays(startOfSecondYear, req.end_date),
      linked_request_id: firstId
    };

    const supabase = getSupabaseBrowserClient();
    try {
      const { leave_type: lt1, ...clean1 } = req1 as any;
      const { leave_type: lt2, ...clean2 } = req2 as any;
      const { error } = await supabase.from('leave_requests').insert([clean1, clean2]);
      if (error) {
        console.error('Failed to save year-boundary split leave requests:', error);
        alert(`Database Error: ${error.message}`);
        return;
      }
      setLeaveRequests(prev => [req2, req1, ...prev]);
    } catch (e: any) {
      console.error('Failed to save year-boundary split leave requests:', e);
    }
  };

  const getEmployeeLeaveBalance = (profileId: string, year: number) => {
    const ent = entitlements.find(e => e.profile_id === profileId && e.year === year);
    const entitlement = ent?.entitlement_days ?? 22;
    const carryOver = ent?.carried_over_days ?? 0;
    const carryOverExpires = ent?.carryover_expires_on ?? `March 31, ${year}`;

    const userReqs = leaveRequests.filter(r => {
      if (r.profile_id !== profileId) return false;
      const rYear = new Date(r.start_date).getFullYear();
      if (rYear !== year && !isNaN(rYear)) return false;
      const lt = leaveTypes.find(t => t.id === r.leave_type_id) || r.leave_type;
      return lt ? lt.counts_against_balance !== false : true;
    });

    const prof = profiles.find(p => p.id === profileId);
    const workSchedule = prof?.work_schedule || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const mandatoryList = [
      ...mandatoryLeaves.map(m => ({ start: m.start_date, end: m.end_date })),
      ...userReqs.filter(r => r.origin === 'mandatory').map(r => ({ start: r.start_date, end: r.end_date }))
    ];

    const getEffectiveRegularDays = (r: LeaveRequest) => {
      try {
        let d = new Date(r.start_date);
        const endD = new Date(r.end_date);
        if (isNaN(d.getTime()) || isNaN(endD.getTime())) return Number(r.working_days || 0);
        let count = 0;
        while (d <= endD) {
          const dStr = d.toISOString().split('T')[0];
          const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
          const isMandatory = mandatoryList.some(m => dStr >= m.start && dStr <= m.end);
          if (!isMandatory && workSchedule.includes(dayOfWeek)) {
            count++;
          }
          d.setDate(d.getDate() + 1);
        }
        return Math.min(Number(r.working_days || 0), count);
      } catch {
        return Number(r.working_days || 0);
      }
    };

    const taken = userReqs
      .filter(r => (r.status === 'approved' || r.status === 'in_progress' || r.status === 'taken' || r.status === 'cancellation_requested') && r.origin !== 'mandatory')
      .reduce((sum, r) => sum + getEffectiveRegularDays(r), 0);

    const reserved = userReqs
      .filter(r => r.status === 'pending' && r.origin !== 'mandatory')
      .reduce((sum, r) => sum + getEffectiveRegularDays(r), 0);

    const mandatory = userReqs
      .filter(r => r.origin === 'mandatory' && !r.detached && (r.status === 'approved' || r.status === 'in_progress' || r.status === 'taken'))
      .reduce((sum, r) => sum + Number(r.working_days || 0), 0);

    const available = entitlement + carryOver - taken - reserved - mandatory;

    return { entitlement, carryOver, carryOverExpires, taken, reserved, mandatory, available };
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
    } catch (e: any) {
      console.error('Failed to insert mandatory leave:', e);
      return;
    }

    // Perform Idempotent Fan-out to all active non-contractors!
    if (newMl.status === 'published') {
      const eligible = profiles.filter(p => p.status === 'active' && p.employment_type !== 'contractor');
      const newRequests: LeaveRequest[] = eligible.map(p => ({
        id: generateUUID(),
        profile_id: p.id,
        leave_type_id: newMl.leave_type_id,
        start_date: newMl.start_date,
        end_date: newMl.end_date,
        half_day_start: false,
        half_day_end: false,
        working_days: p.employment_type === 'part_time' ? 2 : 3,
        status: 'approved',
        origin: 'mandatory',
        mandatory_leave_id: newMl.id,
        note: `Company-wide mandatory leave: ${newMl.name}`,
        ergani_status: 'not_required'
      }));

      try {
        const cleanRequests = newRequests.map(({ leave_type, ...r }: any) => r);
        const { error: reqError } = await supabase.from('leave_requests').insert(cleanRequests);
        if (reqError) {
          console.error('Failed to fan-out mandatory leave requests:', reqError);
          alert(`Database Error fanning out leave requests: ${reqError.message}`);
          return;
        }
        setLeaveRequests(prev => [...newRequests, ...prev]);
      } catch (e: any) {
        console.error('Failed to fan-out mandatory leave requests:', e);
      }
    }
  };

  const updateMandatoryLeave = async (id: string, updated: Partial<MandatoryLeave>) => {
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.from('mandatory_leaves').update(updated).eq('id', id);
      if (error) {
        console.error('Failed to update mandatory leave:', error);
        alert(`Database Error: ${error.message}`);
        return;
      }
      setMandatoryLeaves(prev => prev.map(m => m.id === id ? { ...m, ...updated } : m));

      const reqUpdates: any = {};
      if (updated.start_date) reqUpdates.start_date = updated.start_date;
      if (updated.end_date) reqUpdates.end_date = updated.end_date;
      if (updated.leave_type_id) reqUpdates.leave_type_id = updated.leave_type_id;
      if (updated.name) reqUpdates.note = `Company-wide mandatory leave: ${updated.name}`;

      if (Object.keys(reqUpdates).length > 0) {
        await supabase.from('leave_requests').update(reqUpdates).eq('mandatory_leave_id', id);
        setLeaveRequests(prev => prev.map(r => r.mandatory_leave_id === id ? { ...r, ...reqUpdates } : r));
      }
    } catch (e: any) {
      console.error('Failed to update mandatory leave:', e);
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

    const mult = sal.employer_cost_multiplier ?? (sal.employer_cost_pct ? Number((1 + sal.employer_cost_pct / 100).toFixed(4)) : 1.24);
    const isContractor = prof.employment_type === 'contractor';
    const totalCost = Number((sal.gross_amount * mult).toFixed(2));
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
      await supabase.from('payments').update(cleanUpdates).eq('id', id);
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

  const addSalaryBonus = async (b: Omit<SalaryBonus, 'id'>): Promise<boolean> => {
    const newB: SalaryBonus = { ...b, id: generateUUID() };
    setSalaryBonuses(prev => [...prev, newB]);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.from('salary_bonuses').insert(newB);
      if (error) {
        console.error('Failed to insert salary bonus:', error);
        alert(`Database Error: ${error.message}`);
        setSalaryBonuses(prev => prev.filter(x => x.id !== newB.id));
        return false;
      }
      return true;
    } catch (e) {
      console.error('Exception inserting salary bonus:', e);
      return false;
    }
  };

  const updateSalaryBonus = async (id: string, updates: Partial<SalaryBonus>): Promise<boolean> => {
    setSalaryBonuses(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b));
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.from('salary_bonuses').update(updates).eq('id', id);
      if (error) {
        console.error('Failed to update salary bonus:', error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      return true;
    } catch (e) {
      console.error('Exception updating salary bonus:', e);
      return false;
    }
  };

  const deleteSalaryBonus = async (id: string): Promise<boolean> => {
    setSalaryBonuses(prev => prev.filter(b => b.id !== id));
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.from('salary_bonuses').delete().eq('id', id);
      if (error) {
        console.error('Failed to delete salary bonus:', error);
        alert(`Database Error: ${error.message}`);
        return false;
      }
      return true;
    } catch (e) {
      console.error('Exception deleting salary bonus:', e);
      return false;
    }
  };

  const addSalaryRecord = async (rec: Omit<SalaryRecord, 'id'>) => {
    const newSal: SalaryRecord = { ...rec, id: generateUUID() };
    const supabase = getSupabaseBrowserClient();

    // Never edit in place. A raise = close the old row, add a new one.
    const oldSal = salaries.find(s => s.profile_id === rec.profile_id && !s.valid_to);
    if (oldSal) {
      const closeDate = rec.valid_from;
      setSalaries(prev => prev.map(s => s.id === oldSal.id ? { ...s, valid_to: closeDate } : s));
      try {
        await supabase.from('salary_history').update({ valid_to: closeDate }).eq('id', oldSal.id);
      } catch (e) {
        console.error('Failed to close old salary record in database:', e);
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
      const sal = salaries.find(s => s.profile_id === p.id && !s.valid_to);
      if (!sal) return;

      if (p.employment_type === 'contractor') {
        const pt = paymentTypes.find(t => t.code === 'contractor_invoice');
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
        const ptSalary = paymentTypes.find(t => t.code === 'salary');
        const mult = sal.employer_cost_multiplier ?? (sal.employer_cost_pct ? Number((1 + sal.employer_cost_pct / 100).toFixed(4)) : 1.24);
        
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

        // Recurring monthly bonuses defined on the salary contract — auto-generated each period
        const ptBonus = paymentTypes.find(t => t.code === 'bonus');
        if (ptBonus) {
          const activeMonthlyBonuses = salaryBonuses.filter(b =>
            b.profile_id === p.id && b.status === 'active' && b.kind === 'recurring' &&
            b.frequency === 'monthly' &&
            (!b.start_period || b.start_period <= period) &&
            (!b.end_period || b.end_period >= period)
          );
          activeMonthlyBonuses.forEach(b => {
            const duplicateBonus = payments.some(exist =>
              exist.profile_id === p.id && exist.payment_type_id === ptBonus.id &&
              exist.period === period && exist.note === `Bonus: ${b.name}`
            );
            if (duplicateBonus || newPays.some(n => n.profile_id === p.id && n.payment_type_id === ptBonus.id && n.note === `Bonus: ${b.name}`)) return;
            const bonusAmount = Number(b.amount);
            const bonusTotalCost = Number((bonusAmount * mult).toFixed(2));
            const bonusEmployer = Number((bonusTotalCost - bonusAmount).toFixed(2));
            const bonusNet = Number((bonusAmount * 0.72).toFixed(2));
            newPays.push({
              id: generateUUID(),
              profile_id: p.id,
              period,
              payment_type_id: ptBonus.id,
              payment_type: ptBonus,
              gross: bonusAmount,
              net: bonusNet,
              employer_contributions: bonusEmployer,
              total_cost: bonusTotalCost,
              payment_date: `${period}-28`,
              status: 'planned',
              note: `Bonus: ${b.name}`,
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
    } catch (e: any) {
      console.error('Failed to insert contract:', e);
    }
  };

  const updateContract = async (updated: Contract) => {
    const supabase = getSupabaseBrowserClient();
    const { counterparty, owner_profile, lines, groups, schedule, notice_deadline, ...cleanCnt } = updated as any;
    try {
      const { error, data } = await supabase.from('contracts').update(cleanCnt).eq('id', updated.id).select().single();
      if (error) {
        console.error('Failed to update contract:', error);
        alert(`Database Error: ${error.message}`);
        return;
      }
      const savedCnt = data ? { ...updated, ...data, counterparty: updated.counterparty, owner_profile: updated.owner_profile, lines: lines || [], schedule: schedule || [] } : updated;
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
        line_kind: l.line_kind || 'unit',
        role: l.role || null,
        seniority: l.seniority || null
      }));
      if (linesToInsert.length > 0) {
        await supabase.from('contract_lines').insert(linesToInsert);
      }

      const nowPeriod = new Date().toISOString().slice(0, 7);
      const { data: existingSched } = await supabase.from('contract_schedule').select('*').eq('contract_id', contractId);
      const historicalSched = (existingSched || []).filter((s: any) => s.period < nowPeriod);
      const historicalPeriods = new Set(historicalSched.map((s: any) => s.period));

      await supabase.from('contract_schedule').delete().eq('contract_id', contractId).gte('period', nowPeriod);

      const schedsToInsert = schedules
        .filter(s => !historicalPeriods.has(s.period))
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
      const finalSchedule = [...historicalSched, ...schedsToInsert].sort((a, b) => a.period.localeCompare(b.period));

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

      const newCp: Counterparty = {
        ...(data || row),
        attio_link,
        contacts: [],
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
      const { attio_link, contacts, derived_role, ...cleanRow } = cp as any;
      await supabase.from('counterparties').update(cleanRow).eq('id', cp.id);
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
      syncSlackStatus(newDay.profile_id, newDay.date);
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
  const setProfileRole = async (profileId: string, jobRoleId: string | null, seniorityId: string | null, validFrom: string): Promise<boolean> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const closeDate = (() => { const d = new Date(validFrom + 'T00:00:00'); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
      const openRows = profileRoleHistory.filter(h => h.profile_id === profileId && !h.valid_to);
      for (const h of openRows) {
        await supabase.from('profile_role_history').update({ valid_to: closeDate }).eq('id', h.id);
      }
      if (jobRoleId && seniorityId) {
        await supabase.from('profile_role_history').insert({
          id: generateUUID(), profile_id: profileId, job_role_id: jobRoleId, seniority_id: seniorityId, valid_from: validFrom, valid_to: null
        });
      }
      const { data } = await supabase.from('profile_role_history').select('*').eq('profile_id', profileId);
      setProfileRoleHistory(prev => [...prev.filter(h => h.profile_id !== profileId), ...((data || []) as ProfileRoleHistory[])]);
      return true;
    } catch (e: any) { console.error('setProfileRole error:', e); alert(`Database Error: ${e.message}`); return false; }
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
    const row = { id: p.id || generateUUID(), contract_id: p.contract_id || null, name: p.name, code: p.code || null, status: p.status || 'active', owner_profile_id: p.owner_profile_id || null, default_billable: p.default_billable !== false, budget_hours: p.budget_hours ?? null, budget_value: p.budget_value ?? null, starts_on: p.starts_on || null, ends_on: p.ends_on || null };
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

  const addInvoice = async (inv: Omit<Invoice, 'id' | 'created_at' | 'counterparty' | 'contract' | 'documents' | 'payments' | 'allocations'>): Promise<Invoice | null> => {
    const id = generateUUID();
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

      const { error } = await supabase.from('invoices').update(payload).eq('id', id);
      if (error) {
        console.error("Supabase update invoice error:", error.message);
        alert(`Database Error updating invoice: ${error.message}`);
        setInvoices(previousInvoices);
        return false;
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
        supabase.from('employee_integrations').select('*'),
        supabase.from('integration_exemptions').select('*'),
        supabase.from('integration_settings').select('*'),
      ]);
      const mine = ((integRows || []) as EmployeeIntegration[]).find(i => i.provider === 'slack') || null;
      setEmployeeIntegrations((integRows || []) as EmployeeIntegration[]);
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

  return (
    <AuthContext.Provider value={{
      currentUser,
      isViewAsEmployee,
      setIsViewAsEmployee,
      realUserRole,
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
      counterparties,
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
      documentTypes,
      addDocumentType,
      updateDocumentType,
      deleteDocumentType,
      employeeContracts,
      addEmployeeContract,
      updateEmployeeContract,
      salaryBonuses,
      addSalaryBonus,
      updateSalaryBonus,
      deleteSalaryBonus,
      addSalaryRecord,
      updateSalaryRecord,
      addContract,
      updateContract,
      deleteContract,
      addCounterparty,
      updateCounterparty,
      deleteCounterparty,
      deleteAllCounterparties,
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
      editLeaveRequest,
      requestLeaveCancellation,
      decideLeaveCancellation,
      deleteLeaveRequest,
      splitAndAddLeaveRequest,
      addTeam,
      updateTeam,
      deleteTeam,
      addLeaveType,
      updateLeaveType,
      deleteLeaveType,
      getEmployeeLeaveBalance,
      addInvoice,
      updateInvoice,
      deleteInvoice,
      updateInvoiceStatus,
      recordInvoicePayment,
      addInvoiceDocument,
      saveInvoiceAllocation,
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
      revokeSlackConnection
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
