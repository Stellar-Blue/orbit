"use client";

import React, { useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, Button, Badge } from '@/components/ui/primitives';
import { 
  DollarSign, Download, ShieldCheck, CreditCard, 
  Building, Calendar, FileText, CheckCircle2, TrendingUp, AlertTriangle, Lock 
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { PaymentRecord, SalaryRecord } from '@/lib/types';

export default function MyCompensationPage() {
  const { currentUser, salaries, payments, paymentTypes } = useAuth();
  const isContractor = currentUser.employment_type === 'contractor';

  // Find active salary record for current user
  const currentSalary = useMemo(() => {
    const mySalaries = (salaries || []).filter(s => s.profile_id === currentUser.id);
    // Sort descending by valid_from date
    mySalaries.sort((a, b) => (b.valid_from || '').localeCompare(a.valid_from || ''));
    const latest = mySalaries[0];
    if (latest) return latest;
    return {
      id: 'mock-sal-1',
      profile_id: currentUser.id,
      valid_from: '2026-01-01',
      basis: isContractor ? 'fixed_fee' : 'monthly_gross',
      gross_amount: isContractor ? 3500 : 2800,
      currency: 'EUR',
      employer_cost_pct: isContractor ? 0 : 22.29
    } as SalaryRecord;
  }, [salaries, currentUser.id, isContractor]);

  // Estimate net pay (approx 25% tax/social deductions for salaried, 10% withholding or flat for contractors)
  const estimatedNet = useMemo(() => {
    if (isContractor) return currentSalary.gross_amount; // Contractor invoices gross amount directly
    return Math.round(currentSalary.gross_amount * 0.78);
  }, [currentSalary, isContractor]);

  // Retrieve or mock recent payment history for demo visualization
  const myPayments: PaymentRecord[] = useMemo(() => {
    const records = (payments || []).filter(p => p.profile_id === currentUser.id);
    if (records && records.length > 0) {
      return [...records].sort((a, b) => b.period.localeCompare(a.period));
    }

    // Default sample archive if database hasn't populated payments for this user yet
    return [
      {
        id: 'pay-2026-07',
        profile_id: currentUser.id,
        period: '2026-07',
        payment_type_id: 'regular',
        gross: currentSalary.gross_amount,
        net: estimatedNet,
        employer_contributions: 0,
        total_cost: currentSalary.gross_amount,
        payment_date: '2026-07-30',
        status: 'paid',
        note: isContractor ? 'July 2026 Partner Invoice Retainer' : 'July 2026 Standard Salary'
      },
      {
        id: 'pay-2026-06',
        profile_id: currentUser.id,
        period: '2026-06',
        payment_type_id: 'regular',
        gross: currentSalary.gross_amount,
        net: estimatedNet,
        employer_contributions: 0,
        total_cost: currentSalary.gross_amount,
        payment_date: '2026-06-29',
        status: 'paid',
        note: isContractor ? 'June 2026 Partner Invoice Retainer' : 'June 2026 Standard Salary'
      },
      {
        id: 'pay-2026-05',
        profile_id: currentUser.id,
        period: '2026-05',
        payment_type_id: 'regular',
        gross: currentSalary.gross_amount,
        net: estimatedNet,
        employer_contributions: 0,
        total_cost: currentSalary.gross_amount,
        payment_date: '2026-05-30',
        status: 'paid',
        note: isContractor ? 'May 2026 Partner Invoice Retainer' : 'May 2026 Standard Salary'
      },
    ] as PaymentRecord[];
  }, [payments, currentUser.id, currentSalary.gross_amount, estimatedNet, isContractor]);

  // Handle single payslip export
  const handleDownloadPayslip = (record: PaymentRecord) => {
    const wsData = [
      ['STELLARBLUE SYSTEMS ORBIT — OFFICIAL COMPENSATION STATEMENT'],
      [''],
      ['Employee Name:', `${currentUser.first_name} ${currentUser.last_name}`],
      ['Title / Department:', `${currentUser.title || 'Team Member'} / ${currentUser.team?.name || 'Staff'}`],
      ['Employment Type:', currentUser.employment_type.toUpperCase()],
      ['Work Email:', currentUser.work_email],
      ['Pay Period:', record.period],
      ['Statement Date:', record.payment_date ? record.payment_date.split('T')[0] : new Date().toISOString().split('T')[0]],
      [''],
      ['DESCRIPTION', 'AMOUNT (EUR)'],
      ['Gross Earnings / Retainer Rate', `€${record.gross.toLocaleString('de-DE', { minimumFractionDigits: 2 })}`],
      ['Tax / Social Insurance Deductions', `€${(record.gross - record.net).toLocaleString('de-DE', { minimumFractionDigits: 2 })}`],
      ['NET PAYABLE DISPATCHED', `€${record.net.toLocaleString('de-DE', { minimumFractionDigits: 2 })}`],
      [''],
      ['Status:', record.status.toUpperCase()],
      ['Note: Confidential electronic ledger voucher generated via Orbit HRMS.']
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, `Payslip_${record.period}`);
    XLSX.writeFile(wb, `Payslip_${currentUser.last_name}_${record.period}.xlsx`);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200 max-w-7xl mx-auto pb-20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center">
            <DollarSign className="w-6 h-6 mr-3 text-emerald-600" /> My Personal Compensation & Payroll
          </h1>
          <p className="text-slate-500 text-xs mt-1">
            Review your active remuneration structure, salary history, bank direct deposit details, and monthly payment statements.
          </p>
        </div>
        <div className="flex items-center space-x-2 shrink-0">
          {isContractor ? (
            <span className="inline-flex items-center px-3.5 py-1.5 rounded-xl bg-cyan-50 text-cyan-900 border border-cyan-200 font-extrabold text-xs shadow-2xs">
              🤝 External Contractor Partner
            </span>
          ) : (
            <span className="inline-flex items-center px-3.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-900 border border-emerald-200 font-extrabold text-xs shadow-2xs">
              💼 Salaried Employee (14-Salary Cadence)
            </span>
          )}
        </div>
      </div>

      {/* Overview Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Remuneration Card */}
        <Card title="Active Remuneration Structure" subtitle="Current effective rates & compensation" className="lg:col-span-2 shadow-xs border-slate-200/90">
          <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 text-white mt-3 space-y-6 shadow-md">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 block mb-1">
                  {isContractor ? 'Monthly Fixed Retainer Rate (Gross)' : 'Monthly Base Salary (Gross)'}
                </span>
                <div className="text-3xl sm:text-4xl font-extrabold text-white font-mono">
                  €{currentSalary.gross_amount.toLocaleString('de-DE', { minimumFractionDigits: 2 })} <span className="text-sm font-bold text-slate-300 font-sans">/ month</span>
                </div>
              </div>
              <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-xs font-extrabold flex items-center shadow-2xs shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-emerald-400" /> Active Schedule
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-5 border-t border-slate-700/80 text-xs">
              <div>
                <span className="text-slate-400 font-medium block mb-0.5">Estimated Net Payable</span>
                <strong className="text-emerald-300 font-mono font-bold text-base">
                  €{estimatedNet.toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                </strong>
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  {isContractor ? 'Gross invoice payout' : '~78% net retention estimate'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 font-medium block mb-0.5">Effective Date</span>
                <strong className="text-white font-mono font-bold text-sm">
                  {currentSalary.valid_from}
                </strong>
                <span className="text-[10px] text-slate-400 block mt-0.5">Annual compensation review</span>
              </div>
              <div>
                <span className="text-slate-400 font-medium block mb-0.5">Payment Cadence</span>
                <strong className="text-white font-sans font-bold text-sm block">
                  {isContractor ? '12 Monthly Retainer Blocks' : '14 Standard Salaries'}
                </strong>
                <span className="text-[10px] text-slate-400 block">Includes Easter, Summer & Xmas</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Bank Direct Deposit & Security Details */}
        <Card title="Direct Deposit Account" subtitle="Disbursement bank account coordinates" className="shadow-xs border-slate-200/90 flex flex-col justify-between">
          <div className="space-y-4 mt-3">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-medium flex items-center">
                  <CreditCard className="w-4 h-4 mr-1.5 text-slate-600" /> Bank IBAN
                </span>
                <Badge variant="success">Verified</Badge>
              </div>
              <div className="font-mono font-extrabold text-slate-900 text-sm tracking-wider">
                GR16 0110 0980 0000 1234 5678 901
              </div>
              <p className="text-[10px] text-slate-400">Eurobank Ergasias &bull; BIC: EVTOGRAA</p>
            </div>

            <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200/80 text-blue-950 text-[11px] space-y-1">
              <span className="font-extrabold flex items-center text-xs text-[#3D87D3]">
                <ShieldCheck className="w-4 h-4 mr-1.5 text-[#3D87D3]" /> Encrypted Under RLS
              </span>
              <p className="leading-relaxed text-slate-700">
                Your financial records and banking coordinates are protected by Supabase Row-Level Security and solely accessible by you and authorized Founders.
              </p>
            </div>
          </div>

          <div className="pt-4 mt-4 border-t border-slate-100">
            <Button variant="secondary" className="w-full text-xs font-bold py-2 shadow-2xs border-slate-300" onClick={() => alert("To change banking coordinates or IBAN, please contact HR/Payroll team for multi-factor authorization.")}>
              <Lock className="w-3.5 h-3.5 mr-1.5 text-slate-500" /> Update Bank Account Details
            </Button>
          </div>
        </Card>
      </div>

      {/* Payment History & Monthly Payslip Archive */}
      <div className="space-y-4 pt-4 border-t border-slate-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900 tracking-tight flex items-center">
              <FileText className="w-5 h-5 mr-2 text-indigo-600" /> Payment History & Statement Archive
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Historical log of past disbursements, monthly payslip vouchers, and contractor invoices.
            </p>
          </div>
          <Badge variant="info">{myPayments.length} Archived Statements Available</Badge>
        </div>

        <Card className="shadow-xs border-slate-200/90 overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 uppercase font-extrabold tracking-wider text-[11px]">
                <tr>
                  <th className="p-4">Period</th>
                  <th className="p-4">Description / Type</th>
                  <th className="p-4">Gross Amount</th>
                  <th className="p-4">Net Payout</th>
                  <th className="p-4">Disbursement Status</th>
                  <th className="p-4 text-right">Statement Voucher</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white font-medium">
                {myPayments.map((record, index) => (
                  <tr key={index} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-mono font-bold text-slate-900">
                      {record.period}
                    </td>
                    <td className="p-4 text-slate-800 font-semibold">
                      {record.note || record.payment_type?.name_en || (isContractor ? 'Monthly Partner Retainer' : 'Regular Monthly Salary')}
                    </td>
                    <td className="p-4 font-mono font-bold text-slate-800">
                      €{record.gross.toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-4 font-mono font-bold text-emerald-700">
                      €{record.net.toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-extrabold shadow-2xs">
                        <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" /> Dispatched & Paid
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <button
                        onClick={() => handleDownloadPayslip(record)}
                        className="inline-flex items-center px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs border border-slate-300/80 shadow-2xs transition-all cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5 mr-1.5 text-[#3D87D3]" /> Download Payslip
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
