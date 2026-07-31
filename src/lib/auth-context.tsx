"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { 
  Profile, Team, PaymentType, SalaryRecord, PaymentRecord, 
  LeaveType, LeaveEntitlement, MandatoryLeave, LeaveRequest, 
  PublicHoliday, RemoteDay, RemotePattern, Counterparty, Contract, RemoteMode, RemotePolicy, RemoteAmendmentRequest 
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
  contracts: Contract[];
  isDevMode: boolean;
  signOut: () => Promise<void> | void;
  
  // Actions for immediate optimistic mutation in UI
  switchUser: (profileId: string) => void;
  updateProfile: (profile: Profile) => void;
  addProfile: (profile: Profile) => void;
  addLeaveRequest: (req: Omit<LeaveRequest, 'id'>) => void;
  updateLeaveRequestStatus: (id: string, status: LeaveRequest['status'], rejectionReason?: string) => void;
  addMandatoryLeave: (ml: Omit<MandatoryLeave, 'id'>) => void;
  addPaymentRecord: (pay: Omit<PaymentRecord, 'id'>) => void;
  generateDraftMonth: (period: string) => void;
  addContract: (cnt: Omit<Contract, 'id'>) => void;
  updateContract: (cnt: Contract) => void;
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
  const [contracts, setContracts] = useState<Contract[]>([]);

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
          holidaysRes, remoteDaysRes, remotePatternsRes, counterpartiesRes, contractsRes, remotePoliciesRes
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
          supabase.from('remote_policies').select('*')
        ]);

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

        const enrichedContracts = (contractsRes.data || []).map((cnt: any) => {
          const counterparty = loadedCounterparties.find(c => c.id === cnt.counterparty_id);
          const owner_profile = loadedProfiles.find(p => p.id === cnt.owner_profile_id);
          return { ...cnt, counterparty, owner_profile };
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

  const currentUser = profiles.find(p => p.id === currentUserId) || profiles[0] || fallbackProfile;

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

  const addPaymentRecord = async (pay: Omit<PaymentRecord, 'id'>) => {
    const newPay: PaymentRecord = { ...pay, id: generateUUID() };
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

  const generateDraftMonth = async (period: string) => {
    const activeStaff = profiles.filter(p => p.status === 'active');
    const newPays: PaymentRecord[] = [];

    activeStaff.forEach(p => {
      const sal = salaries.find(s => s.profile_id === p.id && !s.valid_to);
      if (!sal) return;

      if (p.employment_type === 'contractor') {
        const pt = paymentTypes.find(t => t.code === 'contractor_invoice');
        if (pt) {
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
            status: 'planned'
          });
        }
      } else {
        const pt = paymentTypes.find(t => t.code === 'salary');
        const employerContributions = sal.employer_cost_pct ? Number((sal.gross_amount * (sal.employer_cost_pct / 100)).toFixed(2)) : 0;
        const net = Number((sal.gross_amount * 0.72).toFixed(2));
        if (pt) {
          newPays.push({
            id: generateUUID(),
            profile_id: p.id,
            period,
            payment_type_id: pt.id,
            payment_type: pt,
            gross: sal.gross_amount,
            net,
            employer_contributions: employerContributions,
            total_cost: Number((sal.gross_amount + employerContributions).toFixed(2)),
            payment_date: `${period}-28`,
            status: 'planned'
          });
        }
      }
    });

    const supabase = getSupabaseBrowserClient();
    try {
      const cleanPays = newPays.map(({ payment_type, ...p }: any) => p);
      if (cleanPays.length > 0) {
        const { error } = await supabase.from('payments').insert(cleanPays);
        if (error) {
          console.error('Failed to batch insert draft payments:', error);
          alert(`Database Error generating draft payments: ${error.message}`);
          return;
        }
      }
      setPayments(prev => [...newPays, ...prev]);
    } catch (e: any) {
      console.error('Failed to batch insert draft payments:', e);
    }
  };

  const addContract = async (cnt: Omit<Contract, 'id'>) => {
    const newCnt: Contract = { ...cnt, id: generateUUID() };
    const supabase = getSupabaseBrowserClient();
    const { counterparty, owner_profile, notice_deadline, ...cleanCnt } = newCnt as any;
    try {
      const { error, data } = await supabase.from('contracts').insert(cleanCnt).select().single();
      if (error) {
        console.error('Failed to insert contract:', error);
        alert(`Database Error: ${error.message}`);
        return;
      }
      const savedCnt = data ? { ...newCnt, ...data, counterparty: newCnt.counterparty, owner_profile: newCnt.owner_profile } : newCnt;
      setContracts(prev => [savedCnt, ...prev]);
    } catch (e: any) {
      console.error('Failed to insert contract:', e);
    }
  };

  const updateContract = async (updated: Contract) => {
    const supabase = getSupabaseBrowserClient();
    const { counterparty, owner_profile, notice_deadline, ...cleanCnt } = updated as any;
    try {
      const { error, data } = await supabase.from('contracts').update(cleanCnt).eq('id', updated.id).select().single();
      if (error) {
        console.error('Failed to update contract:', error);
        alert(`Database Error: ${error.message}`);
        return;
      }
      const savedCnt = data ? { ...updated, ...data, counterparty: updated.counterparty, owner_profile: updated.owner_profile } : updated;
      setContracts(prev => prev.map(c => c.id === updated.id ? savedCnt : c));
    } catch (e: any) {
      console.error('Failed to update contract:', e);
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

  return (
    <AuthContext.Provider value={{
      currentUser,
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
      contracts,
      isDevMode,
      signOut,
      switchUser,
      updateProfile,
      addProfile,
      addLeaveRequest,
      updateLeaveRequestStatus,
      addMandatoryLeave,
      addPaymentRecord,
      generateDraftMonth,
      addContract,
      updateContract,
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
      getEmployeeLeaveBalance
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
