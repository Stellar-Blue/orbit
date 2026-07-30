"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { 
  Profile, Team, PaymentType, SalaryRecord, PaymentRecord, 
  LeaveType, LeaveEntitlement, MandatoryLeave, LeaveRequest, 
  PublicHoliday, RemoteDay, RemotePattern, Counterparty, Contract 
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
}

const AuthContext = createContext<AppState | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const [profiles, setProfiles] = useState<Profile[]>(InitialData.MOCK_PROFILES);
  const [currentUserId, setCurrentUserId] = useState<string>('prof-eleni'); // Default to Founder Eleni
  const [isDevMode, setIsDevMode] = useState<boolean>(true);
  const [teams] = useState<Team[]>(InitialData.MOCK_TEAMS);
  const [paymentTypes] = useState<PaymentType[]>(InitialData.MOCK_PAYMENT_TYPES);
  const [salaries] = useState<SalaryRecord[]>(InitialData.MOCK_SALARIES);
  const [payments, setPayments] = useState<PaymentRecord[]>(InitialData.MOCK_PAYMENTS);
  const [leaveTypes] = useState<LeaveType[]>(InitialData.MOCK_LEAVE_TYPES);
  const [entitlements, setEntitlements] = useState<LeaveEntitlement[]>(InitialData.MOCK_ENTITLEMENTS);
  const [mandatoryLeaves, setMandatoryLeaves] = useState<MandatoryLeave[]>(InitialData.MOCK_MANDATORY_LEAVES);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>(InitialData.MOCK_LEAVE_REQUESTS);
  const [publicHolidays] = useState<PublicHoliday[]>(InitialData.MOCK_PUBLIC_HOLIDAYS);
  const [remoteDays, setRemoteDays] = useState<RemoteDay[]>(InitialData.MOCK_REMOTE_DAYS);
  const [remotePatterns, setRemotePatterns] = useState<RemotePattern[]>(InitialData.MOCK_REMOTE_PATTERNS);
  const [counterparties] = useState<Counterparty[]>(InitialData.MOCK_COUNTERPARTIES);
  const [contracts, setContracts] = useState<Contract[]>(InitialData.MOCK_CONTRACTS);

  useEffect(() => {
    // Detect environment: local dev mode vs production / Vercel cloud
    const isLocal = typeof window !== 'undefined' && 
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    
    setIsDevMode(isLocal && process.env.NODE_ENV !== 'production');

    // Attempt to read live Supabase session to bind currentUser to authenticated employee profile
    const fetchRealAuthSession = async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (session && session.user && session.user.email) {
          const email = session.user.email.toLowerCase();
          const match = profiles.find(p => p.work_email.toLowerCase() === email);
          if (match) {
            setCurrentUserId(match.id);
          }
        }
      } catch (err) {
        console.error("Session evaluation notice:", err);
      }
    };

    fetchRealAuthSession();
  }, [profiles]);

  // Derive active user
  const currentUser = profiles.find(p => p.id === currentUserId) || profiles[0];

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

  const updateProfile = (updated: Profile) => {
    setProfiles(prev => prev.map(p => p.id === updated.id ? updated : p));
  };

  const addProfile = (newProf: Profile) => {
    setProfiles(prev => [newProf, ...prev]);
  };

  const addLeaveRequest = (req: Omit<LeaveRequest, 'id'>) => {
    const newReq: LeaveRequest = { ...req, id: `lr-${Date.now()}` };
    setLeaveRequests(prev => [newReq, ...prev]);
  };

  const updateLeaveRequestStatus = (id: string, status: LeaveRequest['status']) => {
    setLeaveRequests(prev => prev.map(r => r.id === id ? { ...r, status } : r));
  };

  const addMandatoryLeave = (ml: Omit<MandatoryLeave, 'id'>) => {
    const newMl: MandatoryLeave = { ...ml, id: `ml-${Date.now()}` };
    setMandatoryLeaves(prev => [newMl, ...prev]);

    // Perform Idempotent Fan-out to all active non-contractors!
    if (newMl.status === 'published') {
      const eligible = profiles.filter(p => p.status === 'active' && p.employment_type !== 'contractor');
      const newRequests: LeaveRequest[] = eligible.map(p => ({
        id: `lr-mandatory-${p.id}-${Date.now()}`,
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
    }
  };

  const addPaymentRecord = (pay: Omit<PaymentRecord, 'id'>) => {
    const newPay: PaymentRecord = { ...pay, id: `pay-${Date.now()}` };
    setPayments(prev => [newPay, ...prev]);
  };

  const generateDraftMonth = (period: string) => {
    // Generate draft rows in < 5 mins for all active staff
    const activeStaff = profiles.filter(p => p.status === 'active');
    const newPays: PaymentRecord[] = [];

    activeStaff.forEach(p => {
      const sal = salaries.find(s => s.profile_id === p.id && !s.valid_to);
      if (!sal) return;

      if (p.employment_type === 'contractor') {
        const pt = paymentTypes.find(pt => pt.code === 'contractor_invoice');
        if (pt) {
          newPays.push({
            id: `draft-${p.id}-${period}-${pt.code}`,
            profile_id: p.id,
            period,
            payment_type_id: pt.id,
            gross: sal.gross_amount,
            net: sal.gross_amount,
            employer_contributions: 0,
            total_cost: sal.gross_amount,
            payment_date: `${period}-28`,
            status: 'planned'
          });
        }
      } else {
        const pt = paymentTypes.find(pt => pt.code === 'salary');
        const employerContributions = sal.employer_cost_pct ? Number((sal.gross_amount * (sal.employer_cost_pct / 100)).toFixed(2)) : 0;
        const net = Number((sal.gross_amount * 0.72).toFixed(2)); // approximate net for display
        if (pt) {
          newPays.push({
            id: `draft-${p.id}-${period}-${pt.code}`,
            profile_id: p.id,
            period,
            payment_type_id: pt.id,
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
  };

  const addContract = (cnt: Omit<Contract, 'id'>) => {
    const newCnt: Contract = { ...cnt, id: `cnt-${Date.now()}` };
    setContracts(prev => [newCnt, ...prev]);
  };

  const updateContract = (updated: Contract) => {
    setContracts(prev => prev.map(c => c.id === updated.id ? updated : c));
  };

  const updateErganiStatus = (id: string, entity: 'leave' | 'remote', status: 'not_required' | 'pending' | 'submitted') => {
    if (entity === 'leave') {
      setLeaveRequests(prev => prev.map(r => r.id === id ? { ...r, ergani_status: status, ergani_submitted_at: status === 'submitted' ? new Date().toISOString().split('T')[0] : undefined } : r));
    } else {
      setRemoteDays(prev => prev.map(r => r.id === id ? { ...r, ergani_status: status, ergani_submitted_at: status === 'submitted' ? new Date().toISOString().split('T')[0] : undefined } : r));
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
      updateErganiStatus
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
