"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { notifySuccess } from '@/lib/validation-modal';
import { getSupabaseBrowserClient, SIGNED_URL_TTL_SECONDS } from '@/lib/supabase/client';
import { Contract, ContractLine, ContractLineGroup, ContractSchedule, ContractDirection, ContractStatus, ContractDocument } from '@/lib/types';
import { Button, Badge, Modal, StatCard } from '@/components/ui/primitives';
import { 
  FileText, Plus, AlertTriangle, DollarSign, X,
  Download, Upload, Layers, BarChart3, Sparkles, Save, Edit3, Trash2, Receipt, Eye, Zap, LayoutList
} from 'lucide-react';
import { accountingInvoices } from '@/lib/invoice-netting';
import { ContractPricingBuilder, type PricingDraft } from '@/components/contracts/contract-pricing-builder';
import { ContractProjectsTab } from '@/components/contracts/contract-projects-tab';
import { RateCardMatrix } from '@/components/settings/rate-card-matrix';
import { CounterpartyPicker } from '@/components/counterparties/counterparty-picker';
import { formatDate, todayKey } from '@/lib/date';
import { DocumentPreviewModal } from '@/components/ui/document-preview-modal';
import { calculateContractValuation, getContractNoticeStatus, NOTICE_ALERT_WINDOW_DAYS } from '@/lib/pricing-engine';
import { buildDraftInvoicePayload, getContractBillingPeriods, vatRateForTreatment, type BillingPeriodItem } from '@/lib/billing-periods';
import { invoiceLinksContract } from '@/lib/invoice-links';
import { DatePicker } from '@/components/ui/date-picker';

const ContractsGrid = dynamic(() => import('@/components/contracts/contracts-grid').then(m => m.ContractsGrid), { ssr: false });
const RevenueScheduleGrid = dynamic(() => import('@/components/contracts/revenue-schedule-grid').then(m => m.RevenueScheduleGrid), { ssr: false });

