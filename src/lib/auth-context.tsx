"use client";

import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { 
  Profile, Team, PaymentType, SalaryRecord, PaymentRecord, PaymentDocument, 
  LeaveType, LeaveEntitlement, MandatoryLeave, LeaveRequest, 
  PublicHoliday, RemoteDay, RemotePattern, Counterparty, Contract, RemoteMode, RemotePolicy, RemoteAmendmentRequest,
  CatalogModule, CatalogItem, ContractLine, ContractSchedule, AttioLink, AttioEvent, CounterpartyContact,
  Invoice, InvoiceCategory, InvoiceDocument, InvoicePayment, InvoiceAllocation
} from './types';

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
  counterparties: Counterparty[];
  attioEvents: AttioEvent[];
  contracts: Contract[];
  catalogModules: CatalogModule[];
  catalogItems: CatalogItem[];
  contractLines: ContractLine[];
  contractSchedules: ContractSchedule[];
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
  addProfile: (profile: Profile) => void;
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
  deletePaymentDocument: (paymentId: string, documentId: string) => void;
  generateDraftMonth: (period: string) => Promise<void>;
  addPaymentType: (type: Omit<PaymentType, 'id' | 'sort_order'>) => Promise<void>;
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
  addCounterpartyContact: (contact: Partial<CounterpartyContact>) => Promise<boolean>;
  updateErganiStatus: (id: string, entity: 'leave' | 'remote', status: 'not_required' | 'pending' | 'submitted' | 'needs_amendment') => void;
  saveRemotePattern: (profileId: string, patternEntries: { weekday: string; mode: RemoteMode }[]) => Promise<boolean>;
  updateRemotePolicy: (id: string, updated: Partial<RemotePolicy>) => Promise<void>;
  addRemoteDay: (day: Omit<RemoteDay, 'id'> & { id?: string }) => void;
  bulkAddRemoteDays: (profileId: string, declarations: { date: string; mode: RemoteMode | 'office'; location?: string; note?: string }[]) => Promise<boolean>;
  requestRemoteAmendment: (payload: { date: string; requested_mode: RemoteMode | 'office'; reason: string; location?: string }) => Promise<boolean>;
  decideRemoteAmendment: (id: string, status: 'approved' | 'rejected') => Promise<boolean>;
  editLeaveRequest: (id: string, updated: Partial<LeaveRequest>, editReason?: string) => void;
  requestLeaveCancellation: (id: string) => void;
  decideLeaveCancellation: (id: string, approve: boolean) => void;
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
  saveContractPricing: (contractId: string, lines: Omit<ContractLine, 'id' | 'contract_id'>[], schedules: { period: string; amount: number }[], discount_pct: number, term_years: number, service_start_date: string, calculatedValue: number) => Promise<boolean>;
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
  const [remotePatterns, setRemotePatterns] = useState<RemotePattern[]>([]);
  const [remotePolicies, setRemotePolicies] = useState<RemotePolicy[]>([]);
  const [remoteAmendmentRequests, setRemoteAmendmentRequests] = useState<RemoteAmendmentRequest[]>([]);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [attioEvents, setAttioEvents] = useState<AttioEvent[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [catalogModules, setCatalogModules] = useState<CatalogModule[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [contractLines, setContractLines] = useState<ContractLine[]>([]);
  const [contractSchedules, setContractSchedules] = useState<ContractSchedule[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoiceCategories, setInvoiceCategories] = useState<InvoiceCategory[]>([]);
  const [invoiceDocuments, setInvoiceDocuments] = useState<InvoiceDocument[]>([]);
  const [invoicePayments, setInvoicePayments] = useState<InvoicePayment[]>([]);
  const [invoiceAllocations, setInvoiceAllocations] = useState<InvoiceAllocation[]>([]);

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
          holidaysRes, remoteDaysRes, remotePatternsRes, counterpartiesRes, contractsRes, remotePoliciesRes,
          catalogModulesRes, catalogItemsRes, contractLinesRes, contractScheduleRes, attioLinksRes, cpContactsRes, attioEventsRes
        ] = await Promise.all([
          supabase.from('teams').select('*'),
          supabase.from('profiles').select('*'),
          supabase.from('user_roles').select('*'),
          supabase.from('profile_sensitive').select('*'),
          supabase.from('payment_types').select('*').order('sort_order', { ascending: true }),
          supabase.from('salary_history').select('*'),
          supabase.from('payments').select('*'),
          supabase.from('leave_types').select('*'),
          supabase.from('leave_entitlements').select('*'),
          supabase.from('mandatory_leaves').select('*'),
          supabase.from('leave_requests').select('*'),
          supabase.from('public_holidays').select('*'),
          supabase.from('remote_days').select('*'),
          supabase.from('remote_patterns').select('*'),
          supabase.from('counterparties').select('*'),
          supabase.from('contracts').select('*'),
          supabase.from('remote_policies').select('*'),
          supabase.from('catalog_modules').select('*').order('sort_order', { ascending: true }),
          supabase.from('catalog_items').select('*'),
          supabase.from('contract_lines').select('*'),
          supabase.from('contract_schedule').select('*').order('period', { ascending: true }),
          supabase.from('attio_links').select('*'),
          supabase.from('counterparty_contacts').select('*'),
          supabase.from('attio_events').select('*')
        ]);

        const loadedAttioLinks: AttioLink[] = (attioLinksRes.data || []) as AttioLink[];
        const loadedContacts: CounterpartyContact[] = (cpContactsRes.data || []) as CounterpartyContact[];
        setAttioEvents((attioEventsRes.data || []) as AttioEvent[]);

        const loadedTeams: Team[] = teamsRes.data || [];
        setTeams(loadedTeams);

        const loadedPaymentTypes: PaymentType[] = paymentTypesRes.data || [];
        setPaymentTypes(loadedPaymentTypes);

        const loadedSalaries: SalaryRecord[] = salariesRes.data || [];
        setSalaries(loadedSalaries);

        const loadedLeaveTypes: LeaveType[] = leaveTypesRes.data || [];
        setLeaveTypes(loadedLeaveTypes);

        const loadedEntitlements: LeaveEntitlement[] = entitlementsRes.data || [];
        setEntitlements(loadedEntitlements);

        const loadedMandatory: MandatoryLeave[] = mandatoryRes.data || [];
        setMandatoryLeaves(loadedMandatory);

        const loadedHolidays: PublicHoliday[] = holidaysRes.data || [];
        setPublicHolidays(loadedHolidays);

        const loadedRemoteDays: RemoteDay[] = remoteDaysRes.data || [];
        setRemoteDays(loadedRemoteDays);

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
          return { ...pay, payment_type };
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
          return { ...cp, attio_link, contacts, derived_role };
        });
        setCounterparties(enrichedCounterparties);

        const enrichedContracts = (contractsRes.data || []).map((cnt: any) => {
          const counterparty = enrichedCounterparties.find(c => c.id === cnt.counterparty_id);
          const owner_profile = loadedProfiles.find(p => p.id === cnt.owner_profile_id);
          const lines = loadedContractLines.filter(l => l.contract_id === cnt.id);
          const schedule = loadedContractSchedules.filter(s => s.contract_id === cnt.id);
          return { ...cnt, counterparty, owner_profile, lines, schedule };
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
          const loadedDocs: InvoiceDocument[] = docRes.data || [];
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
      if (sensitive) {
        await supabase.from('profile_sensitive').upsert({ ...sensitive, profile_id: updated.id });
      }
      setProfiles(prev => prev.map(p => p.id === updated.id ? updated : p));
    } catch (e: any) {
      console.error('Failed to update profile in database:', e);
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
    const newReq: LeaveRequest = { ...req, id: generateUUID() };
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
    } catch (e: any) {
      console.error('Failed to decide leave cancellation:', e);
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
    const newMl: MandatoryLeave = { ...ml, id: generateUUID() };
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

  const addPaymentRecord = async (pay: Omit<PaymentRecord, 'id'>) => {
    const newPay: PaymentRecord = { ...pay, id: generateUUID() };
    const supabase = getSupabaseBrowserClient();
    const { payment_type, documents, ...cleanPay } = newPay as any;
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
      const { payment_type, documents, ...cleanUpdates } = updates as any;
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
      await supabase.from('salary_history').insert(newSal);
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

  const addPaymentDocuments = (paymentId: string, docs: PaymentDocument[]) => {
    setPayments(prev => prev.map(p => {
      if (p.id === paymentId) {
        return { ...p, documents: [...(p.documents || []), ...docs] };
      }
      return p;
    }));
  };

  const deletePaymentDocument = (paymentId: string, documentId: string) => {
    setPayments(prev => prev.map(p => {
      if (p.id === paymentId) {
        return { ...p, documents: (p.documents || []).filter(d => d.id !== documentId) };
      }
      return p;
    }));
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
      }
    });

    if (newPays.length === 0) {
      alert(`No new draft payments to generate for period ${period}! Duplicate guard active: all required salary, fee, and statutory payment rows already exist in the ledger.`);
      return;
    }

    const supabase = getSupabaseBrowserClient();
    try {
      const cleanPays = newPays.map(({ payment_type, documents, ...p }: any) => p);
      if (cleanPays.length > 0) {
        const { error } = await supabase.from('payments').insert(cleanPays);
        if (error) {
          console.error('Failed to batch insert draft payments:', error);
        }
      }
      setPayments(prev => [...newPays, ...prev]);
      alert(`Generated ${newPays.length} draft payment row(s) for period ${period}! Includes statutory allowances where applicable.`);
    } catch (e: any) {
      console.error('Failed to batch insert draft payments:', e);
    }
  };

  const addContract = async (cnt: Omit<Contract, 'id'>) => {
    const newCnt: Contract = { ...cnt, id: generateUUID() };
    const supabase = getSupabaseBrowserClient();
    const { counterparty, owner_profile, notice_deadline, lines, schedule, ...cleanCnt } = newCnt as any;
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
    const { counterparty, owner_profile, notice_deadline, lines, schedule, ...cleanCnt } = updated as any;
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
    calculatedValue: number
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
      const linesToInsert = lines.map(l => ({
        id: generateUUID(),
        contract_id: contractId,
        catalog_item_id: l.catalog_item_id || null,
        name: l.name,
        unit_price: l.unit_price,
        quantity: l.quantity,
        unit_label: l.unit_label,
        frequency: l.frequency,
        note: l.note || null
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
          let val = c.value || 0;
          if (c.billing_cadence === 'monthly') val = val * 12;
          else if (c.billing_cadence === 'quarterly') val = val * 4;
          orbit_arr += val;
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
      alert("Attio Nightly Reconciliation Job Executed Successfully!\n• All Orbit-owned rollup attributes (ARR, Active Contracts, Renewal Dates) pushed to linked CRM company records.\n• VIES validation status & drift audit verified.");
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
      setLeaveTypes(prev => [...prev, created]);
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
      setLeaveTypes(prev => prev.map(t => t.id === id ? { ...t, ...payload } : t));
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
    const companyPolicy = remotePolicies.find(p => p.scope_type === 'company');
    if (companyPolicy) {
      const quotaMaxDays = companyPolicy.max_days ?? companyPolicy.max_days_per_month ?? 8;
      const quotaPeriod = companyPolicy.period_type || 'month';

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
    } catch (e: any) {
      console.error("Exception saving remote day:", e);
    }
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
      if (error) console.error("Supabase insert invoice error:", error.message);
    } catch (e) {
      console.error(e);
    }
    return newInv;
  };

  const updateInvoice = async (id: string, updates: Partial<Invoice>): Promise<boolean> => {
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
      if (error) console.error("Supabase update invoice error:", error.message);
    } catch (e) {
      console.error("updateInvoice exception:", e);
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
    setInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, status, notes: notes !== undefined ? notes : inv.notes } : inv));
    try {
      const supabase = getSupabaseBrowserClient();
      const updatePayload: any = { status };
      if (notes !== undefined) updatePayload.notes = notes;
      await supabase.from('invoices').update(updatePayload).eq('id', id);
    } catch (e) {
      console.error(e);
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
      remotePatterns,
      remotePolicies,
      remoteAmendmentRequests,
      counterparties,
      attioEvents,
      contracts,
      catalogModules,
      catalogItems,
      contractLines,
      contractSchedules,
      invoices,
      invoiceCategories,
      invoiceDocuments,
      invoicePayments,
      invoiceAllocations,
      isDevMode,
      signOut,
      switchUser,
      updateProfile,
      addProfile,
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
      deletePaymentDocument,
      generateDraftMonth,
      addPaymentType,
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
      reassignContracts,
      addCounterpartyContact,
      saveContractPricing,
      saveCatalogModule,
      deleteCatalogModule,
      saveCatalogItem,
      deleteCatalogItem,
      updateErganiStatus,
      saveRemotePattern,
      updateRemotePolicy,
      addRemoteDay,
      bulkAddRemoteDays,
      requestRemoteAmendment,
      decideRemoteAmendment,
      editLeaveRequest,
      requestLeaveCancellation,
      decideLeaveCancellation,
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
      deleteInvoiceCategory
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
