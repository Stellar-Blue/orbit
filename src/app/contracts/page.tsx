"use client";

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { notifySuccess } from '@/lib/validation-modal';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { Contract, ContractLine, ContractLineGroup, ContractSchedule, ContractDirection, ContractStatus } from '@/lib/types';
import { Card, Button, Badge, Modal, StatCard } from '@/components/ui/primitives';
import { 
  FileText, Plus, AlertTriangle, Clock, Calendar, DollarSign, X, 
  ArrowUpRight, ShieldCheck, Download, Upload, Layers, Check, TrendingUp, BarChart3, Sparkles, Save, Edit3, Trash2, Receipt, Eye, Copy, Users, Share2
} from 'lucide-react';
import { ContractPricingBuilder } from '@/components/contracts/contract-pricing-builder';
import { ContractProjectsTab } from '@/components/contracts/contract-projects-tab';
import { RateCardMatrix } from '@/components/settings/rate-card-matrix';
import { CounterpartyPicker } from '@/components/counterparties/counterparty-picker';
import { formatDate } from '@/lib/date';
import { DocumentPreviewModal } from '@/components/ui/document-preview-modal';
import { calculateContractValuation, getContractNoticeStatus } from '@/lib/pricing-engine';

const ContractsGrid = dynamic(() => import('@/components/contracts/contracts-grid').then(m => m.ContractsGrid), { ssr: false });
const RevenueGrid = dynamic(() => import('@/components/contracts/revenue-grid').then(m => m.RevenueGrid), { ssr: false });

