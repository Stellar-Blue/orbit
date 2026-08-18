"use client";

import React, { useState, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { notifySuccess } from '@/lib/validation-modal';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { Invoice, InvoiceDirection, InvoiceType, InvoiceStatus, Contract, Counterparty } from '@/lib/types';
import { Card, Button, Badge, Modal, StatCard } from '@/components/ui/primitives';
import { 
  Receipt, Plus, AlertTriangle, Clock, Calendar, DollarSign, 
  ArrowUpRight, ArrowDownLeft, Download, Upload, Check, TrendingUp, BarChart3, 
  Sparkles, Save, FileText, Search, Filter, Tag, CheckCircle2, XCircle, FileSpreadsheet, Building2, HelpCircle,
  Terminal, Activity, ShieldCheck, Key, Copy, ExternalLink, Shield, Edit, Trash2, Eye, Users, Share2, RefreshCw, CloudDownload
} from 'lucide-react';
import { DocumentPreviewModal } from '@/components/ui/document-preview-modal';
import { CashflowBarChart } from '@/components/invoices/cashflow-chart';
import { calculateContractValuation } from '@/lib/pricing-engine';
import * as XLSX from 'xlsx';

const InvoicesGrid = dynamic(() => import('@/components/invoices/invoices-grid').then(m => m.InvoicesGrid), { ssr: false });
const RevenueGrid = dynamic(() => import('@/components/contracts/revenue-grid').then(m => m.RevenueGrid), { ssr: false });

const STAT_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function ReportsPage() {
  const { 
    currentUser, invoices, invoiceCategories, counterparties, contracts, 
    addInvoice, updateInvoice, deleteInvoice, updateInvoiceStatus, recordInvoicePayment, addInvoiceDocument, saveInvoiceAllocation, salaries, refreshInvoices, catalogModules, catalogItems, deleteContract
  } = useAuth();

  const isAdmin = currentUser.role === 'admin';
  const params = useParams();
  const urlId = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; invoice: Invoice } | null>(null);

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

  // Navigation tabs within Financial Hub
  const [activeTab, setActiveTab] = useState<'reconciliation' | 'cashflow' | 'accountant' | 'revenue'>('reconciliation');

  // AR/AP reporting period selector (default: current month & year; month 0 = All Year)
  const [statYear, setStatYear] = useState<number>(new Date().getFullYear());
  const [statMonth, setStatMonth] = useState<number>(new Date().getMonth() + 1);

  // Cashflow realized/projected period selector (default: start 3 months back, 6 months wide)
  const [cfStartYear, setCfStartYear] = useState<number>(() => { const d = new Date(); d.setMonth(d.getMonth() - 3); return d.getFullYear(); });
  const [cfStartMonth, setCfStartMonth] = useState<number>(() => { const d = new Date(); d.setMonth(d.getMonth() - 3); return d.getMonth() + 1; });
  const [cfMonths, setCfMonths] = useState<number>(6);

  // Month M Close Drift Rollups (Current Month)
  const currentMonthPeriod = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const monthDrift = useMemo(() => {
    let uninvoicedArAmount = 0;
    let overdueUnpaidAr = 0;
    let supplierDueIn14Days = 0;
    let missingDocumentsCount = 0;

    const today = new Date();
    const in14Days = new Date();
    in14Days.setDate(today.getDate() + 14);

    // Check contracts for scheduled items without corresponding invoice allocations in current month
    contracts.forEach(cnt => {
      if (cnt.direction === 'revenue') {
        const sched = cnt.schedule?.find(s => s.period === currentMonthPeriod);
        if (sched) {
          const hasAlloc = invoices.some(i => i.contract_id === cnt.id && i.status !== 'cancelled' && (i.reference_period === currentMonthPeriod || i.allocations?.some(a => a.period === currentMonthPeriod) || i.issue_date.startsWith(currentMonthPeriod) || (i.period_from || '').startsWith(currentMonthPeriod)));
          if (!hasAlloc) {
            uninvoicedArAmount += sched.amount;
          }
        }
      }
    });

    invoices.forEach(inv => {
      if (inv.status === 'cancelled') return;
      if (inv.missing_document) missingDocumentsCount++;

      const dueDate = new Date(inv.due_date);
      const isUnpaid = inv.status !== 'paid';

      if (inv.direction === 'outgoing' && isUnpaid && dueDate < today) {
        const paid = (inv.payments || []).reduce((sum, p) => sum + p.amount, 0);
        overdueUnpaidAr += (inv.gross_eur - paid);
      }
      if (inv.direction === 'incoming' && isUnpaid && dueDate >= today && dueDate <= in14Days) {
        const paid = (inv.payments || []).reduce((sum, p) => sum + p.amount, 0);
        supplierDueIn14Days += (inv.gross_eur - paid);
      }
    });

    return { uninvoicedArAmount, overdueUnpaidAr, supplierDueIn14Days, missingDocumentsCount };
  }, [invoices, contracts, currentMonthPeriod]);

  // AR Aging Buckets Calculation
  const agingBuckets = useMemo(() => {
    let current = 0;
    let days1_30 = 0;
    let days31_60 = 0;
    let days61_90 = 0;
    let days90Plus = 0;
    const today = new Date().getTime();

    invoices.forEach(inv => {
      if (inv.direction !== 'outgoing' || inv.status === 'paid' || inv.status === 'cancelled' || inv.type === 'proforma') return;
      const paid = (inv.payments || []).reduce((sum, p) => sum + p.amount, 0);
      const openAmount = Math.max(0, inv.gross_eur - paid);
      const dueTime = new Date(inv.due_date).getTime();
      const diffDays = Math.floor((today - dueTime) / (1000 * 3600 * 24));

      if (diffDays <= 0) current += openAmount;
      else if (diffDays <= 30) days1_30 += openAmount;
      else if (diffDays <= 60) days31_60 += openAmount;
      else if (diffDays <= 90) days61_90 += openAmount;
      else days90Plus += openAmount;
    });

    const totalOpenAr = current + days1_30 + days31_60 + days61_90 + days90Plus;
    return { current, days1_30, days31_60, days61_90, days90Plus, totalOpenAr };
  }, [invoices]);

  // Cashflow view: realized (actual invoices by issue date) vs projected (contract schedules + open liabilities)
  // over a user-selectable period. Realized is filled for past/current months, projected for all months.
  const cashflowView = useMemo(() => {
    const months: Array<{
      month: string; label: string;
      realizedAr: number; realizedAp: number;
      projectedAr: number; projectedAp: number;
      payroll: number; realizedNet: number; projectedNet: number;
      isCurrent: boolean; isPast: boolean;
    }> = [];
    const monthlyPayroll = (salaries || []).reduce((sum, s) => sum + s.gross_amount, 0) || 28500; // default estimated monthly payroll burn
    const nowYM = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

    for (let i = 0; i < cfMonths; i++) {
      const d = new Date(cfStartYear, cfStartMonth - 1 + i, 1);
      const mStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      // Realized = actual invoices issued in this month (accrual basis, cancelled excluded)
      let realizedAr = 0;
      let realizedAp = 0;
      invoices.forEach(inv => {
        if (inv.status === 'cancelled') return;
        if ((inv.issue_date || '').slice(0, 7) !== mStr) return;
        if (inv.direction === 'outgoing') realizedAr += inv.gross_eur;
        else realizedAp += inv.gross_eur;
      });

      // Projected = committed contract schedules + open invoice balances due this month
      let projectedAr = 0;
      let projectedAp = 0;
      contracts.forEach(cnt => {
        const sched = cnt.schedule?.find(s => s.period === mStr);
        if (sched) {
          if (cnt.direction === 'revenue') projectedAr += sched.amount;
          else if (cnt.direction === 'cost') projectedAp += sched.amount;
        } else if (cnt.value && cnt.billing_cadence === 'monthly') {
          const val = cnt.value / 12;
          if (cnt.direction === 'revenue') projectedAr += val;
          else if (cnt.direction === 'cost') projectedAp += val;
        }
      });
      invoices.forEach(inv => {
        if (inv.status === 'paid' || inv.status === 'cancelled') return;
        if (!(inv.due_date || '').startsWith(mStr)) return;
        const paid = (inv.payments || []).reduce((sum, p) => sum + p.amount, 0);
        const rem = Math.max(0, inv.gross_eur - paid);
        if (inv.direction === 'outgoing') projectedAr += rem;
        else if (inv.direction === 'incoming') projectedAp += rem;
      });

      const isPast = mStr < nowYM;
      const isCurrent = mStr === nowYM;
      months.push({
        month: mStr,
        label: `${STAT_MONTHS[d.getMonth()].slice(0, 3)} ${String(d.getFullYear()).slice(2)}`,
        realizedAr: Math.round(realizedAr),
        realizedAp: Math.round(realizedAp),
        projectedAr: Math.round(projectedAr),
        projectedAp: Math.round(projectedAp),
        payroll: Math.round(monthlyPayroll),
        realizedNet: Math.round(realizedAr - realizedAp - (isPast || isCurrent ? monthlyPayroll : 0)),
        projectedNet: Math.round(projectedAr - projectedAp - monthlyPayroll),
        isCurrent,
        isPast
      });
    }
    return months;
  }, [invoices, contracts, salaries, cfStartYear, cfStartMonth, cfMonths]);

  const fmtNet = (v: number) => (v >= 0 ? `+€${v.toLocaleString()}` : `-€${Math.abs(v).toLocaleString()}`);

  // Years available in the invoice archive (for the AR/AP period selector)
  const statYears = useMemo(() => {
    const years = new Set<number>([new Date().getFullYear()]);
    (invoices || []).forEach(i => {
      const y = Number((i.issue_date || '').slice(0, 4));
      if (y) years.add(y);
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [invoices]);

  // Years for the cashflow period selector: invoice years + next year (so future projections can be explored)
  const cfYears = useMemo(() => {
    return Array.from(new Set([...statYears, new Date().getFullYear() + 1])).sort((a, b) => b - a);
  }, [statYears]);

  // Totals for selected period + percentage change vs previous month / year (respectively)
  const statTotals = useMemo(() => {
    const isYearView = statMonth === 0;
    const inPeriod = (inv: Invoice, y: number, m: number) => {
      const invY = Number((inv.issue_date || '').slice(0, 4));
      const invM = Number((inv.issue_date || '').slice(5, 7));
      return isYearView ? invY === y : (invY === y && invM === m);
    };
    let prevYear = statYear;
    let prevMonth = statMonth;
    if (isYearView) {
      prevYear = statYear - 1;
    } else {
      prevMonth = statMonth - 1;
      if (prevMonth < 1) { prevMonth = 12; prevYear = statYear - 1; }
    }
    const sum = (y: number, m: number, dir: InvoiceDirection) =>
      (invoices || []).filter(i => inPeriod(i, y, m) && i.direction === dir && i.status !== 'cancelled')
        .reduce((s, i) => s + i.gross_eur, 0);
    const ar = sum(statYear, statMonth, 'outgoing');
    const ap = sum(statYear, statMonth, 'incoming');
    const prevAr = sum(prevYear, prevMonth, 'outgoing');
    const prevAp = sum(prevYear, prevMonth, 'incoming');
    const pct = (cur: number, prev: number) => prev === 0 ? (cur === 0 ? 0 : 100) : ((cur - prev) / prev) * 100;
    return { ar, ap, prevAr, prevAp, arPct: pct(ar, prevAr), apPct: pct(ap, prevAp) };
  }, [invoices, statYear, statMonth]);

  // Handle Document upload helper
  const handleUploadDocument = async (invId: string, file: File) => {
    const supabase = getSupabaseBrowserClient();
    const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const path = `invoices/${invId}_${Date.now()}_${cleanName}`;
    try {
      let documentUrl = '';
      const { error } = await supabase.storage.from('invoices').upload(path, file, { cacheControl: '3600', upsert: true });
      if (!error) {
        const { data: pubData } = supabase.storage.from('invoices').getPublicUrl(path);
        documentUrl = pubData?.publicUrl || '';
      }
      if (error || !documentUrl) {
        console.warn('Storage fallback applied or public URL unavailable -> using Data URL representation.');
        documentUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve((e.target?.result as string) || '');
          reader.onerror = () => resolve('');
          reader.readAsDataURL(file);
        });
      }
      await addInvoiceDocument(invId, { invoice_id: invId, storage_path: path, file_name: file.name, version: 1, url: documentUrl });
      notifySuccess('Invoice attachment linked.');
    } catch (err: any) {
      console.error('Document upload error:', err);
    }
  };

  // Export Accountant Package CSV
  const exportAccountantPackage = () => {
    const headers = ['Entity Legal Name', 'Direction', 'Type', 'Invoice Number', 'MARK Code', 'Issue Date', 'Due Date', 'Net (EUR)', 'VAT (EUR)', 'Gross (EUR)', 'Status', 'Category/Contract', 'Notes'];
    const rows = invoices.map((i: Invoice) => [
      `"${i.counterparty?.legal_name || 'Unknown Entity'}"`,
      i.direction.toUpperCase(),
      i.type.toUpperCase(),
      `"${i.invoice_number}"`,
      `"${i.mark || 'N/A'}"`,
      i.issue_date,
      i.due_date,
      i.net.toFixed(2),
      i.vat_amount.toFixed(2),
      i.gross_eur.toFixed(2),
      i.status.toUpperCase(),
      `"${i.contract ? i.contract.product || 'Contract' : i.category || 'One-Off Expense'}"`,
      `"${i.notes ? i.notes.replace(/"/g, '""') : ''}"`
    ]);
    const csvContent = [headers.join(','), ...rows.map((r: any[]) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `orbit_accountant_package_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export Budgeting & Cashflow report to Excel (multi-sheet) for off-platform analysis
  const exportCashflowXlsx = () => {
    const wb = XLSX.utils.book_new();
    const startLabel = `${STAT_MONTHS[cfStartMonth - 1]}_${cfStartYear}`;
    const dateStamp = new Date().toISOString().split('T')[0];

    // Sheet 1: Monthly Cashflow (Realized vs Projected)
    const monthly: (string | number)[][] = [
      ['ORBIT — BUDGETING & CASHFLOW REPORT'],
      ['Period Start:', `${STAT_MONTHS[cfStartMonth - 1]} ${cfStartYear}`],
      ['Months Shown:', String(cfMonths)],
      ['Generated On:', new Date().toLocaleDateString('en-GB')],
      [''],
      ['Month', 'Year', 'Realized AR (EUR)', 'Realized AP (EUR)', 'Realized Net (EUR)', 'Projected AR (EUR)', 'Projected AP (EUR)', 'Projected Net (EUR)', 'Payroll Burn (EUR)', 'Status']
    ];
    cashflowView.forEach(m => {
      monthly.push([
        m.month,
        m.month.slice(0, 4),
        m.realizedAr,
        m.realizedAp,
        m.isPast || m.isCurrent ? m.realizedNet : 0,
        m.projectedAr,
        m.projectedAp,
        m.projectedNet,
        m.payroll,
        m.isCurrent ? 'CURRENT' : (m.isPast ? 'REALIZED' : 'PROJECTED')
      ]);
    });
    const wsMonthly = XLSX.utils.aoa_to_sheet(monthly);
    wsMonthly['!cols'] = [{ wch: 11 }, { wch: 7 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 14 }, { wch: 11 }];
    XLSX.utils.book_append_sheet(wb, wsMonthly, 'Monthly_Cashflow');

    // Sheet 2: Invoice detail within the selected period (for deeper analysis)
    const startStr = `${cfStartYear}-${String(cfStartMonth).padStart(2, '0')}-01`;
    const endD = new Date(cfStartYear, cfStartMonth - 1 + cfMonths, 0);
    const endStr = `${endD.getFullYear()}-${String(endD.getMonth() + 1).padStart(2, '0')}-${String(endD.getDate()).padStart(2, '0')}`;
    const detail: (string | number)[][] = [
      ['ORBIT — INVOICE DETAIL (ISSUED WITHIN SELECTED PERIOD)'],
      [`Range: ${startStr} to ${endStr}`],
      [''],
      ['Invoice Number', 'Direction', 'Type', 'Counterparty', 'Issue Date', 'Due Date', 'Reference Period', 'Net (EUR)', 'VAT (EUR)', 'Gross (EUR)', 'Status', 'Missing PDF']
    ];
    invoices
      .filter(i => i.status !== 'cancelled' && (i.issue_date || '') >= startStr && (i.issue_date || '') <= endStr)
      .sort((a, b) => a.issue_date.localeCompare(b.issue_date))
      .forEach(i => {
        detail.push([
          i.invoice_number,
          i.direction === 'outgoing' ? 'AR (Issued)' : 'AP (Received)',
          (i.type || 'invoice').toUpperCase(),
          i.counterparty?.legal_name || 'Unmapped Entity',
          i.issue_date,
          i.due_date,
          i.reference_period || '',
          i.net,
          i.vat_amount,
          i.gross_eur,
          i.status,
          i.missing_document ? 'YES' : 'No'
        ]);
      });
    const wsDetail = XLSX.utils.aoa_to_sheet(detail);
    wsDetail['!cols'] = [{ wch: 18 }, { wch: 13 }, { wch: 11 }, { wch: 28 }, { wch: 11 }, { wch: 11 }, { wch: 13 }, { wch: 11 }, { wch: 11 }, { wch: 13 }, { wch: 15 }, { wch: 11 }];
    XLSX.utils.book_append_sheet(wb, wsDetail, 'Invoice_Detail');

    // Sheet 3: Summary totals
    const pastCurrent = cashflowView.filter(m => m.isPast || m.isCurrent);
    const totalRealizedAr = pastCurrent.reduce((s, m) => s + m.realizedAr, 0);
    const totalRealizedAp = pastCurrent.reduce((s, m) => s + m.realizedAp, 0);
    const totalRealizedNet = pastCurrent.reduce((s, m) => s + m.realizedNet, 0);
    const totalProjectedAr = cashflowView.reduce((s, m) => s + m.projectedAr, 0);
    const totalProjectedAp = cashflowView.reduce((s, m) => s + m.projectedAp, 0);
    const totalProjectedNet = cashflowView.reduce((s, m) => s + m.projectedNet, 0);
    const summary: (string | number)[][] = [
      ['ORBIT — CASHFLOW SUMMARY'],
      [''],
      ['Metric', 'Amount (EUR)'],
      ['Total Realized AR (invoices issued)', totalRealizedAr],
      ['Total Realized AP (invoices received)', totalRealizedAp],
      ['Total Realized Net', totalRealizedNet],
      ['Total Projected AR (schedules + open due)', totalProjectedAr],
      ['Total Projected AP (schedules + open due)', totalProjectedAp],
      ['Total Projected Net', totalProjectedNet],
      ['Monthly Payroll Burn', cashflowView[0]?.payroll || 0],
      [''],
      ['Notes:', 'Realized = actual invoices by issue date. Projected = contract schedules + open invoice balances. Cancelled invoices excluded.']
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summary);
    wsSummary['!cols'] = [{ wch: 46 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

    XLSX.writeFile(wb, `Orbit_Budgeting_Cashflow_${startLabel}_${cfMonths}mo_${dateStamp}.xlsx`);
    notifySuccess('Budgeting & Cashflow Excel report exported.');
  };

  if (!isAdmin) {
    return (
      <div className="p-8 max-w-4xl mx-auto text-center">
        <Card className="p-8 border-red-200 bg-red-50 text-red-900 rounded-2xl">
          <AlertTriangle className="w-12 h-12 text-red-600 mx-auto mb-3" />
          <h2 className="text-xl font-bold">Admin Authorization Required</h2>
          <p className="text-xs text-red-700 mt-2">
            Invoice archives, corporate banking references, and real-time cashflow schedules are restricted to authenticated executive administrators under strict Row-Level Security (RLS).
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full px-6 py-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Module Tabs */}
      <div className="flex items-center space-x-2 border-b border-slate-200 pb-3 overflow-x-auto">
        <button
          onClick={() => setActiveTab('reconciliation')}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'reconciliation'
              ? 'bg-[#3D87D3]/10 text-[#3D87D3] border border-[#3D87D3]/30 shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 text-[#3D87D3]" />
          <span>Expected vs. Actual & Month Close</span>
          {(monthDrift.uninvoicedArAmount > 0 || monthDrift.missingDocumentsCount > 0) && (
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" title="Action needed in current month" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('cashflow')}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'cashflow'
              ? 'bg-purple-50 text-purple-700 border border-purple-200 shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <TrendingUp className="w-4 h-4 text-purple-600" />
          <span>Budgeting & Cashflow Projections</span>
        </button>
        <button
          onClick={() => setActiveTab('accountant')}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'accountant'
              ? 'bg-cyan-50 text-cyan-700 border border-cyan-200 shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <Terminal className="w-4 h-4 text-cyan-600" />
          <span>Accountant Compliance</span>
        </button>
        <button
          onClick={() => setActiveTab('revenue')}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'revenue'
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <Sparkles className="w-4 h-4 text-emerald-600" />
          <span>Revenue Schedule & MRR</span>
        </button>
      </div>

      {activeTab === 'reconciliation' && (
        <div className="space-y-8 animate-fadeIn">
          {/* Dashboard Widget for Month M */}
          <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white p-8 rounded-3xl shadow-xl border border-indigo-500/20">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-xl font-bold text-white flex items-center gap-2.5">
                  <Clock className="w-6 h-6 text-amber-400" />
                  Monthly Close Ritual & Financial Signal Drift ({currentMonthPeriod})
                </h3>
                <p className="text-xs text-slate-300 mt-1 max-w-3xl">
                  Inspect deviations between contract billing commitments and actual registered tax invoices. Catch un-billed revenues and upcoming vendor liabilities before financial close.
                </p>
              </div>
              <span className="px-3 py-1 bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 font-extrabold text-xs rounded-xl">
                Real-Time Sync
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="p-5 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm">
                <span className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  Uninvoiced AR Schedules
                </span>
                <span className="text-3xl font-black text-white mt-2 block font-mono">
                  €{monthDrift.uninvoicedArAmount.toLocaleString('en-US', { minimumFractionDigits: 0 })}
                </span>
                <p className="text-[11px] text-slate-400 mt-2">
                  Contract revenue scheduled for this month lacking registered tax invoices!
                </p>
              </div>

              <div className="p-5 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm">
                <span className="text-xs font-bold text-rose-300 uppercase tracking-wider flex items-center gap-1.5">
                  <XCircle className="w-4 h-4 text-rose-400" />
                  Overdue Unpaid AR
                </span>
                <span className="text-3xl font-black text-white mt-2 block font-mono">
                  €{monthDrift.overdueUnpaidAr.toLocaleString('en-US', { minimumFractionDigits: 0 })}
                </span>
                <p className="text-[11px] text-slate-400 mt-2">
                  Issued client bills past commercial maturity date awaiting collection.
                </p>
              </div>

              <div className="p-5 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm">
                <span className="text-xs font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-cyan-400" />
                  Supplier Due (14 Days)
                </span>
                <span className="text-3xl font-black text-white mt-2 block font-mono">
                  €{monthDrift.supplierDueIn14Days.toLocaleString('en-US', { minimumFractionDigits: 0 })}
                </span>
                <p className="text-[11px] text-slate-400 mt-2">
                  AP vendor liabilities falling due within the next fortnight.
                </p>
              </div>

              <div className="p-5 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm">
                <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-emerald-400" />
                  Unlinked Archive Files
                </span>
                <span className="text-3xl font-black text-white mt-2 block font-mono">
                  {monthDrift.missingDocumentsCount} Bills
                </span>
                <p className="text-[11px] text-slate-400 mt-2">
                  Registered invoice entries missing uploaded PDF supporting docs.
                </p>
              </div>
            </div>
          </div>

          {/* Interactive Billing Schedule Timeline */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
            <h4 className="font-extrabold text-slate-900 text-base mb-4 flex items-center justify-between">
              <span>Contract Revenue Schedule & ±2% Variance Enforcement</span>
              <div className="flex items-center gap-4 text-xs font-normal">
                <span className="flex items-center gap-1 text-emerald-700 font-bold"><span className="w-3 h-3 rounded bg-emerald-500 inline-block"/> Invoiced & Paid</span>
                <span className="flex items-center gap-1 text-amber-700 font-bold"><span className="w-3 h-3 rounded bg-amber-500 inline-block"/> Invoiced Unpaid</span>
                <span className="flex items-center gap-1 text-rose-700 font-bold"><span className="w-3 h-3 rounded bg-rose-500 inline-block"/> Uninvoiced Past/Due</span>
              </div>
            </h4>

            <div className="space-y-4">
              {contracts.filter(c => c.direction === 'revenue').map(cnt => {
                const sched = cnt.schedule || [];
                if (sched.length === 0) return null;

                return (
                  <Card key={cnt.id} className="p-5 border-slate-200 hover:border-slate-300 transition-all rounded-2xl bg-slate-50/50">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-200">
                      <div>
                        <h5 className="font-extrabold text-slate-900 text-sm">{cnt.counterparty?.legal_name || 'Client Agreement'} — {cnt.product || 'Subscription'}</h5>
                        <span className="text-xs text-slate-500 font-medium">Cadence: {cnt.billing_cadence} | Total Contract Value: €{(cnt.value || 0).toLocaleString()}</span>
                      </div>
                      <Badge variant="neutral" className="w-fit bg-white border-slate-300 font-mono text-xs font-bold">
                        Net {cnt.payment_terms_days ?? 30} Days Terms
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                      {sched.map(item => {
                        // Find matching invoices for this schedule period
                        const matchedInv = invoices.find(i => i.contract_id === cnt.id && i.status !== 'cancelled' && (i.allocations?.some(a => a.period === item.period) || i.issue_date.startsWith(item.period)));
                        const isPast = item.period <= currentMonthPeriod;
                        let tileColor = 'bg-slate-100 border-slate-200 text-slate-700';
                        let statusText = 'Scheduled';

                        if (matchedInv) {
                          if (matchedInv.status === 'paid') {
                            tileColor = 'bg-emerald-50 border-emerald-300 text-emerald-900 shadow-xs';
                            statusText = `Paid (${matchedInv.invoice_number})`;
                          } else {
                            tileColor = 'bg-amber-50 border-amber-300 text-amber-900';
                            statusText = `Unpaid (${matchedInv.invoice_number})`;
                          }
                        } else if (isPast) {
                          tileColor = 'bg-rose-50 border-rose-300 text-rose-900 animate-pulse';
                          statusText = 'MISSING INVOICE';
                        }

                        // Check variance (>2%)
                        let hasVariance = false;
                        if (matchedInv && item.amount > 0) {
                          const diff = Math.abs(matchedInv.net - item.amount) / item.amount;
                          if (diff > 0.02) hasVariance = true;
                        }

                        return (
                          <div key={item.id} className={`p-3 rounded-xl border flex flex-col justify-between transition-all ${tileColor}`}>
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-extrabold">{item.period}</span>
                              {hasVariance && (
                                <span className="w-2 h-2 rounded-full bg-red-600" title="Billing variance exceeds ±2% tolerance!" />
                              )}
                            </div>
                            <span className="text-sm font-black mt-2 font-mono">€{item.amount.toLocaleString()}</span>
                            <span className="text-[10px] font-bold uppercase tracking-wider mt-2 truncate">{statusText}</span>
                            {hasVariance && (
                              <span className="text-[9px] bg-red-600 text-white px-1.5 py-0.5 rounded font-extrabold mt-1">±2% Variance Alert</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                );
              })}
              {contracts.filter(c => c.direction === 'revenue' && c.schedule && c.schedule.length > 0).length === 0 && (
                <p className="p-8 text-center text-slate-400 font-medium italic">
                  No revenue schedules configured on active contracts yet. Open a contract dossier to define quarterly or monthly scheduled milestones!
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: BUDGETING & CASHFLOW PROJECTIONS */}
      {activeTab === 'cashflow' && (
        <div className="space-y-8 animate-fadeIn">
          {/* AR Aging Buckets */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-base font-extrabold text-slate-900">Client Accounts Receivable (AR) Aging & DSO</h4>
                <p className="text-xs text-slate-500">Breakdown of outstanding client receivables by overdue seniority duration.</p>
              </div>
              <Badge variant="info" className="text-xs font-bold px-3 py-1">
                Total Open Receivables: €{agingBuckets.totalOpenAr.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </Badge>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
              <Card className="p-4 bg-emerald-50/60 border-emerald-200 rounded-2xl">
                <span className="text-xs font-bold text-emerald-800 block">Current (&lt; Due)</span>
                <span className="text-2xl font-black text-emerald-900 mt-1 block font-mono">€{agingBuckets.current.toLocaleString('en-US', { minimumFractionDigits: 0 })}</span>
                <span className="text-[10px] text-emerald-700 font-semibold mt-1 block">Within net terms</span>
              </Card>

              <Card className="p-4 bg-blue-50/60 border-blue-200 rounded-2xl">
                <span className="text-xs font-bold text-blue-800 block">1 — 30 Days Overdue</span>
                <span className="text-2xl font-black text-blue-900 mt-1 block font-mono">€{agingBuckets.days1_30.toLocaleString('en-US', { minimumFractionDigits: 0 })}</span>
                <span className="text-[10px] text-blue-700 font-semibold mt-1 block">Gentle payment reminder</span>
              </Card>

              <Card className="p-4 bg-amber-50/60 border-amber-200 rounded-2xl">
                <span className="text-xs font-bold text-amber-800 block">31 — 60 Days Overdue</span>
                <span className="text-2xl font-black text-amber-900 mt-1 block font-mono">€{agingBuckets.days31_60.toLocaleString('en-US', { minimumFractionDigits: 0 })}</span>
                <span className="text-[10px] text-amber-700 font-semibold mt-1 block">Escalated collection required</span>
              </Card>

              <Card className="p-4 bg-orange-50/60 border-orange-200 rounded-2xl">
                <span className="text-xs font-bold text-orange-800 block">61 — 90 Days Overdue</span>
                <span className="text-2xl font-black text-orange-900 mt-1 block font-mono">€{agingBuckets.days61_90.toLocaleString('en-US', { minimumFractionDigits: 0 })}</span>
                <span className="text-[10px] text-orange-700 font-semibold mt-1 block">High risk of default</span>
              </Card>

              <Card className="p-4 bg-rose-50/60 border-rose-200 rounded-2xl">
                <span className="text-xs font-bold text-rose-800 block">90+ Days Overdue</span>
                <span className="text-2xl font-black text-rose-900 mt-1 block font-mono">€{agingBuckets.days90Plus.toLocaleString('en-US', { minimumFractionDigits: 0 })}</span>
                <span className="text-[10px] text-rose-700 font-semibold mt-1 block">Legal review recommended</span>
              </Card>
            </div>
          </div>

          {/* Cashflow: Realized vs Projected */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
              <div>
                <h4 className="text-base font-extrabold text-slate-900">Cashflow: Realized vs Projected</h4>
                <p className="text-xs text-slate-500">Actual invoice flows (realized) side-by-side with committed contract schedules & open liabilities (projected), including monthly payroll burn (~€{(salaries || []).reduce((s, r) => s + r.gross_amount, 0).toFixed(0)}/m).</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-[#3D87D3]" />
                  <span className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">Period</span>
                </div>
                <select
                  value={cfStartMonth}
                  onChange={(e) => setCfStartMonth(Number(e.target.value))}
                  className="text-xs px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 font-semibold text-slate-700 focus:outline-none"
                  title="Starting month of the range"
                >
                  {STAT_MONTHS.map((m, idx) => <option key={m} value={idx + 1}>{m}</option>)}
                </select>
                <select
                  value={cfStartYear}
                  onChange={(e) => setCfStartYear(Number(e.target.value))}
                  className="text-xs px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 font-semibold text-slate-700 focus:outline-none"
                  title="Starting year of the range"
                >
                  {cfYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <select
                  value={cfMonths}
                  onChange={(e) => setCfMonths(Number(e.target.value))}
                  className="text-xs px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 font-semibold text-slate-700 focus:outline-none"
                  title="How many months to show"
                >
                  {[3, 6, 12].map(n => <option key={n} value={n}>{n} months</option>)}
                </select>
                <button
                  type="button"
                  onClick={exportCashflowXlsx}
                  className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs px-3.5 py-2 rounded-xl transition-all cursor-pointer"
                  title="Export the selected period to Excel (Monthly Cashflow, Invoice Detail, Summary)"
                >
                  <Download className="w-3.5 h-3.5" /> Export Excel
                </button>
              </div>
            </div>

            {/* Graphs */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50">
                <h5 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-3">AR Cash Inflows</h5>
                <CashflowBarChart
                  labels={cashflowView.map(m => m.label)}
                  series={[
                    { name: 'Realized AR', color: '#10b981', values: cashflowView.map(m => m.realizedAr) },
                    { name: 'Projected AR', color: '#94a3b8', values: cashflowView.map(m => m.projectedAr) }
                  ]}
                />
              </div>
              <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50">
                <h5 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-3">AP Outflows + Payroll</h5>
                <CashflowBarChart
                  labels={cashflowView.map(m => m.label)}
                  series={[
                    { name: 'Realized AP', color: '#f59e0b', values: cashflowView.map(m => m.realizedAp) },
                    { name: 'Projected AP', color: '#e2e8f0', values: cashflowView.map(m => m.projectedAp) }
                  ]}
                />
              </div>
              <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50">
                <h5 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-3">Net Cash Flow</h5>
                <CashflowBarChart
                  labels={cashflowView.map(m => m.label)}
                  series={[
                    { name: 'Realized Net', color: '#3b82f6', values: cashflowView.map(m => m.realizedNet) },
                    { name: 'Projected Net', color: '#93c5fd', values: cashflowView.map(m => m.projectedNet) }
                  ]}
                />
              </div>
            </div>

            {/* Per-month numbers table */}
            <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full text-xs min-w-[780px]">
                <thead>
                  <tr className="bg-slate-100 text-slate-600 font-extrabold uppercase tracking-wider text-[10px]">
                    <th className="p-3 text-left">Month</th>
                    <th className="p-3 text-right">Realized AR</th>
                    <th className="p-3 text-right">Realized AP</th>
                    <th className="p-3 text-right">Realized Net</th>
                    <th className="p-3 text-right">Projected AR</th>
                    <th className="p-3 text-right">Projected AP</th>
                    <th className="p-3 text-right">Projected Net</th>
                  </tr>
                </thead>
                <tbody>
                  {cashflowView.map((m) => (
                    <tr key={m.month} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="p-3 font-bold text-slate-800 font-mono whitespace-nowrap">
                        {m.month}
                        {m.isCurrent && (
                          <span className="ml-2 text-[9px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full font-black align-middle">CURRENT</span>
                        )}
                        {m.isPast && (
                          <span className="ml-1.5 text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full font-bold align-middle">REALIZED</span>
                        )}
                      </td>
                      <td className="p-3 text-right font-mono text-emerald-700">{m.realizedAr ? `€${m.realizedAr.toLocaleString()}` : '—'}</td>
                      <td className="p-3 text-right font-mono text-amber-700">{m.realizedAp ? `€${m.realizedAp.toLocaleString()}` : '—'}</td>
                      <td className="p-3 text-right font-mono font-extrabold text-slate-800">{m.isPast || m.isCurrent ? fmtNet(m.realizedNet) : '—'}</td>
                      <td className="p-3 text-right font-mono text-emerald-700">{m.projectedAr ? `€${m.projectedAr.toLocaleString()}` : '—'}</td>
                      <td className="p-3 text-right font-mono text-amber-700">{m.projectedAp ? `€${m.projectedAp.toLocaleString()}` : '—'}</td>
                      <td className="p-3 text-right font-mono font-extrabold text-slate-800">{fmtNet(m.projectedNet)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: AI OPERATOR & ACCOUNTANT EXPORT */}
      {activeTab === 'accountant' && (
        <div className="space-y-8 animate-fadeIn">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Accountant Package Exporter */}
            <Card className="p-8 bg-gradient-to-br from-slate-900 to-indigo-950 text-white rounded-3xl shadow-xl flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <Badge variant="info" className="bg-cyan-500 text-slate-950 font-extrabold text-xs">One-Click Exporter</Badge>
                  <FileSpreadsheet className="w-8 h-8 text-cyan-400" />
                </div>
                <h3 className="text-2xl font-black text-white mt-4">Monthly Accountant Compliance Package</h3>
                <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                  Generate a structured compliance bundle matching AADE myDATA guidelines. Packages the full month invoice ledger CSV complete with MARK transmission numbers, EUR conversions, VAT treatment classifications, and document archive paths for external auditing.
                </p>
              </div>

              <div className="pt-6 mt-6 border-t border-white/10 flex items-center justify-between">
                <span className="text-xs text-slate-400">Ready for instant local generation</span>
                <Button 
                  onClick={exportAccountantPackage} 
                  className="bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-black px-6 py-3 rounded-2xl text-xs shadow-lg shadow-cyan-400/20 flex items-center gap-2"
                >
                  <Download className="w-4 h-4 stroke-[3]" />
                  Download Complete Ledger CSV
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}


      {/* VIEW 3: EXECUTIVE REVENUE SCHEDULE & MRR LANDING */}
      {activeTab === 'revenue' && (
        <div className="space-y-6">
          <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white shadow-xl border border-slate-700/80">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center space-x-2">
                  <Sparkles className="w-5 h-5 text-emerald-400" />
                  <span className="text-xs font-mono font-black tracking-widest text-emerald-300 uppercase">Executive Financial Monitor</span>
                </div>
                <h3 className="text-2xl font-black text-white mt-1">Modular Revenue & MRR Schedule</h3>
                <p className="text-xs text-slate-300 max-w-2xl mt-0.5">
                  Real-time aggregation of net monthly recurring rates and total contract valuation across active commercial agreements.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-6 bg-slate-900/90 px-6 py-4 rounded-xl border border-slate-700/60 shadow-lg">
                <div>
                  <span className="text-[10px] font-bold uppercase text-emerald-400 block tracking-wider">Total Portfolio ARR</span>
                  <span className="text-2xl font-mono font-black text-emerald-300 mt-0.5 block">
                    €{contracts.reduce((acc, c) => {
                      const val = calculateContractValuation(c.lines || [], c.discount_pct || 0, c.term_years || 1, c.service_start_date || c.starts_on, catalogModules, catalogItems, c.value || 0, c.billing_cadence);
                      return acc + (c.direction === 'revenue' ? val.netARR : 0);
                    }, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Strictly excludes one-time payments</span>
                </div>
                <div className="border-l border-slate-700/80 pl-6">
                  <span className="text-[10px] font-bold uppercase text-amber-400 block tracking-wider">Additional One-Off Revenue</span>
                  <span className="text-2xl font-mono font-black text-amber-300 mt-0.5 block">
                    +€{contracts.reduce((acc, c) => {
                      const val = calculateContractValuation(c.lines || [], c.discount_pct || 0, c.term_years || 1, c.service_start_date || c.starts_on, catalogModules, catalogItems, c.value || 0, c.billing_cadence);
                      return acc + (c.direction === 'revenue' ? val.oneTimeValue : 0);
                    }, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Setup, implementation & workshops</span>
                </div>
                <div className="border-l border-slate-700/80 pl-6">
                  <span className="text-[10px] font-bold uppercase text-blue-400 block tracking-wider">Total Portfolio TCV</span>
                  <span className="text-2xl font-mono font-black text-white mt-0.5 block">
                    €{contracts.reduce((acc, c) => {
                      const val = calculateContractValuation(c.lines || [], c.discount_pct || 0, c.term_years || 1, c.service_start_date || c.starts_on, catalogModules, catalogItems, c.value || 0, c.billing_cadence);
                      return acc + (c.direction === 'revenue' ? val.totalContractValue : 0);
                    }, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Real committed deal valuation</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="text-sm font-extrabold text-slate-800 flex items-center">
                <TrendingUp className="w-4 h-4 mr-2 text-indigo-600" /> Active Contract Pricing breakdown ({contracts.length})
              </span>
              <span className="text-xs text-slate-500 font-mono">Snapshots preserved independently per agreement</span>
            </div>
            <div className="overflow-x-auto">
              <RevenueGrid
                contracts={contracts}
                catalogModules={catalogModules}
                catalogItems={catalogItems}
                isAdmin={isAdmin}
                onEditPricing={(c) => {
                  window.location.href = '/contracts';
                  //
                }}
                onDelete={async (c) => {
                  if (confirm(`Are you certain you want to completely delete contract "${c.reference}" (${c.counterparty?.legal_name})?`)) {
                    await deleteContract(c.id);
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}


    </div>
  );
}
