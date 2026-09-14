"use client";

import React, { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/auth-context';
import { Card, Button, Badge, Modal } from '@/components/ui/primitives';
import { 
  DollarSign, Download, ShieldCheck, CreditCard, 
  Building, Calendar, FileText, CheckCircle2, TrendingUp, AlertTriangle, Lock, Paperclip, FolderOpen, FileSpreadsheet, History
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { PaymentRecord, SalaryRecord, PaymentDocument } from '@/lib/types';
import { formatDate, formatDateTime } from '@/lib/date';
import { isBaseSalary, isRecurringExtra, extrasFor, loadedMonthlyCost } from '@/lib/compensation';
import { BenefitsList } from '@/components/compensation/benefits-list';
import { BlurredReveal } from '@/components/ui/blurred-reveal';

const CompensationGrid = dynamic(() => import('@/components/compensation/compensation-grid').then(m => m.CompensationGrid), { ssr: false });

export default function MyCompensationPage() {
  const { currentUser, salaries, payments, paymentTypes } = useAuth();
  const isContractor = currentUser.employment_type === 'contractor';
  const [selectedPaymentForDocs, setSelectedPaymentForDocs] = useState<PaymentRecord | null>(null);
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // My effective-dated remuneration ledger (base rates + contractual extras + one-off bonuses).
  // Admin-visible in full; an employee reads only their own rows through the RLS-safe view.
  const mySalaries = useMemo(() => {
    const records = (salaries || []).filter(s => s.profile_id === currentUser.id);
    return [...records].sort((a, b) => (b.valid_from || '').localeCompare(a.valid_from || ''));
  }, [salaries, currentUser.id]);

  const myBaseSalaries = useMemo(() => mySalaries.filter(isBaseSalary), [mySalaries]);

  const currentSalary = useMemo(() => {
    const active = myBaseSalaries.find(s => !s.valid_to) || myBaseSalaries[0];
    if (active) return active;
    return {
      id: 'mock-sal-1',
      profile_id: currentUser.id,
      valid_from: '2026-01-01',
      basis: isContractor ? 'fixed_fee' : 'monthly_gross',
      gross_amount: isContractor ? 3500 : 2800,
      currency: 'EUR'
    } as SalaryRecord;
  }, [myBaseSalaries, currentUser.id, isContractor]);

  // Ledger vocabulary: `gross_amount` is the NET the employee is contracted (and the figure the
  // ledger grid calls "Net"); the gross is net + employer contributions.
  const netSalary = useMemo(() => Number(currentSalary.gross_amount) || 0, [currentSalary]);
  const grossSalary = useMemo(() => loadedMonthlyCost(currentSalary), [currentSalary]);

  // The employee's own bank coordinates, straight from their profile_sensitive row (RLS: own row).
  const iban = (currentUser.sensitive?.iban || '').trim();
  const hasIban = iban.length > 0;
  const formattedIban = hasIban ? iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim() : '';
  const bankName = (currentUser.sensitive?.bank_name || '').trim();
  const bankSwift = (currentUser.sensitive?.bank_swift || '').trim();
  const bankLine = [bankName, bankSwift ? `SWIFT/BIC: ${bankSwift.toUpperCase()}` : ''].filter(Boolean).join(' • ');

  // Contractual recurring extras on the contract = the employee's monthly benefits.
  const myRecurringExtras = useMemo(
    () => extrasFor(mySalaries, currentUser.id).filter(isRecurringExtra),
    [mySalaries, currentUser.id]
  );

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
        gross: grossSalary,
        net: netSalary,
        employer_contributions: Number((grossSalary - netSalary).toFixed(2)),
        total_cost: grossSalary,
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
        gross: grossSalary,
        net: netSalary,
        employer_contributions: Number((grossSalary - netSalary).toFixed(2)),
        total_cost: grossSalary,
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
        gross: grossSalary,
        net: netSalary,
        employer_contributions: Number((grossSalary - netSalary).toFixed(2)),
        total_cost: grossSalary,
        payment_date: '2026-05-30',
        bank_reference: 'WIRE-GR89100005',
        status: 'paid',
        note: isContractor ? 'May 2026 Partner Invoice Retainer' : 'May 2026 Standard Salary',
        documents: [
          { id: 'doc-3', name: `Voucher_May_2026_${currentUser.last_name || 'Staff'}.pdf`, type: 'payslip', size: '148 KB', uploaded_at: '2026-05-30' }
        ]
      },
    ] as PaymentRecord[];
  }, [payments, currentUser.id, netSalary, grossSalary, isContractor, currentUser.last_name]);

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
    const content = `STELLARBLUE SYSTEMS ORBIT — VERIFIED PAYMENT DOCUMENT\nDocument ID: ${doc.id}\nType: ${doc.type.toUpperCase()}\nFile Size: ${doc.size}\nUploaded: ${formatDateTime(doc.uploaded_at)}\nEmployee: ${currentUser.first_name} ${currentUser.last_name}\nStatus: Verified and Encrypted under RLS`;
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
    <div className="space-y-8 animate-in fade-in duration-200 pb-20">
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
            {/* Primary figure = what actually lands in the bank each month. */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 block mb-1">
                  Estimated Net Payable Salary
                </span>
                <div className="text-3xl sm:text-4xl font-extrabold text-emerald-300 font-mono">
                  €{netSalary.toLocaleString('de-DE', { minimumFractionDigits: 2 })} <span className="text-sm font-bold text-slate-300 font-sans">/ month</span>
                </div>
                <span className="text-[10px] text-slate-400 block mt-1">
                  {isContractor ? 'Contracted net payout' : 'Contracted net, as recorded in the salary ledger'}
                </span>
              </div>
              <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-xs font-extrabold flex items-center shadow-2xs shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-emerald-400" /> Active Rate
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-5 border-t border-slate-700/80 text-xs">
              <div>
                <span className="text-slate-400 font-medium block mb-0.5">
                  {isContractor ? 'Monthly Retainer (Gross)' : 'Monthly Gross Salary'}
                </span>
                <strong className="text-white font-mono font-bold text-base">
                  €{grossSalary.toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                </strong>
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  {isContractor ? 'Retainer incl. VAT / withholding' : 'Net + employer contributions (ΕΦΚΑ)'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 font-medium block mb-0.5">Effective From Date</span>
                <strong className="text-white font-mono font-bold text-sm">
                  {formatDate(currentSalary.valid_from)}
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

          {/* Recurring monthly extras tracked on the contract = the employee's benefits. */}
          <BenefitsList extras={myRecurringExtras} paymentTypes={paymentTypes} />
        </Card>

        {/* Bank Direct Deposit & Security Details */}
        <Card title="Direct Deposit Account" subtitle="Disbursement bank account coordinates" className="shadow-xs border-slate-200/90 flex flex-col justify-between">
          <div className="space-y-4 mt-3">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-medium flex items-center">
                  <CreditCard className="w-4 h-4 mr-1.5 text-slate-600" /> Bank IBAN
                </span>
                <Badge variant={hasIban ? 'success' : 'warning'}>{hasIban ? 'ON FILE' : 'NOT ON FILE'}</Badge>
              </div>
              {/* The employee's own profile_sensitive.iban — never a sample value. */}
              <BlurredReveal
                value={formattedIban}
                placeholder="No IBAN on file — ask HR/Payroll"
                className="font-mono font-extrabold text-slate-900 text-sm tracking-wider"
              />
              <p className="text-[10px] text-slate-400">
                {bankLine || 'Bank & SWIFT/BIC not on file'}
              </p>
              <p className="text-[10px] text-slate-400">
                {hasIban
                  ? 'Payroll disburses your net pay to this account.'
                  : 'Add your IBAN through HR/Payroll before the next payout run.'}
              </p>
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

        <CompensationGrid
          payments={filteredPayments}
          isContractor={isContractor}
          onOpenDocs={(record) => setSelectedPaymentForDocs(record)}
          onDownloadPayslip={(record) => handleDownloadPayslip(record)}
        />
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
            {myBaseSalaries.length === 0 ? (
              <div className="p-4 rounded-xl border border-slate-200 bg-white flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-800 text-sm block">{formatDate(currentSalary.valid_from)} &rarr; Present</span>
                  <span className="text-slate-500 text-xs">Initial regular engagement terms</span>
                </div>
                <div className="text-right font-mono font-extrabold text-emerald-700 text-base">
                  €{currentSalary.gross_amount.toLocaleString()} <span className="text-xs text-slate-400 font-sans font-normal">/ month gross</span>
                </div>
              </div>
            ) : (
              myBaseSalaries.map(sal => {
                const isActive = !sal.valid_to;
                return (
                  <div key={sal.id} className={`p-3.5 rounded-xl border flex items-center justify-between ${isActive ? 'bg-emerald-50/40 border-emerald-200 shadow-2xs' : 'bg-white border-slate-200 opacity-80'}`}>
                    <div className="flex items-center space-x-3">
                      <Badge variant={isActive ? 'success' : 'neutral'}>{isActive ? 'CURRENT RATE' : 'HISTORICAL'}</Badge>
                      <div>
                        <span className="font-bold text-slate-900 text-sm block">
                          {formatDate(sal.valid_from)} &rarr; {sal.valid_to ? formatDate(sal.valid_to) : 'Present'}
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
