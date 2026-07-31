"use client";

import React, { useState, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, Button, Badge, StatCard, Modal } from '@/components/ui/primitives';
import { 
  DollarSign, Download, Plus, Sparkles, ShieldAlert, 
  Calendar, CheckCircle, RefreshCw, Layers, Sliders, TrendingUp,
  Upload, FileText, Trash2, FileCheck, Paperclip, ExternalLink, Eye, X, Check, FolderOpen, FileSpreadsheet,
  AlertTriangle, Edit, CheckSquare, Users, ShieldCheck, PieChart, Archive
} from 'lucide-react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { PaymentRecord, PaymentDocument, SalaryRecord, PaymentType } from '@/lib/types';

export default function PayrollPage() {
  const { 
    currentUser, profiles, paymentTypes, salaries, payments, 
    generateDraftMonth, addPaymentRecord, updatePaymentRecord, deletePaymentRecord, markAllPaidForPeriod,
    addPaymentDocuments, deletePaymentDocument, addPaymentType, addSalaryRecord, updateSalaryRecord 
  } = useAuth();
  
  const [selectedPeriod, setSelectedPeriod] = useState<string>('2026-07');
  const [tab, setTab] = useState<'ledger' | 'forecast' | 'payment_types'>('ledger');
  const [ledgerFilter, setLedgerFilter] = useState<'all' | 'planned' | 'paid' | 'missing_receipt'>('all');
  const [personFilter, setPersonFilter] = useState<string>('all');

  // Upload New Payment State
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [upProfileId, setUpProfileId] = useState('');
  const [upPeriod, setUpPeriod] = useState('2026-07');
  const [upTypeId, setUpTypeId] = useState('');
  const [upGross, setUpGross] = useState<number>(0);
  const [upEfka, setUpEfka] = useState<number>(0);
  const [upNet, setUpNet] = useState<number>(0);
  const [upDate, setUpDate] = useState('2026-07-28');
  const [upBankRef, setUpBankRef] = useState('');
  const [upStatus, setUpStatus] = useState<'paid' | 'planned' | 'cancelled'>('paid');
  const [upNote, setUpNote] = useState('');
  const [upDocs, setUpDocs] = useState<PaymentDocument[]>([]);

  // Adjust / Edit Existing Payment Modal
  const [editingPayment, setEditingPayment] = useState<PaymentRecord | null>(null);
  const [edGross, setEdGross] = useState<number>(0);
  const [edEfka, setEdEfka] = useState<number>(0);
  const [edNet, setEdNet] = useState<number>(0);
  const [edDate, setEdDate] = useState('');
  const [edBankRef, setEdBankRef] = useState('');
  const [edStatus, setEdStatus] = useState<'paid' | 'planned' | 'cancelled'>('paid');
  const [edNote, setEdNote] = useState('');

  // Existing Payment Documents Management Modal State
  const [selectedPaymentForDocs, setSelectedPaymentForDocs] = useState<PaymentRecord | null>(null);
  const [addMoreDocs, setAddMoreDocs] = useState<PaymentDocument[]>([]);
  
  // New dynamic payment type state
  const [isTypeOpen, setIsTypeOpen] = useState(false);
  const [ptCode, setPtCode] = useState('bonus_midyear');
  const [ptNameEl, setPtNameEl] = useState('Επιπλέον Αμοιβή');
  const [ptNameEn, setPtNameEn] = useState('Mid-Year Performance Bonus');
  const [ptMult, setPtMult] = useState(0.5);
  const [ptStatutory, setPtStatutory] = useState(false);
  const [ptRecurring, setPtRecurring] = useState(false);
  const [ptMonth, setPtMonth] = useState<string>('');

  // Record Raise / Salary Record Modal
  const [isRaiseOpen, setIsRaiseOpen] = useState(false);
  const [rsProfileId, setRsProfileId] = useState('');
  const [rsBasis, setRsBasis] = useState<'monthly_gross' | 'daily_rate' | 'fixed_fee' | 'fee'>('monthly_gross');
  const [rsGross, setRsGross] = useState<number>(3500);
  const [rsMultiplier, setRsMultiplier] = useState<number>(1.24);
  const [rsValidFrom, setRsValidFrom] = useState<string>('2026-08-01');
  const [rsNote, setRsNote] = useState<string>('Annual compensation review');

  // Accountant Export Modal
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [includeReceiptsZip, setIncludeReceiptsZip] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // Bulk Receipt Matcher Modal
  const [isBulkMatchOpen, setIsBulkMatchOpen] = useState(false);
  const [bulkFiles, setBulkFiles] = useState<{ file: File; paymentId: string }[]>([]);

  const isAdmin = currentUser.role === 'admin';

  if (!isAdmin) {
    return (
      <div className="p-10 text-center bg-rose-50 border border-rose-200 rounded-2xl max-w-xl mx-auto my-12 space-y-3 shadow-xs">
        <ShieldAlert className="w-12 h-12 mx-auto text-rose-600" />
        <h2 className="text-xl font-bold text-slate-800">403 Forbidden &mdash; Strictly Admin Restricted</h2>
        <p className="text-xs text-slate-600">
          Compensation ledgers, contractor invoice rates, and salary history are confidential under Supabase Row-Level Security and accessible solely to Founders & Admins.
        </p>
      </div>
    );
  }

  const periodPayments = payments.filter(p => p.period === selectedPeriod && (personFilter === 'all' || p.profile_id === personFilter));
  const totalCost = periodPayments.reduce((acc, p) => acc + p.total_cost, 0);
  const totalNet = periodPayments.reduce((acc, p) => acc + p.net, 0);

  // Missing receipts check
  const paidMissingDocs = periodPayments.filter(p => p.status === 'paid' && (!p.documents || p.documents.length === 0));
  const plannedPayments = periodPayments.filter(p => p.status === 'planned');

  // Filtered ledger rows
  const displayedPayments = useMemo(() => {
    return periodPayments.filter(p => {
      if (ledgerFilter === 'planned') return p.status === 'planned';
      if (ledgerFilter === 'paid') return p.status === 'paid';
      if (ledgerFilter === 'missing_receipt') return p.status === 'paid' && (!p.documents || p.documents.length === 0);
      return true;
    });
  }, [periodPayments, ledgerFilter]);

  const handleGenerateDraft = async () => {
    await generateDraftMonth(selectedPeriod);
  };

  const handleMarkAllPaid = async () => {
    if (!confirm(`Are you sure you want to mark all ${plannedPayments.length} planned/draft rows in ${selectedPeriod} as PAID? Once marked paid, they lock for standard editing and become visible to employees in their self-service portal.`)) return;
    await markAllPaidForPeriod(selectedPeriod);
    alert(`All draft rows for ${selectedPeriod} marked as PAID!`);
  };

  // One-click Accountant Package Export (XLSX + optional ZIP of receipts)
  const handleAccountantExportConfirm = async () => {
    setIsExporting(true);
    try {
      const data = periodPayments.map(p => {
        const prof = profiles.find(pr => pr.id === p.profile_id);
        const pt = paymentTypes.find(type => type.id === p.payment_type_id);
        const taxId = prof?.id.replace('prof-', 'EL09876') || 'EL098765432'; // AFM default
        return {
          Period: p.period,
          Employee_ID: p.profile_id,
          AFM_Tax_ID: taxId,
          Name_GR: prof?.name_el,
          Name_EN: `${prof?.first_name} ${prof?.last_name}`,
          Employment_Type: prof?.employment_type.toUpperCase(),
          Payment_Type_GR: pt?.name_el || 'Μισθός',
          Payment_Type_Code: pt?.code || 'salary',
          Gross_Amount: p.gross,
          Net_Payable: p.net,
          Employer_Contributions: p.employer_contributions,
          Total_Company_Cost: p.total_cost,
          Payment_Date: p.payment_date,
          Bank_Reference: p.bank_reference || 'N/A',
          Status: p.status.toUpperCase(),
          Attached_Receipts: p.documents?.length || 0
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(data);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, `Payroll_${selectedPeriod}`);
      XLSX.writeFile(workbook, `StellarBlue_Accountant_Package_${selectedPeriod}.xlsx`);

      // Generate ZIP of receipt documents if toggle is checked
      if (includeReceiptsZip) {
        const zip = new JSZip();
        const receiptsFolder = zip.folder(`Receipts_${selectedPeriod}`);

        let totalDocsAdded = 0;
        periodPayments.forEach(p => {
          if (p.documents && p.documents.length > 0) {
            const prof = profiles.find(pr => pr.id === p.profile_id);
            const pt = paymentTypes.find(type => type.id === p.payment_type_id);
            const afm = prof?.id.replace('prof-', '9876') || '098765432';
            
            p.documents.forEach((doc, i) => {
              // Naming convention: {ΑΦΜ}_{type}_{YYYY-MM}.pdf
              const suffix = p.documents!.length > 1 ? `_part${i + 1}` : '';
              const filename = `${afm}_${pt?.code || 'pay'}_${selectedPeriod}${suffix}.pdf`;
              
              // Generate verifiable mock content representing the stored receipt voucher
              const receiptContent = `STELLARBLUE SYSTEMS ORBIT — ACCOUNTANT RECEIPT ARCHIVE\nFile Name: ${filename}\nOriginal Upload: ${doc.name} (${doc.size})\nEmployee: ${prof?.first_name} ${prof?.last_name} (AFM: ${afm})\nPeriod: ${p.period}\nPayment Type: ${pt?.name_el} (${pt?.name_en})\nTotal Cost: €${p.total_cost} | Net Disbursed: €${p.net}\nBank Ref: ${p.bank_reference || 'WIRE-TRANSFER'}\nUploaded At: ${doc.uploaded_at}\nEncrypted & Stored in Private Supabase Vault under RLS`;
              
              receiptsFolder?.file(filename, receiptContent);
              totalDocsAdded++;
            });
          }
        });

        if (totalDocsAdded > 0) {
          const content = await zip.generateAsync({ type: 'blob' });
          const url = URL.createObjectURL(content);
          const link = document.createElement('a');
          link.href = url;
          link.download = `StellarBlue_Receipt_Bundle_${selectedPeriod}.zip`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        }
      }

      setIsExportOpen(false);
      alert(`Accountant bundle exported successfully! Generated Excel ledger sheet ${includeReceiptsZip ? '+ ZIP archive with receipt PDFs matching {ΑΦΜ}_{type}_{YYYY-MM}.pdf structure' : ''}.`);
    } catch (e) {
      console.error('Export failed:', e);
      alert('Error generating accountant export package.');
    } finally {
      setIsExporting(false);
    }
  };

  // Calculate 12-Month Forward Burn Forecast
  const twelveMonthForecast = useMemo(() => {
    const activeSalaries = salaries.filter(s => !s.valid_to);
    const months: { monthStr: string; monthLabel: string; monthNum: number; regularCost: number; statutoryCost: number; statutoryItems: string[]; totalCost: number }[] = [];

    // Parse current year & month from selectedPeriod
    let [year, m] = selectedPeriod.split('-').map(Number);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    for (let i = 0; i < 12; i++) {
      const currentM = ((m - 1 + i) % 12) + 1;
      const currentY = year + Math.floor((m - 1 + i) / 12);
      const monthStr = `${currentY}-${String(currentM).padStart(2, '0')}`;
      const monthLabel = `${monthNames[currentM - 1]} ${currentY}`;

      // Regular Monthly Cost (Salaries + Contractor Fees using multiplier)
      let regularCost = 0;
      activeSalaries.forEach(sal => {
        const mult = sal.employer_cost_multiplier ?? (sal.employer_cost_pct ? Number((1 + sal.employer_cost_pct / 100).toFixed(4)) : 1.24);
        const loadedCost = Number((sal.gross_amount * mult).toFixed(2));
        regularCost += loadedCost;
      });

      // Statutory Extras Cost for employees in matching default months (e.g., April Easter, July Holiday, Dec Christmas)
      let statutoryCost = 0;
      const statutoryItems: string[] = [];
      const statTypes = paymentTypes.filter(t => t.is_statutory && !t.is_recurring_monthly && t.default_period_month === currentM);

      if (statTypes.length > 0) {
        statTypes.forEach(st => {
          statutoryItems.push(st.name_el);
          activeSalaries.forEach(sal => {
            const prof = profiles.find(pr => pr.id === sal.profile_id);
            if (prof && prof.employment_type !== 'contractor') { // Contractors do not get Greek statutory bonuses
              const mult = sal.employer_cost_multiplier ?? (sal.employer_cost_pct ? Number((1 + sal.employer_cost_pct / 100).toFixed(4)) : 1.24);
              const statGross = sal.gross_amount * (st.default_multiplier ?? 1.0);
              statutoryCost += Number((statGross * mult).toFixed(2));
            }
          });
        });
      }

      months.push({
        monthStr,
        monthLabel,
        monthNum: currentM,
        regularCost: Math.round(regularCost),
        statutoryCost: Math.round(statutoryCost),
        statutoryItems,
        totalCost: Math.round(regularCost + statutoryCost)
      });
    }

    return months;
  }, [salaries, selectedPeriod, paymentTypes, profiles]);

  const annualProjectedBurn = twelveMonthForecast.reduce((acc, m) => acc + m.totalCost, 0);

  const openUploadModal = () => {
    const defaultProf = profiles.filter(p => p.status === 'active')[0] || profiles[0];
    const defaultType = paymentTypes[0];
    setUpProfileId(defaultProf?.id || '');
    setUpTypeId(defaultType?.id || '');
    setUpPeriod(selectedPeriod);
    setUpDate(`${selectedPeriod}-28`);
    setUpBankRef('');
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
    if (!files) return;

    const newDocs: PaymentDocument[] = Array.from(files).map((f, i) => ({
      id: `doc-${Date.now()}-${i}`,
      name: f.name,
      type: f.name.toLowerCase().includes('inv') ? 'invoice' : f.name.toLowerCase().includes('payslip') ? 'payslip' : 'receipt',
      size: `${(f.size / 1024).toFixed(0)} KB`,
      uploaded_at: new Date().toISOString().split('T')[0]
    }));

    if (target === 'upload') {
      setUpDocs(prev => [...prev, ...newDocs]);
    } else {
      setAddMoreDocs(prev => [...prev, ...newDocs]);
    }
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
      bank_reference: upBankRef.trim() || undefined,
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

  const handleDownloadDoc = (doc: PaymentDocument, profName?: string, bankRef?: string) => {
    const content = `STELLARBLUE SYSTEMS ORBIT — VERIFIED PAYMENT DOCUMENT\nDocument ID: ${doc.id}\nType: ${doc.type.toUpperCase()}\nFile Size: ${doc.size}\nUploaded: ${doc.uploaded_at}\nEmployee: ${profName || 'Staff'}\nBank Reference: ${bankRef || 'WIRE-TRANSFER'}\nStatus: Verified and Encrypted under RLS Vault`;
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

  // Open Adjust / Edit Modal
  const handleOpenEditModal = (pay: PaymentRecord) => {
    setEditingPayment(pay);
    setEdGross(pay.gross);
    setEdEfka(pay.employer_contributions);
    setEdNet(pay.net);
    setEdDate(pay.payment_date || `${selectedPeriod}-28`);
    setEdBankRef(pay.bank_reference || '');
    setEdStatus(pay.status);
    setEdNote(pay.note || '');
  };

  const handleSaveEditedPayment = async () => {
    if (!editingPayment) return;
    const total_cost = Number((Number(edGross) + Number(edEfka)).toFixed(2));
    
    await updatePaymentRecord(editingPayment.id, {
      gross: Number(edGross),
      employer_contributions: Number(edEfka),
      net: Number(edNet),
      total_cost,
      payment_date: edDate,
      bank_reference: edBankRef.trim() || undefined,
      status: edStatus,
      note: edNote.trim() || undefined
    });

    setEditingPayment(null);
    alert('Payment row updated against payroll run!');
  };

  // Save Raise / New Salary Record (Never edit in place)
  const handleSaveRaise = async () => {
    if (!rsProfileId || rsGross <= 0) {
      alert('Please enter a valid gross amount and select an employee.');
      return;
    }
    await addSalaryRecord({
      profile_id: rsProfileId,
      valid_from: rsValidFrom,
      basis: rsBasis,
      gross_amount: Number(rsGross),
      currency: 'EUR',
      employer_cost_pct: rsMultiplier > 1 ? Number(((rsMultiplier - 1) * 100).toFixed(2)) : undefined,
      employer_cost_multiplier: Number(rsMultiplier),
      note: rsNote.trim() || undefined
    });
    setIsRaiseOpen(false);
    alert('New salary record recorded! Previous active record automatically closed to preserve salary history.');
  };

  // Save Dynamic Payment Type
  const handleSaveNewPaymentType = async () => {
    if (!ptNameEl.trim()) {
      alert('Please enter a Greek name for the payment category.');
      return;
    }
    await addPaymentType({
      code: ptCode.trim() || `type_${Date.now()}`,
      name_el: ptNameEl.trim(),
      name_en: ptNameEn.trim() || ptNameEl.trim(),
      is_statutory: ptStatutory,
      is_recurring_monthly: ptRecurring,
      default_period_month: ptMonth ? Number(ptMonth) : undefined,
      default_multiplier: Number(ptMult),
      applies_to: ['full_time', 'part_time', 'contractor', 'intern'],
      active: true
    });
    setIsTypeOpen(false);
    alert('New payment type created! Available instantly for monthly drafts and manual disbursements.');
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
            Version 1 Simple Ledger: Greek 14-salary statutory items, contractor retainers, effective-dated raise histories, and RLS receipt vaults.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input 
            type="month" 
            value={selectedPeriod} 
            onChange={e => setSelectedPeriod(e.target.value)} 
            className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 font-mono shadow-2xs font-bold"
          />
          <Button variant="primary" size="sm" onClick={openUploadModal} className="bg-[#3D87D3] hover:bg-[#3D87D3]/90 shadow-xs cursor-pointer font-bold">
            <Upload className="w-3.5 h-3.5 mr-1.5 text-white" /> Upload Payment
          </Button>
          <Button variant="secondary" size="sm" onClick={handleGenerateDraft} className="cursor-pointer font-semibold">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5 text-[#3D87D3]" /> Generate Draft Month (&lt;5 min)
          </Button>
          <Button variant="primary" size="sm" onClick={() => setIsExportOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 shadow-xs cursor-pointer font-semibold">
            <Download className="w-4 h-4 mr-1.5" /> One-Click Accountant Bundle
          </Button>
        </div>
      </div>

      {/* Missing Receipts Alert Checklist (if paid rows lack receipts) */}
      {paidMissingDocs.length > 0 && (
        <div className="p-4 bg-amber-50 border border-amber-300/80 rounded-2xl shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-pulse">
          <div className="flex items-center space-x-3">
            <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0" />
            <div>
              <h4 className="font-extrabold text-amber-950 text-sm">⚠️ Admin Checklist: {paidMissingDocs.length} Paid Payment(s) Missing Receipt Documents in {selectedPeriod}</h4>
              <p className="text-xs text-amber-800 mt-0.5">
                Paid rows require attached payslips or bank transfer receipts before transmitting to the accountant or locking for employee self-service viewing.
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2 shrink-0">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => { setTab('ledger'); setLedgerFilter('missing_receipt'); }} 
              className="bg-white border-amber-400 text-amber-900 font-bold hover:bg-amber-100"
            >
              Show Missing Receipts Only
            </Button>
            <Button 
              variant="primary" 
              size="sm" 
              onClick={() => {
                // Quick bulk receipt attachment demonstration
                if (confirm(`Bulk upload default receipt confirmations for all ${paidMissingDocs.length} pending paid payments in ${selectedPeriod}?`)) {
                  paidMissingDocs.forEach(p => {
                    const prof = profiles.find(pr => pr.id === p.profile_id);
                    addPaymentDocuments(p.id, [{
                      id: `doc-auto-${Date.now()}-${p.id}`,
                      name: `Bank_Transfer_Receipt_${prof?.last_name || 'Staff'}_${selectedPeriod}.pdf`,
                      type: 'receipt',
                      size: '142 KB',
                      uploaded_at: new Date().toISOString().split('T')[0]
                    }]);
                  });
                  alert('Bulk matched and uploaded receipts to all pending rows!');
                }
              }} 
              className="bg-amber-600 hover:bg-amber-700 text-white font-bold"
            >
              <Upload className="w-3.5 h-3.5 mr-1.5" /> Bulk Match & Upload Vouchers
            </Button>
          </div>
        </div>
      )}

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
          subtitle={`Across ${periodPayments.length} ledger rows (${paidMissingDocs.length} missing docs)`}
          icon={<CheckCircle className="w-5 h-5 text-emerald-600" />}
        />
        <StatCard 
          title="12-Month Forward Projected Burn"
          value={`€${Math.round(annualProjectedBurn).toLocaleString()}`}
          subtitle="Includes Easter, Holiday & Christmas Greek statutory salaries"
          icon={<TrendingUp className="w-5 h-5 text-blue-600" />}
        />
      </div>

      {/* Tabs & Filters Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-200 pb-3 text-sm">
        <div className="flex space-x-6">
          <button 
            onClick={() => setTab('ledger')}
            className={`pb-2 font-semibold transition-all cursor-pointer ${tab === 'ledger' ? 'border-b-2 border-[#3D87D3] text-[#3D87D3] font-bold' : 'text-slate-500 hover:text-slate-800'}`}
          >
            Payment Ledger ({selectedPeriod})
          </button>
          <button 
            onClick={() => setTab('forecast')}
            className={`pb-2 font-semibold transition-all cursor-pointer ${tab === 'forecast' ? 'border-b-2 border-[#3D87D3] text-[#3D87D3] font-bold' : 'text-slate-500 hover:text-slate-800'}`}
          >
            Salary Records & 12-Month Burn Forecast
          </button>
          <button 
            onClick={() => setTab('payment_types')}
            className={`pb-2 font-semibold transition-all flex items-center cursor-pointer ${tab === 'payment_types' ? 'border-b-2 border-[#3D87D3] text-[#3D87D3] font-bold' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <Sliders className="w-3.5 h-3.5 mr-1.5 text-[#3D87D3]" /> Payment Types Table
          </button>
        </div>

        {tab === 'ledger' && (
          <div className="flex items-center gap-2 flex-wrap">
            <select 
              value={personFilter} 
              onChange={e => setPersonFilter(e.target.value)} 
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-700 font-medium"
            >
              <option value="all">👥 All Employees & Contractors</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
              ))}
            </select>
            <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200/80 text-xs font-semibold">
              <button onClick={() => setLedgerFilter('all')} className={`px-2.5 py-1 rounded-md transition-colors ${ledgerFilter === 'all' ? 'bg-white text-slate-800 shadow-2xs font-bold' : 'text-slate-600'}`}>All</button>
              <button onClick={() => setLedgerFilter('planned')} className={`px-2.5 py-1 rounded-md transition-colors ${ledgerFilter === 'planned' ? 'bg-white text-[#3D87D3] shadow-2xs font-bold' : 'text-slate-600'}`}>Draft Planned ({plannedPayments.length})</button>
              <button onClick={() => setLedgerFilter('paid')} className={`px-2.5 py-1 rounded-md transition-colors ${ledgerFilter === 'paid' ? 'bg-white text-emerald-700 shadow-2xs font-bold' : 'text-slate-600'}`}>Paid</button>
              {paidMissingDocs.length > 0 && (
                <button onClick={() => setLedgerFilter('missing_receipt')} className={`px-2 py-1 rounded-md transition-colors ${ledgerFilter === 'missing_receipt' ? 'bg-amber-100 text-amber-900 shadow-2xs font-extrabold' : 'text-amber-700'}`}>⚠️ Missing ({paidMissingDocs.length})</button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* TAB 1: LEDGER TABLE */}
      {tab === 'ledger' && (
        <div className="space-y-4">
          {plannedPayments.length > 0 && (
            <div className="flex items-center justify-between p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl text-xs text-indigo-950">
              <span><strong>Workflow Ready:</strong> You have {plannedPayments.length} draft/planned payment rows awaiting review for {selectedPeriod}. Adjust amounts against payroll run, then finalize.</span>
              <Button variant="primary" size="sm" onClick={handleMarkAllPaid} className="bg-[#3D87D3] hover:bg-[#3D87D3]/90 font-bold shrink-0 shadow-xs">
                <CheckSquare className="w-4 h-4 mr-1.5" /> ✓ Mark All Drafts Paid ({plannedPayments.length})
              </Button>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/90 text-[11px] font-semibold uppercase text-slate-500 tracking-wider">
                  <th className="p-3.5 pl-5">Employee / Partner</th>
                  <th className="p-3.5">Payment Type</th>
                  <th className="p-3.5">Gross Amount</th>
                  <th className="p-3.5">Net Pay</th>
                  <th className="p-3.5">Employer EFKA</th>
                  <th className="p-3.5">Total Cost</th>
                  <th className="p-3.5">Bank Reference</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5 text-right pr-5">Vouchers & Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {displayedPayments.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-slate-500 italic">
                      No payment records found for {selectedPeriod} matching filter. Click <strong>&ldquo;Generate Draft Month&rdquo;</strong> above to instantiate planned rows!
                    </td>
                  </tr>
                ) : (
                  displayedPayments.map(pay => {
                    const prof = profiles.find(p => p.id === pay.profile_id);
                    const pt = paymentTypes.find(type => type.id === pay.payment_type_id);
                    const missingDoc = pay.status === 'paid' && (!pay.documents || pay.documents.length === 0);

                    return (
                      <tr key={pay.id} className={`hover:bg-slate-50/80 transition-colors ${missingDoc ? 'bg-amber-50/30' : ''}`}>
                        <td className="p-3.5 pl-5 font-bold text-slate-800">
                          {prof?.first_name} {prof?.last_name}
                          <span className="text-xs text-slate-500 font-normal block">{prof?.title} ({prof?.employment_type})</span>
                        </td>
                        <td className="p-3.5 text-xs text-[#3D87D3] font-medium">
                          {pt?.name_el || pay.payment_type?.name_el || 'Μισθός'}
                          <span className="text-[10px] text-slate-400 block font-normal">{pt?.name_en || pay.payment_type?.name_en}</span>
                        </td>
                        <td className="p-3.5 font-mono text-slate-700">€{pay.gross.toLocaleString()}</td>
                        <td className="p-3.5 font-mono font-bold text-emerald-700">€{pay.net.toLocaleString()}</td>
                        <td className="p-3.5 font-mono text-slate-600">€{pay.employer_contributions.toLocaleString()}</td>
                        <td className="p-3.5 font-mono font-extrabold text-slate-900 bg-slate-50/80">€{pay.total_cost.toLocaleString()}</td>
                        <td className="p-3.5 font-mono text-xs text-slate-600 max-w-[120px] truncate">
                          {pay.bank_reference || <span className="text-slate-400 italic font-sans font-normal">Pending Ref</span>}
                        </td>
                        <td className="p-3.5">
                          <Badge variant={pay.status === 'paid' ? 'success' : pay.status === 'planned' ? 'warning' : 'neutral'}>
                            {pay.status.toUpperCase()}
                          </Badge>
                          {missingDoc && (
                            <span className="text-[10px] text-amber-700 font-bold block mt-1">⚠️ Missing Receipt</span>
                          )}
                        </td>
                        <td className="p-3.5 text-right pr-5">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleOpenEditModal(pay)}
                              title="Adjust Amounts / Edit"
                              className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                setSelectedPaymentForDocs(pay);
                                setAddMoreDocs([]);
                              }}
                              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-semibold transition-all cursor-pointer shadow-2xs ${missingDoc ? 'bg-amber-100 border-amber-300 text-amber-900 font-bold' : 'bg-slate-100 hover:bg-indigo-50 border-slate-200 hover:border-indigo-200 text-slate-700 hover:text-indigo-700'}`}
                            >
                              <Paperclip className="w-3.5 h-3.5 text-[#3D87D3]" />
                              {pay.documents && pay.documents.length > 0 ? (
                                <span className="font-bold text-slate-900">{pay.documents.length} doc{pay.documents.length !== 1 ? 's' : ''}</span>
                              ) : (
                                <span>{missingDoc ? '+ Attach Receipt' : 'Attach Docs'}</span>
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: SALARY RECORDS HISTORY & 12-MONTH BURN FORECAST */}
      {tab === 'forecast' && (
        <div className="space-y-8">
          <Card 
            title="Effective-Dated Salary Ledger & Multipliers" 
            subtitle="Never edit salaries in place: recording a raise closes the old record with valid_to and adds a new row, generating complete salary histories automatically." 
            action={
              <Button size="sm" variant="primary" onClick={() => {
                const p = profiles.filter(p => p.status === 'active')[0];
                setRsProfileId(p?.id || '');
                setIsRaiseOpen(true);
              }} className="bg-[#3D87D3] hover:bg-[#3D87D3]/90 font-bold cursor-pointer">
                <Plus className="w-3.5 h-3.5 mr-1" /> Record Raise / New Contract
              </Button>
            }
          >
            <div className="space-y-3 mt-3">
              {salaries.map(sal => {
                const prof = profiles.find(p => p.id === sal.profile_id);
                const isActive = !sal.valid_to;
                const mult = sal.employer_cost_multiplier ?? (sal.employer_cost_pct ? Number((1 + sal.employer_cost_pct / 100).toFixed(4)) : 1.24);
                const loadedMonthly = Number((sal.gross_amount * mult).toFixed(2));

                return (
                  <div key={sal.id} className={`p-4 rounded-xl border transition-all flex items-center justify-between text-xs ${isActive ? 'bg-white border-slate-200 shadow-2xs' : 'bg-slate-50/70 border-slate-200 opacity-75'}`}>
                    <div className="flex items-center space-x-3.5">
                      <Badge variant={isActive ? 'success' : 'neutral'}>{isActive ? 'ACTIVE RATE' : 'PAST HISTORY'}</Badge>
                      <div>
                        <span className="font-bold text-slate-800 text-sm block">{prof?.first_name} {prof?.last_name} <span className="text-xs font-normal text-slate-500">({prof?.title})</span></span>
                        <span className="text-slate-500 block mt-0.5">
                          Validity: <strong className="font-mono text-slate-700">{sal.valid_from}</strong> &rarr; <strong className="font-mono text-slate-700">{sal.valid_to || 'Present'}</strong>
                          {sal.note && <span className="ml-2 text-slate-400">&bull; {sal.note}</span>}
                        </span>
                      </div>
                    </div>
                    <div className="text-right flex items-center space-x-6">
                      <div>
                        <span className="text-xs text-slate-400 font-medium block">Employer Multiplier</span>
                        <span className="font-mono font-bold text-[#3D87D3] text-sm">&times;{mult}</span>
                      </div>
                      <div>
                        <span className="text-xs text-slate-400 font-medium block">Gross Base ({sal.basis.replace('_', ' ')})</span>
                        <span className="font-mono font-bold text-slate-800 text-sm">€{sal.gross_amount.toLocaleString()}</span>
                      </div>
                      <div className="bg-slate-50 px-3.5 py-1.5 rounded-xl border border-slate-200/80">
                        <span className="text-[10px] text-slate-500 uppercase font-bold block">Fully-Loaded Cost</span>
                        <span className="text-base font-mono font-extrabold text-emerald-700">€{loadedMonthly.toLocaleString()} <span className="text-[11px] text-slate-400 font-normal">/mo</span></span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="12-Month Projected Burn Engine (Statutory Included)" subtitle="Projected monthly expenditures across all active staff, incorporating Greek statutory salaries (Month 4 Easter, Month 7 Holiday Allowance, Month 12 Christmas) so real expenditures never surprise management.">
            <div className="mt-3 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/90 text-[11px] font-semibold uppercase text-slate-500 tracking-wider">
                    <th className="p-3.5 pl-5">Forecast Month</th>
                    <th className="p-3.5">Regular Salaries & Retainers</th>
                    <th className="p-3.5">Statutory Extras (Δώρα / Αδείες)</th>
                    <th className="p-3.5">Applicable Statutory Items</th>
                    <th className="p-3.5 text-right pr-5">Total Projected Burn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {twelveMonthForecast.map(m => {
                    const isStatutoryMonth = m.statutoryCost > 0;
                    return (
                      <tr key={m.monthStr} className={`hover:bg-slate-50 transition-colors ${isStatutoryMonth ? 'bg-blue-50/30' : ''}`}>
                        <td className="p-3.5 pl-5 font-bold text-slate-800 font-mono text-sm">
                          {m.monthLabel}
                          {isStatutoryMonth && <Badge variant="info" className="ml-2">13th/14th Salary Month</Badge>}
                        </td>
                        <td className="p-3.5 font-mono text-slate-700 font-medium">€{m.regularCost.toLocaleString()}</td>
                        <td className="p-3.5 font-mono font-bold text-[#3D87D3]">€{m.statutoryCost.toLocaleString()}</td>
                        <td className="p-3.5 text-slate-600 font-semibold">
                          {m.statutoryItems.length > 0 ? m.statutoryItems.join(', ') : <span className="text-slate-400 font-normal italic">Regular Payroll Only</span>}
                        </td>
                        <td className="p-3.5 text-right pr-5 font-mono text-base font-extrabold text-slate-900">
                          €{m.totalCost.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-slate-100 font-extrabold border-t-2 border-slate-300 text-sm">
                    <td colSpan={4} className="p-4 pl-5 text-right uppercase tracking-wider text-slate-700">12-Month Total Projected Burn Commitment:</td>
                    <td className="p-4 pr-5 text-right font-mono text-lg text-emerald-800">€{annualProjectedBurn.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* TAB 3: PAYMENT TYPES SETTINGS */}
      {tab === 'payment_types' && (
        <Card title="Dynamic Payment Types Administration" subtitle="A table of payroll categories rather than hardcoded rules. Configures Greek statutory defaults, recurrence rules, and employee applicability." action={
          <Button size="sm" variant="primary" onClick={() => setIsTypeOpen(true)} className="bg-[#3D87D3] hover:bg-[#3D87D3]/90 font-bold cursor-pointer">
            <Plus className="w-3.5 h-3.5 mr-1" /> Add Payment Category
          </Button>
        }>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
            {paymentTypes.map(pt => (
              <div key={pt.id} className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs flex flex-col justify-between space-y-3 hover:border-indigo-200 transition-all">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant={pt.is_statutory ? 'info' : pt.is_recurring_monthly ? 'success' : 'neutral'}>
                      {pt.is_statutory ? 'Statutory (Εργ. Νόμος)' : pt.is_recurring_monthly ? 'Recurring Monthly' : 'One-Off / Variable'}
                    </Badge>
                    <span className="font-mono text-xs text-slate-400">Code: {pt.code}</span>
                  </div>
                  <h4 className="font-bold text-slate-800 text-base mt-2">{pt.name_el}</h4>
                  <p className="text-xs text-slate-500 font-medium">{pt.name_en}</p>
                </div>

                <div className="pt-3 border-t border-slate-100 text-xs text-slate-500 space-y-1.5">
                  <div className="flex justify-between">
                    <span>Default Month:</span>
                    <strong className="font-mono text-slate-700 font-semibold">
                      {pt.default_period_month ? `Month #${pt.default_period_month} (${['', 'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][pt.default_period_month]})` : 'Every Month / As Needed'}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Default Multiplier:</span>
                    <strong className="font-mono text-[#3D87D3] font-bold">{pt.default_multiplier ? `${pt.default_multiplier}x monthly salary` : 'Variable Amount'}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Applies to:</span>
                    <span className="text-slate-700 font-semibold">{pt.applies_to.join(', ')}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* RECORD RAISE MODAL */}
      <Modal isOpen={isRaiseOpen} onClose={() => setIsRaiseOpen(false)} title="Record Compensation Raise / New Contract">
        <div className="space-y-4 text-xs">
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-slate-700">
            <strong>Salary History Best Practice:</strong> Never edit existing salaries in place. This modal registers the new rate starting on the Effective Date and automatically sets valid_to on their previous record.
          </div>

          <div>
            <label className="block font-semibold uppercase text-slate-500 mb-1">Employee / Contractor</label>
            <select value={rsProfileId} onChange={e => {
              setRsProfileId(e.target.value);
              const pr = profiles.find(p => p.id === e.target.value);
              if (pr?.employment_type === 'contractor') {
                setRsBasis('fixed_fee');
                setRsMultiplier(1.0);
              } else {
                setRsBasis('monthly_gross');
                setRsMultiplier(1.24);
              }
            }} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 font-bold">
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.first_name} {p.last_name} ({p.employment_type})</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Compensation Basis</label>
              <select value={rsBasis} onChange={e => setRsBasis(e.target.value as any)} className="w-full bg-white border border-slate-200 rounded p-2 font-semibold text-slate-700">
                <option value="monthly_gross">Monthly Gross (Salary)</option>
                <option value="daily_rate">Daily Rate</option>
                <option value="fixed_fee">Fixed Retainer Fee (Excl VAT)</option>
                <option value="fee">Contractor Fee</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">New Gross Amount (€)</label>
              <input type="number" step="50" value={rsGross} onChange={e => setRsGross(Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded p-2 font-mono text-base font-bold text-emerald-700" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Employer Cost Multiplier</label>
              <input type="number" step="0.01" value={rsMultiplier} onChange={e => setRsMultiplier(Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded p-2 font-mono text-slate-800" />
              <p className="text-[10px] text-slate-400 mt-0.5">e.g. 1.24 for 24% employer EFKA, 1.0 for invoices</p>
            </div>
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Effective From Date</label>
              <input type="date" value={rsValidFrom} onChange={e => setRsValidFrom(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2 font-mono text-slate-800 font-bold" />
            </div>
          </div>

          <div>
            <label className="block font-semibold uppercase text-slate-500 mb-1">Note / Review Reason</label>
            <input type="text" placeholder="e.g. 2026 Annual Promotion Review" value={rsNote} onChange={e => setRsNote(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800" />
          </div>

          <div className="pt-3 border-t border-slate-200 flex justify-end space-x-2">
            <Button variant="outline" size="sm" onClick={() => setIsRaiseOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleSaveRaise} className="bg-[#3D87D3] hover:bg-[#3D87D3]/90 font-bold">Record Salary Record &rarr;</Button>
          </div>
        </div>
      </Modal>

      {/* ACCOUNTANT EXPORT OPTIONS MODAL */}
      <Modal isOpen={isExportOpen} onClose={() => setIsExportOpen(false)} title="Accountant Package Export (&sect;5 Requirement)">
        <div className="space-y-4 text-xs">
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-950 space-y-1">
            <div className="font-bold flex items-center text-sm">
              <Download className="w-4 h-4 mr-1.5 text-emerald-600" /> Export Monthly Accounting Package ({selectedPeriod})
            </div>
            <p className="text-xs text-emerald-800">
              One button generates the accountant workbook with all payment rows (person, tax ID / ΑΦΜ, type, gross, net, employer cost, date, bank reference).
            </p>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <label className="flex items-start space-x-3 cursor-pointer">
              <input 
                type="checkbox" 
                checked={includeReceiptsZip} 
                onChange={e => setIncludeReceiptsZip(e.target.checked)}
                className="mt-0.5 w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
              />
              <div>
                <span className="font-bold text-slate-900 block text-sm">Include Receipts ZIP Bundle Option</span>
                <span className="text-slate-600 block text-xs mt-0.5">
                  Automatically bundle all attached payslips, invoices, and wire receipt PDFs for {selectedPeriod} into a clean `.zip` archive alongside the Excel sheet. Files named as <code className="bg-slate-200 px-1 py-0.5 rounded text-indigo-700 font-mono">&#123;ΑΦΜ&#125;_&#123;type&#125;_&#123;YYYY-MM&#125;.pdf</code> for instantaneous reconciliation.
                </span>
              </div>
            </label>
          </div>

          <div className="pt-3 border-t border-slate-200 flex justify-end space-x-2.5">
            <Button variant="outline" size="sm" onClick={() => setIsExportOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleAccountantExportConfirm} disabled={isExporting} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5">
              {isExporting ? 'Generating Bundle...' : 'Download Accountant Package &rarr;'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ADJUST / EDIT PAYMENT MODAL */}
      <Modal isOpen={!!editingPayment} onClose={() => setEditingPayment(null)} title={`Adjust Payment Row: ${profiles.find(p => p.id === editingPayment?.profile_id)?.last_name} (${editingPayment?.period})`}>
        {editingPayment && (
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-slate-50 border rounded-xl text-slate-600">
              Fix amounts against the accountant&apos;s payroll run, update bank transfer reference numbers, or transition draft rows to paid.
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold uppercase text-slate-500 mb-1">Gross (€)</label>
                <input type="number" step="0.01" value={edGross} onChange={e => setEdGross(Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded p-2 font-mono font-bold" />
              </div>
              <div>
                <label className="block font-semibold uppercase text-slate-500 mb-1">Employer EFKA (€)</label>
                <input type="number" step="0.01" value={edEfka} onChange={e => setEdEfka(Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded p-2 font-mono text-slate-600" />
              </div>
              <div>
                <label className="block font-semibold uppercase text-slate-500 mb-1">Net Payable (€)</label>
                <input type="number" step="0.01" value={edNet} onChange={e => setEdNet(Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded p-2 font-mono text-emerald-700 font-bold" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold uppercase text-slate-500 mb-1">Payment Date</label>
                <input type="date" value={edDate} onChange={e => setEdDate(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2 font-mono" />
              </div>
              <div>
                <label className="block font-semibold uppercase text-slate-500 mb-1">Bank Reference</label>
                <input type="text" placeholder="e.g. WIRE-GR891000" value={edBankRef} onChange={e => setEdBankRef(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2 font-mono font-bold text-slate-800" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold uppercase text-slate-500 mb-1">Status</label>
                <select value={edStatus} onChange={e => setEdStatus(e.target.value as any)} className="w-full bg-white border border-slate-200 rounded p-2 font-bold">
                  <option value="paid">PAID & DISPATCHED</option>
                  <option value="planned">PLANNED / DRAFT</option>
                  <option value="cancelled">CANCELLED</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold uppercase text-slate-500 mb-1">Note</label>
                <input type="text" value={edNote} onChange={e => setEdNote(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2" />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
              <button 
                type="button" 
                onClick={() => {
                  if (confirm('Delete this payment ledger record?')) {
                    deletePaymentRecord(editingPayment.id);
                    setEditingPayment(null);
                  }
                }}
                className="text-rose-600 hover:text-rose-800 font-bold text-xs flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" /> Delete Row
              </button>
              <div className="flex space-x-2">
                <Button variant="outline" size="sm" onClick={() => setEditingPayment(null)}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={handleSaveEditedPayment} className="bg-[#3D87D3] hover:bg-[#3D87D3]/90 font-bold">Save Adjustment &rarr;</Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ADD PAYMENT TYPE MODAL */}
      <Modal isOpen={isTypeOpen} onClose={() => setIsTypeOpen(false)} title="Register Dynamic Payment Category">
        <div className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold uppercase text-slate-500 mb-1">System Code (Slug)</label>
            <input type="text" value={ptCode} onChange={e => setPtCode(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 font-mono" placeholder="e.g. dwro_pasxa or bonus_spot" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Name (Greek)</label>
              <input type="text" value={ptNameEl} onChange={e => setPtNameEl(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 font-bold" placeholder="e.g. Δώρο Пάσχα" />
            </div>
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Name (English)</label>
              <input type="text" value={ptNameEn} onChange={e => setPtNameEn(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800" placeholder="e.g. Easter Bonus" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Default Salary Multiplier</label>
              <input type="number" step="0.1" value={ptMult} onChange={e => setPtMult(Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 font-mono" />
              <span className="text-[10px] text-slate-400">0.5 for Easter/Holiday, 1.0 for Christmas</span>
            </div>
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Default Statutory Month</label>
              <select value={ptMonth} onChange={e => setPtMonth(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2 font-semibold">
                <option value="">None / All Months</option>
                <option value="4">4 - April (Easter Bonus)</option>
                <option value="7">7 - July (Holiday Allowance)</option>
                <option value="12">12 - December (Christmas Bonus)</option>
              </select>
            </div>
          </div>
          <div className="flex items-center space-x-6 pt-2">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input type="checkbox" checked={ptStatutory} onChange={e => setPtStatutory(e.target.checked)} className="w-4 h-4 text-blue-600 rounded border-slate-300" />
              <span className="font-bold text-slate-700">Greek Statutory Item (Law)</span>
            </label>
            <label className="flex items-center space-x-2 cursor-pointer">
              <input type="checkbox" checked={ptRecurring} onChange={e => setPtRecurring(e.target.checked)} className="w-4 h-4 text-emerald-600 rounded border-slate-300" />
              <span className="font-bold text-slate-700">Recurring Monthly</span>
            </label>
          </div>
          <div className="pt-3 border-t border-slate-200 flex justify-end space-x-2">
            <Button variant="outline" size="sm" onClick={() => setIsTypeOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleSaveNewPaymentType} className="bg-[#3D87D3] hover:bg-[#3D87D3]/90 font-bold">Save Category &rarr;</Button>
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
              <input type="month" value={upPeriod} onChange={e => setUpPeriod(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 font-mono shadow-2xs font-bold" />
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Bank Reference Number</label>
              <input type="text" placeholder="WIRE-GR890001" value={upBankRef} onChange={e => setUpBankRef(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2 font-mono font-bold text-slate-800" />
            </div>
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Disbursement Status</label>
              <select value={upStatus} onChange={e => setUpStatus(e.target.value as any)} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 font-bold shadow-2xs">
                <option value="paid">PAID & DISPATCHED</option>
                <option value="planned">PLANNED / DRAFT</option>
                <option value="cancelled">CANCELLED</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Memo / Description</label>
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
                <div className="p-6 text-center border border-dashed border-amber-300 bg-amber-50/40 rounded-xl text-amber-900 font-medium">
                  ⚠️ No documents or payslips currently attached to this payment row. Attach receipt files below!
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
                            onClick={() => handleDownloadDoc(doc, `${prof?.first_name} ${prof?.last_name}`, selectedPaymentForDocs.bank_reference)}
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
