"use client";

import React, { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { notifySuccess } from '@/lib/validation-modal';
import { getSupabaseBrowserClient, SIGNED_URL_TTL_SECONDS } from '@/lib/supabase/client';
import { Contract, ContractLine, ContractLineGroup, ContractSchedule, ContractDirection, ContractStatus } from '@/lib/types';
import { Card, Button, Badge, Modal, StatCard } from '@/components/ui/primitives';
import { 
  FileText, Plus, AlertTriangle, Calendar, DollarSign, X, 
  ArrowUpRight, Download, Upload, Layers, TrendingUp, BarChart3, Sparkles, Save, Edit3, Trash2, Receipt, Eye, Zap
} from 'lucide-react';
import { ContractPricingBuilder } from '@/components/contracts/contract-pricing-builder';
import { ContractProjectsTab } from '@/components/contracts/contract-projects-tab';
import { RateCardMatrix } from '@/components/settings/rate-card-matrix';
import { CounterpartyPicker } from '@/components/counterparties/counterparty-picker';
import { formatDate, todayKey } from '@/lib/date';
import { DocumentPreviewModal } from '@/components/ui/document-preview-modal';
import { calculateContractValuation, getContractNoticeStatus } from '@/lib/pricing-engine';
import { buildDraftInvoicePayload, getContractBillingPeriods, type BillingPeriodItem } from '@/lib/billing-periods';

const ContractsGrid = dynamic(() => import('@/components/contracts/contracts-grid').then(m => m.ContractsGrid), { ssr: false });
const RevenueScheduleGrid = dynamic(() => import('@/components/contracts/revenue-schedule-grid').then(m => m.RevenueScheduleGrid), { ssr: false });

export default function ContractsRegistryPage() {
  const { currentUser, contracts, counterparties, profiles, projects, addContract, updateContract, deleteContract, saveContractPricing, invoices, catalogModules, catalogItems, ensureContractRateCard, timesheets, addInvoice, refreshInvoices } = useAuth();
  const params = useParams();
  const router = useRouter();
  const urlId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  
  const [directionFilter, setDirectionFilter] = useState<ContractDirection | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<ContractStatus | 'all'>('all');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [dossierTab, setDossierTab] = useState<'general' | 'pricing' | 'invoices' | 'projects' | 'ratecard'>('general');
  const [contractRateCardId, setContractRateCardId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'revenue'>('table');
  /** Optimistic "draft created" marks for the dossier's fast-create rows, keyed `${contractId}::${periodKey}`. */
  const [contractDraftIds, setContractDraftIds] = useState<Record<string, string>>({});
  /** Period currently being drafted — blocks a double click from creating two invoices. */
  const [creatingPeriodKey, setCreatingPeriodKey] = useState<string | null>(null);

  const isAdmin = currentUser.role === 'admin';

  // Fast-create a draft invoice for one of the contract's due billing periods, from the dossier or
  // straight from a suggestion in the revenue schedule. Uses the same payload builder as the Invoices
  // Hub quick-create so every path stays identical.
  const createDraftForPeriod = async (contract: Contract, period: BillingPeriodItem) => {
    if (!addInvoice || creatingPeriodKey) return;
    setCreatingPeriodKey(period.key);
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const dueStr = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
      const invNumber = `INV-${(period.from || todayStr).slice(0, 4)}-${Math.floor(1000 + Math.random() * 9000)}`;

      const newInv = await addInvoice(buildDraftInvoicePayload({
        period,
        contractId: contract.id,
        counterpartyId: contract.counterparty_id,
        direction: contract.direction,
        currency: contract.currency,
        expectedAmount: period.expectedAmount,
        reference: contract.reference,
        timing: period.timing,
        invoiceNumber: invNumber,
        issueDate: todayStr,
        dueDate: dueStr,
      }));

      if (newInv) {
        setContractDraftIds(prev => ({ ...prev, [`${contract.id}::${period.key}`]: newInv.id }));
        notifySuccess(`Draft invoice #${invNumber} created for ${contract.reference} (${period.label}).`);
        await refreshInvoices?.();
      }
    } finally {
      setCreatingPeriodKey(null);
    }
  };

  // Sync initial selection from URL ID
  useEffect(() => {
    if (urlId && contracts.length > 0 && !selectedContract) {
      const target = contracts.find(c => c.id === urlId || c.reference === urlId);
      if (target) {
        setSelectedContract(target);
      }
    }
  }, [urlId, contracts]);

  // Lazily create the contract's own man-hours rate card (seeded from the global default)
  useEffect(() => {
    if (!selectedContract) { setContractRateCardId(null); return; }
    let cancelled = false;
    ensureContractRateCard(selectedContract.id).then(id => { if (!cancelled) setContractRateCardId(id); });
    return () => { cancelled = true; };
  }, [selectedContract?.id]);

  // Sync address bar when contract is selected or closed
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (selectedContract) {
      window.history.pushState(null, '', `/contracts/${selectedContract.id}`);
    } else if (window.location.pathname.startsWith('/contracts/')) {
      window.history.pushState(null, '', '/contracts');
    }
  }, [selectedContract]);

  // Due billing periods for the contract currently open in the dossier (shared with the Invoices Hub
  // quick-create queue, so "what is owed" is computed in exactly one place).
  const selectedContractPeriods = useMemo(() => {
    if (!selectedContract) return [];
    return getContractBillingPeriods(selectedContract, {
      catalogModules: catalogModules || [],
      catalogItems: catalogItems || [],
      groups: selectedContract.groups || [],
      timesheets: timesheets || [],
      invoices: invoices || [],
      generatedDraftIds: contractDraftIds,
    });
  }, [selectedContract, catalogModules, catalogItems, timesheets, invoices, contractDraftIds]);

  // Form states for adding new contract
  const [newRef, setNewRef] = useState('SB-2026-NEW');
  const [newDirection, setNewDirection] = useState<ContractDirection>('revenue');
  const [newType, setNewType] = useState('saas_subscription');
  const [isPreviewingDoc, setIsPreviewingDoc] = useState(false);
  const [previewDocUrl, setPreviewDocUrl] = useState<string>('');
  const [newNotice, setNewNotice] = useState(60);
  const [newStarts, setNewStarts] = useState(todayKey);
  const [newEnds, setNewEnds] = useState('');
  const [newBillingCadence, setNewBillingCadence] = useState<'monthly' | 'quarterly' | 'annual' | 'milestone' | 'one_off'>('monthly');
  const [newInvoiceTiming, setNewInvoiceTiming] = useState<string>('start_of_period');
  const [newDocName, setNewDocName] = useState<string>('');
  const [newDocUrl, setNewDocUrl] = useState<string>('');
  const [isUploadingDoc, setIsUploadingDoc] = useState<boolean>(false);
  const [newCounterpartyId, setNewCounterpartyId] = useState<string>('');
  const [cpError, setCpError] = useState<string>('');

  const uploadToSupabaseStorage = async (file: File, refPrefix: string): Promise<string | null> => {
    const supabase = getSupabaseBrowserClient();
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = `contracts/${refPrefix}_${Date.now()}_${cleanFileName}`;
    try {
      const { error } = await supabase.storage
        .from('contract-documents')
        .upload(filePath, file, { cacheControl: '3600', upsert: true });

      if (error) {
        console.warn('Supabase Storage bucket notice:', error.message, '-> Falling back to encoded URL representation.');
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve((e.target?.result as string) || null);
          reader.readAsDataURL(file);
        });
      }

      // contract-documents is private, so the object path is stored and signed on read.
      return filePath;
    } catch (err) {
      console.error('Storage upload error:', err);
      return null;
    }
  };

  // document_url holds one of three shapes: a Data URL (the upload fallback above), a full
  // public URL from before the bucket was made private, or an object path for anything
  // written since. Older rows are left alone and normalised here instead of backfilled.
  const resolveContractDocumentUrl = async (documentUrl: string): Promise<string> => {
    if (documentUrl.startsWith('data:')) {
      return documentUrl;
    }

    const publicPrefix = '/storage/v1/object/public/contract-documents/';
    const prefixIndex = documentUrl.indexOf(publicPrefix);
    let storagePath = documentUrl;
    if (prefixIndex !== -1) {
      storagePath = documentUrl.slice(prefixIndex + publicPrefix.length);
    }

    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase.storage
      .from('contract-documents')
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

    return data?.signedUrl || '';
  };

  const handleSelectDocForNew = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    setIsUploadingDoc(true);
    const url = await uploadToSupabaseStorage(file, newRef || 'NEW');
    setIsUploadingDoc(false);
    if (url) {
      setNewDocName(file.name);
      setNewDocUrl(url);
    }
  };

  const handleUploadDocForSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0 || !selectedContract) return;
    const file = e.target.files[0];
    setIsUploadingDoc(true);
    const url = await uploadToSupabaseStorage(file, selectedContract.reference);
    setIsUploadingDoc(false);
    if (url) {
      const updated: Contract = {
        ...selectedContract,
        document_name: file.name,
        document_url: url,
        document_uploaded_at: new Date().toISOString()
      };
      updateContract(updated);
      setSelectedContract(updated);
      notifySuccess(`Document "${file.name}" attached to the contract.`);
    } else {
      alert("Error processing document attachment.");
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-10 text-center bg-slate-50 border border-slate-200 rounded-2xl max-w-xl mx-auto my-12 space-y-3 shadow-xs">
        <AlertTriangle className="w-10 h-10 mx-auto text-amber-600" />
        <h3 className="text-lg font-bold text-slate-800">Access Restricted: Admin Clearance Required</h3>
        <p className="text-xs text-slate-600 leading-relaxed">
          The Contracts Registry contains confidential financial terms, client SLAs, and operational vendor pricing. Your profile does not currently hold administrator credentials.
        </p>
      </div>
    );
  }

  const filteredContracts = contracts.filter(c => {
    const matchesDirection = directionFilter === 'all' || c.direction === directionFilter;
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchesDirection && matchesStatus;
  });

  // The revenue schedule mirrors the Excel revenue budget: every client agreement, across its own
  // effective dates. The reporting period and the direction filter intentionally do not apply.
  const revenueContracts = contracts.filter(c => c.direction === 'revenue');

  // `contracts.value` holds the deal's total contract value (TCV) as computed by the pricing sheet,
  // so a multi-year deal must be annualised before it can be reported as yearly revenue.
  const annualValue = (c: Contract): number => calculateContractValuation(
    c.lines || [], c.discount_pct || 0, c.term_years || 1,
    c.service_start_date || c.starts_on, catalogModules, catalogItems,
    c.value || 0, c.billing_cadence
  ).netARR;

  // Reporting-period attribution: annualised value prorated to the fraction of a year that the
  // contract's term overlaps the selected date range. Without a range every active contract
  // counts at its full annual value.
  const parseDay = (s: string): Date | null => {
    if (!s) return null;
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };
  const DAY_MS = 86400000;
  const valueInPeriod = (c: Contract): number => {
    const annual = annualValue(c);
    if (!periodFrom && !periodTo) return annual;
    const start = parseDay(c.starts_on);
    if (!start) return 0;
    const end = c.ends_on ? parseDay(c.ends_on) : null;
    const lo = periodFrom ? parseDay(periodFrom)! : new Date(0);
    const hi = periodTo ? parseDay(periodTo)! : new Date(9999, 11, 31);
    const ovStart = start > lo ? start : lo;
    const ovEnd = end && end < hi ? end : hi;
    if (ovEnd < ovStart) return 0; // term does not overlap the reporting period
    if (!end) return annual; // auto-renewing / indefinite term — report the annual commitment
    const overlapDays = Math.round((ovEnd.getTime() - ovStart.getTime()) / DAY_MS) + 1;
    return Math.round(annual * (overlapDays / 365));
  };

  const revenueTotal = contracts.filter(c => c.direction === 'revenue' && c.status === 'active').reduce((acc, c) => acc + valueInPeriod(c), 0);
  const costTotal = contracts.filter(c => c.direction === 'cost' && c.status === 'active').reduce((acc, c) => acc + valueInPeriod(c), 0);
  const urgentAlerts = contracts.filter(c => getContractNoticeStatus(c).isUrgent).length;
  const hasPeriod = !!(periodFrom || periodTo);

  const handleCreateContract = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCounterpartyId) {
      setCpError("Please select or create a Counterparty before registering the contract.");
      return;
    }
    setCpError("");
    const selectedCp = counterparties.find(c => c.id === newCounterpartyId);
    addContract({
      counterparty_id: newCounterpartyId,
      counterparty: selectedCp,
      direction: newDirection,
      reference: newRef,
      type: newType,
      status: 'active',
      starts_on: newStarts,
      ends_on: newEnds || undefined,
      auto_renews: !newEnds,
      notice_period_days: Number(newNotice),
      value: 0,
      currency: 'EUR',
      billing_cadence: newBillingCadence,
      invoice_timing: newInvoiceTiming,
      vat_treatment: 'domestic_24',
      owner_profile_id: currentUser.id,
      product: newDirection === 'revenue' ? 'Atlas ETRM & EMS' : 'Vendor Cloud Retainer',
      document_name: newDocName || undefined,
      document_url: newDocUrl || undefined,
      document_uploaded_at: newDocName ? new Date().toISOString() : undefined
    });
    setNewDocName('');
    setNewDocUrl('');
    setNewCounterpartyId('');
    setNewBillingCadence('monthly');
    setNewInvoiceTiming('start_of_period');
    setNewEnds('');
    setIsCreateOpen(false);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center">
            <FileText className="w-6 h-6 mr-3 text-[#3D87D3]" /> Client & Supplier Contract Registry
          </h1>
          <p className="text-slate-500 text-xs mt-1">
            Bi-directional management covering both revenue SaaS (Atlas ETRM/EMS) and committed supplier spend with automated notice-window alerting.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg bg-slate-100 border border-slate-200 p-0.5">
            <button 
              onClick={() => setViewMode('table')} 
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${viewMode === 'table' ? 'bg-[#3D87D3] text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Timeline List
            </button>
            <button 
              onClick={() => setViewMode('revenue')} 
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${viewMode === 'revenue' ? 'bg-[#3D87D3] text-white shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <BarChart3 className="w-3.5 h-3.5" /> Revenue Schedule & MRR
            </button>
          </div>
          {isAdmin && (
            <Button variant="primary" size="sm" onClick={() => setIsCreateOpen(true)} className="shadow-xs cursor-pointer">
              <Plus className="w-4 h-4 mr-1.5" /> New Contract
            </Button>
          )}
        </div>
      </div>

      {/* Reporting Period — the revenue schedule spans the contracts' own effective dates instead */}
      {viewMode !== 'revenue' && (
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase text-slate-400">
            <Calendar className="w-4 h-4" /> Reporting Period
          </span>
          <input
            type="date"
            value={periodFrom}
            max={periodTo || undefined}
            onChange={e => setPeriodFrom(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#3D87D3]"
          />
          <span className="text-slate-400 text-xs">→</span>
          <input
            type="date"
            value={periodTo}
            min={periodFrom || undefined}
            onChange={e => setPeriodTo(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#3D87D3]"
          />
          {hasPeriod && (
            <button
              onClick={() => { setPeriodFrom(''); setPeriodTo(''); }}
              className="text-[11px] font-bold text-rose-600 hover:text-rose-700 flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" /> Clear
            </button>
          )}
        </div>
        <div className="text-xs font-mono text-slate-500">
          {hasPeriod ? (
            <>Totals cover <span className="font-bold text-[#3D87D3]">{periodFrom || 'start'} → {periodTo || 'present'}</span>, annualised and prorated to the period</>
          ) : (
            <>Showing <span className="font-bold">annualised (ARR)</span> contracted totals</>
          )}
        </div>
      </div>
      )}

      {/* KPI & Notice Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <StatCard 
          title="Contracted Client Revenue (Active, Annual)" 
          value={`€${revenueTotal.toLocaleString()}/yr`} 
          subtitle={hasPeriod ? `Annualised revenue committed in ${periodFrom || 'start'} → ${periodTo || 'present'}` : "Annualised recurring revenue (ARR) · excludes one-time fees"}
          icon={<DollarSign className="w-5 h-5 text-emerald-600" />}
        />
        <StatCard 
          title="Committed Supplier Spend (Active, Annual)" 
          value={`€${costTotal.toLocaleString()}/yr`} 
          subtitle={hasPeriod ? `Annualised spend committed in ${periodFrom || 'start'} → ${periodTo || 'present'}` : "Annualised recurring spend · excludes one-time fees"}
          icon={<DollarSign className="w-5 h-5 text-amber-600" />}
        />
        <StatCard 
          title="Action Required (Next 90 Days)" 
          value={`${urgentAlerts} Notice Windows`}
          subtitle="Critical deadline monitoring active"
          icon={<AlertTriangle className="w-5 h-5 text-rose-600" />}
        />
      </div>

      {/* Direction Toggle & Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-bold uppercase text-slate-400 mr-2">Direction:</span>
          <button
            onClick={() => setDirectionFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${directionFilter === 'all' ? 'bg-slate-800 text-white font-bold border border-slate-800' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            All Contracts
          </button>
          <button
            onClick={() => setDirectionFilter('revenue')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center cursor-pointer ${directionFilter === 'revenue' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            Client Revenue (<span className="text-emerald-700 font-mono ml-1">€{revenueTotal.toLocaleString()}/yr</span>)
          </button>
          <button
            onClick={() => setDirectionFilter('cost')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center cursor-pointer ${directionFilter === 'cost' ? 'bg-amber-50 text-amber-800 border border-amber-200 font-bold' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            Supplier Spend (<span className="text-amber-700 font-mono ml-1">€{costTotal.toLocaleString()}/yr</span>)
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs font-bold uppercase text-slate-400">Status:</span>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as ContractStatus | 'all')}
            className="bg-white border border-slate-200 rounded-lg px-3 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#3D87D3]"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="expiring">Expiring (Notice Urgent)</option>
            <option value="in_negotiation">In Negotiation</option>
          </select>
        </div>
      </div>

      {viewMode === 'revenue' ? (
        /* REVENUE SCHEDULE (Excel-style monthly grid) */
        <RevenueScheduleGrid
          contracts={revenueContracts}
          projects={projects}
          catalogModules={catalogModules}
          catalogItems={catalogItems}
          invoices={invoices}
          draftInvoiceIds={contractDraftIds}
          onCreateInvoice={createDraftForPeriod}
          onOpenContract={setSelectedContract}
        />
      ) : (
        /* TABLE LIST VIEW (AG GRID) */
        <ContractsGrid
          contracts={filteredContracts}
          catalogModules={catalogModules}
          catalogItems={catalogItems}
          isAdmin={isAdmin}
          externalFilters={{
            active: directionFilter !== 'all' || statusFilter !== 'all',
            onClear: () => { setDirectionFilter('all'); setStatusFilter('all'); }
          }}
          onSelect={setSelectedContract}
          onDelete={(c) => {
            if (confirm(`Are you certain you want to completely delete contract "${c.reference}" (${c.counterparty?.legal_name})?`)) {
              deleteContract(c.id);
            }
          }}
          onOpenCounterparty={(c) => {
            if (c.counterparty_id) router.push(`/counterparties/${c.counterparty_id}`);
          }}
        />
      )}

      {/* CONTRACT DETAIL MODAL WITH VERSIONED DOCUMENTS & MODULAR PRICING */}
      <Modal 
        isOpen={!!selectedContract} 
        onClose={() => setSelectedContract(null)} 
        title={selectedContract ? `Contract Dossier & Edit Hub: ${selectedContract.reference}` : 'Contract'}
        size="full"
      >
        {selectedContract && (
          <div className="space-y-6 text-sm">
            {(() => {
              const dossierVal = calculateContractValuation(selectedContract.lines || [], selectedContract.discount_pct || 0, selectedContract.term_years || 1, selectedContract.service_start_date || selectedContract.starts_on, catalogModules, catalogItems, selectedContract.value || 0, selectedContract.billing_cadence);
              return (
                <div className="flex flex-wrap items-center justify-between p-3.5 bg-slate-900 text-slate-100 rounded-xl border border-slate-800 gap-4 shadow-md">
                  <div className="flex items-center gap-3">
                    <span className={`px-2.5 py-1 rounded-lg text-xs font-black tracking-wide border shadow-sm ${dossierVal.tierInfo.badgeClass}`}>
                      {dossierVal.tierInfo.label}
                    </span>
                    <span className="text-xs text-slate-400">
                      Weighted ARR: <strong className="text-slate-200 font-mono font-bold">€{dossierVal.weightedARR.toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-6 font-mono text-xs">
                    <div>
                      <span className="text-slate-400 font-sans font-medium text-[11px] mr-1">Net ARR (Recurring):</span>
                      <strong className="text-emerald-400 font-bold">€{dossierVal.netARR.toLocaleString()}/yr</strong>
                    </div>
                    {dossierVal.oneTimeValue > 0 && (
                      <div>
                        <span className="text-slate-400 font-sans font-medium text-[11px] mr-1">One-Off Additions:</span>
                        <strong className="text-amber-400 font-bold">+€{dossierVal.oneTimeValue.toLocaleString()}</strong>
                      </div>
                    )}
                    <div>
                      <span className="text-slate-400 font-sans font-medium text-[11px] mr-1">Real Deal TCV:</span>
                      <strong className="text-blue-400 font-black">€{dossierVal.totalContractValue.toLocaleString()}</strong>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Modal Internal Navigation */}
            <div className="flex items-center border-b border-slate-200 pb-2 space-x-6">
              <button
                type="button"
                onClick={() => setDossierTab('general')}
                className={`pb-2.5 text-xs font-extrabold transition-all border-b-2 -mb-[9px] cursor-pointer flex items-center ${
                  dossierTab === 'general' ? 'border-[#3D87D3] text-[#3D87D3]' : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <Edit3 className="w-4 h-4 mr-2" /> General Terms & Metadata Editor
              </button>
              <button
                type="button"
                onClick={() => setDossierTab('pricing')}
                className={`pb-2.5 text-xs font-extrabold transition-all border-b-2 -mb-[9px] cursor-pointer flex items-center ${
                  dossierTab === 'pricing' ? 'border-[#3D87D3] text-[#3D87D3]' : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <Layers className="w-4 h-4 mr-2 text-purple-600" /> Modular Rate Sheet & Revenue Schedule
                {selectedContract.lines && selectedContract.lines.length > 0 && (
                  <Badge variant="success" className="ml-2 text-[11px] px-2 py-0.5">{selectedContract.lines.length}</Badge>
                )}
              </button>
              <button
                type="button"
                onClick={() => setDossierTab('invoices')}
                className={`pb-2.5 text-xs font-extrabold transition-all border-b-2 -mb-[9px] cursor-pointer flex items-center ${
                  dossierTab === 'invoices' ? 'border-[#3D87D3] text-[#3D87D3]' : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <Receipt className="w-4 h-4 mr-2 text-emerald-600" /> Linked Invoices & Payments
                {invoices?.filter(i => i.contract_id === selectedContract.id).length > 0 && (
                  <Badge variant="info" className="ml-2 text-[11px] px-2 py-0.5">{invoices?.filter(i => i.contract_id === selectedContract.id).length}</Badge>
                )}
              </button>
              <button
                type="button"
                onClick={() => setDossierTab('projects')}
                className={`pb-2.5 text-xs font-extrabold transition-all border-b-2 -mb-[9px] cursor-pointer flex items-center ${
                  dossierTab === 'projects' ? 'border-[#3D87D3] text-[#3D87D3]' : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <Layers className="w-4 h-4 mr-2 text-sky-600" /> Projects
                {projects?.filter(p => p.contract_id === selectedContract.id && p.status !== 'archived').length > 0 && (
                  <Badge variant="info" className="ml-2 text-[11px] px-2 py-0.5">{projects?.filter(p => p.contract_id === selectedContract.id && p.status !== 'archived').length}</Badge>
                )}
              </button>
              <button
                type="button"
                onClick={() => setDossierTab('ratecard')}
                className={`pb-2.5 text-xs font-extrabold transition-all border-b-2 -mb-[9px] cursor-pointer flex items-center ${
                  dossierTab === 'ratecard' ? 'border-[#3D87D3] text-[#3D87D3]' : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <DollarSign className="w-4 h-4 mr-2 text-sky-600" /> Rate Card
              </button>
            </div>

            {dossierTab === 'ratecard' ? (
              <div className="pt-3 space-y-4 animate-fadeIn">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-extrabold text-slate-900 text-sm flex items-center gap-2"><DollarSign className="w-4 h-4 text-sky-600" /> Man-Hours Rate Card — this contract</h4>
                    <p className="text-xs text-slate-500">Rates are priced per contract. Seeded from the global default when first opened; edit to override. Used for billing T&M work.</p>
                  </div>
                </div>
                <div className="rounded-2xl bg-white border border-slate-200 shadow-2xs overflow-hidden">
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-200"><span className="text-sm font-extrabold text-slate-800">Rate Card Matrix (hourly €)</span></div>
                  {contractRateCardId ? <RateCardMatrix cardId={contractRateCardId} /> : <div className="p-8 text-center text-xs text-slate-400">Preparing this contract's rate card…</div>}
                </div>
              </div>
            ) : dossierTab === 'projects' ? (
              <ContractProjectsTab contract={selectedContract} />
            ) : dossierTab === 'invoices' ? (
              <div className="space-y-6 pt-3 animate-fadeIn">
                {(() => {
                  const linkedInvoices = (invoices || []).filter(i => i.contract_id === selectedContract.id && i.status !== 'cancelled');
                  const totalGross = linkedInvoices.reduce((s, i) => s + i.gross_eur, 0);
                  const totalPaid = linkedInvoices.reduce((s, i) => s + (i.payments || []).reduce((ps, p) => ps + p.amount, 0), 0);
                  const totalOpen = Math.max(0, totalGross - totalPaid);
                  const duePeriods = selectedContractPeriods.filter(p => p.status !== 'billed');
                  const dueTotal = duePeriods.reduce((s, p) => s + p.expectedAmount, 0);
                  const nextDuePeriod = duePeriods.find(p => p.status === 'unbilled');

                  return (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <Card className="p-4 bg-emerald-50/60 border-emerald-200 rounded-2xl">
                          <span className="text-xs font-bold text-emerald-800 block">Total Billed Gross</span>
                          <span className="text-2xl font-black text-emerald-900 mt-1 block font-mono">€{totalGross.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                          <span className="text-[11px] text-emerald-700 font-medium">Across {linkedInvoices.length} archived invoices</span>
                        </Card>

                        <Card className="p-4 bg-blue-50/60 border-blue-200 rounded-2xl">
                          <span className="text-xs font-bold text-blue-800 block">Total Settled / Paid</span>
                          <span className="text-2xl font-black text-blue-900 mt-1 block font-mono">€{totalPaid.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                          <span className="text-[11px] text-blue-700 font-medium">Collected via banking wire/SEPA</span>
                        </Card>

                        <Card className="p-4 bg-amber-50/60 border-amber-200 rounded-2xl">
                          <span className="text-xs font-bold text-amber-800 block">Open Receivable / Debt</span>
                          <span className="text-2xl font-black text-amber-900 mt-1 block font-mono">€{totalOpen.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                          <span className="text-[11px] text-amber-700 font-medium">{totalOpen === 0 ? 'Fully settled obligation' : 'Pending collection or maturity'}</span>
                        </Card>
                      </div>

                      {/* Fast create: the periods this contract already owes, ready to bill in one click */}
                      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
                        <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h4 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
                              <Zap className="w-4 h-4 text-emerald-600" />
                              Billing Periods Due
                              {duePeriods.length > 0 && (
                                <Badge variant="warning" className="text-[11px] px-2 py-0.5">{duePeriods.length} unbilled</Badge>
                              )}
                            </h4>
                            <p className="text-xs text-slate-500">
                              {selectedContract.billing_cadence || 'monthly'} cadence anchored on {formatDate(selectedContract.service_start_date || selectedContract.starts_on)} ·
                              {' '}{selectedContract.invoice_timing === 'end_of_period' ? 'in arrears' : 'in advance'} ·
                              {' '}expected total <strong className="text-slate-700 font-mono">€{dueTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {nextDuePeriod && (
                              <button
                                type="button"
                                onClick={() => createDraftForPeriod(selectedContract, nextDuePeriod)}
                                disabled={creatingPeriodKey !== null}
                                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-extrabold shadow-sm transition-all cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                                title={`Create a draft invoice for ${nextDuePeriod.label} (€${nextDuePeriod.expectedAmount.toLocaleString()})`}
                              >
                                <Zap className="w-3.5 h-3.5 text-amber-300" /> Create next draft · {formatDate(nextDuePeriod.billingDate)}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => router.push(`/invoices?new=1&contract=${selectedContract.id}`)}
                              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all cursor-pointer"
                              title="Open the invoice register pre-filled for this contract"
                            >
                              <Receipt className="w-3.5 h-3.5 text-[#3D87D3]" /> Register Invoice
                            </button>
                          </div>
                        </div>

                        {duePeriods.length === 0 ? (
                          <div className="p-5 text-center text-xs text-slate-400 font-semibold italic">
                            No billing period is due yet — as soon as one reaches its {selectedContract.invoice_timing === 'end_of_period' ? 'period end' : 'period start'} it appears here ready to invoice.
                          </div>
                        ) : (
                          <table className="w-full text-left text-xs">
                            <thead className="bg-slate-100 border-b border-slate-200 font-bold text-slate-600 uppercase text-[10px] tracking-wider">
                              <tr>
                                <th className="p-3">Billing Cycle</th>
                                <th className="p-3">Service Window</th>
                                <th className="p-3">Billing Date</th>
                                <th className="p-3 text-right">Expected Gross</th>
                                <th className="p-3 text-center">Status</th>
                                <th className="p-3 text-right">Fast Create</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/60 font-medium">
                              {duePeriods.map(period => (
                                <tr key={period.key} className="hover:bg-slate-50/70 transition-colors">
                                  <td className="p-3">
                                    <span className="font-bold text-slate-900 block capitalize">
                                      {(selectedContract.billing_cadence || 'monthly').replace('_', ' ')} cycle · from {formatDate(period.from)}
                                    </span>
                                    <span className={`text-[10px] font-bold block mt-0.5 ${period.timing === 'end_of_period' ? 'text-indigo-600' : 'text-emerald-600'}`}>
                                      {period.timing === 'end_of_period' ? '⏳ billed in arrears (period end)' : '🚀 billed in advance (period start)'}
                                    </span>
                                  </td>
                                  <td className="p-3 text-slate-600 font-mono">{formatDate(period.from)} → {formatDate(period.to)}</td>
                                  <td className="p-3">
                                    <span className={`font-mono font-bold px-2 py-0.5 rounded-lg border ${period.status === 'unbilled' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                      {formatDate(period.billingDate)}
                                    </span>
                                    <span className="block text-[10px] text-slate-400 mt-0.5">
                                      {period.timing === 'end_of_period' ? 'period end' : 'period start'}
                                    </span>
                                  </td>
                                  <td className="p-3 text-right font-black text-slate-900 font-mono">€{period.expectedAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                  <td className="p-3 text-center">
                                    {period.status === 'unbilled'
                                      ? <Badge variant="warning">Unbilled</Badge>
                                      : <Badge variant="info">Draft created</Badge>}
                                  </td>
                                  <td className="p-3">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => router.push(`/invoices?new=1&contract=${selectedContract.id}&period=${encodeURIComponent(period.key)}&from=${period.from}&to=${period.to}&net=${period.expectedAmount}`)}
                                        className="px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 text-[11px] font-bold transition-all cursor-pointer"
                                        title="Open the register pre-filled with this period and amount"
                                      >
                                        Review
                                      </button>
                                      {period.status === 'unbilled' ? (
                                        <button
                                          type="button"
                                          onClick={() => createDraftForPeriod(selectedContract, period)}
                                          disabled={creatingPeriodKey !== null}
                                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-extrabold shadow-sm transition-all cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                                          title="Create a draft invoice for this period right now"
                                        >
                                          <Zap className="w-3 h-3 text-amber-300" /> {creatingPeriodKey === period.key ? 'Creating…' : 'Create draft'}
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => router.push(`/invoices?contract=${selectedContract.id}`)}
                                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 text-[11px] font-bold transition-all cursor-pointer"
                                        >
                                          Open in hub <ArrowUpRight className="w-3 h-3" />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>

                      <div className="bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
                        <div className="p-4 bg-white border-b border-slate-200 flex items-center justify-between">
                          <div>
                            <h4 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
                              <Receipt className="w-4 h-4 text-emerald-600" />
                              Contract Invoice Ledger ({linkedInvoices.length} documents)
                            </h4>
                            <p className="text-xs text-slate-500">Commercial terms: Net {selectedContract.payment_terms_days ?? 30} Days</p>
                          </div>
                          <a href="/invoices" className="text-xs font-bold text-[#3D87D3] hover:underline flex items-center gap-1">
                            <span>Manage in Global Invoices Hub</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </a>
                        </div>

                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-100 border-b border-slate-200 font-bold text-slate-600 uppercase text-[10px] tracking-wider">
                            <tr>
                              <th className="p-3.5">Invoice # & MARK</th>
                              <th className="p-3.5">Issue Date</th>
                              <th className="p-3.5">Due Date</th>
                              <th className="p-3.5 text-right">Gross Amount</th>
                              <th className="p-3.5 text-right">Paid Amount</th>
                              <th className="p-3.5 text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200/60 bg-white font-medium">
                            {linkedInvoices.map(inv => {
                              const pAmt = (inv.payments || []).reduce((s, p) => s + p.amount, 0);
                              return (
                                <tr key={inv.id} className="hover:bg-slate-50/70 transition-colors">
                                  <td className="p-3.5">
                                    <span className="font-bold text-slate-900 font-mono block">{inv.invoice_number}</span>
                                    {inv.reference_period && (
                                      <span className="text-[10px] bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded font-mono font-bold block w-fit my-0.5">
                                        Ref: {inv.reference_period}
                                      </span>
                                    )}
                                    {inv.mark ? <span className="text-[10px] text-emerald-600 font-mono block">MARK: {inv.mark}</span> : <span className="text-[10px] text-amber-600 italic block">No MARK code</span>}
                                  </td>
                                  <td className="p-3.5 text-slate-700">{formatDate(inv.issue_date)}</td>
                                  <td className="p-3.5 text-slate-700">{formatDate(inv.due_date)}</td>
                                  <td className="p-3.5 text-right font-black text-slate-900">€{inv.gross_eur.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                  <td className="p-3.5 text-right font-bold text-emerald-700">€{pAmt.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                  <td className="p-3.5 text-center">
                                    {inv.status === 'paid' && <Badge variant="success">Paid</Badge>}
                                    {inv.status === 'partially_paid' && <Badge variant="warning">Partial</Badge>}
                                    {inv.status !== 'paid' && inv.status !== 'partially_paid' && <Badge variant="info">{inv.status.replace('_', ' ')}</Badge>}
                                  </td>
                                </tr>
                              );
                            })}
                            {linkedInvoices.length === 0 && (
                              <tr>
                                <td colSpan={6} className="p-8 text-center text-slate-400 font-semibold italic">
                                  No tax invoices linked directly to this contract agreement yet. Head over to the Invoices Register to record billing milestones!
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : dossierTab === 'pricing' ? (
              <div className="pt-2 min-h-[500px]">
                <ContractPricingBuilder
                  contractId={selectedContract.id}
                  initialLines={selectedContract.lines || []}
                  initialGroups={selectedContract.groups || []}
                  initialDiscountPct={selectedContract.discount_pct || 0}
                  initialTermYears={selectedContract.term_years || 1}
                  initialStartDate={selectedContract.service_start_date || selectedContract.starts_on}
                  contractInvoiceTiming={selectedContract.invoice_timing}
                  onSave={async (lines, schedule, discountPct, termYears, startDate, tcv, groups) => {
                    await saveContractPricing(
                      selectedContract.id,
                      lines,
                      schedule,
                      discountPct,
                      termYears,
                      startDate,
                      tcv,
                      groups
                    );
                    setSelectedContract({
                      ...selectedContract,
                      lines: lines as unknown as ContractLine[],
                      groups: groups as unknown as ContractLineGroup[],
                      schedule: schedule as unknown as ContractSchedule[],
                      discount_pct: discountPct,
                      term_years: termYears,
                      service_start_date: startDate,
                      value: tcv
                    });
                    // Report what actually persisted so a silently-dropped field is immediately visible.
                    const windowCount = lines.filter(l => l.starts_on || l.ends_on).length;
                    const timingCount = lines.filter(l => l.invoice_timing).length;
                    notifySuccess(
                      `Pricing snapshot and revenue schedule locked to the deal.` +
                      (windowCount || timingCount
                        ? ` Saved per line: ${windowCount} active window${windowCount === 1 ? '' : 's'}, ${timingCount} custom invoicing timing${timingCount === 1 ? '' : 's'}.`
                        : ''),
                      'Pricing saved'
                    );
                  }}
                  onCancel={() => setSelectedContract(null)}
                />
              </div>
            ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
              {/* Left Column: Entity Specs & Attachments (5 cols) */}
              <div className="lg:col-span-5 space-y-5">
                <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold uppercase text-slate-400 tracking-wider">Counterparty Entity</span>
                    <Badge variant={selectedContract.direction === 'revenue' ? 'success' : 'warning'} className="text-xs py-1 px-2.5 font-bold">
                      {selectedContract.direction === 'revenue' ? 'Client Revenue' : 'Supplier Spend'}
                    </Badge>
                  </div>
                  <div className="text-xl font-black text-slate-900">{selectedContract.counterparty?.legal_name || 'Designated Entity'}</div>
                  <div className="pt-2 border-t border-slate-200/80 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                    <div>ΑΦΜ: <strong className="text-slate-800 font-mono">{selectedContract.counterparty?.afm || 'Unspecified'}</strong></div>
                    <div>Country: <strong className="text-slate-800">{selectedContract.counterparty?.country || 'Greece'}</strong></div>
                  </div>
                </div>

                {/* Notice Window Warning Box */}
                <div className="p-4 rounded-2xl bg-rose-50/90 border border-rose-200/90 space-y-2 shadow-xs">
                  <div className="flex items-center justify-between text-rose-900 font-extrabold text-xs uppercase tracking-wide">
                    <span className="flex items-center"><AlertTriangle className="w-4 h-4 mr-2 text-rose-600 shrink-0" /> Notice Window Alarm</span>
                    <span className="font-mono bg-rose-100 px-2 py-0.5 rounded text-rose-950">{selectedContract.notice_deadline}</span>
                  </div>
                  <p className="text-xs text-rose-900/90 leading-relaxed">
                    This contract requires a <strong className="font-extrabold underline">{selectedContract.notice_period_days}-day advance written notice</strong> prior to {selectedContract.ends_on} to cancel or renegotiate terms.
                  </p>
                </div>

                {/* Supabase Document Attachments */}
                <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase font-extrabold text-slate-700 tracking-wide">Signed Document Dossier</span>
                    <div>
                      <input
                        type="file"
                        id="doc-upload-selected"
                        className="hidden"
                        onChange={handleUploadDocForSelected}
                        accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                      />
                      <label
                        htmlFor="doc-upload-selected"
                        className={`px-3 py-1.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-xs inline-flex items-center cursor-pointer shadow-2xs transition-all ${isUploadingDoc ? 'opacity-60 pointer-events-none' : ''}`}
                      >
                        <Upload className="w-3.5 h-3.5 mr-1.5 text-[#3D87D3]" /> 
                        {isUploadingDoc ? 'Uploading...' : selectedContract.document_name ? 'Replace Doc' : 'Attach PDF / Doc'}
                      </label>
                    </div>
                  </div>

                  {selectedContract.document_name ? (
                    <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200 flex items-center justify-between text-xs">
                      <div className="flex items-center space-x-3 truncate mr-2">
                        <div className="p-2.5 bg-emerald-600 rounded-xl text-white shrink-0 shadow-2xs">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div className="truncate">
                          <p className="font-extrabold text-slate-900 truncate">{selectedContract.document_name}</p>
                          <p className="text-[11px] text-emerald-700 font-semibold mt-0.5">
                            Active execution copy · Hosted in Supabase
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 shrink-0">
                        <Button 
                          size="sm" 
                          variant="secondary" 
                          onClick={async () => {
                            if (!selectedContract.document_url) {
                              return;
                            }
                            setPreviewDocUrl(await resolveContractDocumentUrl(selectedContract.document_url));
                            setIsPreviewingDoc(true);
                          }}
                          className="bg-white border-slate-300 font-extrabold cursor-pointer hover:bg-slate-100 shadow-2xs text-xs py-1 px-3"
                        >
                          <Eye className="w-3.5 h-3.5 mr-1 text-indigo-600" /> Preview
                        </Button>
                        <Button 
                          size="sm" 
                          variant="secondary" 
                          onClick={() => {
                            if (selectedContract.document_url?.startsWith('data:')) {
                              const a = document.createElement('a');
                              a.href = selectedContract.document_url;
                              a.download = selectedContract.document_name || 'contract_document.pdf';
                              a.click();
                            } else {
                              alert(`Downloading ${selectedContract.document_name}...`);
                            }
                          }}
                          className="bg-white border-slate-300 font-extrabold cursor-pointer hover:bg-slate-100 shadow-2xs shrink-0 text-xs py-1 px-3"
                        >
                          <Download className="w-3.5 h-3.5 mr-1 text-blue-600" /> Download
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-6 rounded-xl bg-slate-50/70 border-2 border-dashed border-slate-200 text-center text-xs text-slate-500 space-y-1">
                      <FileText className="w-8 h-8 mx-auto text-slate-400" />
                      <p className="font-extrabold text-slate-700 text-sm">No signed PDF attached</p>
                      <p className="text-[11px]">Click &ldquo;Attach PDF / Doc&rdquo; above to preserve the execution version.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Interactive Contract Terms Editor (7 cols) */}
              <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
                  <div>
                    <h4 className="text-base font-black text-slate-900 flex items-center">
                      <Edit3 className="w-4 h-4 mr-2 text-[#3D87D3]" /> Contract Terms & Metadata Editor
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">Modify agreement parameters, dates, and legal notes directly below</p>
                  </div>
                  <div className="flex items-center space-x-2">
                    {isAdmin && (
                      <Button 
                        variant="danger" 
                        size="sm"
                        onClick={async () => {
                          if (confirm(`Are you certain you want to completely delete agreement "${selectedContract.reference}" (${selectedContract.counterparty?.legal_name})? This action cannot be undone.`)) {
                            const ok = await deleteContract(selectedContract.id);
                            if (ok) {
                              setSelectedContract(null);
                              alert("Contract has been completely deleted.");
                            }
                          }
                        }}
                        className="shadow-sm font-bold cursor-pointer bg-rose-600 hover:bg-rose-700 text-white"
                      >
                        <Trash2 className="w-4 h-4 mr-1.5" /> Delete Contract
                      </Button>
                    )}
                    <Button 
                      variant="primary" 
                      size="sm"
                      onClick={() => {
                        updateContract(selectedContract);
                        notifySuccess('Contract updated.');
                      }}
                      className="shadow-sm font-bold bg-[#3D87D3] hover:bg-[#3476B8] cursor-pointer"
                    >
                      <Save className="w-4 h-4 mr-1.5" /> Save Changes
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Contract Title / Reference</label>
                    <input
                      type="text"
                      value={selectedContract.reference}
                      onChange={e => setSelectedContract({ ...selectedContract, reference: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-sm font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Agreement Direction</label>
                    <select
                      value={selectedContract.direction}
                      onChange={e => setSelectedContract({ ...selectedContract, direction: e.target.value as ContractDirection })}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-sm font-semibold text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
                    >
                      <option value="revenue">Client Revenue (Inbound)</option>
                      <option value="cost">Supplier Spend (Outbound)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Effective Start Date</label>
                    <input
                      type="date"
                      value={selectedContract.service_start_date || selectedContract.starts_on}
                      onChange={e => setSelectedContract({ ...selectedContract, starts_on: e.target.value, service_start_date: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-sm font-mono text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Contract Expiration Date</label>
                    <input
                      type="date"
                      value={selectedContract.ends_on}
                      onChange={e => setSelectedContract({ ...selectedContract, ends_on: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-sm font-mono text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Notice Period (Days Prior to End)</label>
                    <input
                      type="number"
                      value={selectedContract.notice_period_days}
                      onChange={e => {
                        const days = parseInt(e.target.value) || 0;
                        setSelectedContract({ ...selectedContract, notice_period_days: days });
                      }}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-sm font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Notice Window Deadline</label>
                    <input
                      type="date"
                      value={selectedContract.notice_deadline}
                      onChange={e => setSelectedContract({ ...selectedContract, notice_deadline: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-sm font-mono text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Invoicing Cadence / Frequency</label>
                    <select
                      value={selectedContract.billing_cadence || 'monthly'}
                      onChange={e => setSelectedContract({ ...selectedContract, billing_cadence: e.target.value as any })}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-sm font-semibold text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
                    >
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="annual">Annual</option>
                      <option value="milestone">Milestone / Project-based</option>
                      <option value="one_off">One-off / Single Billing</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Invoicing Timing (Within Period)</label>
                    <select
                      value={selectedContract.invoice_timing || 'start_of_period'}
                      onChange={e => setSelectedContract({ ...selectedContract, invoice_timing: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-sm font-semibold text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
                    >
                      <option value="start_of_period">Start of Period (In Advance / e.g. Start of Month/Quarter)</option>
                      <option value="end_of_period">End of Period (In Arrears / e.g. End of Month/Quarter)</option>
                      <option value="upon_milestone">Upon Milestone Completion / Delivery</option>
                    </select>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-blue-50/80 border border-blue-200/80 flex items-center space-x-3 text-xs text-blue-900 shadow-2xs">
                  <div className="w-8 h-8 rounded-lg bg-blue-600 text-white font-extrabold flex items-center justify-center shrink-0 shadow-sm">
                    ⚡
                  </div>
                  <div>
                    <span className="font-bold block text-sm">
                      Billing Rule: {selectedContract.billing_cadence ? selectedContract.billing_cadence.charAt(0).toUpperCase() + selectedContract.billing_cadence.slice(1) : 'Monthly'} — {
                        selectedContract.invoice_timing === 'end_of_period' ? 'End of Period (Arrears / Post-service)' :
                        selectedContract.invoice_timing === 'upon_milestone' ? 'Upon Milestone Completion' :
                        'Start of Period (Invoiced in Advance)'
                      }
                    </span>
                    <span className="text-[11px] text-blue-700 font-medium mt-0.5 block">
                      Orbit utilizes this timing rule on the Home Dashboard to alert operations when draft invoices need to be issued.
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-800 mb-1.5 flex items-center justify-between">
                    <span>Key Legal Clauses & Terms Documentation</span>
                    <span className="text-[10px] text-slate-400 font-normal">Internal compliance notes</span>
                  </label>
                  <textarea
                    rows={6}
                    value={selectedContract.notes || ''}
                    placeholder="Document specific liability caps, SLA penalties, payment terms, or negotiated exemptions here..."
                    onChange={e => setSelectedContract({ ...selectedContract, notes: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-xs text-slate-800 font-mono focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all leading-relaxed"
                  />
                </div>
              </div>
            </div>
            )}
          </div>
        )}
      </Modal>

      {/* CREATE CONTRACT MODAL */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Register New Contract" size="2xl">
        <form onSubmit={handleCreateContract} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold uppercase text-slate-500 mb-1">Contract Direction</label>
            <select 
              value={newDirection}
              onChange={e => setNewDirection(e.target.value as ContractDirection)}
              className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800"
            >
              <option value="revenue">Client Revenue (Atlas ETRM / EMS / Consulting)</option>
              <option value="cost">Supplier Spend (Cloud / Data Provider / Partnership)</option>
            </select>
          </div>

          <div>
            <label className="block font-semibold uppercase text-slate-500 mb-1.5 flex items-center justify-between">
              <span>Counterparty (Client / Supplier) <span className="text-red-500">*</span></span>
              <span className="text-[11px] text-[#3D87D3] normal-case font-semibold">First-Class Registry Entity</span>
            </label>
            <CounterpartyPicker
              value={newCounterpartyId}
              onChange={(val) => { setNewCounterpartyId(val); setCpError(""); }}
              error={cpError}
              allowClear={true}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Internal Reference</label>
              <input 
                type="text" 
                value={newRef} 
                onChange={e => setNewRef(e.target.value)} 
                className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Contract Value (€)</label>
              <div className="w-full bg-slate-100/80 border border-slate-200 rounded p-2 text-slate-500 font-medium text-xs flex items-center h-10 select-none" title="Value is computed automatically from line items in the Rate Sheet">
                <Sparkles className="w-3.5 h-3.5 mr-1.5 text-indigo-600 shrink-0" />
                <span className="italic">Dynamically calculated from Modular Pricing</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Starts On</label>
              <input 
                type="date" 
                value={newStarts} 
                onChange={e => setNewStarts(e.target.value)} 
                className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800"
              />
            </div>
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Expiration Date <span className="text-slate-400 normal-case font-normal">(optional)</span></label>
              <input 
                type="date" 
                value={newEnds} 
                onChange={e => setNewEnds(e.target.value)} 
                className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800"
                placeholder="Leave empty for auto-renewing"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Invoicing Cadence / Frequency</label>
              <select
                value={newBillingCadence}
                onChange={e => setNewBillingCadence(e.target.value as any)}
                className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800"
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
                <option value="one_off">One-off / Delivery</option>
                <option value="milestone">Milestone-based</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Invoicing Timing (Within Period)</label>
              <select
                value={newInvoiceTiming}
                onChange={e => setNewInvoiceTiming(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800"
              >
                <option value="start_of_period">Start of Period (In Advance)</option>
                <option value="end_of_period">End of Period (Arrears)</option>
                <option value="upon_milestone">Upon Milestone Completion</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Notice Period (Days)</label>
              <input 
                type="number" 
                value={newNotice} 
                onChange={e => setNewNotice(Number(e.target.value))} 
                className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold uppercase text-slate-500 mb-1">Attach Signed Document (Optional)</label>
            <input 
              type="file" 
              onChange={handleSelectDocForNew} 
              accept=".pdf,.doc,.docx,.png,.jpg"
              className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 text-xs font-medium file:mr-3 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-[#3D87D3]/10 file:text-[#3D87D3] hover:file:bg-[#3D87D3]/20 cursor-pointer"
            />
            {isUploadingDoc && <p className="text-[11px] text-blue-600 font-bold mt-1 animate-pulse">⏳ Uploading file to Supabase Storage bucket...</p>}
            {newDocName && !isUploadingDoc && <p className="text-[11px] text-emerald-700 font-extrabold mt-1">✓ Storage File Ready: {newDocName}</p>}
          </div>

          <div className="pt-3 flex justify-end space-x-2">
            <Button variant="outline" size="sm" type="button" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" type="submit" disabled={isUploadingDoc}>Save to Registry &rarr;</Button>
          </div>
        </form>
      </Modal>

      {selectedContract && selectedContract.document_name && (
        <DocumentPreviewModal
          isOpen={isPreviewingDoc}
          onClose={() => setIsPreviewingDoc(false)}
          documentName={selectedContract.document_name}
          documentUrl={previewDocUrl}
          storagePath={`contracts/${selectedContract.reference}/${selectedContract.document_name}`}
          uploadedAt={selectedContract.document_uploaded_at?.split('T')[0] || selectedContract.starts_on}
          subtitle={`Signed Agreement · ${selectedContract.counterparty?.legal_name || 'Client Entity'}`}
          onDownload={() => {
            if (selectedContract.document_url?.startsWith('data:')) {
              const a = document.createElement('a');
              a.href = selectedContract.document_url;
              a.download = selectedContract.document_name || 'contract_document.pdf';
              a.click();
            } else {
              alert(`Downloading ${selectedContract.document_name}...`);
            }
          }}
        />
      )}

    </div>
  );
}