/** ` · 1.2 MB` / ` · 240 KB` suffix for the document list, empty when the size is unknown. */
const formatFileSizeSuffix = (bytes?: number | null): string => {
  const size = Number(bytes) || 0;
  if (size <= 0) return '';
  if (size < 1024 * 1024) return ` · ${Math.max(1, Math.round(size / 1024))} KB`;
  return ` · ${(size / (1024 * 1024)).toFixed(1)} MB`;
};

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
  /** Signed-document dossier for the open contract, tagged with its contract so a switch never flashes stale rows. */
  const [contractDocs, setContractDocs] = useState<{ contractId: string; docs: ContractDocument[] }>({ contractId: '', docs: [] });
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
        netAmount: period.expectedAmount,
        vatRate: vatRateForTreatment(contract.vat_treatment),
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

  // One Save for the whole dossier: the general form edits `selectedContract` in place while the
  // pricing builder reports its live draft into this ref, so both halves persist together.
  const [isSavingContract, setIsSavingContract] = useState(false);
  const [pricingWindowErrors, setPricingWindowErrors] = useState(0);
  const pricingDraftRef = useRef<PricingDraft | null>(null);

  const saveContractDossier = async () => {
    if (!selectedContract || isSavingContract || pricingWindowErrors > 0) return;
    const contract = selectedContract;
    setIsSavingContract(true);
    let pricingSaved = false;
    try {
      await updateContract(contract);

      // The ref can still hold the previous dossier's draft for a frame after switching contracts.
      const draft = pricingDraftRef.current;
      if (draft && draft.isDirty && (!draft.contractId || draft.contractId === contract.id)) {
        pricingSaved = await saveContractPricing(
          contract.id,
          draft.lines,
          draft.schedule,
          draft.discountPct,
          draft.termYears,
          draft.startDate,
          draft.totalContractValue,
          draft.groups
        );
        if (pricingSaved) {
          setSelectedContract({
            ...contract,
            lines: draft.lines as unknown as ContractLine[],
            groups: draft.groups as unknown as ContractLineGroup[],
            schedule: draft.schedule as unknown as ContractSchedule[],
            discount_pct: draft.discountPct,
            term_years: draft.termYears,
            service_start_date: draft.startDate,
            value: draft.totalContractValue,
          });
        }
      }

      notifySuccess(
        pricingSaved ? 'Contract details and pricing saved.' : 'Contract details saved.',
        'Contract saved'
      );
    } finally {
      setIsSavingContract(false);
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

  // Pull the signed-document dossier for whichever contract is open.
  useEffect(() => {
    const contractId = selectedContract?.id;
    if (!contractId) return;
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase
        .from('contract_documents')
        .select('*')
        .eq('contract_id', contractId)
        .order('uploaded_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        console.error('[contract_documents] read failed:', error.message);
        return;
      }
      setContractDocs({ contractId, docs: (data || []) as ContractDocument[] });
    })();
    return () => { cancelled = true; };
  }, [selectedContract?.id]);

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
  const [previewDocName, setPreviewDocName] = useState<string>('');
  const [previewDocUploadedAt, setPreviewDocUploadedAt] = useState<string>('');
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

  const loadContractDocuments = async (contractId: string) => {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from('contract_documents')
      .select('*')
      .eq('contract_id', contractId)
      .order('uploaded_at', { ascending: false });
    if (error) {
      console.error('[contract_documents] read failed:', error.message);
      return;
    }
    setContractDocs({ contractId, docs: (data || []) as ContractDocument[] });
  };

  // The dossier can hold any number of signed copies — every save uploads and appends, never replaces.
  const handleUploadContractDocs = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0 || !selectedContract) return;
    const contract = selectedContract;
    setIsUploadingDoc(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const rows: Array<Record<string, unknown>> = [];
      for (const file of files) {
        const path = await uploadToSupabaseStorage(file, contract.reference);
        if (!path) continue;
        rows.push({
          contract_id: contract.id,
          storage_path: path,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type || null,
          doc_type: 'contract',
          signed: true,
          uploaded_by: currentUser.id,
        });
      }
      if (rows.length === 0) {
        alert('Could not upload the selected document(s).');
        return;
      }
      const { error } = await supabase.from('contract_documents').insert(rows);
      if (error) {
        alert(`Could not attach the document(s): ${error.message}`);
        return;
      }
      notifySuccess(
        `${rows.length} document${rows.length === 1 ? '' : 's'} attached to ${contract.reference}.`,
        'Signed document dossier'
      );
      await loadContractDocuments(contract.id);
    } finally {
      setIsUploadingDoc(false);
    }
  };

  const deleteContractDocument = async (doc: ContractDocument) => {
    if (!selectedContract) return;
    const label = doc.file_name || 'this document';
    if (!confirm(`Remove "${label}" from the contract's signed document dossier?`)) return;

    if (doc.id === 'legacy' && selectedContract.document_name) {
      const cleared: Contract = { ...selectedContract, document_name: undefined, document_url: undefined, document_uploaded_at: undefined };
      await updateContract(cleared);
      setSelectedContract(cleared);
      notifySuccess(`Document "${label}" removed.`);
      return;
    }

    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from('contract_documents').delete().eq('id', doc.id);
    if (error) {
      alert(`Could not remove the document: ${error.message}`);
      return;
    }
    if (!doc.storage_path.startsWith('data:') && !/^https?:/i.test(doc.storage_path)) {
      await supabase.storage.from('contract-documents').remove([doc.storage_path]);
    }
    notifySuccess(`Document "${label}" removed.`);
    await loadContractDocuments(selectedContract.id);
  };

  const previewContractDocument = async (doc: ContractDocument) => {
    const url = await resolveContractDocumentUrl(doc.storage_path);
    if (!url) {
      alert('That document could not be opened — the stored file is missing.');
      return;
    }
    setPreviewDocName(doc.file_name || 'Contract document');
    setPreviewDocUploadedAt((doc.uploaded_at || '').split('T')[0]);
    setPreviewDocUrl(url);
    setIsPreviewingDoc(true);
  };

  const downloadContractDocument = async (doc: ContractDocument) => {
    const href = doc.storage_path.startsWith('data:')
      ? doc.storage_path
      : await resolveContractDocumentUrl(doc.storage_path);
    if (!href) {
      alert('That document could not be downloaded — the stored file is missing.');
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = doc.file_name || 'contract_document';
    anchor.target = '_blank';
    anchor.rel = 'noopener';
    anchor.click();
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

  // Documents for the open contract. Contracts attached before the dossier held a list still expose
  // their single legacy file, so nothing disappears if the backfill has not run yet.
  const dossierDocs: ContractDocument[] = (() => {
    if (!selectedContract) return [];
    const loaded = contractDocs.contractId === selectedContract.id ? contractDocs.docs : [];
    if (loaded.length > 0) return loaded;
    if (!selectedContract.document_name || !selectedContract.document_url) return [];
    return [{
      id: 'legacy',
      contract_id: selectedContract.id,
      file_name: selectedContract.document_name,
      storage_path: selectedContract.document_url,
      uploaded_at: selectedContract.document_uploaded_at,
    }];
  })();

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

  const handleCreateContract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCounterpartyId) {
      setCpError("Please select or create a Counterparty before registering the contract.");
      return;
    }
    setCpError("");
    const selectedCp = counterparties.find(c => c.id === newCounterpartyId);
    const created = await addContract({
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
    if (created && newDocName && newDocUrl) {
      const { error } = await getSupabaseBrowserClient().from('contract_documents').insert({
        contract_id: created.id,
        storage_path: newDocUrl,
        file_name: newDocName,
        doc_type: 'contract',
        signed: true,
        uploaded_by: currentUser.id,
      });
      if (error) console.error('[contract_documents] attach failed:', error.message);
    }
    setNewDocName('');
    setNewDocUrl('');
    setNewCounterpartyId('');
    setNewBillingCadence('monthly');
    setNewInvoiceTiming('start_of_period');
    setNewEnds('');
    setIsCreateOpen(false);
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      {/* Header — command bar: where you are, then the one action that matters. */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 border-b border-[var(--line-strong)] pb-3">
        <div className="min-w-0">
          <p className="ui-eyebrow">Operations · Contract registry</p>
          <h1 className="ui-title mt-1">Contracts</h1>
          <p className="text-[12.5px] text-[var(--ink-3)] mt-1 max-w-2xl">
            Client revenue and supplier spend in one registry, with renewal notice windows and invoicing per agreement.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="ui-segmented" role="group" aria-label="View">
            <button type="button" onClick={() => setViewMode('table')} aria-pressed={viewMode === 'table'}>
              <LayoutList className="w-3.5 h-3.5" /> List
            </button>
            <button type="button" onClick={() => setViewMode('revenue')} aria-pressed={viewMode === 'revenue'}>
              <BarChart3 className="w-3.5 h-3.5" /> Revenue schedule
            </button>
          </div>
          {isAdmin && (
            <Button variant="primary" size="sm" onClick={() => setIsCreateOpen(true)}>
              <Plus className="w-3.5 h-3.5" /> New contract
            </Button>
          )}
        </div>
      </div>

      {/* KPI & Notice Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard 
          title="Client revenue, annualised" 
          value={`€${revenueTotal.toLocaleString()}/yr`} 
          subtitle={hasPeriod ? `Annualised revenue committed in ${periodFrom || 'start'} → ${periodTo || 'present'}` : "Annualised recurring revenue (ARR) · excludes one-time fees"}
          icon={<DollarSign className="w-5 h-5 text-emerald-600" />}
        />
        <StatCard 
          title="Supplier spend, annualised" 
          value={`€${costTotal.toLocaleString()}/yr`} 
          subtitle={hasPeriod ? `Annualised spend committed in ${periodFrom || 'start'} → ${periodTo || 'present'}` : "Annualised recurring spend · excludes one-time fees"}
          icon={<DollarSign className="w-5 h-5 text-amber-600" />}
        />
        <StatCard
          title={`Action required, next ${NOTICE_ALERT_WINDOW_DAYS} days`}
          value={urgentAlerts}
          subtitle={urgentAlerts > 0
            ? `${urgentAlerts === 1 ? 'Notice deadline is' : 'Notice deadlines are'} open or already missed`
            : 'No notice deadline needs action'}
          icon={<AlertTriangle className="w-5 h-5 text-rose-600" />}
          footer={
            <Link
              href="/contracts/notices"
              className="text-[11px] font-medium text-[var(--accent-ink)] hover:underline"
            >
              {urgentAlerts > 0 ? 'See what action is required' : 'Open the notice-window report'}
            </Link>
          }
        />
      </div>

      {/* Filters — direction, status and the reporting window in one strip */}
      <div className="ui-card p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="ui-segmented" role="group" aria-label="Direction">
            <button type="button" onClick={() => setDirectionFilter('all')} aria-pressed={directionFilter === 'all'}>
              All contracts
            </button>
            <button type="button" onClick={() => setDirectionFilter('revenue')} aria-pressed={directionFilter === 'revenue'}>
              Client revenue <span className="font-mono text-[11px] font-medium text-[var(--ink-4)]">€{revenueTotal.toLocaleString()}/yr</span>
            </button>
            <button type="button" onClick={() => setDirectionFilter('cost')} aria-pressed={directionFilter === 'cost'}>
              Supplier spend <span className="font-mono text-[11px] font-medium text-[var(--ink-4)]">€{costTotal.toLocaleString()}/yr</span>
            </button>
          </div>

          <label className="flex items-center gap-2">
            <span className="ui-label">Status</span>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as ContractStatus | 'all')}
              className="h-7 rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-white px-2 text-[12px] font-medium text-[var(--ink-2)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
            >
              <option value="all">All statuses</option>
              <option value="active">Active only</option>
              <option value="expiring">Expiring (notice urgent)</option>
              <option value="in_negotiation">In negotiation</option>
            </select>
          </label>
        </div>

        {viewMode !== 'revenue' && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] mt-3 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="ui-label">Reporting period</span>
              <DatePicker value={periodFrom} max={periodTo || undefined} onChange={next => setPeriodFrom(next)} className="h-8 px-2 text-[12px]" />
              <span className="text-[var(--ink-4)] text-xs">to</span>
              <DatePicker value={periodTo} min={periodFrom || undefined} onChange={next => setPeriodTo(next)} className="h-8 px-2 text-[12px]" />
              {hasPeriod && (
                <button
                  type="button"
                  onClick={() => { setPeriodFrom(''); setPeriodTo(''); }}
                  className="h-8 px-2 rounded-[var(--radius-control)] text-[12px] font-semibold text-[var(--ink-3)] hover:text-rose-700 hover:bg-rose-50 inline-flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <X className="w-3.5 h-3.5" /> Clear
                </button>
              )}
            </div>
            <p className="text-[11px] text-[var(--ink-3)]">
              {hasPeriod ? 'Totals annualised and prorated to the selected window.' : 'Showing annualised (ARR) contracted totals.'}
            </p>
          </div>
        )}
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
        title={selectedContract ? selectedContract.reference : 'Contract'}
        eyebrow={`Contract dossier · ${selectedContract?.direction === 'cost' ? 'Supplier spend' : 'Client revenue'}`}
        size="full"
      >
        {selectedContract && (
          <div className="space-y-6 text-sm">
            {(() => {
              const dossierVal = calculateContractValuation(selectedContract.lines || [], selectedContract.discount_pct || 0, selectedContract.term_years || 1, selectedContract.service_start_date || selectedContract.starts_on, catalogModules, catalogItems, selectedContract.value || 0, selectedContract.billing_cadence);
              return (
                <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between px-4 py-2.5 bg-white rounded-[var(--radius-card)] border border-[var(--line)] gap-4 shadow-[var(--shadow-card)]">
                  <div className="flex items-center gap-3">
                    <span className={`px-2 h-6 inline-flex items-center rounded-md text-[11px] font-semibold border ${dossierVal.tierInfo.badgeClass}`}>
                      {dossierVal.tierInfo.label}
                    </span>
                    <span className="ui-meta">
                      Weighted ARR <strong className="ui-num font-semibold text-[var(--ink-2)]">€{dossierVal.weightedARR.toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr</strong>
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-5 text-[12px]">
                      <div>
                        <span className="ui-label mr-1.5">Net ARR</span>
                        <strong className="ui-num font-semibold text-emerald-700">€{dossierVal.netARR.toLocaleString()}/yr</strong>
                      </div>
                      {dossierVal.oneTimeValue > 0 && (
                        <div>
                          <span className="ui-label mr-1.5">One-off</span>
                          <strong className="ui-num font-semibold text-amber-700">+€{dossierVal.oneTimeValue.toLocaleString()}</strong>
                        </div>
                      )}
                      <div>
                        <span className="ui-label mr-1.5">TCV</span>
                        <strong className="ui-num font-semibold text-[var(--ink)]">€{dossierVal.totalContractValue.toLocaleString()}</strong>
                      </div>
                    </div>
                    {/* The dossier's single save action — visible on every tab. */}
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={saveContractDossier}
                      disabled={isSavingContract || pricingWindowErrors > 0}
                      title={pricingWindowErrors > 0
                        ? `Fix ${pricingWindowErrors} invalid line window${pricingWindowErrors === 1 ? '' : 's'} in the revenue schedule before saving`
                        : 'Save the contract terms, pricing and revenue schedule together'}
                      className="font-semibold"
                    >
                      <Save className="w-4 h-4 mr-1.5" /> {isSavingContract ? 'Saving…' : 'Save contract'}
                    </Button>
                  </div>
                </div>
              );
            })()}

            {/* Modal internal navigation — same machined switch as the list screens. */}
            <div className="ui-segmented flex-wrap" role="group" aria-label="Contract dossier sections">
              <button type="button" aria-pressed={dossierTab === 'general'} onClick={() => setDossierTab('general')}>
                <Edit3 className="w-3.5 h-3.5" /> Terms &amp; metadata
              </button>
              <button type="button" aria-pressed={dossierTab === 'pricing'} onClick={() => setDossierTab('pricing')}>
                <Layers className="w-3.5 h-3.5" /> Rate sheet &amp; schedule
                {selectedContract.lines && selectedContract.lines.length > 0 && (
                  <span className="font-mono text-[10px] font-semibold text-[var(--ink-4)]">{selectedContract.lines.length}</span>
                )}
              </button>
              <button type="button" aria-pressed={dossierTab === 'invoices'} onClick={() => setDossierTab('invoices')}>
                <Receipt className="w-3.5 h-3.5" /> Invoices
                {(invoices ?? []).filter(i => invoiceLinksContract(i, selectedContract.id, projects ?? [])).length > 0 && (
                  <span className="font-mono text-[10px] font-semibold text-[var(--ink-4)]">{(invoices ?? []).filter(i => invoiceLinksContract(i, selectedContract.id, projects ?? [])).length}</span>
                )}
              </button>
              <button type="button" aria-pressed={dossierTab === 'projects'} onClick={() => setDossierTab('projects')}>
                <Layers className="w-3.5 h-3.5" /> Projects
                {projects?.filter(p => p.contract_id === selectedContract.id && p.status !== 'archived').length > 0 && (
                  <span className="font-mono text-[10px] font-semibold text-[var(--ink-4)]">{projects?.filter(p => p.contract_id === selectedContract.id && p.status !== 'archived').length}</span>
                )}
              </button>
              <button type="button" aria-pressed={dossierTab === 'ratecard'} onClick={() => setDossierTab('ratecard')}>
                <DollarSign className="w-3.5 h-3.5" /> Rate card
              </button>
            </div>

            {/* Kept mounted on every tab: the dossier's single Save persists whatever was edited here. */}
            <div className={dossierTab === 'pricing' ? 'pt-2 min-h-[500px]' : 'hidden'}>
              <ContractPricingBuilder
                contractId={selectedContract.id}
                initialLines={selectedContract.lines || []}
                initialGroups={selectedContract.groups || []}
                initialDiscountPct={selectedContract.discount_pct || 0}
                initialTermYears={selectedContract.term_years || 1}
                initialStartDate={selectedContract.service_start_date || selectedContract.starts_on}
                contractEndsOn={selectedContract.ends_on}
                contractInvoiceTiming={selectedContract.invoice_timing}
                key={selectedContract.id}
                hideActions
                onDraftChange={draft => {
                  pricingDraftRef.current = draft;
                  setPricingWindowErrors(draft.windowErrorCount);
                }}
              />
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
                  const linkedInvoices = accountingInvoices((invoices || []).filter(i => invoiceLinksContract(i, selectedContract.id, projects ?? [])));
                  const totalGross = linkedInvoices.reduce((s, i) => s + i.gross_eur, 0);
                  const totalPaid = linkedInvoices.reduce((s, i) => s + (i.payments || []).reduce((ps, p) => ps + p.amount, 0), 0);
                  const totalOpen = Math.max(0, totalGross - totalPaid);
                  const duePeriods = selectedContractPeriods.filter(p => p.status !== 'billed');
                  const dueTotal = duePeriods.reduce((s, p) => s + p.expectedAmount, 0);
                  const nextDuePeriod = duePeriods.find(p => p.status === 'unbilled');

                  return (
                    <div className="space-y-6">
                      <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-white grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[var(--line)]">
                        <div className="p-4">
                          <span className="ui-label block">Billed gross</span>
                          <span className="ui-num text-[20px] font-semibold text-[var(--ink)] mt-1 block tracking-[-0.01em]">€{totalGross.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                          <span className="ui-meta">Across {linkedInvoices.length} {linkedInvoices.length === 1 ? 'invoice' : 'invoices'}</span>
                        </div>
                        <div className="p-4">
                          <span className="ui-label block">Settled</span>
                          <span className="ui-num text-[20px] font-semibold text-[var(--ink)] mt-1 block tracking-[-0.01em]">€{totalPaid.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                          <span className="ui-meta">Collected by bank transfer</span>
                        </div>
                        <div className="p-4">
                          <span className="ui-label block">Open receivable</span>
                          <span className={`ui-num text-[20px] font-semibold mt-1 block tracking-[-0.01em] ${totalOpen === 0 ? 'text-[var(--ink)]' : 'text-amber-700'}`}>€{totalOpen.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                          <span className="ui-meta">{totalOpen === 0 ? 'Fully settled' : 'Awaiting collection'}</span>
                        </div>
                      </div>

                      {/* Fast create: the periods this contract already owes, ready to bill in one click */}
                      <div className="bg-white border border-[var(--line)] rounded-[var(--radius-card)] overflow-hidden">
                        <div className="px-4 py-3 border-b border-[var(--line)] flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5">
                            <h4 className="text-[14px] font-semibold text-[var(--ink)]">Billing periods due</h4>
                            {duePeriods.length > 0 && (
                              <Badge variant="warning">{duePeriods.length} unbilled</Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {nextDuePeriod && (
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => createDraftForPeriod(selectedContract, nextDuePeriod)}
                                disabled={creatingPeriodKey !== null}
                                title={`Create a draft invoice for ${nextDuePeriod.label} (€${nextDuePeriod.expectedAmount.toLocaleString()})`}
                              >
                                <Zap className="w-3.5 h-3.5 mr-1.5" /> Create draft for {formatDate(nextDuePeriod.billingDate)}
                              </Button>
                            )}
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => router.push(`/invoices?new=1&contract=${selectedContract.id}`)}
                              title="Open the invoice register pre-filled for this contract"
                            >
                              <Receipt className="w-3.5 h-3.5 mr-1.5" /> Register invoice
                            </Button>
                          </div>
                        </div>
                        <p className="ui-meta px-4 pt-3">
                          {`Billed ${selectedContract.invoice_timing === 'end_of_period' ? 'in arrears' : 'in advance'} from ${formatDate(selectedContract.service_start_date || selectedContract.starts_on)}, ${selectedContract.billing_cadence === 'one_off' ? 'once' : `${(selectedContract.billing_cadence || 'monthly').replace('_', ' ')} cadence`}.`}
                          Expected total <strong className="ui-num font-semibold text-[var(--ink-2)]">€{dueTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
                        </p>

                        {duePeriods.length === 0 ? (
                          <p className="px-4 py-6 text-[12px] text-[var(--ink-3)] text-center">
                            Nothing due yet. A period appears here as soon as it reaches its {selectedContract.invoice_timing === 'end_of_period' ? 'end' : 'start'} date.
                          </p>
                        ) : (
                          <table className="w-full text-left text-[12px] mt-3">
                            <thead className="border-y border-[var(--line)] bg-[var(--surface-muted)]">
                              <tr className="ui-label">
                                <th className="px-4 py-2 font-medium">Billing cycle</th>
                                <th className="px-4 py-2 font-medium">Service window</th>
                                <th className="px-4 py-2 font-medium">Billing date</th>
                                <th className="px-4 py-2 font-medium text-right">Expected gross</th>
                                <th className="px-4 py-2 font-medium text-center">Status</th>
                                <th className="px-4 py-2 font-medium text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--line)]">
                              {duePeriods.map(period => (
                                <tr key={period.key} className="hover:bg-[var(--surface-muted)] transition-colors">
                                  <td className="px-4 py-2.5">
                                    <span className="font-medium text-[var(--ink)]">
                                      {period.label.includes('Milestone') || period.label.includes('One-off')
                                        ? period.label
                                        : `${(selectedContract.billing_cadence || 'monthly').replace('_', ' ').replace(/^./, c => c.toUpperCase())} period ${period.from.slice(0, 4)}`}
                                    </span>
                                    <span className="ui-meta block text-[11px]">billed {period.timing === 'end_of_period' ? 'at period end' : 'at period start'}</span>
                                  </td>
                                  <td className="px-4 py-2.5 ui-meta whitespace-nowrap">{formatDate(period.from)} – {formatDate(period.to)}</td>
                                  <td className="px-4 py-2.5">
                                    <span className="ui-num text-[var(--ink-2)]">{formatDate(period.billingDate)}</span>
                                  </td>
                                  <td className="px-4 py-2.5 text-right ui-num font-medium text-[var(--ink)]">€{period.expectedAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                  <td className="px-4 py-2.5 text-center">
                                    {period.status === 'unbilled'
                                      ? <Badge variant="warning">Unbilled</Badge>
                                      : <Badge variant="neutral">Draft created</Badge>}
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => router.push(`/invoices?new=1&contract=${selectedContract.id}&period=${encodeURIComponent(period.key)}&from=${period.from}&to=${period.to}&net=${period.expectedAmount}`)}
                                        title="Open the register pre-filled with this period and amount"
                                      >
                                        Review
                                      </Button>
                                      {period.status === 'unbilled' ? (
                                        <Button
                                          variant="secondary"
                                          size="sm"
                                          onClick={() => createDraftForPeriod(selectedContract, period)}
                                          disabled={creatingPeriodKey !== null}
                                          title="Create a draft invoice for this period right now"
                                        >
                                          <Zap className="w-3 h-3 mr-1" /> {creatingPeriodKey === period.key ? 'Creating…' : 'Create draft'}
                                        </Button>
                                      ) : (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => router.push(`/invoices?contract=${selectedContract.id}`)}
                                        >
                                          Open invoice
                                        </Button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>

                      <div className="bg-white border border-[var(--line)] rounded-[var(--radius-card)] overflow-hidden">
                        <div className="px-4 py-3 border-b border-[var(--line)] flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5">
                            <h4 className="text-[14px] font-semibold text-[var(--ink)]">Invoice ledger</h4>
                            <Badge variant="neutral">{linkedInvoices.length}</Badge>
                            <span className="ui-meta">Payment terms net {selectedContract.payment_terms_days ?? 30}</span>
                          </div>
                          <Link href="/invoices" className="text-[12px] font-medium text-[var(--accent-ink)] hover:underline">
                            Open invoices
                          </Link>
                        </div>

                        <table className="w-full text-left text-[12px]">
                          <thead className="border-b border-[var(--line)] bg-[var(--surface-muted)]">
                            <tr className="ui-label">
                              <th className="px-4 py-2 font-medium">Invoice</th>
                              <th className="px-4 py-2 font-medium">Issued</th>
                              <th className="px-4 py-2 font-medium">Due</th>
                              <th className="px-4 py-2 font-medium text-right">Gross</th>
                              <th className="px-4 py-2 font-medium text-right">Paid</th>
                              <th className="px-4 py-2 font-medium text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--line)]">
                            {linkedInvoices.map(inv => {
                              const pAmt = (inv.payments || []).reduce((s, p) => s + p.amount, 0);
                              return (
                                <tr key={inv.id} className="hover:bg-[var(--surface-muted)] transition-colors">
                                  <td className="px-4 py-2.5">
                                    <Link href={`/invoices/${inv.id}`} className="ui-num font-medium text-[var(--accent-ink)] hover:underline block">
                                      {inv.invoice_number}
                                    </Link>
                                    <span className="ui-meta text-[11px] block">
                                      {inv.reference_period ? inv.reference_period : 'No reference period'}
                                      {inv.mark ? ` · MARK ${inv.mark}` : ''}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5 ui-num text-[var(--ink-2)]">{formatDate(inv.issue_date)}</td>
                                  <td className="px-4 py-2.5 ui-num text-[var(--ink-2)]">{formatDate(inv.due_date)}</td>
                                  <td className="px-4 py-2.5 text-right ui-num font-medium text-[var(--ink)]">€{inv.gross_eur.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                  <td className="px-4 py-2.5 text-right ui-num text-emerald-700">€{pAmt.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                  <td className="px-4 py-2.5 text-center">
                                    {inv.status === 'paid' && <Badge variant="success">Paid</Badge>}
                                    {inv.status === 'partially_paid' && <Badge variant="warning">Partial</Badge>}
                                    {inv.status !== 'paid' && inv.status !== 'partially_paid' && <Badge variant="neutral">{inv.status.replace('_', ' ')}</Badge>}
                                  </td>
                                </tr>
                              );
                            })}
                            {linkedInvoices.length === 0 && (
                              <tr>
                                <td colSpan={6} className="px-4 py-8 text-center text-[12px] text-[var(--ink-3)]">
                                  No invoices on this contract yet. Create a draft from a billing period above, or register one manually.
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
            ) : dossierTab === 'pricing' ? null : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
              {/* Left Column: Entity Specs & Attachments (5 cols) */}
              <div className="lg:col-span-5 space-y-5">
                <div className="p-4 rounded-[var(--radius-card)] bg-white border border-[var(--line)] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="ui-label">Counterparty</span>
                    <Badge variant={selectedContract.direction === 'revenue' ? 'success' : 'warning'}>
                      {selectedContract.direction === 'revenue' ? 'Client revenue' : 'Supplier spend'}
                    </Badge>
                  </div>
                  <div className="text-[17px] font-semibold text-[var(--ink)] leading-snug">{selectedContract.counterparty?.legal_name || 'Designated entity'}</div>
                  <div className="pt-2.5 border-t border-[var(--line)] flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
                    <div><span className="ui-label mr-1.5">VAT</span><strong className="ui-num font-medium text-[var(--ink-2)]">{selectedContract.counterparty?.afm || 'Not set'}</strong></div>
                    <div><span className="ui-label mr-1.5">Country</span><strong className="font-medium text-[var(--ink-2)]">{selectedContract.counterparty?.country || 'Greece'}</strong></div>
                  </div>
                </div>

                {/* Notice Window Warning Box — only while the window is open or was missed */}
                {(() => {
                  const notice = getContractNoticeStatus(selectedContract);
                  if (!notice.isUrgent) return null;
                  const overdue = notice.daysUntilNotice < 0;
                  const days = Math.abs(notice.daysUntilNotice);
                  return (
                    <div className={`p-4 rounded-[var(--radius-card)] border space-y-2 ${overdue ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-200'}`}>
                      <div className={`flex items-center justify-between text-[12px] font-semibold ${overdue ? 'text-rose-900' : 'text-amber-900'}`}>
                        <span className="flex items-center gap-2">
                          <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${overdue ? 'text-rose-600' : 'text-amber-600'}`} />
                          {overdue ? 'Notice window missed' : 'Notice window open'}
                        </span>
                        <span className={`ui-num px-1.5 py-0.5 rounded text-[11px] ${overdue ? 'bg-rose-100 text-rose-900' : 'bg-amber-100 text-amber-900'}`}>
                          {notice.noticeDeadlineStr}
                        </span>
                      </div>
                      <p className={`text-xs leading-relaxed ${overdue ? 'text-rose-900/90' : 'text-amber-900/90'}`}>
                        {overdue ? (
                          <>
                            The <strong className="font-extrabold underline">{selectedContract.notice_period_days}-day notice deadline</strong> passed{' '}
                            <strong className="font-extrabold">{days} day{days === 1 ? '' : 's'} ago</strong>. The agreement ends{' '}
                            <strong className="font-extrabold">{selectedContract.ends_on}</strong>
                            {selectedContract.auto_renews ? ' and auto-renews unless it is renegotiated now.' : ' — confirm the exit or renewal terms now.'}
                          </>
                        ) : (
                          <>
                            <strong className="font-extrabold">{days} day{days === 1 ? '' : 's'}</strong> left to serve the{' '}
                            <strong className="font-extrabold underline">{selectedContract.notice_period_days}-day written notice</strong> before{' '}
                            <strong className="font-extrabold">{selectedContract.ends_on}</strong> to cancel or renegotiate.
                          </>
                        )}
                      </p>
                    </div>
                  );
                })()}

                {/* Signed Document Dossier — any number of signed copies per contract */}
                <div className="p-4 rounded-[var(--radius-card)] bg-white border border-[var(--line)] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <span className="ui-label">Documents</span>
                      {dossierDocs.length > 0 && (
                        <Badge variant="neutral">{dossierDocs.length}</Badge>
                      )}
                    </span>
                    <div>
                      <input
                        type="file"
                        id="doc-upload-selected"
                        className="hidden"
                        multiple
                        onChange={handleUploadContractDocs}
                        accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.xls,.xlsx,.csv,.txt"
                      />
                      <label
                        htmlFor="doc-upload-selected"
                        className={`h-8 px-2.5 rounded-[var(--radius-control)] border border-[var(--line)] bg-white hover:bg-[var(--surface-muted)] text-[12px] font-medium text-[var(--ink-2)] inline-flex items-center cursor-pointer transition-colors ${isUploadingDoc ? 'opacity-60 pointer-events-none' : ''}`}
                      >
                        <Upload className="w-3.5 h-3.5 mr-1.5" />
                        {isUploadingDoc ? 'Uploading…' : 'Attach'}
                      </label>
                    </div>
                  </div>

                  {dossierDocs.length > 0 ? (
                    <ul className="space-y-2">
                      {dossierDocs.map(doc => (
                        <li
                          key={doc.id}
                          className="px-2.5 py-2 rounded-lg border border-[var(--line)] flex items-center justify-between gap-2 text-[12px]"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <FileText className="w-4 h-4 shrink-0 text-[var(--ink-4)]" />
                            <div className="min-w-0">
                              <p className="font-medium text-[var(--ink)] truncate" title={doc.file_name || doc.storage_path}>
                                {doc.file_name || 'Contract document'}
                              </p>
                              <p className="ui-meta text-[11px] mt-0.5 truncate">
                                {doc.uploaded_at ? formatDate(doc.uploaded_at.split('T')[0]) : 'Date unknown'}
                                {formatFileSizeSuffix(doc.file_size)}
                                {doc.id === 'legacy' ? ' · legacy attachment' : ''}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void previewContractDocument(doc)}
                              title="Preview this document"
                            >
                              <Eye className="w-3.5 h-3.5 mr-1.5" /> Preview
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void downloadContractDocument(doc)}
                              title="Download this document"
                              aria-label="Download this document"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </Button>
                            <button
                              type="button"
                              onClick={() => void deleteContractDocument(doc)}
                              title="Remove this document"
                              aria-label="Remove this document"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="p-5 rounded-lg border border-dashed border-[var(--line-strong)] text-center space-y-1">
                      <FileText className="w-5 h-5 mx-auto text-[var(--ink-4)]" />
                      <p className="text-[12px] font-medium text-[var(--ink-2)]">No signed documents yet</p>
                      <p className="ui-meta">Attach the signed contract, amendments or annexes.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Interactive Contract Terms Editor (7 cols) */}
              <div className="lg:col-span-7 bg-white p-5 rounded-[var(--radius-card)] border border-[var(--line)] space-y-4">
                <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
                  <div>
                    <h4 className="text-[14px] font-semibold text-[var(--ink)]">Terms &amp; metadata</h4>
                    <p className="ui-meta mt-0.5">Agreement parameters, dates and notes.</p>
                  </div>
                  <div className="flex items-center space-x-2">
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (confirm(`Are you certain you want to completely delete agreement "${selectedContract.reference}" (${selectedContract.counterparty?.legal_name})? This action cannot be undone.`)) {
                            const ok = await deleteContract(selectedContract.id);
                            if (ok) {
                              setSelectedContract(null);
                              alert("Contract has been completely deleted.");
                            }
                          }
                        }}
                        className="h-8 px-2 rounded-[var(--radius-control)] text-[12px] font-medium text-[var(--ink-3)] hover:text-rose-700 hover:bg-rose-50 inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="ui-label block mb-1.5">Contract Title / Reference</label>
                    <input
                      type="text"
                      value={selectedContract.reference}
                      onChange={e => setSelectedContract({ ...selectedContract, reference: e.target.value })}
                      className="w-full h-9 px-3 bg-white border border-[var(--line-strong)] rounded-[var(--radius-control)] text-[13px] text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="ui-label block mb-1.5">Agreement Direction</label>
                    <select
                      value={selectedContract.direction}
                      onChange={e => setSelectedContract({ ...selectedContract, direction: e.target.value as ContractDirection })}
                      className="w-full h-9 px-3 bg-white border border-[var(--line-strong)] rounded-[var(--radius-control)] text-[13px] text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                    >
                      <option value="revenue">Client Revenue (Inbound)</option>
                      <option value="cost">Supplier Spend (Outbound)</option>
                    </select>
                  </div>
                  <div>
                    <label className="ui-label block mb-1.5">Effective Start Date</label>
                    <DatePicker value={selectedContract.service_start_date || selectedContract.starts_on} onChange={next => setSelectedContract({ ...selectedContract, starts_on: next, service_start_date: next })} className="w-full h-9 px-3 text-[13px]" />
                  </div>
                  <div>
                    <label className="ui-label block mb-1.5">Contract Expiration Date</label>
                    <DatePicker value={selectedContract.ends_on} onChange={next => setSelectedContract({ ...selectedContract, ends_on: next })} className="w-full h-9 px-3 text-[13px]" />
                  </div>
                  <div>
                    <label className="ui-label block mb-1.5">Notice Period (Days Prior to End)</label>
                    <input
                      type="number"
                      value={selectedContract.notice_period_days}
                      onChange={e => {
                        const days = parseInt(e.target.value) || 0;
                        setSelectedContract({ ...selectedContract, notice_period_days: days });
                      }}
                      className="w-full h-9 px-3 bg-white border border-[var(--line-strong)] rounded-[var(--radius-control)] text-[13px] text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="ui-label block mb-1.5">Notice Window Deadline</label>
                    <DatePicker value={selectedContract.notice_deadline} onChange={next => setSelectedContract({ ...selectedContract, notice_deadline: next })} className="w-full h-9 px-3 text-[13px]" />
                  </div>
                  <div>
                    <label className="ui-label block mb-1.5">Invoicing Cadence / Frequency</label>
                    <select
                      value={selectedContract.billing_cadence || 'monthly'}
                      onChange={e => setSelectedContract({ ...selectedContract, billing_cadence: e.target.value as any })}
                      className="w-full h-9 px-3 bg-white border border-[var(--line-strong)] rounded-[var(--radius-control)] text-[13px] text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                    >
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="annual">Annual</option>
                      <option value="milestone">Milestone / Project-based</option>
                      <option value="one_off">One-off / Single Billing</option>
                    </select>
                  </div>
                  <div>
                    <label className="ui-label block mb-1.5">Invoicing Timing (Within Period)</label>
                    <select
                      value={selectedContract.invoice_timing || 'start_of_period'}
                      onChange={e => setSelectedContract({ ...selectedContract, invoice_timing: e.target.value })}
                      className="w-full h-9 px-3 bg-white border border-[var(--line-strong)] rounded-[var(--radius-control)] text-[13px] text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                    >
                      <option value="start_of_period">Start of Period (In Advance / e.g. Start of Month/Quarter)</option>
                      <option value="end_of_period">End of Period (In Arrears / e.g. End of Month/Quarter)</option>
                      <option value="upon_milestone">Upon Milestone Completion / Delivery</option>
                    </select>
                  </div>
                </div>

                <p className="flex items-start gap-2 text-[12px] text-[var(--ink-2)]">
                  <Zap className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--accent)]" />
                  <span>
                    Billed {selectedContract.billing_cadence ? selectedContract.billing_cadence.replace('_', ' ') : 'monthly'} at the{' '}
                    {selectedContract.invoice_timing === 'end_of_period' ? 'end of each period, in arrears' :
                     selectedContract.invoice_timing === 'upon_milestone' ? 'milestone date' :
                     'start of each period, in advance'}. Invoice suggestions on the revenue schedule follow this rule.
                  </span>
                </p>

                <div>
                  <label className="flex items-center justify-between mb-1.5">
                    <span className="ui-label">Legal clauses &amp; notes</span>
                    <span className="ui-meta">Internal only</span>
                  </label>
                  <textarea
                    rows={4}
                    value={selectedContract.notes || ''}
                    placeholder="Liability caps, SLA penalties, payment terms, negotiated exemptions…"
                    onChange={e => setSelectedContract({ ...selectedContract, notes: e.target.value })}
                    className="w-full p-3 bg-white border border-[var(--line-strong)] rounded-[var(--radius-control)] text-[13px] leading-relaxed text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
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
              <span className="text-[11px] text-[#2f6fa3] normal-case font-semibold">First-Class Registry Entity</span>
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
              <DatePicker value={newStarts} onChange={next => setNewStarts(next)} className="w-full" />
            </div>
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Expiration Date <span className="text-slate-400 normal-case font-normal">(optional)</span></label>
              <DatePicker value={newEnds} onChange={next => setNewEnds(next)} className="w-full" placeholder="Leave empty for auto-renewing" />
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
              className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 text-xs font-medium file:mr-3 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-[#2f6fa3]/10 file:text-[#2f6fa3] hover:file:bg-[#2f6fa3]/20 cursor-pointer"
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

      {selectedContract && isPreviewingDoc && (
        <DocumentPreviewModal
          isOpen={isPreviewingDoc}
          onClose={() => setIsPreviewingDoc(false)}
          documentName={previewDocName || 'Contract document'}
          documentUrl={previewDocUrl}
          storagePath={previewDocName || null}
          uploadedAt={previewDocUploadedAt || selectedContract.starts_on}
          subtitle={`Signed Agreement · ${selectedContract.counterparty?.legal_name || 'Client Entity'}`}
          onDownload={() => {
            const doc = dossierDocs.find(d => (d.file_name || 'Contract document') === (previewDocName || 'Contract document'));
            if (doc) void downloadContractDocument(doc);
          }}
        />
      )}

    </div>
  );
}
