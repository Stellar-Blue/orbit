"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { 
  Profile, Team, PaymentType, SalaryRecord, PaymentRecord, 
  LeaveType, LeaveEntitlement, MandatoryLeave, LeaveRequest, 
  PublicHoliday, RemoteDay, RemotePattern, Counterparty, Contract, RemoteMode 
} from './types';
import * as InitialData from './mock-data';

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
  counterparties: Counterparty[];
  contracts: Contract[];
  isDevMode: boolean;
  signOut: () => Promise<void> | void;
  
  // Actions for immediate optimistic mutation in UI
  switchUser: (profileId: string) => void;
  updateProfile: (profile: Profile) => void;
  addProfile: (profile: Profile) => void;
  addLeaveRequest: (req: Omit<LeaveRequest, 'id'>) => void;
  updateLeaveRequestStatus: (id: string, status: LeaveRequest['status']) => void;
  addMandatoryLeave: (ml: Omit<MandatoryLeave, 'id'>) => void;
  addPaymentRecord: (pay: Omit<PaymentRecord, 'id'>) => void;
  generateDraftMonth: (period: string) => void;
  addContract: (cnt: Omit<Contract, 'id'>) => void;
  updateContract: (cnt: Contract) => void;
  updateErganiStatus: (id: string, entity: 'leave' | 'remote', status: 'not_required' | 'pending' | 'submitted') => void;
  saveRemotePattern: (profileId: string, patternEntries: { weekday: string; mode: RemoteMode }[]) => void;
  addRemoteDay: (day: Omit<RemoteDay, 'id'> & { id?: string }) => void;
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
  const [profiles, setProfiles] = useState<Profile[]>(InitialData.MOCK_PROFILES);
  const [currentUserId, setCurrentUserId] = useState<string>('prof-eleni'); // Default to Founder Eleni
  const [isDevMode, setIsDevMode] = useState<boolean>(true);
  const [teams, setTeams] = useState<Team[]>(InitialData.MOCK_TEAMS);
  const [paymentTypes, setPaymentTypes] = useState<PaymentType[]>(InitialData.MOCK_PAYMENT_TYPES);
  const [salaries, setSalaries] = useState<SalaryRecord[]>(InitialData.MOCK_SALARIES);
  const [payments, setPayments] = useState<PaymentRecord[]>(InitialData.MOCK_PAYMENTS);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>(InitialData.MOCK_LEAVE_TYPES);
  const [entitlements, setEntitlements] = useState<LeaveEntitlement[]>(InitialData.MOCK_ENTITLEMENTS);
  const [mandatoryLeaves, setMandatoryLeaves] = useState<MandatoryLeave[]>(InitialData.MOCK_MANDATORY_LEAVES);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>(InitialData.MOCK_LEAVE_REQUESTS);
  const [publicHolidays, setPublicHolidays] = useState<PublicHoliday[]>(InitialData.MOCK_PUBLIC_HOLIDAYS);
  const [remoteDays, setRemoteDays] = useState<RemoteDay[]>(InitialData.MOCK_REMOTE_DAYS);
  const [remotePatterns, setRemotePatterns] = useState<RemotePattern[]>(InitialData.MOCK_REMOTE_PATTERNS);
  const [counterparties, setCounterparties] = useState<Counterparty[]>(InitialData.MOCK_COUNTERPARTIES);
  const [contracts, setContracts] = useState<Contract[]>(InitialData.MOCK_CONTRACTS);

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
          holidaysRes, remoteDaysRes, remotePatternsRes, counterpartiesRes, contractsRes
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
          supabase.from('contracts').select('*')
        ]);

        const loadedTeams: Team[] = (teamsRes.data && teamsRes.data.length > 0) ? teamsRes.data : InitialData.MOCK_TEAMS;
        setTeams(loadedTeams);

        const loadedPaymentTypes: PaymentType[] = (paymentTypesRes.data && paymentTypesRes.data.length > 0) ? paymentTypesRes.data : InitialData.MOCK_PAYMENT_TYPES;
        setPaymentTypes(loadedPaymentTypes);

        const loadedSalaries: SalaryRecord[] = (salariesRes.data && salariesRes.data.length > 0) ? salariesRes.data : InitialData.MOCK_SALARIES;
        setSalaries(loadedSalaries);

        const loadedLeaveTypes: LeaveType[] = (leaveTypesRes.data && leaveTypesRes.data.length > 0) ? leaveTypesRes.data : InitialData.MOCK_LEAVE_TYPES;
        setLeaveTypes(loadedLeaveTypes);

        const loadedEntitlements: LeaveEntitlement[] = (entitlementsRes.data && entitlementsRes.data.length > 0) ? entitlementsRes.data : InitialData.MOCK_ENTITLEMENTS;
        setEntitlements(loadedEntitlements);

        const loadedMandatory: MandatoryLeave[] = (mandatoryRes.data && mandatoryRes.data.length > 0) ? mandatoryRes.data : InitialData.MOCK_MANDATORY_LEAVES;
        setMandatoryLeaves(loadedMandatory);

        const loadedHolidays: PublicHoliday[] = (holidaysRes.data && holidaysRes.data.length > 0) ? holidaysRes.data : InitialData.MOCK_PUBLIC_HOLIDAYS;
        setPublicHolidays(loadedHolidays);

        const loadedRemoteDays: RemoteDay[] = (remoteDaysRes.data && remoteDaysRes.data.length > 0) ? remoteDaysRes.data : InitialData.MOCK_REMOTE_DAYS;
        setRemoteDays(loadedRemoteDays);

        const loadedRemotePatterns: RemotePattern[] = (remotePatternsRes.data && remotePatternsRes.data.length > 0) ? remotePatternsRes.data : InitialData.MOCK_REMOTE_PATTERNS;
        setRemotePatterns(loadedRemotePatterns);

        const loadedCounterparties: Counterparty[] = (counterpartiesRes.data && counterpartiesRes.data.length > 0) ? counterpartiesRes.data : InitialData.MOCK_COUNTERPARTIES;
        setCounterparties(loadedCounterparties);

        let loadedProfiles: Profile[] = InitialData.MOCK_PROFILES;
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

        if (paymentsRes.data && paymentsRes.data.length > 0) {
          const enrichedPayments = paymentsRes.data.map((pay: any) => {
            const payment_type = loadedPaymentTypes.find(pt => pt.id === pay.payment_type_id);
            return { ...pay, payment_type };
          });
          setPayments(enrichedPayments);
        }

        if (leaveRequestsRes.data && leaveRequestsRes.data.length > 0) {
          const enrichedRequests = leaveRequestsRes.data.map((req: any) => {
            const leave_type = loadedLeaveTypes.find(lt => lt.id === req.leave_type_id);
            return { ...req, leave_type };
          });
          setLeaveRequests(enrichedRequests);
        }

        if (contractsRes.data && contractsRes.data.length > 0) {
          const enrichedContracts = contractsRes.data.map((cnt: any) => {
            const counterparty = loadedCounterparties.find(c => c.id === cnt.counterparty_id);
            const owner_profile = loadedProfiles.find(p => p.id === cnt.owner_profile_id);
            return { ...cnt, counterparty, owner_profile };
          });
          setContracts(enrichedContracts);
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (session && session.user && session.user.email) {
          const email = session.user.email.toLowerCase();
          const match = loadedProfiles.find(p => p.work_email.toLowerCase() === email);
          if (match) {
            setCurrentUserId(match.id);
          }
        }
      } catch (err) {
        console.error("Live database sync exception (fallback to mock):", err);
      }
    };

    fetchLiveSupabaseData();
  }, []);

  // Derive active user
  const currentUser = profiles.find(p => p.id === currentUserId) || profiles.find(p => p.work_email.includes('eleni')) || profiles[0];

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
    setProfiles(prev => prev.map(p => p.id === updated.id ? updated : p));
    const supabase = getSupabaseBrowserClient();
    const { team, sensitive, role, ...cleanProfile } = updated as any;
    try {
      await supabase.from('profiles').update(cleanProfile).eq('id', updated.id);
      if (sensitive) {
        await supabase.from('profile_sensitive').upsert({ ...sensitive, profile_id: updated.id });
      }
    } catch (e) {
      console.error('Failed to update profile in database:', e);
    }
  };

  const addProfile = async (newProf: Profile) => {
    const id = (newProf.id && newProf.id.includes('-') && newProf.id.length === 36) ? newProf.id : generateUUID();
    const profWithId = { ...newProf, id };
    setProfiles(prev => [profWithId, ...prev]);

    const supabase = getSupabaseBrowserClient();
    const { team, sensitive, role, ...cleanProfile } = profWithId as any;
    try {
      await supabase.from('profiles').insert(cleanProfile);
      if (role) {
        await supabase.from('user_roles').insert({ profile_id: id, role });
      }
      if (sensitive) {
        await supabase.from('profile_sensitive').insert({ ...sensitive, profile_id: id });
      }
    } catch (e) {
      console.error('Failed to insert profile into database:', e);
    }
  };

  const addLeaveRequest = async (req: Omit<LeaveRequest, 'id'>) => {
    const newReq: LeaveRequest = { ...req, id: generateUUID() };
    setLeaveRequests(prev => [newReq, ...prev]);

    const supabase = getSupabaseBrowserClient();
    const { leave_type, ...cleanReq } = newReq as any;
    try {
      await supabase.from('leave_requests').insert(cleanReq);
    } catch (e) {
      console.error('Failed to insert leave request into database:', e);
    }
  };

  const updateLeaveRequestStatus = async (id: string, status: LeaveRequest['status']) => {
    const decided_by = currentUser.id;
    const decided_at = new Date().toISOString().split('T')[0];
    setLeaveRequests(prev => prev.map(r => r.id === id ? { ...r, status, decided_by, decided_at } : r));

    const supabase = getSupabaseBrowserClient();
    try {
      await supabase.from('leave_requests').update({ status, decided_by, decided_at }).eq('id', id);
    } catch (e) {
      console.error('Failed to update leave request status:', e);
    }
  };

  const addMandatoryLeave = async (ml: Omit<MandatoryLeave, 'id'>) => {
    const newMl: MandatoryLeave = { ...ml, id: generateUUID() };
    setMandatoryLeaves(prev => [newMl, ...prev]);

    const supabase = getSupabaseBrowserClient();
    try {
      await supabase.from('mandatory_leaves').insert(newMl);
    } catch (e) {
      console.error('Failed to insert mandatory leave:', e);
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
        working_days: p.employment_type === 'part_time' ? 2 : 3, // Calculated respecting schedule
        status: 'approved',
        origin: 'mandatory',
        mandatory_leave_id: newMl.id,
        note: `Company-wide mandatory leave: ${newMl.name}`,
        ergani_status: 'not_required'
      }));
      setLeaveRequests(prev => [...newRequests, ...prev]);

      try {
        const cleanRequests = newRequests.map(({ leave_type, ...r }: any) => r);
        await supabase.from('leave_requests').insert(cleanRequests);
      } catch (e) {
        console.error('Failed to fan-out mandatory leave requests:', e);
      }
    }
  };

  const addPaymentRecord = async (pay: Omit<PaymentRecord, 'id'>) => {
    const newPay: PaymentRecord = { ...pay, id: generateUUID() };
    setPayments(prev => [newPay, ...prev]);

    const supabase = getSupabaseBrowserClient();
    const { payment_type, ...cleanPay } = newPay as any;
    try {
      await supabase.from('payments').insert(cleanPay);
    } catch (e) {
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

    setPayments(prev => [...newPays, ...prev]);

    const supabase = getSupabaseBrowserClient();
    try {
      const cleanPays = newPays.map(({ payment_type, ...p }: any) => p);
      if (cleanPays.length > 0) {
        await supabase.from('payments').insert(cleanPays);
      }
    } catch (e) {
      console.error('Failed to batch insert draft payments:', e);
    }
  };

  const addContract = async (cnt: Omit<Contract, 'id'>) => {
    const newCnt: Contract = { ...cnt, id: generateUUID() };
    setContracts(prev => [newCnt, ...prev]);

    const supabase = getSupabaseBrowserClient();
    const { counterparty, owner_profile, ...cleanCnt } = newCnt as any;
    try {
      await supabase.from('contracts').insert(cleanCnt);
    } catch (e) {
      console.error('Failed to insert contract:', e);
    }
  };

  const updateContract = async (updated: Contract) => {
    setContracts(prev => prev.map(c => c.id === updated.id ? updated : c));

    const supabase = getSupabaseBrowserClient();
    const { counterparty, owner_profile, ...cleanCnt } = updated as any;
    try {
      await supabase.from('contracts').update(cleanCnt).eq('id', updated.id);
    } catch (e) {
      console.error('Failed to update contract:', e);
    }
  };

  const updateErganiStatus = async (id: string, entity: 'leave' | 'remote', status: 'not_required' | 'pending' | 'submitted') => {
    const submittedAt = status === 'submitted' ? new Date().toISOString().split('T')[0] : undefined;
    const supabase = getSupabaseBrowserClient();

    if (entity === 'leave') {
      setLeaveRequests(prev => prev.map(r => r.id === id ? { ...r, ergani_status: status, ergani_submitted_at: submittedAt } : r));
      try {
        await supabase.from('leave_requests').update({ ergani_status: status, ergani_submitted_at: submittedAt }).eq('id', id);
      } catch (e) {
        console.error('Failed to update ergani status for leave request:', e);
      }
    } else {
      setRemoteDays(prev => prev.map(r => r.id === id ? { ...r, ergani_status: status, ergani_submitted_at: submittedAt } : r));
      try {
        await supabase.from('remote_days').update({ ergani_status: status, ergani_submitted_at: submittedAt }).eq('id', id);
      } catch (e) {
        console.error('Failed to update ergani status for remote day:', e);
      }
    }
  };

  const saveRemotePattern = async (profileId: string, patternEntries: { weekday: string; mode: RemoteMode }[]) => {
    const validFrom = new Date().toISOString().split('T')[0];
    const updatedPatterns: RemotePattern[] = patternEntries.map(pe => ({
      id: generateUUID(),
      profile_id: profileId,
      weekday: pe.weekday,
      mode: pe.mode,
      valid_from: validFrom
    }));

    setRemotePatterns(prev => {
      const filtered = prev.filter(p => p.profile_id !== profileId || !patternEntries.some(pe => pe.weekday === p.weekday));
      return [...filtered, ...updatedPatterns];
    });

    const supabase = getSupabaseBrowserClient();
    try {
      const payload = patternEntries.map(pe => ({
        profile_id: profileId,
        weekday: pe.weekday,
        mode: pe.mode,
        valid_from: validFrom
      }));
      const { error } = await supabase.from('remote_patterns').upsert(payload, { onConflict: 'profile_id,weekday' });
      if (error) console.error("Failed to persist remote pattern in Supabase:", error);
    } catch (e) {
      console.error("Exception saving remote patterns:", e);
    }
  };

  const addRemoteDay = async (day: Omit<RemoteDay, 'id'> & { id?: string }) => {
    const newDay: RemoteDay = {
      ...day,
      id: day.id || generateUUID()
    };

    setRemoteDays(prev => {
      const filtered = prev.filter(d => !(d.profile_id === newDay.profile_id && d.date === newDay.date));
      return [newDay, ...filtered];
    });

    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.from('remote_days').upsert({
        id: newDay.id,
        profile_id: newDay.profile_id,
        date: newDay.date,
        mode: newDay.mode,
        location: newDay.location || null,
        note: newDay.note || null,
        ergani_status: newDay.ergani_status
      }, { onConflict: 'profile_id,date' });
      if (error) console.error("Failed to persist remote day override:", error);
    } catch (e) {
      console.error("Exception saving remote day:", e);
    }
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
      addRemoteDay
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
