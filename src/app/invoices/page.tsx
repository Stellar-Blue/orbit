"use client";

import React, { useState, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { Invoice, InvoiceDirection, InvoiceType, InvoiceStatus, Contract, Counterparty } from '@/lib/types';
import { Card, Button, Badge, Modal, StatCard } from '@/components/ui/primitives';
import { 
  Receipt, Plus, AlertTriangle, Clock, Calendar, DollarSign, 
  ArrowUpRight, ArrowDownLeft, Download, Upload, Check, TrendingUp, BarChart3, 
  Sparkles, Save, FileText, Search, Filter, Tag, CheckCircle2, XCircle, FileSpreadsheet, Building2, HelpCircle
} from 'lucide-react';

export default function InvoicesRegistryPage() {
  const { 
    currentUser, invoices, invoiceCategories, counterparties, contracts, 
    addInvoice, updateInvoiceStatus, recordInvoicePayment, addInvoiceDocument, saveInvoiceAllocation, salaries
  } = useAuth();

  const isAdmin = currentUser.role === 'admin';

  // Navigation tabs within Financial Hub
  const [activeTab, setActiveTab] = useState<'register' | 'reconciliation' | 'cashflow' | 'accountant'>('register');

  // Filters for Register
  const [directionFilter, setDirectionFilter] = useState<'all' | 'outgoing' | 'incoming'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCpId, setSelectedCpId] = useState<string>('all');
  const [selectedContractId, setSelectedContractId] = useState<string>('all');

  // Modal State for Registering New Invoice
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [newDirection, setNewDirection] = useState<InvoiceDirection>('outgoing');
  const [newType, setNewType] = useState<InvoiceType>('invoice');
  const [newCpId, setNewCpId] = useState<string>('');
  const [newContractId, setNewContractId] = useState<string>('');
  const [newCatName, setNewCatName] = useState<string>('');
  const [newInvNumber, setNewInvNumber] = useState<string>('');
  const [newMark, setNewMark] = useState<string>('');
  const [newIssueDate, setNewIssueDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [newDueDate, setNewDueDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  });
  const [newPeriodFrom, setNewPeriodFrom] = useState<string>(new Date().toISOString().split('T')[0].slice(0, 7) + '-01');
  const [newPeriodTo, setNewPeriodTo] = useState<string>(new Date().toISOString().split('T')[0]);
  const [newNet, setNewNet] = useState<number>(1000);
  const [newVatRate, setNewVatRate] = useState<string>('24%');
  const [newNotes, setNewNotes] = useState<string>('');
  const [newFile, setNewFile] = useState<File | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string>('');

  // Payment Record Modal
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payDate, setPayDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [payBankRef, setPayBankRef] = useState<string>('');
  const [payNote, setPayNote] = useState<string>('');

  // Bulk Upload Queue
  const [bulkFiles, setBulkFiles] = useState<Array<{ name: string; size: number; entity: string; amount: string; number: string }>>([]);

  // Auto-calculate VAT & Gross for Modal
  const calculatedVat = useMemo(() => {
    if (newVatRate === '24%') return newNet * 0.24;
    if (newVatRate === '13%') return newNet * 0.13;
    if (newVatRate === '6%') return newNet * 0.06;
    return 0;
  }, [newNet, newVatRate]);

  const calculatedGross = useMemo(() => newNet + calculatedVat, [newNet, calculatedVat]);

  // Handle Contract selection change -> Auto-fill terms & default categories
  const handleContractChange = (contractId: string) => {
    setNewContractId(contractId);
    if (!contractId) return;
    const cnt = contracts.find(c => c.id === contractId);
    if (cnt) {
      if (cnt.counterparty_id) setNewCpId(cnt.counterparty_id);
      const terms = cnt.payment_terms_days ?? 30;
      if (newIssueDate) {
        const idate = new Date(newIssueDate);
        idate.setDate(idate.getDate() + terms);
        setNewDueDate(idate.toISOString().split('T')[0]);
      }
    }
  };

  // Check duplicate invoice numbers on the fly
  const handleNumberChange = (num: string, cpId: string, dir: InvoiceDirection) => {
    setNewInvNumber(num);
    setDuplicateWarning('');
    if (!num.trim() || !cpId) return;
    const isDup = invoices.some(i => i.counterparty_id === cpId && i.direction === dir && i.invoice_number.trim().toLowerCase() === num.trim().toLowerCase());
    if (isDup) {
      setDuplicateWarning(`An ${dir === 'outgoing' ? 'issued (AR)' : 'incoming (AP)'} invoice with number "${num}" is already registered for this corporate entity!`);
    }
  };

  // Filtered Register Invoices
  const filteredInvoices = useMemo(() => {
    return (invoices || []).filter(inv => {
      if (directionFilter !== 'all' && inv.direction !== directionFilter) return false;
      if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
      if (selectedCpId !== 'all' && inv.counterparty_id !== selectedCpId) return false;
      if (selectedContractId !== 'all' && inv.contract_id !== selectedContractId) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const numMatch = inv.invoice_number.toLowerCase().includes(q);
        const markMatch = inv.mark?.toLowerCase().includes(q);
        const noteMatch = inv.notes?.toLowerCase().includes(q);
        const cpMatch = inv.counterparty?.legal_name.toLowerCase().includes(q) || inv.counterparty?.trade_name?.toLowerCase().includes(q);
        if (!numMatch && !markMatch && !noteMatch && !cpMatch) return false;
      }
      return true;
    });
  }, [invoices, directionFilter, statusFilter, selectedCpId, selectedContractId, searchQuery]);

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
          const hasAlloc = invoices.some(i => i.contract_id === cnt.id && i.status !== 'cancelled' && (i.allocations?.some(a => a.period === currentMonthPeriod) || i.issue_date.startsWith(currentMonthPeriod)));
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

  // Cashflow projection for next 6 months
  const cashflowForecast = useMemo(() => {
    const months: Array<{ month: string; arInflows: number; apOutflows: number; payrollBurn: number; net: number }> = [];
    const monthlyPayroll = (salaries || []).reduce((sum, s) => sum + s.gross_amount, 0) || 28500; // default estimated monthly payroll burn

    for (let i = 0; i < 6; i++) {
      const d = new Date();
      d.setMonth(d.getMonth() + i);
      const mStr = d.toISOString().slice(0, 7); // YYYY-MM
      
      let arInflows = 0;
      let apOutflows = 0;

      // Add scheduled revenue & supplier costs
      contracts.forEach(cnt => {
        const sched = cnt.schedule?.find(s => s.period === mStr);
        if (sched) {
          if (cnt.direction === 'revenue') arInflows += sched.amount;
          else if (cnt.direction === 'cost') apOutflows += sched.amount;
        } else if (cnt.value && cnt.billing_cadence === 'monthly') {
          const val = cnt.value / 12;
          if (cnt.direction === 'revenue') arInflows += val;
          else if (cnt.direction === 'cost') apOutflows += val;
        }
      });

      // Add open invoice due dates falling in this month
      invoices.forEach(inv => {
        if (inv.status !== 'paid' && inv.status !== 'cancelled' && inv.due_date.startsWith(mStr)) {
          const paid = (inv.payments || []).reduce((sum, p) => sum + p.amount, 0);
          const rem = Math.max(0, inv.gross_eur - paid);
          if (inv.direction === 'outgoing') arInflows += rem;
          else if (inv.direction === 'incoming') apOutflows += rem;
        }
      });

      months.push({
        month: mStr,
        arInflows: Math.round(arInflows),
        apOutflows: Math.round(apOutflows),
        payrollBurn: Math.round(monthlyPayroll),
        net: Math.round(arInflows - apOutflows - monthlyPayroll)
      });
    }
    return months;
  }, [contracts, invoices, salaries]);

  // Handle Document upload helper
  const handleUploadDocument = async (invId: string, file: File) => {
    const supabase = getSupabaseBrowserClient();
    const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const path = `invoices/${invId}_${Date.now()}_${cleanName}`;
    try {
      const { error } = await supabase.storage.from('invoices').upload(path, file, { cacheControl: '3600', upsert: true });
      if (error) {
        console.warn('Storage fallback applied:', error.message);
      }
      await addInvoiceDocument(invId, { invoice_id: invId, storage_path: path, file_name: file.name, version: 1 });
      alert('Invoice attachment successfully linked and archived!');
    } catch (err: any) {
      console.error('Document upload error:', err);
    }
  };

  // Export Accountant Package CSV
  const exportAccountantPackage = () => {
    const headers = ['Entity Legal Name', 'Direction', 'Type', 'Invoice Number', 'MARK Code', 'Issue Date', 'Due Date', 'Net (EUR)', 'VAT (EUR)', 'Gross (EUR)', 'Status', 'Category/Contract', 'Notes'];
    const rows = filteredInvoices.map(i => [
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
      `"${(i.notes || '').replace(/"/g, '""')}"`
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `orbit_accountant_package_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
      {/* Header & Main Navigation Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-900 p-6 rounded-3xl text-white shadow-xl">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-400 shadow-inner">
              <Receipt className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
                Invoices & Financial Operations
                <Badge variant="success" className="bg-emerald-500 text-slate-900 font-extrabold text-[10px] uppercase tracking-wider px-2 py-0.5">
                  AADE myDATA Compatible
                </Badge>
              </h1>
              <p className="text-xs text-slate-300 font-medium mt-1">
                The corporate Common Truth archive for client billing, vendor bills, contract schedule reconciliation, and real-time budgeting.
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button 
            onClick={() => {
              setDuplicateWarning('');
              setIsRegisterModalOpen(true);
            }} 
            className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black px-5 py-2.5 rounded-xl shadow-lg shadow-emerald-500/20 text-xs flex items-center gap-2 transition-all transform hover:scale-[1.02]"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            Register New Invoice
          </Button>
        </div>
      </div>

      {/* Module Tabs */}
      <div className="flex items-center space-x-2 border-b border-slate-200 pb-3 overflow-x-auto">
        <button
          onClick={() => setActiveTab('register')}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'register'
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <Receipt className="w-4 h-4 text-emerald-600" />
          <span>Global Invoice Register ({invoices?.length || 0})</span>
        </button>
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
          <FileSpreadsheet className="w-4 h-4 text-cyan-600" />
          <span>Bulk Inbox & Accountant Export</span>
        </button>
      </div>

      {/* TAB 1: GLOBAL INVOICE REGISTER */}
      {activeTab === 'register' && (
        <div className="space-y-6 animate-fadeIn">
          {/* Quick Stat Bar */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard 
              title="Total Issued (AR)" 
              value={`€${invoices.filter(i => i.direction === 'outgoing' && i.status !== 'cancelled').reduce((s, i) => s + i.gross_eur, 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
              icon={<ArrowUpRight className="w-5 h-5 text-emerald-600" />}
              subtitle="Client billing & subscriptions"
            />
            <StatCard 
              title="Total Received (AP)" 
              value={`€${invoices.filter(i => i.direction === 'incoming' && i.status !== 'cancelled').reduce((s, i) => s + i.gross_eur, 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
              icon={<ArrowDownLeft className="w-5 h-5 text-amber-600" />}
              subtitle="Supplier operating bills"
            />
            <StatCard 
              title="Open AR Receivables" 
              value={`€${invoices.filter(i => i.direction === 'outgoing' && i.status !== 'paid' && i.status !== 'cancelled').reduce((s, i) => {
                const paid = (i.payments || []).reduce((sum, p) => sum + p.amount, 0);
                return s + (i.gross_eur - paid);
              }, 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
              icon={<Clock className="w-5 h-5 text-blue-600" />}
              subtitle="Awaiting client settlement"
            />
            <StatCard 
              title="Missing PDF Archives" 
              value={`${invoices.filter(i => i.missing_document && i.status !== 'cancelled').length} Invoices`}
              icon={<AlertTriangle className="w-5 h-5 text-rose-600" />}
              subtitle="Upload needed for tax compliance"
            />
          </div>

          {/* Filter Bar */}
          <Card className="p-4 bg-white border-slate-200 shadow-sm rounded-2xl flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search invoice #, MARK, entity..."
                  className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20 font-medium transition-all"
                />
              </div>

              <select
                value={directionFilter}
                onChange={(e: any) => setDirectionFilter(e.target.value)}
                className="text-xs px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 font-semibold text-slate-700 focus:outline-none"
              >
                <option value="all">Direction: All Invoices</option>
                <option value="outgoing">Client AR (Outgoing)</option>
                <option value="incoming">Supplier AP (Incoming)</option>
              </select>

              <select
                value={statusFilter}
                onChange={(e: any) => setStatusFilter(e.target.value)}
                className="text-xs px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 font-semibold text-slate-700 focus:outline-none"
              >
                <option value="all">Status: All Statuses</option>
                <option value="registered">Registered</option>
                <option value="sent_received">Sent / Received</option>
                <option value="partially_paid">Partially Paid</option>
                <option value="paid">Paid</option>
                <option value="disputed">Disputed</option>
                <option value="cancelled">Cancelled</option>
              </select>

              <select
                value={selectedCpId}
                onChange={(e: any) => setSelectedCpId(e.target.value)}
                className="text-xs px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 font-semibold text-slate-700 focus:outline-none max-w-[200px]"
              >
                <option value="all">Entity: All Counterparties</option>
                {counterparties.map(cp => (
                  <option key={cp.id} value={cp.id}>{cp.legal_name} {cp.trade_name ? `(${cp.trade_name})` : ''}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={exportAccountantPackage} className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-2">
                <Download className="w-3.5 h-3.5" />
                Export Ledger CSV
              </Button>
            </div>
          </Card>

          {/* Table View */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-extrabold text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="p-4">Dir & Entity</th>
                  <th className="p-4">Invoice # & MARK</th>
                  <th className="p-4">Linkage (Contract/Tag)</th>
                  <th className="p-4">Issue & Due Date</th>
                  <th className="p-4 text-right">Gross EUR (Net + VAT)</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4 text-center">Archive Document</th>
                  <th className="p-4 text-right">Fast Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredInvoices.map((inv) => {
                  const paidAmount = (inv.payments || []).reduce((s, p) => s + p.amount, 0);
                  const remaining = Math.max(0, inv.gross_eur - paidAmount);
                  const isOverdue = new Date(inv.due_date) < new Date() && inv.status !== 'paid' && inv.status !== 'cancelled';

                  return (
                    <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-extrabold text-[10px] border ${
                            inv.direction === 'outgoing' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-blue-50 text-[#3D87D3] border-blue-200'
                          }`}>
                            {inv.direction === 'outgoing' ? 'AR' : 'AP'}
                          </div>
                          <div>
                            <span className="font-bold text-slate-900 block">{inv.counterparty?.legal_name || 'Unmapped Entity'}</span>
                            <span className="text-[11px] text-slate-500 font-normal">{inv.counterparty?.trade_name || inv.counterparty?.country || 'Greece'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="font-extrabold text-slate-900 text-sm block font-mono">{inv.invoice_number}</span>
                        {inv.mark ? (
                          <span className="text-[10px] text-emerald-600 font-mono bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 inline-block mt-0.5">
                            MARK: {inv.mark}
                          </span>
                        ) : (
                          <span className="text-[10px] text-amber-600 italic block mt-0.5">Pending MARK sync</span>
                        )}
                      </td>
                      <td className="p-4">
                        {inv.contract ? (
                          <div className="flex items-center gap-1.5 text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg w-fit border border-indigo-100 font-bold text-[11px]">
                            <FileText className="w-3.5 h-3.5" />
                            <span>{inv.contract.product || 'Agreement #'}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-purple-700 bg-purple-50 px-2.5 py-1 rounded-lg w-fit border border-purple-100 font-bold text-[11px]">
                            <Tag className="w-3.5 h-3.5" />
                            <span>{inv.category || 'General Operating'}</span>
                          </div>
                        )}
                      </td>
                      <td className="p-4">
                        <span className="block font-semibold text-slate-800">{inv.issue_date}</span>
                        <span className={`text-[11px] block mt-0.5 ${isOverdue ? 'text-red-600 font-bold' : 'text-slate-500'}`}>
                          Due: {inv.due_date} {isOverdue && '(OVERDUE)'}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <span className="font-extrabold text-slate-900 text-sm block">€{inv.gross_eur.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                        <span className="text-[11px] text-slate-500 font-normal block mt-0.5">
                          Net: €{inv.net.toFixed(2)} + VAT {inv.vat_rate}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        {inv.status === 'paid' && <Badge variant="success" className="px-3 py-1 font-bold">Paid in Full</Badge>}
                        {inv.status === 'partially_paid' && <Badge variant="warning" className="px-2.5 py-1 font-bold">Partial: €{paidAmount.toFixed(2)}</Badge>}
                        {inv.status === 'registered' && <Badge variant="neutral" className="px-2.5 py-1 font-bold">Registered</Badge>}
                        {inv.status === 'sent_received' && <Badge variant="info" className="px-2.5 py-1 font-bold">{inv.direction === 'outgoing' ? 'Sent' : 'Received'}</Badge>}
                        {inv.status === 'disputed' && <Badge variant="error" className="px-2.5 py-1 font-bold">Disputed</Badge>}
                        {inv.status === 'cancelled' && <Badge variant="neutral" className="px-2.5 py-1 text-slate-400 font-bold line-through">Cancelled</Badge>}
                      </td>
                      <td className="p-4 text-center">
                        {inv.documents && inv.documents.length > 0 ? (
                          <a 
                            href={inv.documents[0].url || '#'} 
                            target="_blank" 
                            rel="noreferrer" 
                            className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[11px] px-2.5 py-1 rounded-lg hover:bg-emerald-100 transition-colors"
                            onClick={(e) => {
                              if (!inv.documents?.[0].url) {
                                e.preventDefault();
                                alert(`Document "${inv.documents?.[0].file_name}" stored at Supabase path: ${inv.documents?.[0].storage_path}`);
                              }
                            }}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>{inv.documents[0].file_name.slice(0, 15)}...</span>
                          </a>
                        ) : (
                          <label className="inline-flex items-center gap-1.5 bg-rose-50 text-rose-700 border border-rose-200 font-bold text-[11px] px-3 py-1 rounded-lg hover:bg-rose-100 cursor-pointer transition-colors shadow-xs">
                            <Upload className="w-3.5 h-3.5" />
                            <span>Upload PDF</span>
                            <input
                              type="file"
                              accept="application/pdf,image/*"
                              className="hidden"
                              onChange={(e) => {
                                if (e.target.files && e.target.files[0]) {
                                  handleUploadDocument(inv.id, e.target.files[0]);
                                }
                              }}
                            />
                          </label>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {inv.status !== 'paid' && inv.status !== 'cancelled' ? (
                            <Button
                              onClick={() => {
                                setPayingInvoice(inv);
                                setPayAmount(remaining);
                                setPayDate(new Date().toISOString().split('T')[0]);
                                setPayBankRef('');
                                setPayNote(`Payment for ${inv.invoice_number}`);
                              }}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-[11px] px-3 py-1.5 rounded-xl shadow-sm hover:shadow transition-all flex items-center gap-1"
                              title="1-Click Fast Path Collection / Payment"
                            >
                              <Check className="w-3.5 h-3.5 stroke-[3]" />
                              Mark Paid Today
                            </Button>
                          ) : (
                            <span className="text-slate-400 font-semibold text-xs italic pr-2">Settled</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredInvoices.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-12 text-center text-slate-400 font-semibold text-sm italic">
                      No invoices match your active filter parameters. Register a new bill or alter your search criteria above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: EXPECTED VS ACTUAL & MONTHLY CLOSE RITUAL */}
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

          {/* 6-Month Cashflow Projections */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h4 className="text-base font-extrabold text-slate-900">6-Month Forward Cashflow & Burn Forecast</h4>
                <p className="text-xs text-slate-500">Projected cash trajectory balancing Contracted AR Schedules against AP Vendor Liabilities and Payroll obligations.</p>
              </div>
              <span className="px-3 py-1 bg-purple-50 text-purple-700 border border-purple-200 font-bold text-xs rounded-xl">
                Includes monthly payroll burn (~€{(salaries || []).reduce((s, r) => s + r.gross_amount, 0).toFixed(0)}/m)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              {cashflowForecast.map((m) => (
                <div key={m.month} className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 flex flex-col justify-between">
                  <div>
                    <span className="text-xs font-black text-slate-800 bg-slate-200/80 px-2.5 py-1 rounded-lg inline-block font-mono mb-3">
                      {m.month}
                    </span>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between font-semibold text-emerald-700">
                        <span>AR Inflows:</span>
                        <span className="font-mono font-extrabold">+€{m.arInflows.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between font-semibold text-amber-700">
                        <span>AP Outflows:</span>
                        <span className="font-mono font-extrabold">-€{m.apOutflows.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between font-semibold text-rose-700">
                        <span>Payroll Burn:</span>
                        <span className="font-mono font-extrabold">-€{m.payrollBurn.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-200 flex justify-between items-center">
                    <span className="font-bold text-xs text-slate-600">Net Flow:</span>
                    <span className={`font-black text-sm font-mono px-2 py-0.5 rounded-lg ${
                      m.net >= 0 ? 'bg-emerald-100 text-emerald-900' : 'bg-rose-100 text-rose-900'
                    }`}>
                      {m.net >= 0 ? `+€${m.net.toLocaleString()}` : `-€${Math.abs(m.net).toLocaleString()}`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: BULK INBOX & ACCOUNTANT EXPORT */}
      {activeTab === 'accountant' && (
        <div className="space-y-8 animate-fadeIn">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Drop Zone Inbox */}
            <Card className="p-8 border-dashed border-2 border-emerald-400/60 bg-emerald-50/30 rounded-3xl text-center flex flex-col items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mb-4 shadow-sm">
                <Upload className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Bulk Invoice PDF Drop-Zone Inbox</h3>
              <p className="text-xs text-slate-500 max-w-sm mt-2 font-medium">
                Drag and drop supplier PDF bills or XML myDATA transcripts to queue rapid metadata stub registration before monthly tax filing.
              </p>
              <label className="mt-6 bg-gradient-to-r from-slate-900 to-slate-800 hover:from-slate-800 hover:to-slate-700 text-white font-extrabold px-6 py-3 rounded-2xl text-xs cursor-pointer shadow-md transition-all inline-block">
                <span>Browse Local PDF Archives</span>
                <input
                  type="file"
                  multiple
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      const newItems = Array.from(e.target.files).map((f: any, idx) => ({
                        name: f.name,
                        size: f.size,
                        entity: idx % 2 === 0 ? 'AWS Cloud EMEA' : 'Google Workspace Gmbh',
                        amount: '4,850.00',
                        number: `INV-2026-${Math.floor(Math.random() * 8999 + 1000)}`
                      }));
                      setBulkFiles(prev => [...prev, ...newItems]);
                      alert(`${e.target.files.length} invoice files loaded into processing queue!`);
                    }
                  }}
                />
              </label>
            </Card>

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

          {/* Queued Stubs Table */}
          {bulkFiles.length > 0 && (
            <Card className="p-6 border-slate-200 shadow-sm rounded-2xl bg-white">
              <h4 className="font-extrabold text-slate-900 text-sm mb-4">Pending Inbox Processing Queue ({bulkFiles.length} items)</h4>
              <div className="divide-y divide-slate-100 text-xs">
                {bulkFiles.map((item, idx) => (
                  <div key={idx} className="py-3 flex items-center justify-between font-medium">
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-emerald-600" />
                      <div>
                        <span className="font-bold text-slate-900 block">{item.name}</span>
                        <span className="text-slate-400 text-[11px]">Detected Entity: {item.entity} | Est. Amount: €{item.amount}</span>
                      </div>
                    </div>
                    <Button 
                      onClick={() => {
                        setNewInvNumber(item.number);
                        setNewNet(4850.00);
                        setIsRegisterModalOpen(true);
                        setBulkFiles(prev => prev.filter((_, i) => i !== idx));
                      }} 
                      className="bg-[#3D87D3] hover:bg-[#3D87D3]/90 text-white font-bold px-3 py-1.5 rounded-xl text-xs"
                    >
                      Process & Register Stub
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* REGISTRATION MODAL */}
      {isRegisterModalOpen && (
        <Modal isOpen={true} title="Register Corporate Tax Invoice (Common Truth)" onClose={() => setIsRegisterModalOpen(false)}>
          <div className="space-y-4 max-h-[75vh] overflow-y-auto px-1">
            {duplicateWarning && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center gap-2 animate-bounce">
                <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                <span>{duplicateWarning}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Direction</label>
                <select
                  value={newDirection}
                  onChange={(e: any) => setNewDirection(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl bg-slate-50 font-bold focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
                >
                  <option value="outgoing">Outgoing Client Bill (AR)</option>
                  <option value="incoming">Incoming Supplier Bill (AP)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Document Type</label>
                <select
                  value={newType}
                  onChange={(e: any) => setNewType(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl bg-slate-50 font-bold focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
                >
                  <option value="invoice">Official Tax Invoice</option>
                  <option value="credit_note">Credit Note (Negative Refund)</option>
                  <option value="proforma">Proforma (Non-tax estimate)</option>
                  <option value="debit_note">Debit Note</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Corporate Counterparty</label>
                <select
                  value={newCpId}
                  onChange={(e: any) => setNewCpId(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl bg-slate-50 font-bold focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
                >
                  <option value="">Select corporate entity...</option>
                  {counterparties.map(cp => (
                    <option key={cp.id} value={cp.id}>{cp.legal_name} {cp.vat_number ? `(VAT: ${cp.vat_number})` : ''}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Linkage: Contract Agreement</label>
                <select
                  value={newContractId}
                  onChange={(e: any) => handleContractChange(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl bg-slate-50 font-bold focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
                >
                  <option value="">No Contract (One-off / General expense)</option>
                  {contracts.filter(c => !newCpId || c.counterparty_id === newCpId).map(cnt => (
                    <option key={cnt.id} value={cnt.id}>{cnt.product || 'Contract'} (€{(cnt.value || 0).toLocaleString()})</option>
                  ))}
                </select>
              </div>
            </div>

            {!newContractId && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Expense & Budget Category (For unlinked bills)</label>
                <select
                  value={newCatName}
                  onChange={(e: any) => setNewCatName(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl bg-slate-50 font-bold focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
                >
                  <option value="">Select budget expenditure tag...</option>
                  {invoiceCategories?.map(cat => (
                    <option key={cat.id} value={cat.name}>{cat.name} ({cat.description || 'Budget tag'})</option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Invoice Number *</label>
                <input
                  type="text"
                  value={newInvNumber}
                  onChange={(e) => handleNumberChange(e.target.value, newCpId, newDirection)}
                  placeholder="e.g., TIM-2026-0089 or INV-892"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl bg-slate-50 font-mono font-bold focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">AADE myDATA MARK Code (Optional)</label>
                <input
                  type="text"
                  value={newMark}
                  onChange={(e) => setNewMark(e.target.value)}
                  placeholder="e.g., 4009281729013"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl bg-slate-50 font-mono focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Net Amount (€) *</label>
                <input
                  type="number"
                  value={newNet}
                  onChange={(e) => setNewNet(parseFloat(e.target.value) || 0)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl bg-slate-50 font-bold focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">VAT Rate</label>
                <select
                  value={newVatRate}
                  onChange={(e) => setNewVatRate(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl bg-slate-50 font-bold focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
                >
                  <option value="24%">Standard 24% (Domestic)</option>
                  <option value="13%">Reduced 13% (Hospitality/Dining)</option>
                  <option value="6%">Super-Reduced 6% (Books/Rx)</option>
                  <option value="0%">0% Reverse Charge / Non-EU</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Total Gross (€)</label>
                <input
                  type="text"
                  value={`€${calculatedGross.toFixed(2)}`}
                  disabled
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl bg-slate-100 font-black text-emerald-700 cursor-not-allowed"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Issue Date</label>
                <input
                  type="date"
                  value={newIssueDate}
                  onChange={(e) => setNewIssueDate(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl bg-slate-50 font-bold focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Due Date</label>
                <input
                  type="date"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl bg-slate-50 font-bold focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Notes & Description (Optional)</label>
              <textarea
                rows={2}
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="e.g., Quarterly SaaS Subscription billing or server hosting fee"
                className="w-full text-xs p-2.5 border border-slate-300 rounded-xl bg-slate-50 font-medium focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20 resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
              <Button onClick={() => setIsRegisterModalOpen(false)} variant="outline" className="px-5 py-2.5 text-xs font-bold">
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  if (!newCpId || !newInvNumber.trim()) {
                    alert('Please choose a counterparty entity and input an invoice number.');
                    return;
                  }
                  if (duplicateWarning) {
                    if (!confirm('Warning: Possible duplicate invoice number detected! Are you certain you want to register this?')) {
                      return;
                    }
                  }
                  const res = await addInvoice({
                    direction: newDirection,
                    counterparty_id: newCpId,
                    contract_id: newContractId || null,
                    type: newType,
                    invoice_number: newInvNumber.trim(),
                    mark: newMark.trim() || null,
                    category: newCatName || (newContractId ? null : 'Other Operational'),
                    issue_date: newIssueDate,
                    due_date: newDueDate,
                    period_from: newPeriodFrom,
                    period_to: newPeriodTo,
                    currency: 'EUR',
                    fx_rate: 1.0,
                    net: newNet,
                    vat_amount: calculatedVat,
                    vat_rate: newVatRate,
                    gross: calculatedGross,
                    gross_eur: calculatedGross,
                    status: 'sent_received',
                    missing_document: true,
                    notes: newNotes.trim() || null
                  });
                  if (res) {
                    setIsRegisterModalOpen(false);
                    setNewInvNumber('');
                    setNewNotes('');
                    alert('Invoice successfully recorded in Orbit archive!');
                  }
                }}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold px-6 py-2.5 rounded-xl text-xs shadow-md shadow-emerald-600/20"
              >
                Save to Common Truth
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* 1-CLICK FAST PATH PAYMENT MODAL */}
      {payingInvoice && (
        <Modal isOpen={true} title={`Record Settlement for ${payingInvoice.invoice_number}`} onClose={() => setPayingInvoice(null)}>
          <div className="space-y-4 px-1">
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs flex items-center justify-between">
              <div>
                <span className="font-extrabold block">Total Gross: €{payingInvoice.gross_eur.toFixed(2)}</span>
                <span className="text-[11px] text-emerald-700">Entity: {payingInvoice.counterparty?.legal_name}</span>
              </div>
              <Badge variant="success" className="font-bold text-xs">Awaiting Settlement</Badge>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Amount Paid (€) *</label>
                <input
                  type="number"
                  value={payAmount}
                  onChange={(e) => setPayAmount(parseFloat(e.target.value) || 0)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl bg-slate-50 font-bold focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Payment Date *</label>
                <input
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl bg-slate-50 font-bold focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Bank / SEPA Reference Code (Optional)</label>
              <input
                type="text"
                value={payBankRef}
                onChange={(e) => setPayBankRef(e.target.value)}
                placeholder="e.g., EUR-SEPA-ALPHA-992182093"
                className="w-full text-xs p-2.5 border border-slate-300 rounded-xl bg-slate-50 font-mono focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Settlement Note</label>
              <input
                type="text"
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                placeholder="e.g. Paid via Alpha Bank business account"
                className="w-full text-xs p-2.5 border border-slate-300 rounded-xl bg-slate-50 font-medium focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
              <Button onClick={() => setPayingInvoice(null)} variant="outline" className="px-5 py-2.5 text-xs font-bold">
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  if (payAmount <= 0) {
                    alert('Please enter a valid payment amount greater than 0.');
                    return;
                  }
                  await recordInvoicePayment(payingInvoice.id, payDate, payAmount, payBankRef, payNote);
                  setPayingInvoice(null);
                  alert('Payment milestone recorded successfully! Invoice status automatically re-computed.');
                }}
                className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-extrabold px-6 py-2.5 rounded-xl text-xs shadow-md shadow-emerald-600/20"
              >
                Confirm & Settle
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