export default function ContractsRegistryPage() {
  const { currentUser, contracts, counterparties, profiles, projects, addContract, updateContract, deleteContract, saveContractPricing, invoices, catalogModules, catalogItems, ensureContractRateCard } = useAuth();
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
  const [viewMode, setViewMode] = useState<'kanban' | 'table' | 'revenue'>('table');

  const isAdmin = currentUser.role === 'admin';

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; contract: Contract } | null>(null);

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

  // Form states for adding new contract
  const [newRef, setNewRef] = useState('SB-2026-NEW');
  const [newDirection, setNewDirection] = useState<ContractDirection>('revenue');
  const [newType, setNewType] = useState('saas_subscription');
  const [isPreviewingDoc, setIsPreviewingDoc] = useState(false);
  const [newNotice, setNewNotice] = useState(60);
  const [newStarts, setNewStarts] = useState('2026-08-01');
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

      const { data } = supabase.storage.from('contract-documents').getPublicUrl(filePath);
      return data.publicUrl || filePath;
    } catch (err) {
      console.error('Storage upload error:', err);
      return null;
    }
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

  // Reporting-period attribution: fraction of a contract's term overlapping the selected
  // date range. Without a range every active contract counts in full; with one, the
  // committed value is prorated to the portion of the term that falls inside the window.
  const parseDay = (s: string): Date | null => {
    if (!s) return null;
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };
  const DAY_MS = 86400000;
  const valueInPeriod = (c: Contract): number => {
    const full = c.value || 0;
    if (!periodFrom && !periodTo) return full;
    const start = parseDay(c.starts_on);
    if (!start) return 0;
    const end = c.ends_on ? parseDay(c.ends_on) : null;
    const lo = periodFrom ? parseDay(periodFrom)! : new Date(0);
    const hi = periodTo ? parseDay(periodTo)! : new Date(9999, 11, 31);
    const ovStart = start > lo ? start : lo;
    const ovEnd = end && end < hi ? end : hi;
    if (ovEnd < ovStart) return 0; // term does not overlap the reporting period
    if (!end) return full; // auto-renewing / indefinite term — fully committed
    const termDays = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
    const overlapDays = Math.round((ovEnd.getTime() - ovStart.getTime()) / DAY_MS) + 1;
    return Math.round(full * (overlapDays / termDays));
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

  const kanbanColumns: ContractStatus[] = ['draft', 'in_negotiation', 'active', 'expiring', 'expired'];

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
              onClick={() => setViewMode('kanban')} 
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${viewMode === 'kanban' ? 'bg-[#3D87D3] text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Kanban Board
            </button>
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

      {/* Reporting Period */}
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
            <>Totals cover <span className="font-bold text-[#3D87D3]">{periodFrom || 'start'} → {periodTo || 'present'}</span>, prorated to the period</>
          ) : (
            <>Showing <span className="font-bold">all-time</span> contracted totals</>
          )}
        </div>
      </div>

      {/* KPI & Notice Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <StatCard 
          title="Contracted Client Revenue (Active)" 
          value={`€${revenueTotal.toLocaleString()}`} 
          subtitle={hasPeriod ? `Committed for ${periodFrom || 'start'} → ${periodTo || 'present'}` : "Atlas ETRM, EMS & Consulting subscriptions"}
          icon={<DollarSign className="w-5 h-5 text-emerald-600" />}
        />
        <StatCard 
          title="Committed Supplier Spend (Active)" 
          value={`€${costTotal.toLocaleString()}`} 
          subtitle={hasPeriod ? `Committed for ${periodFrom || 'start'} → ${periodTo || 'present'}` : "Cloud infrastructure & algorithm partner feeds"}
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
            Client Revenue (<span className="text-emerald-700 font-mono ml-1">€{revenueTotal.toLocaleString()}</span>)
          </button>
          <button
            onClick={() => setDirectionFilter('cost')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center cursor-pointer ${directionFilter === 'cost' ? 'bg-amber-50 text-amber-800 border border-amber-200 font-bold' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            Supplier Spend (<span className="text-amber-700 font-mono ml-1">€{costTotal.toLocaleString()}</span>)
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

      {/* KANBAN BOARD VIEW */}
      {viewMode === 'kanban' ? (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-start pb-4 overflow-x-auto">
          {kanbanColumns.map(status => {
            const colContracts = filteredContracts.filter(c => c.status === status);
            return (
              <div key={status} className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 min-w-[240px] shadow-xs">
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200">
                  <span className="text-xs font-bold uppercase text-slate-600 tracking-wider flex items-center">
                    {status === 'expiring' && <AlertTriangle className="w-3.5 h-3.5 mr-1 text-rose-600" />}
                    {status.replace('_', ' ')}
                  </span>
                  <span className="w-5 h-5 rounded-full bg-white border border-slate-200 text-[11px] text-slate-700 flex items-center justify-center font-bold shadow-2xs">
                    {colContracts.length}
                  </span>
                </div>

                <div className="space-y-3">
                  {colContracts.map(c => {
                    const isRevenue = c.direction === 'revenue';
                    const { isUrgent: isUrgentNotice, noticeDeadlineStr: cardDeadlineStr } = getContractNoticeStatus(c);
                    return (
                      <div 
                        key={c.id}
                        onClick={() => setSelectedContract(c)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({ x: Math.min(e.clientX, window.innerWidth - 320), y: Math.min(e.clientY, window.innerHeight - 380), contract: c });
                        }}
                        className="p-3.5 rounded-xl bg-white border border-slate-200 hover:border-slate-300 transition-all cursor-pointer shadow-2xs group flex flex-col justify-between space-y-2 relative"
                      >
                        <div>
                          <div className="flex items-center justify-between text-[10px] mb-1">
                            <Badge variant={isRevenue ? 'success' : 'warning'}>{c.direction.toUpperCase()}</Badge>
                            <div className="flex items-center space-x-2">
                              <span className="font-mono text-slate-400">{c.reference}</span>
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (confirm(`Are you certain you want to completely delete contract "${c.reference}" (${c.counterparty?.legal_name})?`)) {
                                      await deleteContract(c.id);
                                    }
                                  }}
                                  className="text-slate-300 hover:text-rose-600 transition-colors p-0.5 cursor-pointer"
                                  title="Delete Contract"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                          <h4 className="font-bold text-sm text-slate-800 group-hover:text-[#3D87D3] transition-colors leading-tight">
                            {c.counterparty?.legal_name || 'Counterparty'}
                          </h4>
                          <p className="text-xs text-slate-500 mt-1">{c.product || c.type}</p>
                          <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={(e) => copyToClipboard(c.id, `Contract UUID (${c.id.slice(0, 8)}...)`, c.id, e)}
                              className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-[#3D87D3] border border-slate-200 rounded font-mono text-[10px] transition-colors cursor-pointer shadow-2xs"
                              title="Click to copy full Contract UUID · Right-click card for Fast Report"
                            >
                              <span>UUID: {c.id.slice(0, 8)}...{c.id.slice(-4)}</span>
                              {copiedId === c.id ? (
                                <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                              ) : (
                                <Copy className="w-3 h-3 text-slate-400 shrink-0" />
                              )}
                            </button>
                          </div>
                        </div>

                        {(() => {
                          const val = calculateContractValuation(c.lines || [], c.discount_pct || 0, c.term_years || 1, c.service_start_date || c.starts_on, catalogModules, catalogItems, c.value || 0, c.billing_cadence);
                          return (
                            <div className="space-y-2 mt-2">
                              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-bold text-slate-500 uppercase">ARR (Recurring)</span>
                                  <span className="font-mono font-black text-xs text-emerald-700">€{val.netARR.toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr</span>
                                </div>
                                {val.oneTimeValue > 0 && (
                                  <div className="flex items-center justify-between text-[11px]">
                                    <span className="text-slate-500 font-medium">One-off additional:</span>
                                    <span className="font-mono font-bold text-amber-600">+€{val.oneTimeValue.toLocaleString()}</span>
                                  </div>
                                )}
                                <div className="flex items-center justify-between border-t border-slate-200/80 pt-1 text-[11px]">
                                  <span className="font-extrabold text-slate-700">Real Deal TCV:</span>
                                  <span className="font-mono font-extrabold text-slate-900">€{val.totalContractValue.toLocaleString()}</span>
                                </div>
                              </div>
                              <div>
                                <span className={`px-2 py-0.5 rounded text-[10px] font-black inline-block border ${val.tierInfo.badgeClass}`}>
                                  {val.tierInfo.label}
                                </span>
                              </div>
                            </div>
                          );
                        })()}

                        <div className={`pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] ${isUrgentNotice ? 'text-rose-600 font-bold' : 'text-slate-500'}`}>
                          <span className="flex items-center">
                            <Clock className="w-3 h-3 mr-1" /> Notice: {cardDeadlineStr}
                          </span>
                          {isUrgentNotice && <span className="text-[10px] bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200 text-rose-700">URGENT</span>}
                        </div>
                      </div>
                    );
                  })}
                  {colContracts.length === 0 && (
                    <div className="p-6 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg">
                      No contracts in this pipeline stage.
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* TABLE LIST VIEW (AG GRID) */
        <ContractsGrid
          contracts={filteredContracts}
          catalogModules={catalogModules}
          catalogItems={catalogItems}
          isAdmin={isAdmin}
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
                    alert("Modular pricing snapshot and revenue schedule locked to deal!");
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
                          onClick={() => setIsPreviewingDoc(true)}
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
          documentUrl={selectedContract.document_url}
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

      {/* RIGHT-CLICK CUSTOM CONTEXT MENU FOR CONTRACTS */}
      {contextMenu && (
        <div 
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-50 w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 py-2 text-xs overflow-hidden animate-in fade-in zoom-in-95 duration-150 font-sans"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 mb-1">
            <div className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider">⚡ Quick Copy Menu</div>
            <div className="font-extrabold text-slate-800 truncate text-sm">{contextMenu.contract.reference} &mdash; {contextMenu.contract.counterparty?.legal_name || 'Contract'}</div>
          </div>

          <div className="py-1 space-y-0.5">
            <button
              type="button"
              onClick={() => {
                copyToClipboard(contextMenu.contract.id, `Contract UUID (${contextMenu.contract.id.slice(0,8)}...)`, contextMenu.contract.id);
                setContextMenu(null);
              }}
              className="w-full px-3.5 py-2 text-left text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 font-semibold flex items-center justify-between transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Copy className="w-3.5 h-3.5 text-[#3D87D3]" /> Copy Contract UUID
              </span>
              <span className="text-[10px] font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">{contextMenu.contract.id.slice(0, 6)}...</span>
            </button>

            <button
              type="button"
              onClick={() => {
                copyToClipboard(contextMenu.contract.counterparty_id || 'N/A', `Counterparty UUID`, undefined);
                setContextMenu(null);
              }}
              className="w-full px-3.5 py-2 text-left text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 font-semibold flex items-center justify-between transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-blue-600" /> Copy Counterparty UUID
              </span>
              <span className="text-[10px] font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">{contextMenu.contract.counterparty_id?.slice(0, 6) || 'None'}...</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const val = `€${contextMenu.contract.value?.toLocaleString() || '0'} / ${contextMenu.contract.billing_cadence || 'monthly'}`;
                copyToClipboard(val, `Contract Value (${val})`, undefined);
                setContextMenu(null);
              }}
              className="w-full px-3.5 py-2 text-left text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 font-semibold flex items-center justify-between transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <DollarSign className="w-3.5 h-3.5 text-emerald-600" /> Copy Value & Cadence
              </span>
              <span className="text-[10px] font-bold text-emerald-700">€{contextMenu.contract.value?.toLocaleString() || 0}</span>
            </button>
          </div>

          <div className="border-t border-slate-100 my-1 pt-1">
            <button
              type="button"
              onClick={() => {
                const c = contextMenu.contract;
                const arr = c.billing_cadence === 'annual' ? (c.value || 0) : c.billing_cadence === 'quarterly' ? (c.value || 0) * 4 : (c.value || 0) * 12;
                const report = [
                  `📋 CONTRACT FAST REPORT: ${c.reference}`,
                  `=========================================`,
                  `• Counterparty: ${c.counterparty?.legal_name || 'Unmapped Entity'} (CP UUID: ${c.counterparty_id || 'N/A'})`,
                  `• Contract UUID: ${c.id}`,
                  `• Product & Type: ${c.product || c.type || 'Agreement'} (${c.direction.toUpperCase()})`,
                  `• Status: ${c.status.toUpperCase()}`,
                  `• Commercial Value: €${c.value?.toLocaleString() || '0'} / ${c.billing_cadence || 'month'} (Est. ARR: €${arr.toLocaleString()})`,
                  `• Term Period: ${c.starts_on} to ${c.ends_on || 'Indefinite'}`,
                  `• Notice Terms: ${c.notice_period_days || 30} days window (Deadline: ${c.notice_deadline || 'None'})`,
                  `• Notes & Conditions: ${c.notes || 'Standard executive financial terms apply.'}`
                ].join('\n');
                copyToClipboard(report, `Contract Fast Report (${c.reference})`, undefined);
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
