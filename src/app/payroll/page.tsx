"use client";

import React, { useState, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { notifySuccess } from '@/lib/validation-modal';
import { Card, Button, Badge, StatCard, Modal } from '@/components/ui/primitives';
import { 
  DollarSign, Download, Plus, Sparkles, ShieldAlert, 
  Calendar, CheckCircle, RefreshCw, Layers, Sliders, TrendingUp,
  Upload, FileText, Trash2, FileCheck, Paperclip, ExternalLink, Eye, X, Check, FolderOpen, FileSpreadsheet,
  AlertTriangle, Edit, CheckSquare, Users, ShieldCheck, PieChart, Archive, Copy, Share2, Zap
} from 'lucide-react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { PaymentRecord, PaymentDocument, SalaryRecord, PaymentType } from '@/lib/types';
import { loadedMonthlyCost, employerCostRatio, isBaseSalary, isRecurringExtra, isOneTimeBonus, extrasFor, loadedExtraCost } from '@/lib/compensation';
import { formatDate, formatDateTime } from '@/lib/date';
import { DocumentPreviewModal } from '@/components/ui/document-preview-modal';

const PayrollGrid = dynamic(() => import('@/components/payroll/payroll-grid').then(m => m.PayrollGrid), { ssr: false });
const SalaryLedgerGrid = dynamic(() => import('@/components/payroll/salary-ledger-grid').then(m => m.SalaryLedgerGrid), { ssr: false });

export default function PayrollPage() {
  const { 
    currentUser, profiles, paymentTypes, salaries, payments, 
    generateDraftMonth, addPaymentRecord, updatePaymentRecord, deletePaymentRecord, markAllPaidForPeriod,
    addPaymentDocuments, updatePaymentDocumentType, deletePaymentDocument, addPaymentType, updatePaymentType, deletePaymentType, addSalaryRecord, updateSalaryRecord, deleteSalaryRecord,
    documentTypes, backfillSalaryPayments
  } = useAuth();
  
  const [backfillingId, setBackfillingId] = useState<string | null>(null);
  const [editSalaryId, setEditSalaryId] = useState<string | null>(null);
  const [newExtra, setNewExtra] = useState({ payment_type_id: '', amount: 0, start_period: '' });
  const [salForm, setSalForm] = useState({
    // net = gross_amount (what the employee receives) · full_cost = the derived gross ·
    // company_cost = the accountant's optional total.
    gross_amount: 0, full_cost: 0, company_cost: 0, valid_from: '', valid_to: '', basis: 'monthly_gross', note: '', label: '', payment_type_id: '',
  });

  const openSalaryEditor = (sal: SalaryRecord) => {
    setSalForm({
      gross_amount: Number(sal.gross_amount || 0),
      full_cost: loadedMonthlyCost(sal),
      company_cost: Number(sal.full_company_cost || 0),
      valid_from: sal.valid_from || '',
      valid_to: sal.valid_to || '',
      basis: sal.basis || 'monthly_gross',
      note: sal.note || '',
      label: sal.label || '',
      payment_type_id: sal.payment_type_id || '',
    });
    setEditSalaryId(sal.id);
  };

  const handleSaveSalaryEdit = async () => {
    if (!editSalaryId || !salForm.valid_from || salForm.gross_amount <= 0) {
      alert('Valid from and a positive net amount are required.');
      return;
    }
    // Blank = we do not have the accountant's total yet, so keep the column NULL.
    const companyCost = salForm.company_cost > 0 ? Number(salForm.company_cost) : null;
    // Extras/bonuses carry no employer-cost maths of their own — they inherit the base ratio.
    if (editSalaryRecord && !isBaseSalary(editSalaryRecord)) {
      await updateSalaryRecord(editSalaryId, {
        gross_amount: Number(salForm.gross_amount),
        full_company_cost: companyCost,
        valid_from: salForm.valid_from,
        valid_to: salForm.valid_to || undefined,
        label: salForm.label.trim() || editSalaryRecord.label || 'Contractual extra',
        payment_type_id: salForm.payment_type_id || null,
        note: salForm.note.trim() || undefined,
      });
      setEditSalaryId(null);
      notifySuccess('Ledger entry updated.');
      return;
    }
    const fullCost = Number(salForm.full_cost) || Number(salForm.gross_amount);
    await updateSalaryRecord(editSalaryId, {
      gross_amount: Number(salForm.gross_amount),
      full_company_cost: companyCost,
      employer_cost_amount: Number(Math.max(0, fullCost - Number(salForm.gross_amount)).toFixed(2)),
      employer_cost_multiplier: null,
      employer_cost_pct: null,
      valid_from: salForm.valid_from,
      valid_to: salForm.valid_to || undefined,
      basis: salForm.basis as any,
      note: salForm.note.trim() || undefined,
    });
    setEditSalaryId(null);
    notifySuccess('Salary record updated.');
  };

  // Generate any missing payment rows for a salary record's validity window.
  const handleBackfillSalary = async (sal: SalaryRecord) => {
    const prof = profiles.find(p => p.id === sal.profile_id);
    setBackfillingId(sal.id);
    const res = await backfillSalaryPayments(sal.id);
    setBackfillingId(null);
    notifySuccess(res.created > 0
      ? `Produced ${res.created} missing payment row(s) for ${prof?.first_name} ${prof?.last_name} (${sal.valid_from.slice(0, 7)}${sal.valid_to ? ` to ${sal.valid_to.slice(0, 7)}` : ' to date'}).`
      : 'All past payments already exist.');
  };

  // Every non-base ledger entry (contractual extras + one-off bonuses) of the employee being edited.
  const editSalaryRecord = salaries.find(s => s.id === editSalaryId) || null;
  const editExtraEmployee = editSalaryRecord ? profiles.find(p => p.id === editSalaryRecord.profile_id) : null;
  const editExtras = editSalaryRecord
    ? extrasFor(salaries, editSalaryRecord.profile_id).filter(x => isRecurringExtra(x))
    : [];
  const recurringPaymentTypes = paymentTypes.filter(pt => pt.active && pt.is_recurring_monthly);
  /** The modal edits a base rate or (when true) a contractual extra / one-off bonus ledger entry. */
  const isExtraEntry = !!editSalaryRecord && !isBaseSalary(editSalaryRecord);

  const handleAddSalaryExtra = async () => {
    if (!editSalaryRecord) return;
    const pt = recurringPaymentTypes.find(t => t.id === newExtra.payment_type_id);
    if (!pt || !newExtra.amount || newExtra.amount <= 0) {
      alert('Pick a recurring monthly Dynamic Payment Type and enter a positive monthly amount.');
      return;
    }
    await addSalaryRecord({
      profile_id: editSalaryRecord.profile_id,
      entry_type: 'recurring_extra',
      label: pt.name_en || pt.name_el,
      payment_type_id: pt.id,
      valid_from: newExtra.start_period ? `${newExtra.start_period}-01` : new Date().toISOString().slice(0, 10),
      basis: 'monthly_gross',
      gross_amount: Number(newExtra.amount),
      currency: 'EUR',
      note: undefined,
    });
    setNewExtra({ payment_type_id: '', amount: 0, start_period: '' });
  };

  // Delete any ledger entry (base rate, recurring extra or one-off bonus).
  const handleDeleteSalary = async (sal: SalaryRecord) => {
    const prof = profiles.find(p => p.id === sal.profile_id);
    const who = prof ? `${prof.first_name} ${prof.last_name}` : 'this employee';
    const what = isBaseSalary(sal)
      ? 'salary record'
      : `${isOneTimeBonus(sal) ? 'one-off bonus' : 'recurring extra'} “${sal.label || 'unnamed'}”`;
    if (!confirm(
      `Delete the ${what} for ${who} effective ${formatDate(sal.valid_from)}` +
      `${sal.valid_to ? ` until ${formatDate(sal.valid_to)}` : ' (still running)'}?\n\n` +
      'It disappears from the salary ledger and the 12-month burn forecast. ' +
      'Payment rows already generated are kept — the payment ledger is the record of what was paid. ' +
      'This cannot be undone.'
    )) return;
    const ok = await deleteSalaryRecord(sal.id);
    if (ok) notifySuccess('Ledger entry deleted.');
  };
  
  const hasPaymentReceipt = (docs?: PaymentDocument[]) => {
    if (!docs || !Array.isArray(docs) || docs.length === 0) return false;
    return docs.some(d => d && (d.type === 'receipt' || d.type === 'payslip' || (d.name || '').toLowerCase().includes('receipt') || (d.name || '').toLowerCase().includes('apodeixi')));
  };

  const params = useParams();
  const urlId = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const [selectedPeriod, setSelectedPeriod] = useState<string>('2026-07');
  const [endPeriod, setEndPeriod] = useState<string>('2026-07');
  const [tab, setTab] = useState<'ledger' | 'forecast' | 'payment_types'>('ledger');
  const [ledgerFilter, setLedgerFilter] = useState<'all' | 'planned' | 'paid' | 'missing_receipt'>('all');
  const [personFilter, setPersonFilter] = useState<string>('all');

  const periodLabel = selectedPeriod === endPeriod || !endPeriod ? selectedPeriod : `${selectedPeriod} to ${endPeriod}`;

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; payment: PaymentRecord } | null>(null);

  const copyToClipboard = (text: string, label: string, id?: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(text);
    if (id) setCopiedId(id);
    setCopyFeedback(label);
    setTimeout(() => {
      if (id) setCopiedId(null);
      setCopyFeedback(null);
    }, 2500);
  };

  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    window.addEventListener('click', handleClickOutside);
    window.addEventListener('scroll', handleClickOutside, true);
    return () => {
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('scroll', handleClickOutside, true);
    };
  }, []);

  const getMonthsInRange = (start: string, end: string): string[] => {
    let [y1, m1] = start.split('-').map(Number);
    const [y2, m2] = end.split('-').map(Number);
    const months: string[] = [];
    while (y1 < y2 || (y1 === y2 && m1 <= m2)) {
      months.push(`${y1}-${String(m1).padStart(2, '0')}`);
      m1++;
      if (m1 > 12) { m1 = 1; y1++; }
    }
    return months;
  };

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
  const [previewDoc, setPreviewDoc] = useState<{ doc: PaymentDocument; profName: string; bankRef?: string } | null>(null);

  // Sync initial selection from URL ID
  useEffect(() => {
    if (urlId && payments.length > 0 && !selectedPaymentForDocs && !editingPayment) {
      const target = payments.find(p => p.id === urlId || p.bank_reference === urlId);
      if (target) {
        if (target.period && target.period !== selectedPeriod) {
          setSelectedPeriod(target.period);
          setEndPeriod(target.period);
        }
        setSelectedPaymentForDocs(target);
      }
    }
  }, [urlId, payments]);

  // Sync address bar when payment is selected or closed
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const active = selectedPaymentForDocs || editingPayment;
    if (active) {
      if (window.location.pathname !== `/payroll/${active.id}`) {
        window.history.pushState(null, '', `/payroll/${active.id}`);
      }
    } else if (window.location.pathname !== '/payroll' && window.location.pathname.startsWith('/payroll/')) {
      window.history.pushState(null, '', '/payroll');
    }
  }, [selectedPaymentForDocs, editingPayment]);
  
  // New dynamic payment type state
  const [isTypeOpen, setIsTypeOpen] = useState(false);
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [ptCode, setPtCode] = useState('bonus_midyear');
  const [ptNameEl, setPtNameEl] = useState('Επιπλέον Αμοιβή');
  const [ptNameEn, setPtNameEn] = useState('Mid-Year Performance Bonus');
  const [ptMult, setPtMult] = useState(0.5);
  const [ptStatutory, setPtStatutory] = useState(false);
  const [ptRecurring, setPtRecurring] = useState(false);
  const [ptMonth, setPtMonth] = useState<string>('');
  const [ptActive, setPtActive] = useState(true);

  // Record Raise / Salary Record Modal
  const [isRaiseOpen, setIsRaiseOpen] = useState(false);
  const [rsProfileId, setRsProfileId] = useState('');
  const [rsBasis, setRsBasis] = useState<'monthly_gross' | 'daily_rate' | 'fixed_fee' | 'fee'>('monthly_gross');
  const [rsGross, setRsGross] = useState<number>(3500);
  const [rsFullCost, setRsFullCost] = useState<number>(4340);
  const [rsCompanyCost, setRsCompanyCost] = useState<number>(0);
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

  const periodPayments = useMemo(() => {
    const minP = selectedPeriod <= (endPeriod || selectedPeriod) ? selectedPeriod : (endPeriod || selectedPeriod);
    const maxP = selectedPeriod <= (endPeriod || selectedPeriod) ? (endPeriod || selectedPeriod) : selectedPeriod;
    return (payments || []).filter(p => p && p.period >= minP && p.period <= maxP && (personFilter === 'all' || p.profile_id === personFilter));
  }, [payments, selectedPeriod, endPeriod, personFilter]);

  const totalCost = periodPayments.reduce((acc, p) => acc + (Number(p?.total_cost) || 0), 0);
  const totalNet = periodPayments.reduce((acc, p) => acc + (Number(p?.net) || 0), 0);

  // Missing receipts check
  const paidMissingDocs = periodPayments.filter(p => p?.status === 'paid' && !hasPaymentReceipt(p?.documents));
  const plannedPayments = periodPayments.filter(p => p?.status === 'planned');

  // Filtered ledger rows
  const displayedPayments = useMemo(() => {
    return periodPayments.filter(p => {
      if (ledgerFilter === 'planned') return p.status === 'planned';
      if (ledgerFilter === 'paid') return p.status === 'paid';
      if (ledgerFilter === 'missing_receipt') return p.status === 'paid' && !hasPaymentReceipt(p.documents);
      return true;
    });
  }, [periodPayments, ledgerFilter]);

  const handleGenerateDraft = async () => {
    const minP = selectedPeriod <= (endPeriod || selectedPeriod) ? selectedPeriod : (endPeriod || selectedPeriod);
    const maxP = selectedPeriod <= (endPeriod || selectedPeriod) ? (endPeriod || selectedPeriod) : selectedPeriod;
    const months = getMonthsInRange(minP, maxP);
    for (const m of months) {
      await generateDraftMonth(m);
    }
  };

  const handleMarkAllPaid = async () => {
    const minP = selectedPeriod <= (endPeriod || selectedPeriod) ? selectedPeriod : (endPeriod || selectedPeriod);
    const maxP = selectedPeriod <= (endPeriod || selectedPeriod) ? (endPeriod || selectedPeriod) : selectedPeriod;
    const months = getMonthsInRange(minP, maxP);
    if (!confirm(`Are you sure you want to mark all ${plannedPayments.length} planned/draft rows in period range (${periodLabel}) as PAID? Once marked paid, they lock for standard editing and become visible to employees in their self-service portal.`)) return;
    for (const m of months) {
      await markAllPaidForPeriod(m);
    }
    notifySuccess(`All draft rows for ${periodLabel} marked as paid.`);
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
      XLSX.utils.book_append_sheet(workbook, worksheet, `Payroll_${periodLabel.replace(/ /g, '_')}`);
      XLSX.writeFile(workbook, `StellarBlue_Accountant_Package_${periodLabel.replace(/ /g, '_')}.xlsx`);

      // Generate ZIP of receipt documents if toggle is checked
      if (includeReceiptsZip) {
        const zip = new JSZip();
        const receiptsFolder = zip.folder(`Receipts_${periodLabel.replace(/ /g, '_')}`);

        let totalDocsAdded = 0;
        periodPayments.forEach(p => {
          if (p.documents && p.documents.length > 0) {
            const prof = profiles.find(pr => pr.id === p.profile_id);
            const pt = paymentTypes.find(type => type.id === p.payment_type_id);
            const afm = prof?.id.replace('prof-', '9876') || '098765432';
            
            p.documents.forEach((doc, i) => {
              // Naming convention: {ΑΦΜ}_{type}_{YYYY-MM}.pdf
              const suffix = p.documents!.length > 1 ? `_part${i + 1}` : '';
              const filename = `${afm}_${pt?.code || 'pay'}_${p.period}${suffix}.pdf`;
              
              // Generate verifiable mock content representing the stored receipt voucher
              const receiptContent = `STELLARBLUE SYSTEMS ORBIT — ACCOUNTANT RECEIPT ARCHIVE\nFile Name: ${filename}\nOriginal Upload: ${doc.name} (${doc.size})\nEmployee: ${prof?.first_name} ${prof?.last_name} (AFM: ${afm})\nPeriod: ${p.period}\nPayment Type: ${pt?.name_el} (${pt?.name_en})\nTotal Cost: €${p.total_cost} | Net Disbursed: €${p.net}\nBank Ref: ${p.bank_reference || 'WIRE-TRANSFER'}\nUploaded At: ${formatDateTime(doc.uploaded_at)}\nEncrypted & Stored in Private Supabase Vault under RLS`;
              
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
          link.download = `StellarBlue_Receipt_Bundle_${periodLabel.replace(/ /g, '_')}.zip`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        }
      }

      setIsExportOpen(false);
      notifySuccess('Accountant bundle exported.');
    } catch (e) {
      console.error('Export failed:', e);
      alert('Error generating accountant export package.');
    } finally {
      setIsExporting(false);
    }
  };

  // Calculate 12-Month Forward Burn Forecast
  const twelveMonthForecast = useMemo(() => {
    const months: { monthStr: string; monthLabel: string; monthNum: number; regularCost: number; statutoryCost: number; statutoryItems: string[]; totalCost: number }[] = [];

    // Parse current year & month from selectedPeriod
    let [year, m] = selectedPeriod.split('-').map(Number);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    for (let i = 0; i < 12; i++) {
      const currentM = ((m - 1 + i) % 12) + 1;
      const currentY = year + Math.floor((m - 1 + i) / 12);
      const monthStr = `${currentY}-${String(currentM).padStart(2, '0')}`;
      const monthLabel = `${monthNames[currentM - 1]} ${currentY}`;
      const monthEnd = `${monthStr}-${String(new Date(currentY, currentM, 0).getDate()).padStart(2, '0')}`;
      const monthStart = `${monthStr}-01`;

      // Only what is effective during THIS month: a raise, an extra starting later or one that
      // ended before must not inflate the forecast.
      const rowsInMonth = salaries.filter(sal =>
        sal.valid_from <= monthEnd && (!sal.valid_to || sal.valid_to >= monthStart));

      // Regular Monthly Cost (base rates, contractor fees + contractual extras, fully loaded)
      let regularCost = 0;
      rowsInMonth.forEach(sal => {
        regularCost += isBaseSalary(sal)
          ? loadedMonthlyCost(sal)
          : loadedExtraCost(salaries, sal.profile_id, Number(sal.gross_amount) || 0);
      });

      // Statutory Extras Cost for employees in matching default months (e.g., April Easter, July Holiday, Dec Christmas)
      let statutoryCost = 0;
      const statutoryItems: string[] = [];
      const statTypes = paymentTypes.filter(t => t.is_statutory && !t.is_recurring_monthly && t.default_period_month === currentM);

      if (statTypes.length > 0) {
        statTypes.forEach(st => {
          statutoryItems.push(st.name_el);
          // Statutory bonuses are a multiple of the BASE rate only — never of an extra.
          rowsInMonth.filter(isBaseSalary).forEach(sal => {
            const prof = profiles.find(pr => pr.id === sal.profile_id);
            if (prof && prof.employment_type !== 'contractor') { // Contractors do not get Greek statutory bonuses
              const statGross = sal.gross_amount * (st.default_multiplier ?? 1.0);
              statutoryCost += Number((statGross * employerCostRatio(sal)).toFixed(2));
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
      const sal = salaries.find(s => s.profile_id === defaultProf.id && isBaseSalary(s) && !s.valid_to);
      if (sal) {
        setUpGross(sal.gross_amount);
        if (defaultProf.employment_type === 'contractor') {
          setUpEfka(0);
          setUpNet(sal.gross_amount);
        } else {
          setUpEfka(Number((loadedMonthlyCost(sal) - sal.gross_amount).toFixed(2)));
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
    const sal = salaries.find(s => s.profile_id === prof.id && isBaseSalary(s) && !s.valid_to);
    if (sal) {
      setUpGross(sal.gross_amount);
      if (prof.employment_type === 'contractor') {
        setUpEfka(0);
        setUpNet(sal.gross_amount);
      } else {
        setUpEfka(Number((loadedMonthlyCost(sal) - sal.gross_amount).toFixed(2)));
        setUpNet(Number((sal.gross_amount * 0.72).toFixed(2)));
      }
    }
  };

  const readFileAsDataURL = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve((e.target?.result as string) || '');
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>, target: 'upload' | 'existing') => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    const newDocs: PaymentDocument[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      const dataUrl = await readFileAsDataURL(f);
      newDocs.push({
        id: `doc-${Date.now()}-${i}`,
        name: f.name,
        type: f.name.toLowerCase().includes('inv') ? 'invoice' : f.name.toLowerCase().includes('payslip') ? 'payslip' : 'receipt',
        size: `${(f.size / 1024).toFixed(0)} KB`,
        uploaded_at: new Date().toISOString().split('T')[0],
        url: dataUrl || undefined
      });
    }

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
    notifySuccess(`Payment of €${upGross.toLocaleString()} uploaded with ${upDocs.length} document(s) for ${upPeriod}.`);
  };

  const handleSaveAdditionalDocs = () => {
    if (!selectedPaymentForDocs || addMoreDocs.length === 0) return;
    addPaymentDocuments(selectedPaymentForDocs.id, addMoreDocs);
    setSelectedPaymentForDocs(prev => prev ? { ...prev, documents: [...(prev.documents || []), ...addMoreDocs] } : null);
    setAddMoreDocs([]);
    notifySuccess(`Attached ${addMoreDocs.length} document(s) to the payment record.`);
  };

  const handleDownloadDoc = (doc: PaymentDocument, profName?: string, bankRef?: string) => {
    if (doc.url && (doc.url.startsWith('http://') || doc.url.startsWith('https://') || doc.url.startsWith('data:') || doc.url.startsWith('blob:'))) {
      const link = document.createElement('a');
      link.href = doc.url;
      link.download = doc.name;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    // Fallback only if no actual file payload exists (e.g., sample mock records from seed script)
    const content = `STELLARBLUE SYSTEMS ORBIT — VERIFIED PAYMENT DOCUMENT\nDocument ID: ${doc.id}\nType: ${doc.type.toUpperCase()}\nFile Size: ${doc.size}\nUploaded: ${formatDateTime(doc.uploaded_at)}\nEmployee: ${profName || 'Staff'}\nBank Reference: ${bankRef || 'WIRE-TRANSFER'}\nStatus: Verified and Encrypted under RLS Vault (Demo Placeholder - Upload a file to retain binary archive)`;
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
    notifySuccess('Payment row updated.');
  };

  // Save Raise / New Salary Record (Never edit in place)
  const handleSaveRaise = async () => {
    if (!rsProfileId || rsGross <= 0) {
      alert('Please enter a valid gross amount and select an employee.');
      return;
    }
    const fullCost = Number(rsFullCost) || Number(rsGross);
    await addSalaryRecord({
      profile_id: rsProfileId,
      valid_from: rsValidFrom,
      basis: rsBasis,
      gross_amount: Number(rsGross),
      full_company_cost: rsCompanyCost > 0 ? Number(rsCompanyCost) : null,
      currency: 'EUR',
      employer_cost_amount: Number(Math.max(0, fullCost - Number(rsGross)).toFixed(2)),
      employer_cost_multiplier: null,
      employer_cost_pct: null,
      note: rsNote.trim() || undefined
    });
    setIsRaiseOpen(false);
    setRsCompanyCost(0);
    notifySuccess('New salary record recorded.');
  };

  // Save Dynamic Payment Type (create when editingTypeId is null, otherwise update in place)
  const handleSaveNewPaymentType = async () => {
    if (!ptNameEl.trim()) {
      alert('Please enter a Greek name for the payment category.');
      return;
    }
    if (editingTypeId) {
      const ok = await updatePaymentType(editingTypeId, {
        code: ptCode.trim(),
        name_el: ptNameEl.trim(),
        name_en: ptNameEn.trim() || ptNameEl.trim(),
        is_statutory: ptStatutory,
        is_recurring_monthly: ptRecurring,
        default_period_month: ptMonth ? Number(ptMonth) : null,
        default_multiplier: Number(ptMult),
        active: ptActive
      });
      if (!ok) return;
      setIsTypeOpen(false);
      setEditingTypeId(null);
      notifySuccess('Payment category updated.');
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
    notifySuccess('New payment type created.');
  };

  const openNewPaymentType = () => {
    setEditingTypeId(null);
    setPtCode('bonus_midyear');
    setPtNameEl('Επιπλέον Αμοιβή');
    setPtNameEn('Mid-Year Performance Bonus');
    setPtMult(0.5);
    setPtStatutory(false);
    setPtRecurring(false);
    setPtMonth('');
    setPtActive(true);
    setIsTypeOpen(true);
  };

  const openPaymentTypeEditor = (pt: PaymentType) => {
    setEditingTypeId(pt.id);
    setPtCode(pt.code);
    setPtNameEl(pt.name_el);
    setPtNameEn(pt.name_en);
    setPtMult(Number(pt.default_multiplier ?? 1));
    setPtStatutory(pt.is_statutory);
    setPtRecurring(pt.is_recurring_monthly);
    setPtMonth(pt.default_period_month ? String(pt.default_period_month) : '');
    setPtActive(pt.active);
    setIsTypeOpen(true);
  };

  const handleDeletePaymentType = async (pt: PaymentType) => {
    const usedByPayments = payments.filter(p => p.payment_type_id === pt.id).length;
    const linkedExtras = salaries.filter(s => s.payment_type_id === pt.id).length;
    if (usedByPayments > 0) {
      // payments.payment_type_id is a NOT NULL FK without cascade — deleting is impossible.
      if (confirm(`${pt.name_en} (${pt.code}) is used by ${usedByPayments} payment row(s) and cannot be deleted.\n\nDeactivate it instead? It stays on historic rows but disappears from new entries and forecasts.`)) {
        const ok = await updatePaymentType(pt.id, { active: false });
        if (ok) notifySuccess('Payment category deactivated.');
      }
      return;
    }
    const extraWarning = linkedExtras > 0
      ? `\n\n${linkedExtras} contractual recurring extra(s) are linked to it and will lose that category.`
      : '';
    const systemWarning = ['salary', 'bonus', 'contractor_invoice'].includes(pt.code)
      ? `\n\n⚠ "${pt.code}" drives payroll draft generation — deleting it stops those rows being created. Deactivating is usually safer.`
      : '';
    if (!confirm(`Delete payment category ${pt.name_en} (${pt.code})?${extraWarning}${systemWarning}\n\nThis cannot be undone.`)) return;
    const ok = await deletePaymentType(pt.id);
    if (ok) notifySuccess('Payment category deleted.');
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
          <div className="flex items-center bg-white border border-slate-200 rounded-lg p-1 shadow-2xs gap-1.5">
            <span className="text-[11px] font-bold text-slate-500 px-1">From:</span>
            <input 
              type="month" 
              value={selectedPeriod} 
              onChange={e => setSelectedPeriod(e.target.value)} 
              className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs text-slate-800 font-mono font-bold focus:outline-[#3D87D3]"
            />
            <span className="text-[11px] font-bold text-slate-500 px-1">To:</span>
            <input 
              type="month" 
              value={endPeriod} 
              onChange={e => setEndPeriod(e.target.value)} 
              className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs text-slate-800 font-mono font-bold focus:outline-[#3D87D3]"
            />
            <button
              type="button"
              onClick={() => {
                if (selectedPeriod !== endPeriod) {
                  setEndPeriod(selectedPeriod);
                } else {
                  setEndPeriod(`${selectedPeriod.split('-')[0]}-12`);
                }
              }}
              className="px-2 py-1 bg-blue-50 text-[#3D87D3] hover:bg-blue-100 rounded text-[11px] font-bold transition-colors cursor-pointer"
              title="Click to toggle between single month and remainder of the year"
            >
              {selectedPeriod === endPeriod ? '+ Year Range' : '1 Month'}
            </button>
          </div>
          <Button variant="primary" size="sm" onClick={openUploadModal} className="bg-[#3D87D3] hover:bg-[#3D87D3]/90 shadow-xs cursor-pointer font-bold">
            <Upload className="w-3.5 h-3.5 mr-1.5 text-white" /> Upload Payment
          </Button>
          <Button variant="secondary" size="sm" onClick={handleGenerateDraft} className="cursor-pointer font-semibold" title={`Generate drafts for period range: ${periodLabel}`}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5 text-[#3D87D3]" /> Generate Draft ({periodLabel})
          </Button>
          <Button variant="primary" size="sm" onClick={() => setIsExportOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 shadow-xs cursor-pointer font-semibold">
            <Download className="w-4 h-4 mr-1.5" /> Accountant Bundle
          </Button>
        </div>
      </div>

      {/* Missing Receipts Alert Checklist (if paid rows lack receipts) */}
      {paidMissingDocs.length > 0 && (
        <div className="p-4 bg-amber-50 border border-amber-300/80 rounded-2xl shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-pulse">
          <div className="flex items-center space-x-3">
            <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0" />
            <div>
              <h4 className="font-extrabold text-amber-950 text-sm">⚠️ Admin Checklist: {paidMissingDocs.length} Paid Payment(s) Missing Receipt Documents in {periodLabel}</h4>
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
                if (confirm(`Bulk upload default receipt confirmations for all ${paidMissingDocs.length} pending paid payments in ${periodLabel}?`)) {
                  paidMissingDocs.forEach(p => {
                    const prof = profiles.find(pr => pr.id === p.profile_id);
                    addPaymentDocuments(p.id, [{
                      id: `doc-auto-${Date.now()}-${p.id}`,
                      name: `Bank_Transfer_Receipt_${prof?.last_name || 'Staff'}_${p.period}.pdf`,
                      type: 'receipt',
                      size: '142 KB',
                      uploaded_at: new Date().toISOString().split('T')[0]
                    }]);
                  });
                  notifySuccess('Bulk matched and uploaded receipts to all pending rows.');
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
          subtitle="Gross salaries, net disbursements & contractor retainers"
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

          <PayrollGrid
            payments={displayedPayments}
            profiles={profiles}
            paymentTypes={paymentTypes}
            hasPaymentReceipt={hasPaymentReceipt}
            onEdit={(pay) => handleOpenEditModal(pay)}
            onAttachDocs={(pay) => {
              setSelectedPaymentForDocs(pay);
              setAddMoreDocs([]);
            }}
          />
        </div>
      )}

      {/* TAB 2: SALARY RECORDS HISTORY & 12-MONTH BURN FORECAST */}
      {tab === 'forecast' && (
        <div className="space-y-8">
          <Card 
            title="Effective-Dated Salary Ledger & Company Costs" 
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
            <div className="mt-3">
              <SalaryLedgerGrid
                salaries={salaries}
                profiles={profiles}
                paymentTypes={paymentTypes}
                backfillingId={backfillingId}
                onEdit={openSalaryEditor}
                onBackfill={handleBackfillSalary}
                onDelete={handleDeleteSalary}
              />
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
          <Button size="sm" variant="primary" onClick={openNewPaymentType} className="bg-[#3D87D3] hover:bg-[#3D87D3]/90 font-bold cursor-pointer">
            <Plus className="w-3.5 h-3.5 mr-1" /> Add Payment Category
          </Button>
        }>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
            {paymentTypes.map(pt => (
              <div key={pt.id} className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs flex flex-col justify-between space-y-3 hover:border-indigo-200 transition-all">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="flex items-center gap-1.5">
                      <Badge variant={pt.is_statutory ? 'info' : pt.is_recurring_monthly ? 'success' : 'neutral'}>
                        {pt.is_statutory ? 'Statutory (Εργ. Νόμος)' : pt.is_recurring_monthly ? 'Recurring Monthly' : 'One-Off / Variable'}
                      </Badge>
                      {!pt.active && <Badge variant="error" className="text-[9px] px-1.5 py-0">INACTIVE</Badge>}
                    </span>
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

                <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => openPaymentTypeEditor(pt)} className="cursor-pointer">
                    <Edit className="w-3.5 h-3.5 mr-1" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const ok = await updatePaymentType(pt.id, { active: !pt.active });
                      if (ok) notifySuccess(pt.active ? 'Payment category deactivated.' : 'Payment category activated.');
                    }}
                    className="cursor-pointer"
                  >
                    {pt.active ? 'Deactivate' : 'Activate'}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => handleDeletePaymentType(pt)} title="Delete payment category" className="cursor-pointer">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* RECORD RAISE MODAL */}
      {/* EDIT EXISTING EFFECTIVE-DATED SALARY RECORD (opened from the salary ledger grid) */}
      <Modal isOpen={!!editSalaryId} onClose={() => setEditSalaryId(null)} title={isExtraEntry ? 'Edit Ledger Entry' : 'Edit Effective-Dated Salary Record'}>
        <div className="space-y-4 text-xs">
          {isExtraEntry ? (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 font-medium">
              Editing a <strong>{isOneTimeBonus(editSalaryRecord!) ? 'one-off bonus' : 'contractual recurring extra'}</strong>. Payroll drafts pay it for every month its validity window covers, filed under its Dynamic Payment Type. End it by setting a <strong>Valid To</strong> date.
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-900 font-medium">
              This edits the existing record in place. To record a <strong>raise</strong>, use &quot;Record Raise / New Contract&quot; instead, so the previous rate is closed with a valid-to date and the history stays complete.
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {isExtraEntry && (
              <>
                <div className="sm:col-span-2">
                  <label className="text-slate-500 font-semibold block mb-1">Name</label>
                  <input type="text" value={salForm.label} onChange={e => setSalForm({ ...salForm, label: e.target.value })} placeholder="e.g. Company Car Allowance" className="w-full p-2 border rounded-md bg-white text-slate-800" />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-slate-500 font-semibold block mb-1">Dynamic Payment Type (the category payroll files it under)</label>
                  <select value={salForm.payment_type_id} onChange={e => setSalForm({ ...salForm, payment_type_id: e.target.value })} className="w-full p-2 border rounded-md bg-white text-slate-800">
                    <option value="">— Generic Bonus category —</option>
                    {recurringPaymentTypes.map(pt => <option key={pt.id} value={pt.id}>{pt.name_el} ({pt.name_en})</option>)}
                    {salForm.payment_type_id && !recurringPaymentTypes.some(pt => pt.id === salForm.payment_type_id) && (
                      <option value={salForm.payment_type_id}>{paymentTypes.find(pt => pt.id === salForm.payment_type_id)?.name_en || 'Linked category'} (inactive)</option>
                    )}
                  </select>
                </div>
              </>
            )}
            <div>
              <label className="text-slate-500 font-semibold block mb-1">{isExtraEntry ? 'Net (€ / month)' : 'Net (€)'}</label>
              <input type="number" step="0.01" value={salForm.gross_amount || ''} onChange={e => setSalForm({ ...salForm, gross_amount: Number(e.target.value) })} className="w-full p-2 border rounded-md bg-white text-slate-800 font-mono" />
            </div>
            {!isExtraEntry && (
              <div>
                <label className="text-slate-500 font-semibold block mb-1">Gross (€/mo)</label>
                <input type="number" step="0.01" value={salForm.full_cost || ''} onChange={e => setSalForm({ ...salForm, full_cost: Number(e.target.value) })} className="w-full p-2 border rounded-md bg-white text-slate-800 font-mono" />
                <p className="text-[10px] text-slate-400 mt-0.5">Net + employer contributions (ΕΦΚΑ).</p>
              </div>
            )}
            <div>
              <label className="text-slate-500 font-semibold block mb-1">Full Company Cost (€/mo) — optional</label>
              <input type="number" step="0.01" placeholder="Leave empty until known" value={salForm.company_cost || ''} onChange={e => setSalForm({ ...salForm, company_cost: Number(e.target.value) })} className="w-full p-2 border rounded-md bg-white text-slate-800 font-mono" />
              <p className="text-[10px] text-slate-400 mt-0.5">Total as the accountant bills it. Not used in calculations yet.</p>
            </div>
            <div>
              <label className="text-slate-500 font-semibold block mb-1">Valid From</label>
              <input type="date" value={salForm.valid_from} onChange={e => setSalForm({ ...salForm, valid_from: e.target.value })} className="w-full p-2 border rounded-md bg-white text-slate-800 font-mono" />
            </div>
            <div>
              <label className="text-slate-500 font-semibold block mb-1">Valid To (empty = still running)</label>
              <input type="date" value={salForm.valid_to} onChange={e => setSalForm({ ...salForm, valid_to: e.target.value })} className="w-full p-2 border rounded-md bg-white text-slate-800 font-mono" />
            </div>
            {!isExtraEntry && (
              <div>
                <label className="text-slate-500 font-semibold block mb-1">Basis</label>
                <select value={salForm.basis} onChange={e => setSalForm({ ...salForm, basis: e.target.value })} className="w-full p-2 border rounded-md bg-white text-slate-800">
                  <option value="monthly_gross">Monthly Gross</option>
                  <option value="daily_rate">Daily Rate</option>
                  <option value="fixed_fee">Fixed Fee</option>
                  <option value="fee">Fee</option>
                </select>
              </div>
            )}
            <div className="sm:col-span-2">
              <label className="text-slate-500 font-semibold block mb-1">Note</label>
              <input type="text" value={salForm.note} onChange={e => setSalForm({ ...salForm, note: e.target.value })} className="w-full p-2 border rounded-md bg-white text-slate-800" />
            </div>
          </div>

          {/* Contractual recurring extras — the Dynamic Payment Types this employee is
              paid every month, on top of the base salary. Auto-generated by payroll drafts. */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-bold text-slate-800">
                Recurring monthly extras{editExtraEmployee ? ` — ${editExtraEmployee.first_name} ${editExtraEmployee.last_name}` : ''}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">Each is filed in payroll under its own Dynamic Payment Type</span>
            </div>
            {editExtras.length === 0 && (
              <div className="text-[11px] text-slate-400 italic">No recurring monthly extras on this contract yet.</div>
            )}
            {editExtras.map(x => {
              const pt = x.payment_type_id ? paymentTypes.find(t => t.id === x.payment_type_id) : undefined;
              const running = !x.valid_to || x.valid_to >= new Date().toISOString().slice(0, 10);
              return (
                <div key={x.id} className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-lg p-2">
                  <div className="min-w-0">
                    <span className="font-bold text-slate-800 block truncate">{x.label || 'Unnamed extra'}</span>
                    <span className="text-[10px] text-slate-500 block truncate">
                      {pt ? `${pt.name_el} · ${pt.name_en}` : 'Generic Bonus category'}
                      {' · '}€{Number(x.gross_amount).toLocaleString()} / month
                      {' · '}{formatDate(x.valid_from)} → {x.valid_to ? formatDate(x.valid_to) : 'Present'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant={running ? 'success' : 'neutral'} className="text-[9px] px-1.5 py-0">{running ? 'RUNNING' : 'ENDED'}</Badge>
                    <Button size="sm" variant="outline" onClick={() => openSalaryEditor(x)} className="cursor-pointer shrink-0" title="Edit this extra in the form above">
                      <Edit className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => handleDeleteSalary(x)} className="cursor-pointer shrink-0" title="Delete this extra">
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
            <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-slate-200">
              <select
                value={newExtra.payment_type_id}
                onChange={e => setNewExtra({ ...newExtra, payment_type_id: e.target.value })}
                className="flex-1 min-w-[180px] p-2 border rounded-md bg-white text-slate-800"
              >
                <option value="">— Pick a recurring monthly Payment Type —</option>
                {recurringPaymentTypes.map(pt => <option key={pt.id} value={pt.id}>{pt.name_el} ({pt.name_en})</option>)}
              </select>
              <input type="number" step="0.01" placeholder="€ / month" value={newExtra.amount || ''} onChange={e => setNewExtra({ ...newExtra, amount: Number(e.target.value) })} className="w-28 p-2 border rounded-md bg-white text-slate-800 font-mono" />
              <input type="month" value={newExtra.start_period} onChange={e => setNewExtra({ ...newExtra, start_period: e.target.value })} title="Active from (empty = immediately)" className="w-36 p-2 border rounded-md bg-white text-slate-800 font-mono" />
              <Button size="sm" variant="primary" onClick={handleAddSalaryExtra} className="bg-[#3D87D3] text-white cursor-pointer shrink-0">
                <Plus className="w-3.5 h-3.5 mr-1" /> Add Extra
              </Button>
            </div>
          </div>
          <div className="flex justify-between items-center pt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => { const sal = editSalaryRecord; setEditSalaryId(null); if (sal) handleDeleteSalary(sal); }}
              className="border-rose-300 text-rose-600 hover:bg-rose-50 hover:border-rose-400 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete Record
            </Button>
            <div className="flex space-x-3">
              <Button size="sm" variant="outline" onClick={() => setEditSalaryId(null)} className="cursor-pointer">Cancel</Button>
              <Button size="sm" variant="primary" onClick={handleSaveSalaryEdit} className="bg-[#3D87D3] text-white cursor-pointer">
                <Check className="w-3.5 h-3.5 mr-1" /> Save Record
              </Button>
            </div>
          </div>
        </div>
      </Modal>

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
              const gross = Number(rsGross) || 0;
              if (pr?.employment_type === 'contractor') {
                setRsBasis('fixed_fee');
                setRsFullCost(gross);
              } else {
                setRsBasis('monthly_gross');
                setRsFullCost(Number((gross * 1.24).toFixed(2)));
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
              <label className="block font-semibold uppercase text-slate-500 mb-1">New Net Amount (€)</label>
              <input type="number" step="50" value={rsGross} onChange={e => {
                const g = Number(e.target.value);
                setRsFullCost(prev => (rsGross > 0 && prev > 0) ? Number((g * (prev / rsGross)).toFixed(2)) : (rsBasis === 'fixed_fee' || rsBasis === 'fee' ? g : Number((g * 1.24).toFixed(2))));
                setRsGross(g);
              }} className="w-full bg-white border border-slate-200 rounded p-2 font-mono text-base font-bold text-emerald-700" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Gross (€/mo)</label>
              <input type="number" step="50" value={rsFullCost} onChange={e => setRsFullCost(Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded p-2 font-mono text-slate-800" />
              <p className="text-[10px] text-slate-400 mt-0.5">Net + employer contributions / VAT. Equal to net for invoices.</p>
            </div>
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Full Company Cost (€/mo) — optional</label>
              <input type="number" step="50" placeholder="Leave empty until known" value={rsCompanyCost || ''} onChange={e => setRsCompanyCost(Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded p-2 font-mono text-slate-800" />
              <p className="text-[10px] text-slate-400 mt-0.5">Total as the accountant bills it. Not used in calculations yet.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
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
              {isExporting ? 'Generating Bundle...' : 'Download Accountant Package →'}
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

      {/* ADD / EDIT PAYMENT TYPE MODAL */}
      <Modal isOpen={isTypeOpen} onClose={() => { setIsTypeOpen(false); setEditingTypeId(null); }} title={editingTypeId ? 'Edit Dynamic Payment Category' : 'Register Dynamic Payment Category'}>
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
            {editingTypeId && (
              <label className="flex items-center space-x-2 cursor-pointer">
                <input type="checkbox" checked={ptActive} onChange={e => setPtActive(e.target.checked)} className="w-4 h-4 text-blue-600 rounded border-slate-300" />
                <span className="font-bold text-slate-700">Active (available for new entries)</span>
              </label>
            )}
          </div>
          <div className="pt-3 border-t border-slate-200 flex justify-end space-x-2">
            <Button variant="outline" size="sm" onClick={() => { setIsTypeOpen(false); setEditingTypeId(null); }}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleSaveNewPaymentType} className="bg-[#3D87D3] hover:bg-[#3D87D3]/90 font-bold">{editingTypeId ? 'Update Category' : 'Save Category'} &rarr;</Button>
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Gross Amount (€)</label>
              <input type="number" step="0.01" value={upGross} onChange={e => setUpGross(Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 font-mono font-bold" />
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
                        {documentTypes.filter(dt => dt.active).map(dt => (
                          <option key={dt.code} value={dt.code}>{dt.emoji} {dt.label}</option>
                        ))}
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

            <div className={`p-3 rounded-xl border flex items-center justify-between ${hasPaymentReceipt(selectedPaymentForDocs.documents) ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-amber-50 border-amber-300 text-amber-900'}`}>
              <div className="flex items-center space-x-2.5">
                {hasPaymentReceipt(selectedPaymentForDocs.documents) ? (
                  <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                )}
                <div>
                  <span className="font-bold block text-xs">
                    {hasPaymentReceipt(selectedPaymentForDocs.documents) ? '✓ Official Settlement Receipt Attached' : '⚠️ Missing Settlement Receipt'}
                  </span>
                  <span className="text-[11px] font-medium opacity-90 block">
                    {hasPaymentReceipt(selectedPaymentForDocs.documents) 
                      ? 'This payment row satisfies audit compliance with a verified Bank Receipt or Payslip voucher.' 
                      : 'You can attach multiple documents (invoices, timesheets, tax sheets), but at least one must be marked as "⭐ Bank Receipt (Proof)" or "📄 Payslip (Analysis)" for audit compliance.'}
                  </span>
                </div>
              </div>
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
                        <div className="flex items-center space-x-3 truncate max-w-[50%]">
                          <div className="p-2 bg-indigo-50 text-[#3D87D3] rounded-lg shrink-0">
                            {doc.type === 'invoice' ? <FileSpreadsheet className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                          </div>
                          <div className="truncate">
                            <span className="font-bold text-slate-800 text-xs block truncate">{doc.name}</span>
                            <span className="text-[10px] text-slate-400 font-mono block mt-0.5">
                              Uploaded: {formatDateTime(doc.uploaded_at)} &bull; Size: {doc.size}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2 shrink-0">
                          <select
                            value={doc.type || 'receipt'}
                            onChange={(e) => {
                              const val = e.target.value;
                              updatePaymentDocumentType(selectedPaymentForDocs.id, doc.id, val);
                              setSelectedPaymentForDocs(prev => prev ? {
                                ...prev,
                                documents: (prev.documents || []).map(d => d.id === doc.id ? { ...d, type: val } : d)
                              } : null);
                            }}
                            className={`text-[11px] font-extrabold rounded-lg px-2.5 py-1 border cursor-pointer transition-colors shadow-2xs ${
                              doc.type === 'receipt' || doc.type === 'payslip' 
                                ? 'bg-emerald-100 border-emerald-300 text-emerald-900' 
                                : 'bg-slate-100 border-slate-300 text-slate-700'
                            }`}
                            title="Change document category / mark as Receipt"
                          >
                            {documentTypes.filter(dt => dt.active).map(dt => (
                              <option key={dt.code} value={dt.code}>{dt.emoji} {dt.label}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => setPreviewDoc({ doc, profName: `${prof?.first_name} ${prof?.last_name}`, bankRef: selectedPaymentForDocs.bank_reference })}
                            className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-md font-semibold text-[11px] flex items-center gap-1 px-2.5 transition-colors cursor-pointer shadow-2xs"
                          >
                            <Eye className="w-3.5 h-3.5 text-indigo-600" /> Preview
                          </button>
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
                          {documentTypes.filter(dt => dt.active).map(dt => (
                            <option key={dt.code} value={dt.code}>{dt.emoji} {dt.label}</option>
                          ))}
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

      {previewDoc && (
        <DocumentPreviewModal
          isOpen={!!previewDoc}
          onClose={() => setPreviewDoc(null)}
          documentName={previewDoc.doc.name}
          documentUrl={previewDoc.doc.url}
          storagePath={`payroll/${selectedPeriod}/${previewDoc.doc.name}`}
          uploadedAt={formatDateTime(previewDoc.doc.uploaded_at)}
          subtitle={`Payroll Receipt · ${previewDoc.profName} (${previewDoc.doc.type.replace('_', ' ')})`}
          onDownload={() => handleDownloadDoc(previewDoc.doc, previewDoc.profName, previewDoc.bankRef)}
        />
      )}

      {/* RIGHT-CLICK CUSTOM CONTEXT MENU FOR PAYROLL ROWS */}
      {contextMenu && (
        <div 
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-50 w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 py-2 text-xs overflow-hidden animate-in fade-in zoom-in-95 duration-150 font-sans"
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const pay = contextMenu.payment;
            const prof = profiles.find(p => p.id === pay.profile_id);
            const pt = paymentTypes.find(type => type.id === pay.payment_type_id);
            return (
              <>
                <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 mb-1">
                  <div className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider">⚡ Quick Copy Menu</div>
                  <div className="font-extrabold text-slate-800 truncate text-sm">{prof ? `${prof.first_name} ${prof.last_name}` : 'Employee'} &mdash; {pay.period}</div>
                </div>

                <div className="py-1 space-y-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      copyToClipboard(pay.id, `Payment UUID (${pay.id.slice(0,8)}...)`, pay.id);
                      setContextMenu(null);
                    }}
                    className="w-full px-3.5 py-2 text-left text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 font-semibold flex items-center justify-between transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <Copy className="w-3.5 h-3.5 text-[#3D87D3]" /> Copy Payment UUID
                    </span>
                    <span className="text-[10px] font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">{pay.id.slice(0, 6)}...</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      copyToClipboard(pay.profile_id, `Employee UUID (${pay.profile_id.slice(0,8)}...)`, undefined);
                      setContextMenu(null);
                    }}
                    className="w-full px-3.5 py-2 text-left text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 font-semibold flex items-center justify-between transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <Users className="w-3.5 h-3.5 text-blue-600" /> Copy Employee UUID
                    </span>
                    <span className="text-[10px] font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">{pay.profile_id.slice(0, 6)}...</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const val = `€${pay.net.toLocaleString()} Net (Total Cost: €${pay.total_cost.toLocaleString()}) - Bank Ref: ${pay.bank_reference || 'Wire Transfer'}`;
                      copyToClipboard(val, `Disbursement Info (€${pay.net.toLocaleString()})`, undefined);
                      setContextMenu(null);
                    }}
                    className="w-full px-3.5 py-2 text-left text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 font-semibold flex items-center justify-between transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <DollarSign className="w-3.5 h-3.5 text-emerald-600" /> Copy Net Pay & Bank Ref
                    </span>
                    <span className="text-[10px] font-bold text-emerald-700">€{pay.net.toLocaleString()}</span>
                  </button>
                </div>

                <div className="border-t border-slate-100 my-1 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      const report = [
                        `💶 PAYROLL DISBURSEMENT REPORT: ${pay.period}`,
                        `=========================================`,
                        `• Employee / Partner: ${prof ? `${prof.first_name} ${prof.last_name}` : 'Staff Member'} (Title: ${prof?.title || 'Team Member'}, Type: ${prof?.employment_type || 'regular'})`,
                        `• Payment UUID: ${pay.id}`,
                        `• Employee Profile UUID: ${pay.profile_id}`,
                        `• Period: ${pay.period} | Scheduled Payment Date: ${formatDate(pay.payment_date)}`,
                        `• Payment Category: ${pt?.name_el || 'Μισθός'} (${pt?.name_en || 'Salary'})`,
                        `• Status: ${pay.status.toUpperCase()}`,
                        `• Financial Breakdown: Gross €${(pay.gross || 0).toLocaleString()} | Employer EFKA: €${(pay.employer_contributions || 0).toLocaleString()} | Total Cost: €${(pay.total_cost || 0).toLocaleString()} | Net Payable: €${(pay.net || 0).toLocaleString()}`,
                        `• Bank Ref & Note: ${pay.bank_reference || 'WIRE-TRANSFER'} / ${pay.note || 'Regular scheduled settlement'}`,
                        `• Compliance & Receipts: ${pay.documents?.length || 0} document(s) verified in Supabase RLS vault`
                      ].join('\n');
                      copyToClipboard(report, `Payroll Fast Report (${pay.period})`, undefined);
                      setContextMenu(null);
                    }}
                    className="w-full px-3.5 py-2 text-left text-slate-800 hover:bg-emerald-50 hover:text-emerald-900 font-bold flex items-center justify-between transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-2 text-emerald-700">
                      <Share2 className="w-4 h-4 text-emerald-600" /> Copy Fast Report (For Colleague)
                    </span>
                    <span className="text-[9px] font-extrabold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded uppercase border border-emerald-200">Text</span>
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* FLOATING TOAST FEEDBACK FOR COPIED VALUES */}
      {copyFeedback && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-2xl border border-slate-700 flex items-center gap-3 animate-in slide-in-from-bottom-5 fade-in duration-200">
          <div className="w-7 h-7 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
            <Check className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-100">Copied to Clipboard!</div>
            <div className="text-[11px] text-slate-400 font-mono truncate max-w-xs">{copyFeedback}</div>
          </div>
        </div>
      )}
    </div>
  );
}
