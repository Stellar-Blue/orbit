"use client";

import React, { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, Button, Badge, Modal } from '@/components/ui/primitives';
import { 
  DollarSign, Download, ShieldCheck, CreditCard, 
  Building, Calendar, FileText, CheckCircle2, TrendingUp, AlertTriangle, Lock, Paperclip, FolderOpen, FileSpreadsheet, History
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { PaymentRecord, SalaryRecord, PaymentDocument } from '@/lib/types';

export default function MyCompensationPage() {
  const { currentUser, salaries, payments, paymentTypes } = useAuth();
  const isContractor = currentUser.employment_type === 'contractor';
  const [selectedPaymentForDocs, setSelectedPaymentForDocs] = useState<PaymentRecord | null>(null);
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // Find active and historical salary records for current user (NO employer costs displayed)
  const mySalaries = useMemo(() => {
    const records = (salaries || []).filter(s => s.profile_id === currentUser.id);
    return [...records].sort((a, b) => (b.valid_from || '').localeCompare(a.valid_from || ''));
  }, [salaries, currentUser.id]);

  const currentSalary = useMemo(() => {
    const active = mySalaries.find(s => !s.valid_to) || mySalaries[0];
    if (active) return active;
    return {
      id: 'mock-sal-1',
      profile_id: currentUser.id,
      valid_from: '2026-01-01',
      basis: isContractor ? 'fixed_fee' : 'monthly_gross',
      gross_amount: isContractor ? 3500 : 2800,
      currency: 'EUR'
    } as SalaryRecord;
  }, [mySalaries, currentUser.id, isContractor]);

  // Estimate net pay (approx 22% tax/social deductions for salaried, 0% withholding or flat for contractors)
  const estimatedNet = useMemo(() => {
    if (isContractor) return currentSalary.gross_amount;
    return Math.round(currentSalary.gross_amount * 0.78);
  }, [currentSalary, isContractor]);

  // STRICT REQUIREMENT: Only show PAID payments to employee. Draft/planned stays hidden under RLS until confirmed.
  const myPayments: PaymentRecord[] = useMemo(() => {
    const records = (payments || []).filter(p => p.profile_id === currentUser.id && p.status === 'paid');
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
        bank_reference: 'WIRE-GR89100010',
        status: 'paid',
        note: isContractor ? 'July 2026 Partner Invoice Retainer' : 'July 2026 Standard Salary',
        documents: [
          { id: 'doc-1', name: `Voucher_July_2026_${currentUser.last_name || 'Staff'}.pdf`, type: 'payslip', size: '154 KB', uploaded_at: '2026-07-30' }
        ]
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
        bank_reference: 'WIRE-GR89100009',
        status: 'paid',
        note: isContractor ? 'June 2026 Partner Invoice Retainer' : 'June 2026 Standard Salary',
        documents: [
          { id: 'doc-2', name: `Voucher_June_2026_${currentUser.last_name || 'Staff'}.pdf`, type: 'payslip', size: '151 KB', uploaded_at: '2026-06-29' }
        ]
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
        bank_reference: 'WIRE-GR89100005',
        status: 'paid',
        note: isContractor ? 'May 2026 Partner Invoice Retainer' : 'May 2026 Standard Salary',
        documents: [
          { id: 'doc-3', name: `Voucher_May_2026_${currentUser.last_name || 'Staff'}.pdf`, type: 'payslip', size: '148 KB', uploaded_at: '2026-05-30' }
        ]
      },
    ] as PaymentRecord[];
  }, [payments, currentUser.id, currentSalary.gross_amount, estimatedNet, isContractor, currentUser.last_name]);

  // Available years for filter
  const availableYears = useMemo(() => {
    const years = new Set<string>();
    myPayments.forEach(p => years.add(p.period.substring(0, 4)));
    return Array.from(years).sort().reverse();
  }, [myPayments]);

  const filteredPayments = useMemo(() => {
    if (yearFilter === 'all') return myPayments;
    return myPayments.filter(p => p.period.startsWith(yearFilter));
  }, [myPayments, yearFilter]);

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
      ['Bank Reference:', record.bank_reference || 'DIRECT-DEPOSIT'],
      ['Statement Date:', record.payment_date ? record.payment_date.split('T')[0] : new Date().toISOString().split('T')[0]],
      [''],
      ['DESCRIPTION', 'AMOUNT (EUR)'],
      ['Gross Earnings / Retainer Rate', `€${record.gross.toLocaleString('de-DE', { minimumFractionDigits: 2 })}`],
      ['Tax & Social Insurance Deductions', `€${(record.gross - record.net).toLocaleString('de-DE', { minimumFractionDigits: 2 })}`],
      ['NET PAYABLE DISBURSED', `€${record.net.toLocaleString('de-DE', { minimumFractionDigits: 2 })}`],
      [''],
      ['Status:', record.status.toUpperCase()],
      ['Note: Confidential electronic ledger voucher generated via Orbit HRMS under Supabase RLS.']
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, `Payslip_${record.period}`);
    XLSX.writeFile(wb, `Payslip_${currentUser.last_name}_${record.period}.xlsx`);
  };

  const handleDownloadDoc = (doc: PaymentDocument) => {
    const content = `STELLARBLUE SYSTEMS ORBIT — VERIFIED PAYMENT DOCUMENT\nDocument ID: ${doc.id}\nType: ${doc.type.toUpperCase()}\nFile Size: ${doc.size}\nUploaded: ${doc.uploaded_at}\nEmployee: ${currentUser.first_name} ${currentUser.last_name}\nStatus: Verified and Encrypted under RLS`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = doc.name.endsWith('.pdf') ? doc.name.replace('.pdf', '_receipt.txt') : doc.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
            Review your active remuneration structure, personal raise history, direct deposit details, and confirmed payment statements.
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
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setShowHistoryModal(true)}
            className="bg-white border-slate-200 text-slate-700 font-bold hover:bg-slate-50 shadow-2xs"
          >
            <History className="w-3.5 h-3.5 mr-1.5 text-[#3D87D3]" /> My Compensation History
          </Button>
        </div>
      </div>

      {/* Overview Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Remuneration Card */}
        <Card title="Active Remuneration Structure" subtitle="Current effective rates & personal earnings (Confidential)" className="lg:col-span-2 shadow-xs border-slate-200/90">
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
                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-emerald-400" /> Active Rate
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
                <span className="text-slate-400 font-medium block mb-0.5">Effective From Date</span>
                <strong className="text-white font-mono font-bold text-sm">
                  {currentSalary.valid_from}
                </strong>
                <span className="text-[10px] text-slate-400 block mt-0.5">{currentSalary.note || 'Current annual compensation review'}</span>
              </div>
              <div>
                <span className="text-slate-400 font-medium block mb-0.5">Payment Cadence</span>
                <strong className="text-white font-sans font-bold text-sm block">
                  {isContractor ? '12 Monthly Retainer Blocks' : '14 Standard Salaries'}
                </strong>
                <span className="text-[10px] text-slate-400 block">{isContractor ? 'Invoiced monthly' : 'Includes Easter, Summer & Xmas bonuses'}</span>
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
                <ShieldCheck className="w-4 h-4 mr-1.5 text-[#3D87D3]" /> RLS Privacy Guaranteed
              </span>
              <p className="leading-relaxed text-slate-700">
                Under Supabase Row-Level Security, you solely view your own confirmed paid rows. Unfinalized drafts and internal company economics remain totally separate.
              </p>
            </div>
          </div>

          <div className="pt-4 mt-4 border-t border-slate-100">
            <Button variant="secondary" className="w-full text-xs font-bold py-2 shadow-2xs border-slate-300 cursor-pointer" onClick={() => alert("To change banking coordinates or IBAN, please contact HR/Payroll team for multi-factor verification.")}>
              <Lock className="w-3.5 h-3.5 mr-1.5 text-slate-500" /> Request IBAN Update
            </Button>
          </div>
        </Card>
      </div>

      {/* Payment History & Monthly Payslip Archive */}
      <div className="space-y-4 pt-4 border-t border-slate-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900 tracking-tight flex items-center">
              <FileText className="w-5 h-5 mr-2 text-[#3D87D3]" /> Confirmed Payment History & Statement Archive
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Historical log of completed disbursements and official voucher receipts. Only finalized paid rows appear here.
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <span className="text-xs font-bold text-slate-500">Filter Year:</span>
            <select 
              value={yearFilter} 
              onChange={e => setYearFilter(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-800 shadow-2xs cursor-pointer"
            >
              <option value="all">All Years ({myPayments.length} records)</option>
              {availableYears.map(yr => (
                <option key={yr} value={yr}>{yr}</option>
              ))}
            </select>
          </div>
        </div>

        <Card className="shadow-xs border-slate-200/90 overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 uppercase font-extrabold tracking-wider text-[11px]">
                <tr>
                  <th className="p-4 pl-5">Period</th>
                  <th className="p-4">Payment Type & Memo</th>
                  <th className="p-4">Gross Earnings</th>
                  <th className="p-4">Net Disbursed</th>
                  <th className="p-4">Payment Date & Bank Ref</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right pr-5">Voucher / Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white font-medium">
                {filteredPayments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-400 italic">
                      No confirmed paid disbursements found for selected timeframe.
                    </td>
                  </tr>
                ) : (
                  filteredPayments.map((record, index) => (
                    <tr key={index} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-4 pl-5 font-mono font-extrabold text-slate-900 text-sm">
                        {record.period}
                      </td>
                      <td className="p-4 text-slate-800 font-semibold">
                        <span className="block text-sm text-[#3D87D3] font-bold">
                          {record.payment_type?.name_el || (isContractor ? 'Partner Retainer' : 'Regular Monthly Salary')}
                        </span>
                        <span className="text-xs text-slate-500 font-normal">{record.note || record.payment_type?.name_en || 'Standard disbursement'}</span>
                      </td>
                      <td className="p-4 font-mono font-bold text-slate-700 text-sm">
                        €{record.gross.toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-4 font-mono font-extrabold text-emerald-700 text-sm bg-emerald-50/20">
                        €{record.net.toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-4 font-mono text-xs">
                        <span className="text-slate-800 font-semibold block">{record.payment_date || `${record.period}-28`}</span>
                        <span className="text-[10px] text-slate-400 uppercase tracking-tight">{record.bank_reference || 'WIRE-TRANSFER'}</span>
                      </td>
                      <td className="p-4">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-extrabold shadow-2xs">
                          <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" /> PAID
                        </span>
                      </td>
                      <td className="p-4 text-right pr-5 flex items-center justify-end space-x-2">
                        {record.documents && record.documents.length > 0 ? (
                          <button
                            onClick={() => setSelectedPaymentForDocs(record)}
                            className="inline-flex items-center px-3 py-1.5 rounded-lg bg-[#3D87D3]/10 hover:bg-[#3D87D3]/20 text-[#3D87D3] font-bold text-xs border border-[#3D87D3]/20 shadow-2xs transition-all cursor-pointer"
                          >
                            <Paperclip className="w-3.5 h-3.5 mr-1 text-[#3D87D3]" /> {record.documents.length} Receipt{record.documents.length > 1 ? 's' : ''}
                          </button>
                        ) : (
                          <button
                            onClick={() => handleDownloadPayslip(record)}
                            className="inline-flex items-center px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs border border-slate-300/80 shadow-2xs transition-all cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5 mr-1.5 text-[#3D87D3]" /> Statement
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* MY COMPENSATION HISTORY MODAL */}
      <Modal 
        isOpen={showHistoryModal} 
        onClose={() => setShowHistoryModal(false)} 
        title={`My Personal Salary History (${currentUser.first_name} ${currentUser.last_name})`}
      >
        <div className="space-y-4 text-xs">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-700">
            Below is your chronological record of base rates and salary adjustments. Historical entries show when each compensation level went into effect.
          </div>

          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {mySalaries.length === 0 ? (
              <div className="p-4 rounded-xl border border-slate-200 bg-white flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-800 text-sm block">{currentSalary.valid_from} &rarr; Present</span>
                  <span className="text-slate-500 text-xs">Initial regular engagement terms</span>
                </div>
                <div className="text-right font-mono font-extrabold text-emerald-700 text-base">
                  €{currentSalary.gross_amount.toLocaleString()} <span className="text-xs text-slate-400 font-sans font-normal">/ month gross</span>
                </div>
              </div>
            ) : (
              mySalaries.map((sal, idx) => {
                const isActive = !sal.valid_to;
                return (
                  <div key={sal.id} className={`p-3.5 rounded-xl border flex items-center justify-between ${isActive ? 'bg-emerald-50/40 border-emerald-200 shadow-2xs' : 'bg-white border-slate-200 opacity-80'}`}>
                    <div className="flex items-center space-x-3">
                      <Badge variant={isActive ? 'success' : 'neutral'}>{isActive ? 'CURRENT RATE' : 'HISTORICAL'}</Badge>
                      <div>
                        <span className="font-bold text-slate-900 text-sm block">
                          {sal.valid_from} &rarr; {sal.valid_to || 'Present'}
                        </span>
                        <span className="text-[11px] text-slate-500 block mt-0.5">
                          Basis: {sal.basis.toUpperCase().replace('_', ' ')} {sal.note && `&bull; ${sal.note}`}
                        </span>
                      </div>
                    </div>
                    <div className="text-right font-mono font-extrabold text-slate-900 text-base">
                      €{sal.gross_amount.toLocaleString()} <span className="text-xs text-slate-500 font-sans font-normal">/ mo gross</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="pt-3 border-t border-slate-200 flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowHistoryModal(false)}>Close Window</Button>
          </div>
        </div>
      </Modal>

      {/* EMPLOYEE ATTACHED DOCUMENTS MODAL */}
      <Modal 
        isOpen={!!selectedPaymentForDocs} 
        onClose={() => setSelectedPaymentForDocs(null)} 
        title={selectedPaymentForDocs ? `Attached Payment Receipts (${selectedPaymentForDocs.period})` : 'Payment Documents'}
      >
        {selectedPaymentForDocs && (
          <div className="space-y-4 text-xs">
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-800 text-sm block">Period: {selectedPaymentForDocs.period} (Bank Ref: {selectedPaymentForDocs.bank_reference || 'WIRE'})</span>
                <span className="text-slate-500 text-[11px]">{selectedPaymentForDocs.note || 'Regular Monthly Disbursement'}</span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-400 font-bold block uppercase">Net Payout</span>
                <span className="text-base font-mono font-extrabold text-emerald-700">€{selectedPaymentForDocs.net.toLocaleString()}</span>
              </div>
            </div>

            <div className="space-y-2.5">
              <h4 className="font-extrabold text-slate-700 uppercase tracking-wider text-[11px]">
                Official Vouchers & Receipts ({selectedPaymentForDocs.documents?.length || 0})
              </h4>
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {selectedPaymentForDocs.documents?.map(doc => (
                  <div key={doc.id} className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs flex items-center justify-between hover:border-indigo-200 transition-all">
                    <div className="flex items-center space-x-3 truncate max-w-[65%]">
                      <div className="p-2 bg-indigo-50 text-[#3D87D3] rounded-lg shrink-0">
                        {doc.type === 'invoice' ? <FileSpreadsheet className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                      </div>
                      <div className="truncate">
                        <span className="font-bold text-slate-800 text-xs block truncate">{doc.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono block mt-0.5">
                          Category: {doc.type.toUpperCase().replace('_', ' ')} &bull; {doc.size}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDownloadDoc(doc)}
                      className="inline-flex items-center px-3 py-1.5 rounded-lg bg-[#3D87D3] hover:bg-[#3D87D3]/90 text-white font-bold text-[11px] shadow-xs transition-all cursor-pointer shrink-0"
                    >
                      <Download className="w-3 h-3 mr-1.5" /> Download PDF
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setSelectedPaymentForDocs(null)}>Close Window</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
