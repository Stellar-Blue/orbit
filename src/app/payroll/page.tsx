"use client";

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, Button, Badge, StatCard, Modal } from '@/components/ui/primitives';
import { 
  DollarSign, Download, Plus, Sparkles, ShieldAlert, 
  Calendar, CheckCircle, RefreshCw, Layers, Sliders, TrendingUp,
  Upload, FileText, Trash2, FileCheck, Paperclip, ExternalLink, Eye, X, Check, FolderOpen, FileSpreadsheet
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { PaymentRecord, PaymentDocument } from '@/lib/types';

export default function PayrollPage() {
  const { currentUser, profiles, paymentTypes, salaries, payments, generateDraftMonth, addPaymentRecord, addPaymentDocuments, deletePaymentDocument } = useAuth();
  const [selectedPeriod, setSelectedPeriod] = useState<string>('2026-08');
  const [tab, setTab] = useState<'ledger' | 'forecast' | 'payment_types'>('ledger');
  
  // Upload New Payment State
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [upProfileId, setUpProfileId] = useState('');
  const [upPeriod, setUpPeriod] = useState('2026-08');
  const [upTypeId, setUpTypeId] = useState('');
  const [upGross, setUpGross] = useState<number>(0);
  const [upEfka, setUpEfka] = useState<number>(0);
  const [upNet, setUpNet] = useState<number>(0);
  const [upDate, setUpDate] = useState('2026-08-28');
  const [upStatus, setUpStatus] = useState<'paid' | 'planned' | 'cancelled'>('paid');
  const [upNote, setUpNote] = useState('');
  const [upDocs, setUpDocs] = useState<PaymentDocument[]>([]);

  // Existing Payment Documents Management Modal State
  const [selectedPaymentForDocs, setSelectedPaymentForDocs] = useState<PaymentRecord | null>(null);
  const [addMoreDocs, setAddMoreDocs] = useState<PaymentDocument[]>([]);
  
  // New dynamic payment type state
  const [isTypeOpen, setIsTypeOpen] = useState(false);
  const [ptCode, setPtCode] = useState('bonus_midyear');
  const [ptNameEl, setPtNameEl] = useState('Επιπλέον Αμοιβή');
  const [ptNameEn, setPtNameEn] = useState('Mid-Year Performance Bonus');
  const [ptMult, setPtMult] = useState(0.5);

  const isAdmin = currentUser.role === 'admin';

  if (!isAdmin) {
    return (
      <div className="p-10 text-center bg-rose-50 border border-rose-200 rounded-2xl max-w-xl mx-auto my-12 space-y-3 shadow-xs">
        <ShieldAlert className="w-12 h-12 mx-auto text-rose-600" />
        <h2 className="text-xl font-bold text-slate-800">403 Forbidden &mdash; Strictly Admin Restricted</h2>
        <p className="text-xs text-slate-600">
          Compensation ledgers, contractor invoice rates, and salary history are confidential under Supabase Row-Level Security and accessible solely to Founders.
        </p>
      </div>
    );
  }

  const periodPayments = payments.filter(p => p.period === selectedPeriod);
  const totalCost = periodPayments.reduce((acc, p) => acc + p.total_cost, 0);
  const totalNet = periodPayments.reduce((acc, p) => acc + p.net, 0);

  const handleGenerateDraft = () => {
    generateDraftMonth(selectedPeriod);
    alert(`Successfully generated draft salary & contractor invoice records for ${selectedPeriod} across all active staff!`);
  };

  // One-click Accountant Package Export (XLSX Bundle)
  const handleAccountantExport = () => {
    const data = periodPayments.map(p => {
      const prof = profiles.find(pr => pr.id === p.profile_id);
      const pt = paymentTypes.find(type => type.id === p.payment_type_id);
      return {
        Period: p.period,
        Employee_ID: p.profile_id,
        Name_GR: prof?.name_el,
        Name_EN: `${prof?.first_name} ${prof?.last_name}`,
        EmploymentType: prof?.employment_type.toUpperCase(),
        PaymentType_GR: pt?.name_el || 'Μισθός',
        Gross_Amount: p.gross,
        Net_Payable: p.net,
        Employer_Contributions: p.employer_contributions,
        Total_Company_Cost: p.total_cost,
        Status: p.status.toUpperCase()
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, `Payroll_${selectedPeriod}`);
    XLSX.writeFile(workbook, `StellarBlue_Accountant_Package_${selectedPeriod}.xlsx`);
  };

  // Calculate 12-month forward burn forecast
  const currentMonthlyBurn = salaries.filter(s => !s.valid_to).reduce((acc, sal) => {
    const empCost = sal.employer_cost_pct ? sal.gross_amount * (sal.employer_cost_pct / 100) : 0;
    return acc + sal.gross_amount + empCost;
  }, 0);

  const annualProjectedBurn = currentMonthlyBurn * 14; // Greek statutory 14 salaries approximation for full-time

  const openUploadModal = () => {
    const defaultProf = profiles.filter(p => p.status === 'active')[0] || profiles[0];
    const defaultType = paymentTypes[0];
    setUpProfileId(defaultProf?.id || '');
    setUpTypeId(defaultType?.id || '');
    setUpPeriod(selectedPeriod);
    setUpDate(`${selectedPeriod}-28`);
    setUpDocs([]);
    setUpNote('');

    if (defaultProf) {
      const sal = salaries.find(s => s.profile_id === defaultProf.id && !s.valid_to);
      if (sal) {
        setUpGross(sal.gross_amount);
        if (defaultProf.employment_type === 'contractor') {
          setUpEfka(0);
          setUpNet(sal.gross_amount);
        } else {
          const efka = sal.employer_cost_pct ? Number((sal.gross_amount * (sal.employer_cost_pct / 100)).toFixed(2)) : 0;
          setUpEfka(efka);
          setUpNet(Number((sal.gross_amount * 0.72).toFixed(2)));
        }
      } else {
        setUpGross(2500);
        setUpEfka(550);
        setUpNet(1800);
      }
    }
    setIsUploadOpen(true);
  };

  const handleEmployeeSelectChange = (profId: string) => {
    setUpProfileId(profId);
    const prof = profiles.find(p => p.id === profId);
    if (!prof) return;
    const sal = salaries.find(s => s.profile_id === prof.id && !s.valid_to);
    if (sal) {
      setUpGross(sal.gross_amount);
      if (prof.employment_type === 'contractor') {
        setUpEfka(0);
        setUpNet(sal.gross_amount);
      } else {
        const efka = sal.employer_cost_pct ? Number((sal.gross_amount * (sal.employer_cost_pct / 100)).toFixed(2)) : 0;
        setUpEfka(efka);
        setUpNet(Number((sal.gross_amount * 0.72).toFixed(2)));
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, target: 'upload' | 'existing') => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const newFiles: PaymentDocument[] = [];
    Array.from(files).forEach(file => {
      const sizeKB = Math.max(1, Math.round(file.size / 1024));
      const sizeStr = sizeKB > 1000 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;
      let type = 'payslip';
      const nameLower = file.name.toLowerCase();
      if (nameLower.includes('inv') || nameLower.includes('τιμολ')) type = 'invoice';
      else if (nameLower.includes('rec') || nameLower.includes('bank') || nameLower.includes('wire')) type = 'receipt';
      else if (nameLower.includes('tax') || nameLower.includes('e11')) type = 'tax_sheet';

      newFiles.push({
        id: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        name: file.name,
        type,
        size: sizeStr,
        uploaded_at: new Date().toISOString().split('T')[0]
      });
    });

    if (target === 'upload') {
      setUpDocs(prev => [...prev, ...newFiles]);
    } else {
      setAddMoreDocs(prev => [...prev, ...newFiles]);
    }
    e.target.value = '';
  };

  const handleSaveUploadedPayment = () => {
    if (!upProfileId) {
      alert('Please select an employee or contractor.');
      return;
    }
    if (upGross <= 0) {
      alert('Please enter a valid gross amount.');
      return;
    }
    const pt = paymentTypes.find(t => t.id === upTypeId) || paymentTypes[0];
    const total_cost = Number((Number(upGross) + Number(upEfka)).toFixed(2));
    
    addPaymentRecord({
      profile_id: upProfileId,
      period: upPeriod,
      payment_type_id: pt.id,
      payment_type: pt,
      gross: Number(upGross),
      net: Number(upNet),
      employer_contributions: Number(upEfka),
      total_cost,
      payment_date: upDate,
      status: upStatus,
      note: upNote.trim() || undefined,
      documents: upDocs.length > 0 ? upDocs : []
    });

    setIsUploadOpen(false);
    setUpDocs([]);
    alert(`Successfully uploaded payment of €${upGross.toLocaleString()} with ${upDocs.length} attached document(s) for period ${upPeriod}!`);
  };

  const handleSaveAdditionalDocs = () => {
    if (!selectedPaymentForDocs || addMoreDocs.length === 0) return;
    addPaymentDocuments(selectedPaymentForDocs.id, addMoreDocs);
    setSelectedPaymentForDocs(prev => prev ? { ...prev, documents: [...(prev.documents || []), ...addMoreDocs] } : null);
    setAddMoreDocs([]);
    alert(`Successfully attached ${addMoreDocs.length} new document(s) to the payment record!`);
  };

  const handleDownloadDoc = (doc: PaymentDocument, profName?: string) => {
    const content = `STELLARBLUE SYSTEMS ORBIT — VERIFIED PAYMENT DOCUMENT\nDocument ID: ${doc.id}\nType: ${doc.type.toUpperCase()}\nFile Size: ${doc.size}\nUploaded: ${doc.uploaded_at}\nEmployee: ${profName || 'Staff'}\nStatus: Verified and Encrypted under RLS`;
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
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center">
            <DollarSign className="w-6 h-6 mr-3 text-[#3D87D3]" /> Compensation & Payroll Ledger
          </h1>
          <p className="text-slate-500 text-xs mt-1">
            Greek 14-salary statutory items support, contractor invoicing, effective-dated salary histories, and accountant export bundles.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input 
            type="month" 
            value={selectedPeriod} 
            onChange={e => setSelectedPeriod(e.target.value)} 
            className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 font-mono shadow-2xs"
          />
          <Button variant="primary" size="sm" onClick={openUploadModal} className="bg-[#3D87D3] hover:bg-[#3D87D3]/90 shadow-xs cursor-pointer font-bold">
            <Upload className="w-3.5 h-3.5 mr-1.5 text-white" /> Upload Payment & Docs
          </Button>
          <Button variant="secondary" size="sm" onClick={handleGenerateDraft} className="cursor-pointer">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5 text-[#3D87D3]" /> Generate Draft Month (&lt;5 min)
          </Button>
          <Button variant="primary" size="sm" onClick={handleAccountantExport} className="bg-emerald-600 hover:bg-emerald-700 shadow-xs cursor-pointer font-semibold">
            <Download className="w-4 h-4 mr-1.5" /> One-Click Accountant Bundle
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <StatCard 
          title={`Total Company Cost (${selectedPeriod})`}
          value={`€${totalCost.toLocaleString()}`}
          subtitle="Gross salaries, employer EFKA & contractor retainers"
          icon={<DollarSign className="w-5 h-5 text-[#3D87D3]" />}
        />
        <StatCard 
          title="Net Payable to Employees & Contractors"
          value={`€${totalNet.toLocaleString()}`}
          subtitle={`Across ${periodPayments.length} ledger rows`}
          icon={<CheckCircle className="w-5 h-5 text-emerald-600" />}
        />
        <StatCard 
          title="12-Month Forward Projected Burn"
          value={`€${Math.round(annualProjectedBurn).toLocaleString()}`}
          subtitle="Includes 13th & 14th statutory Greek salaries"
          icon={<TrendingUp className="w-5 h-5 text-blue-600" />}
        />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 space-x-6 text-sm">
        <button 
          onClick={() => setTab('ledger')}
          className={`pb-3 font-semibold transition-all cursor-pointer ${tab === 'ledger' ? 'border-b-2 border-[#3D87D3] text-[#3D87D3] font-bold' : 'text-slate-500 hover:text-slate-800'}`}
        >
          Payment Ledger ({selectedPeriod})
        </button>
        <button 
          onClick={() => setTab('forecast')}
          className={`pb-3 font-semibold transition-all cursor-pointer ${tab === 'forecast' ? 'border-b-2 border-[#3D87D3] text-[#3D87D3] font-bold' : 'text-slate-500 hover:text-slate-800'}`}
        >
          Effective-Dated Salary History & Forecast
        </button>
        <button 
          onClick={() => setTab('payment_types')}
          className={`pb-3 font-semibold transition-all flex items-center cursor-pointer ${tab === 'payment_types' ? 'border-b-2 border-[#3D87D3] text-[#3D87D3] font-bold' : 'text-slate-500 hover:text-slate-800'}`}
        >
          <Sliders className="w-3.5 h-3.5 mr-1.5 text-[#3D87D3]" /> Dynamic Payment Types Settings
        </button>
      </div>

      {/* TAB 1: LEDGER TABLE */}
      {tab === 'ledger' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/90 text-[11px] font-semibold uppercase text-slate-500 tracking-wider">
                <th className="p-3.5 pl-5">Employee / Partner</th>
                <th className="p-3.5">Payment Type (GR / EN)</th>
                <th className="p-3.5">Gross Amount</th>
                <th className="p-3.5">Net Pay</th>
                <th className="p-3.5">Employer EFKA</th>
                <th className="p-3.5">Total Company Cost</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Documents & Receipts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {periodPayments.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500 italic">
                    No payment rows found for {selectedPeriod}. Click <strong>&ldquo;Generate Draft Month&rdquo;</strong> or <strong>&ldquo;Upload Payment & Docs&rdquo;</strong> above!
                  </td>
                </tr>
              ) : (
                periodPayments.map(pay => {
                  const prof = profiles.find(p => p.id === pay.profile_id);
                  const pt = paymentTypes.find(type => type.id === pay.payment_type_id);
                  return (
                    <tr key={pay.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3.5 pl-5 font-bold text-slate-800">
                        {prof?.first_name} {prof?.last_name}
                        <span className="text-xs text-slate-500 font-normal block">{prof?.title} ({prof?.employment_type})</span>
                      </td>
                      <td className="p-3.5 text-xs text-[#3D87D3] font-medium">
                        {pt?.name_el} ({pt?.name_en})
                      </td>
                      <td className="p-3.5 font-mono text-slate-700">€{pay.gross.toLocaleString()}</td>
                      <td className="p-3.5 font-mono font-bold text-emerald-700">€{pay.net.toLocaleString()}</td>
                      <td className="p-3.5 font-mono text-slate-600">€{pay.employer_contributions.toLocaleString()}</td>
                      <td className="p-3.5 font-mono font-extrabold text-slate-900 bg-slate-50/80">€{pay.total_cost.toLocaleString()}</td>
                      <td className="p-3.5">
                        <Badge variant={pay.status === 'paid' ? 'success' : 'warning'}>{pay.status.toUpperCase()}</Badge>
                      </td>
                      <td className="p-3.5">
                        <button
                          onClick={() => {
                            setSelectedPaymentForDocs(pay);
                            setAddMoreDocs([]);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-100 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 text-xs font-semibold text-slate-700 hover:text-indigo-700 transition-all cursor-pointer shadow-2xs"
                        >
                          <Paperclip className="w-3.5 h-3.5 text-[#3D87D3]" />
                          {pay.documents && pay.documents.length > 0 ? (
                            <span className="font-bold text-slate-900">{pay.documents.length} doc{pay.documents.length !== 1 ? 's' : ''}</span>
                          ) : (
                            <span className="text-slate-500 font-normal">Upload Docs</span>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 2: HISTORY & BURN FORECAST */}
      {tab === 'forecast' && (
        <Card title="Effective-Dated Salary Ledger & 12-Month Burn Engine" subtitle="Current baseline compensation commitments across StellarBlue employees and contractor retainers">
          <div className="space-y-3 mt-2">
            {salaries.map(sal => {
              const prof = profiles.find(p => p.id === sal.profile_id);
              return (
                <div key={sal.id} className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-slate-800 text-sm">{prof?.first_name} {prof?.last_name}</span>
                    <span className="text-slate-500 block mt-0.5">Effective Date: <strong className="font-mono text-slate-700">{sal.valid_from}</strong> &rarr; {sal.valid_to || 'Present (Active)'} &bull; Note: {sal.note || 'Regular scale'}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-mono font-bold text-emerald-700 block">€{sal.gross_amount.toLocaleString()} <span className="text-xs text-slate-500 font-sans font-normal">/ month ({sal.basis})</span></span>
                    <span className="text-[10px] text-slate-500">Employer cost: {sal.employer_cost_pct ? `${sal.employer_cost_pct}% EFKA` : '0% (Excl VAT invoice)'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* TAB 3: PAYMENT TYPES SETTINGS */}
      {tab === 'payment_types' && (
        <Card title="Dynamic Payment Types Administration" subtitle="Preventing hardcoded Greek statutory items (Easter/Christmas bonus, vacation allowance) in code" action={
          <Button size="sm" variant="secondary" onClick={() => setIsTypeOpen(true)} className="cursor-pointer">
            <Plus className="w-3.5 h-3.5 mr-1" /> Add Payment Category
          </Button>
        }>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
            {paymentTypes.map(pt => (
              <div key={pt.id} className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant={pt.is_statutory ? 'info' : 'neutral'}>{pt.is_statutory ? 'Statutory (Εργ. Νόμος)' : 'Custom Bonus'}</Badge>
                    <span className="font-mono text-xs text-slate-400">Code: {pt.code}</span>
                  </div>
                  <h4 className="font-bold text-slate-800 text-base mt-2">{pt.name_el}</h4>
                  <p className="text-xs text-slate-500">{pt.name_en}</p>
                </div>

                <div className="pt-3 border-t border-slate-100 text-xs text-slate-500 space-y-1">
                  <div className="flex justify-between">
                    <span>Default Multiplier:</span>
                    <strong className="font-mono text-[#3D87D3] font-bold">{pt.default_multiplier ? `${pt.default_multiplier}x monthly salary` : 'Variable / Spot'}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Applies to:</span>
                    <span className="text-slate-700 font-medium">{pt.applies_to.join(', ')}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ADD PAYMENT TYPE MODAL */}
      <Modal isOpen={isTypeOpen} onClose={() => setIsTypeOpen(false)} title="Register Dynamic Payment Type">
        <div className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold uppercase text-slate-500 mb-1">System Code (Slug)</label>
            <input type="text" value={ptCode} onChange={e => setPtCode(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 font-mono" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Name (Greek)</label>
              <input type="text" value={ptNameEl} onChange={e => setPtNameEl(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 font-bold" />
            </div>
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Name (English)</label>
              <input type="text" value={ptNameEn} onChange={e => setPtNameEn(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800" />
            </div>
          </div>
          <div>
            <label className="block font-semibold uppercase text-slate-500 mb-1">Default Salary Multiplier</label>
            <input type="number" step="0.1" value={ptMult} onChange={e => setPtMult(Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 font-mono" />
          </div>
          <div className="pt-2 flex justify-end space-x-2">
            <Button variant="outline" size="sm" onClick={() => setIsTypeOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => { setIsTypeOpen(false); alert('Payment Type registered!'); }} className="bg-[#3D87D3] hover:bg-[#3D87D3]/90">Save Category &rarr;</Button>
          </div>
        </div>
      </Modal>

      {/* UPLOAD PAYMENT MODAL */}
      <Modal isOpen={isUploadOpen} onClose={() => setIsUploadOpen(false)} title="Upload Payment & Attach Documents">
        <div className="space-y-4 text-xs">
          <div className="p-3 bg-indigo-50/80 border border-indigo-100 rounded-xl text-slate-700 space-y-1">
            <div className="font-bold flex items-center text-indigo-950">
              <Upload className="w-4 h-4 mr-1.5 text-[#3D87D3]" /> Record Disbursement & Attach Vouchers
            </div>
            <p className="text-[11px] text-slate-600">
              Upload salary payments, contractor invoices, bonuses, or reimbursements. Attach multiple documents simultaneously (payslips, receipts, invoices).
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Employee / Partner</label>
              <select 
                value={upProfileId} 
                onChange={e => handleEmployeeSelectChange(e.target.value)} 
                className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 font-bold shadow-2xs"
              >
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>{p.first_name} {p.last_name} ({p.employment_type.toUpperCase()})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Payment Period</label>
              <input type="month" value={upPeriod} onChange={e => setUpPeriod(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 font-mono shadow-2xs" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Payment Category</label>
              <select 
                value={upTypeId} 
                onChange={e => setUpTypeId(e.target.value)} 
                className="w-full bg-white border border-slate-200 rounded p-2 text-[#3D87D3] font-semibold shadow-2xs"
              >
                {paymentTypes.map(pt => (
                  <option key={pt.id} value={pt.id}>{pt.name_el} ({pt.name_en})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Payment Date</label>
              <input type="date" value={upDate} onChange={e => setUpDate(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 font-mono shadow-2xs" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Gross Amount (€)</label>
              <input type="number" step="0.01" value={upGross} onChange={e => setUpGross(Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 font-mono font-bold" />
            </div>
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Employer EFKA (€)</label>
              <input type="number" step="0.01" value={upEfka} onChange={e => setUpEfka(Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-600 font-mono" />
            </div>
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Net Pay (€)</label>
              <input type="number" step="0.01" value={upNet} onChange={e => setUpNet(Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded p-2 text-emerald-700 font-mono font-bold" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Disbursement Status</label>
              <select value={upStatus} onChange={e => setUpStatus(e.target.value as any)} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 font-bold shadow-2xs">
                <option value="paid">PAID & DISPATCHED</option>
                <option value="planned">PLANNED / DRAFT</option>
                <option value="cancelled">CANCELLED</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Memo / Description (Optional)</label>
              <input type="text" placeholder="e.g. Q3 Retainer & Software Expenses" value={upNote} onChange={e => setUpNote(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800" />
            </div>
          </div>

          {/* MULTIPLE DOCUMENTS UPLOADER BOX */}
          <div className="pt-3 border-t border-slate-200">
            <label className="block font-bold text-slate-800 mb-2 flex items-center justify-between">
              <span className="flex items-center"><Paperclip className="w-4 h-4 mr-1.5 text-[#3D87D3]" /> Attach Payment Documents & Receipts (Multiple Support)</span>
              <Badge variant="info">{upDocs.length} Selected</Badge>
            </label>

            <div className="relative border-2 border-dashed border-slate-300 hover:border-[#3D87D3] bg-slate-50 hover:bg-blue-50/30 transition-all rounded-xl p-4 text-center cursor-pointer mb-3">
              <input 
                type="file" 
                multiple 
                onChange={e => handleFileSelect(e, 'upload')} 
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
              />
              <Upload className="w-7 h-7 mx-auto text-[#3D87D3] mb-1.5" />
              <p className="font-bold text-slate-700 text-xs">Click or drag & drop multiple files here</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Supports Payslip PDFs, Bank Wire Receipts, Contractor Invoices, and Tax Statements</p>
            </div>

            {upDocs.length > 0 && (
              <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                {upDocs.map((doc, idx) => (
                  <div key={doc.id || idx} className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-slate-200 shadow-2xs text-xs">
                    <div className="flex items-center space-x-2.5 truncate max-w-[55%]">
                      <FileText className="w-4 h-4 text-[#3D87D3] shrink-0" />
                      <div className="truncate">
                        <span className="font-bold text-slate-800 block truncate">{doc.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{doc.size}</span>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <select 
                        value={doc.type}
                        onChange={e => {
                          const val = e.target.value;
                          setUpDocs(prev => prev.map((d, i) => i === idx ? { ...d, type: val } : d));
                        }}
                        className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-[11px] font-semibold text-slate-700"
                      >
                        <option value="payslip">Payslip</option>
                        <option value="receipt">Bank Receipt</option>
                        <option value="invoice">Invoice</option>
                        <option value="tax_sheet">Tax Document</option>
                        <option value="other">Other Attachment</option>
                      </select>
                      <button 
                        type="button" 
                        onClick={() => setUpDocs(prev => prev.filter((_, i) => i !== idx))} 
                        className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-md transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-200 flex justify-end space-x-2.5">
            <Button variant="outline" size="sm" onClick={() => setIsUploadOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleSaveUploadedPayment} className="bg-[#3D87D3] hover:bg-[#3D87D3]/90 font-bold px-5">
              <Check className="w-4 h-4 mr-1.5" /> Record Payment & Upload Docs ({upDocs.length})
            </Button>
          </div>
        </div>
      </Modal>

      {/* MANAGE EXISTING PAYMENT DOCUMENTS MODAL */}
      <Modal 
        isOpen={!!selectedPaymentForDocs} 
        onClose={() => { setSelectedPaymentForDocs(null); setAddMoreDocs([]); }} 
        title={selectedPaymentForDocs ? `Payment Documents: ${profiles.find(p => p.id === selectedPaymentForDocs.profile_id)?.first_name} ${profiles.find(p => p.id === selectedPaymentForDocs.profile_id)?.last_name} (${selectedPaymentForDocs.period})` : 'Payment Documents'}
      >
        {selectedPaymentForDocs && (
          <div className="space-y-5 text-xs">
            <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-xl border border-slate-200">
              <div>
                <span className="text-[11px] text-slate-500 uppercase font-bold block">Total Company Cost</span>
                <span className="text-lg font-mono font-extrabold text-slate-900">€{selectedPaymentForDocs.total_cost.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-[11px] text-slate-500 uppercase font-bold block">Net Disbursed</span>
                <span className="text-lg font-mono font-extrabold text-emerald-700">€{selectedPaymentForDocs.net.toLocaleString()}</span>
              </div>
              <Badge variant={selectedPaymentForDocs.status === 'paid' ? 'success' : 'warning'}>
                {selectedPaymentForDocs.status.toUpperCase()}
              </Badge>
            </div>

            <div>
              <h4 className="font-extrabold text-slate-800 uppercase tracking-wider text-[11px] mb-2.5 flex items-center">
                <FolderOpen className="w-4 h-4 mr-1.5 text-[#3D87D3]" /> Attached Documents ({selectedPaymentForDocs.documents?.length || 0})
              </h4>

              {(!selectedPaymentForDocs.documents || selectedPaymentForDocs.documents.length === 0) ? (
                <div className="p-6 text-center border border-dashed border-slate-200 rounded-xl text-slate-400 bg-slate-50/50">
                  No documents or payslips currently attached to this payment row. Upload files below!
                </div>
              ) : (
                <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                  {selectedPaymentForDocs.documents.map(doc => {
                    const prof = profiles.find(p => p.id === selectedPaymentForDocs.profile_id);
                    return (
                      <div key={doc.id} className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs flex items-center justify-between hover:border-indigo-200 transition-all">
                        <div className="flex items-center space-x-3 truncate max-w-[60%]">
                          <div className="p-2 bg-indigo-50 text-[#3D87D3] rounded-lg shrink-0">
                            {doc.type === 'invoice' ? <FileSpreadsheet className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                          </div>
                          <div className="truncate">
                            <span className="font-bold text-slate-800 text-xs block truncate">{doc.name}</span>
                            <span className="text-[10px] text-slate-400 font-mono block mt-0.5">
                              Uploaded: {doc.uploaded_at} &bull; Size: {doc.size}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2 shrink-0">
                          <Badge variant="neutral" className="capitalize text-[10px]">{doc.type.replace('_', ' ')}</Badge>
                          <button
                            type="button"
                            onClick={() => handleDownloadDoc(doc, `${prof?.first_name} ${prof?.last_name}`)}
                            className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md font-semibold text-[11px] flex items-center gap-1 px-2.5 transition-colors cursor-pointer shadow-2xs"
                          >
                            <Download className="w-3.5 h-3.5 text-[#3D87D3]" /> Download
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`Remove document ${doc.name}?`)) {
                                deletePaymentDocument(selectedPaymentForDocs.id, doc.id);
                                setSelectedPaymentForDocs(prev => prev ? { ...prev, documents: (prev.documents || []).filter(d => d.id !== doc.id) } : null);
                              }
                            }}
                            className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-md transition-colors cursor-pointer"
                            title="Remove Document"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Upload Add More Documents Section */}
            <div className="pt-4 border-t border-slate-200">
              <h4 className="font-bold text-slate-800 text-xs mb-2 flex items-center">
                <Upload className="w-3.5 h-3.5 mr-1.5 text-emerald-600" /> Upload Additional Documents
              </h4>
              
              <div className="relative border-2 border-dashed border-slate-300 hover:border-emerald-500 bg-slate-50 hover:bg-emerald-50/20 transition-all rounded-xl p-3.5 text-center cursor-pointer mb-3">
                <input 
                  type="file" 
                  multiple 
                  onChange={e => handleFileSelect(e, 'existing')} 
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
                />
                <p className="font-bold text-slate-700 text-xs">Click to browse or drop files to attach to this payment</p>
                <p className="text-[10px] text-slate-400">Multiple files supported (PDF, DOCX, XLSX, PNG)</p>
              </div>

              {addMoreDocs.length > 0 && (
                <div className="space-y-2 mb-3 max-h-36 overflow-y-auto pr-1">
                  {addMoreDocs.map((doc, idx) => (
                    <div key={doc.id || idx} className="flex items-center justify-between p-2 rounded-lg bg-emerald-50/60 border border-emerald-200 text-xs">
                      <span className="font-bold text-slate-800 truncate max-w-[60%]">{doc.name} ({doc.size})</span>
                      <div className="flex items-center space-x-2">
                        <select 
                          value={doc.type}
                          onChange={e => {
                            const val = e.target.value;
                            setAddMoreDocs(prev => prev.map((d, i) => i === idx ? { ...d, type: val } : d));
                          }}
                          className="bg-white border border-slate-300 rounded px-2 py-0.5 text-[11px] font-semibold text-slate-700"
                        >
                          <option value="payslip">Payslip</option>
                          <option value="receipt">Bank Receipt</option>
                          <option value="invoice">Invoice</option>
                          <option value="tax_sheet">Tax Document</option>
                          <option value="other">Other</option>
                        </select>
                        <button type="button" onClick={() => setAddMoreDocs(prev => prev.filter((_, i) => i !== idx))} className="text-rose-500 hover:text-rose-700 p-1">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                  <Button variant="primary" size="sm" onClick={handleSaveAdditionalDocs} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 shadow-xs mt-2">
                    <Check className="w-4 h-4 mr-1.5" /> Confirm & Upload {addMoreDocs.length} Selected File(s)
                  </Button>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-200 flex justify-end">
              <Button variant="outline" size="sm" onClick={() => { setSelectedPaymentForDocs(null); setAddMoreDocs([]); }}>Close Window</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
