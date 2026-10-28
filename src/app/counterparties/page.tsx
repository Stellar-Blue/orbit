"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { notifySuccess, notifyValidation } from '@/lib/validation-modal';
import { Counterparty, AttioLink, CounterpartyContact, Contract, Role } from '@/lib/types';
import { calculateContractValuation } from '@/lib/pricing-engine';
import { accountingInvoices } from '@/lib/invoice-netting';
import { formatDate, formatDateTime } from '@/lib/date';
import { CounterpartyPicker } from '@/components/counterparties/counterparty-picker';
import { TierOverrideForm } from '@/components/counterparties/tier-override-form';
import { Card, Button, Badge, Modal, StatCard } from '@/components/ui/primitives';
import type { AttioSyncCompany } from '@/components/counterparties/attio-companies-grid';
import { 
  Building2, Search, RefreshCw, ShieldCheck, Plus, Check, ExternalLink, 
  AlertTriangle, ArrowUpRight, Users, Link as LinkIcon, Unlink, FileText, 
  Filter, Sparkles, Globe, MapPin, Trash2, Edit3, CheckCircle2, AlertCircle, HelpCircle, Receipt, DollarSign, Copy, Pin, Layers, Merge, Award
} from 'lucide-react';

const AttioCompaniesGrid = dynamic(() => import('@/components/counterparties/attio-companies-grid').then(m => m.AttioCompaniesGrid), { ssr: false });
const CounterpartiesGrid = dynamic(() => import('@/components/counterparties/counterparties-grid').then(m => m.CounterpartiesGrid), { ssr: false });

export default function CounterpartiesRegistryPage() {
  const { 
    counterparties, counterpartyRoles, contracts, attioEvents, addCounterparty, updateCounterparty, 
    linkToAttio, processAttioReviewEvent, reconcileAttio, reassignContracts, mergeCounterparties,
    addCounterpartyContact, deleteCounterparty, deleteAllCounterparties, currentUser, invoices, catalogModules, catalogItems,
    tierStates, recomputeTiers
  } = useAuth();
  const params = useParams();
  const urlId = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const [activeTab, setActiveTab] = useState<'registry' | 'queue'>('registry');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [selectedEntity, setSelectedEntity] = useState<Counterparty | null>(null);
  const [dossierTab, setDossierTab] = useState<'profile' | 'invoices' | 'tier'>('profile');
  const [isEditMode, setIsEditMode] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [isTierRecomputing, setIsTierRecomputing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Merge duplicate counterparty state
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  // Sync initial selection from URL ID
  useEffect(() => {
    if (urlId && counterparties.length > 0 && !selectedEntity) {
      const target = counterparties.find(c => c.id === urlId || c.vat_number === urlId || c.afm === urlId);
      if (target) {
        setSelectedEntity(target);
      }
    }
  }, [urlId, counterparties]);

  // Sync address bar when counterparty is selected or closed
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (selectedEntity) {
      window.history.pushState(null, '', `/counterparties/${selectedEntity.id}`);
    } else if (window.location.pathname.startsWith('/counterparties/')) {
      window.history.pushState(null, '', '/counterparties');
    }
  }, [selectedEntity]);

  const copyUuid = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // New Entity Modal state
  const [showNewModal, setShowNewModal] = useState(false);
  const [newLegalName, setNewLegalName] = useState("");
  const [newTradeName, setNewTradeName] = useState("");
  const [newCountry, setNewCountry] = useState("Greece");
  const [newVat, setNewVat] = useState("");
  const [newDomain, setNewDomain] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [syncToAttio, setSyncToAttio] = useState(true);

  // Edit State in Dossier
  const [editLegalName, setEditLegalName] = useState("");
  const [editTradeName, setEditTradeName] = useState("");
  const [editVat, setEditVat] = useState("");
  const [editCountry, setEditCountry] = useState("");
  const [editDomain, setEditDomain] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editRoles, setEditRoles] = useState<Role[]>([]);

  // New Entity Modal state
  const [newRoles, setNewRoles] = useState<Role[]>([]);

  // Attio manual link inputs
  const [linkRecordId, setLinkRecordId] = useState("");

  // New Contact person inputs
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactRole, setContactRole] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  // Attio CRM Inbound Sync state
  const [attioSyncCompanies, setAttioSyncCompanies] = useState<AttioSyncCompany[] | null>(null);
  const [fetchingAttioSync, setFetchingAttioSync] = useState(false);
  const [importingRecordId, setImportingRecordId] = useState<string | null>(null);

  const isAdmin = currentUser.role === 'admin';

  const handleRecomputeTiers = async () => {
    setIsTierRecomputing(true);
    const result = await recomputeTiers('client', 'data_change');
    setIsTierRecomputing(false);
    alert(result.ok
      ? (result.changes.length > 0
        ? `Tiers recomputed — ${result.changes.length} counterparty tier change(s) recorded (data_change).`
        : 'Tiers recomputed — no changes (stable).')
      : `Recompute failed: ${result.error || 'Unknown error'}`);
  };

  // One-time tier recompute on first load (ensures every counterparty has a tier with live data)
  const tierInitRef = useRef(false);
  useEffect(() => {
    if (isAdmin && counterparties.length > 0 && tierStates.length === 0 && !tierInitRef.current) {
      tierInitRef.current = true;
      recomputeTiers('client', 'data_change');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counterparties.length, tierStates.length, isAdmin]);

  // KPIs
  const totalEntities = counterparties.filter(c => c.status !== 'archived').length;
  const clientCount = counterparties.filter(c => c.status !== 'archived' && (c.roles || []).some(r => r.slug === 'client')).length;
  const supplierCount = counterparties.filter(c => c.status !== 'archived' && (c.roles || []).some(r => r.slug === 'supplier')).length;
  const linkedCount = counterparties.filter(c => c.status !== 'archived' && c.attio_link?.link_status === 'linked').length;
  const pendingReviewCount = attioEvents.filter(e => e.status === 'pending_review').length;

  const filteredRegistry = useMemo(() => {
    return counterparties.filter(cp => {
      const roles = cp.roles || [];
      const hasClient = roles.some(r => r.slug === 'client');
      const hasSupplier = roles.some(r => r.slug === 'supplier');
      if (roleFilter === 'clients' && !hasClient) return false;
      if (roleFilter === 'suppliers' && !hasSupplier) return false;
      if (roleFilter === 'both' && !(hasClient && hasSupplier)) return false;
      if (roleFilter === 'unlinked' && cp.attio_link?.link_status === 'linked') return false;
      if (roleFilter === 'archived' && cp.status !== 'archived') return false;
      if (roleFilter !== 'archived' && cp.status === 'archived') return false;

      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesName = cp.legal_name?.toLowerCase().includes(q) || cp.trade_name?.toLowerCase().includes(q);
        const matchesVat = cp.vat_number?.toLowerCase().includes(q) || cp.afm?.toLowerCase().includes(q);
        const matchesDomain = cp.website_domain?.toLowerCase().includes(q);
        const matchesCountry = cp.country?.toLowerCase().includes(q);
        return matchesName || matchesVat || matchesDomain || matchesCountry;
      }
      return true;
    });
  }, [counterparties, roleFilter, search]);

  const handleReconcile = async () => {
    setIsReconciling(true);
    await reconcileAttio();
    setIsReconciling(false);
  };

  const openDossier = (cp: Counterparty) => {
    setSelectedEntity(cp);
    setIsEditMode(false);
    setEditLegalName(cp.legal_name || "");
    setEditTradeName(cp.trade_name || cp.legal_name || "");
    setEditVat(cp.vat_number || cp.afm || "");
    setEditCountry(cp.country || "Greece");
    setEditDomain(cp.website_domain || "");
    setEditNotes(cp.notes || "");
    setEditRoles(cp.roles || []);
    setLinkRecordId(cp.attio_link?.attio_record_id || `attio_rec_orbit_${cp.id.slice(0, 8)}`);
  };

  const handleSaveEdit = async () => {
    if (!selectedEntity) return;
    const success = await updateCounterparty({
      ...selectedEntity,
      legal_name: editLegalName.trim(),
      trade_name: editTradeName.trim() || editLegalName.trim(),
      vat_number: editVat.trim(),
      afm: editVat.trim(),
      country: editCountry,
      website_domain: editDomain.trim(),
      notes: editNotes.trim(),
      roles: editRoles
    });
    if (success) {
      setSelectedEntity(prev => prev ? { ...prev, legal_name: editLegalName, trade_name: editTradeName, vat_number: editVat, afm: editVat, country: editCountry, website_domain: editDomain, notes: editNotes, roles: editRoles } : null);
      setIsEditMode(false);
    }
  };

  const handleCreateNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLegalName.trim()) {
      alert("Legal Name is required.");
      return;
    }
    await addCounterparty({
      legal_name: newLegalName.trim(),
      trade_name: newTradeName.trim() || undefined,
      country: newCountry,
      vat_number: newVat.trim() || undefined,
      website_domain: newDomain.trim() || undefined,
      notes: newNotes.trim() || undefined,
      sync_to_attio: syncToAttio,
      status: 'active',
      roles: newRoles
    });
    setShowNewModal(false);
    setNewLegalName(""); setNewTradeName(""); setNewVat(""); setNewDomain(""); setNewNotes(""); setNewRoles([]);
  };

  const getRoleBadge = (roles?: Role[]) => {
    if (!roles || roles.length === 0) return <Badge variant="neutral">No Roles</Badge>;
    return (
      <div className="flex gap-1 flex-wrap">
        {roles.map(r => {
           if (r.slug === 'client') return <Badge key={r.id} variant="info">Client</Badge>;
           if (r.slug === 'supplier') return <Badge key={r.id} variant="warning">Supplier</Badge>;
           return <Badge key={r.id} variant="info" className="bg-slate-500/10 text-slate-600 border border-slate-300 capitalize">{r.name}</Badge>;
        })}
      </div>
    );
  };

  const getContractVal = (c: Contract) => calculateContractValuation(
    c.lines || [], c.discount_pct || 0, c.term_years || 1,
    c.service_start_date || c.starts_on, catalogModules, catalogItems,
    c.value || 0, c.billing_cadence
  );

  const getContractArr = (cpId: string) => {
    const cpContracts = contracts.filter(c => c.counterparty_id === cpId && c.status === 'active' && c.direction === 'revenue');
    return cpContracts.reduce((sum, c) => sum + getContractVal(c).netARR, 0);
  };

  const getContractCount = (cpId: string) => {
    return contracts.filter(c => c.counterparty_id === cpId && c.status === 'active').length;
  };

  const handleFetchAttioCompanies = async () => {
    setFetchingAttioSync(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('orbit_attio_api_key') : '';
      const attributeSlug = typeof window !== 'undefined' ? localStorage.getItem('orbit_attio_rel_attribute') || 'relationship_type' : 'relationship_type';
      const rawVals = typeof window !== 'undefined' ? localStorage.getItem('orbit_attio_rel_values') : null;
      const whitelistValues = rawVals ? JSON.parse(rawVals) : ['Client', 'Customer', 'Supplier', 'Partner', 'Vendor'];

      const res = await fetch('/api/v1/attio/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, attributeSlug, whitelistValues })
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        alert(data.error || "Failed to communicate with Attio API.");
        return;
      }
      if (data && data.companies) {
        setAttioSyncCompanies(data.companies);
        if (data.companies.length === 0) {
          notifyValidation({ type: 'info', title: 'No matches', message: 'Connected to Attio, but no corporate records matched your filter criteria.' });
        }
      }
    } catch (err: any) {
      console.error("Error pulling Attio companies:", err);
      alert(`Network or server error connecting to Attio: ${err?.message || 'Check console'}`);
    } finally {
      setFetchingAttioSync(false);
    }
  };

  const isCompanyImported = (comp: any) => {
    const validVat = comp.vat_number && comp.vat_number !== 'N/A in Attio' && comp.vat_number !== 'N/A' && comp.vat_number.trim() !== '' ? comp.vat_number.trim().toLowerCase() : null;
    return counterparties.some(c => {
      if (c.attio_link?.attio_record_id && c.attio_link.attio_record_id === comp.attio_record_id) return true;
      if (validVat && c.vat_number && c.vat_number.trim().toLowerCase() === validVat) return true;
      if (c.legal_name && comp.legal_name && c.legal_name.trim().toLowerCase() === comp.legal_name.trim().toLowerCase()) return true;
      return false;
    });
  };

  const handleImportCompany = async (comp: any) => {
    setImportingRecordId(comp.attio_record_id);
    try {
      const cleanVat = comp.vat_number && comp.vat_number !== 'N/A in Attio' && comp.vat_number !== 'N/A' && comp.vat_number.trim() !== '' ? comp.vat_number.trim() : undefined;
      const created = await addCounterparty({
        legal_name: comp.legal_name,
        trade_name: comp.legal_name,
        country: comp.country_code === 'GR' ? 'Greece' : comp.country_code === 'NL' ? 'Netherlands' : comp.country_code === 'DE' ? 'Germany' : comp.country_code === 'IT' ? 'Italy' : 'Europe',
        vat_number: cleanVat,
        afm: cleanVat && comp.country_code === 'GR' ? cleanVat : undefined,
        vat_valid: !!cleanVat,
        status: 'active',
        roles: (comp.suggested_roles || []).map((slug: string) => counterpartyRoles.find(r => r.slug === slug.toLowerCase())).filter(Boolean) as Role[],
        website_domain: comp.domain,
        sync_to_attio: true,
        notes: `Imported via Attio CRM sync (${comp.relationship_status})`
      }, comp.attio_record_id);
      
      if (created && comp.attio_record_id) {
        await linkToAttio(created.id, comp.attio_record_id);
      }
    } finally {
      setImportingRecordId(null);
    }
  };

  const handleBulkImportAll = async () => {
    if (!attioSyncCompanies || attioSyncCompanies.length === 0) return;
    const unimported = attioSyncCompanies.filter(comp => !isCompanyImported(comp));
    if (unimported.length === 0) {
      notifyValidation({ type: 'info', title: 'Already imported', message: 'All fetched Attio entities are already in Orbit.' });
      return;
    }
    if (confirm(`Bulk import all ${unimported.length} qualifying Attio CRM companies into Orbit's Corporate Entity Registry?`)) {
      for (const comp of unimported) {
        await handleImportCompany(comp);
      }
      notifySuccess(`Imported and linked ${unimported.length} corporate entit${unimported.length === 1 ? 'y' : 'ies'} from Attio.`);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Header & KPI Summary */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200/80 pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-[#2f6fa3] to-indigo-600 text-white shadow-md shadow-blue-500/20">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                Counterparty Registry & Attio CRM Sync
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                First-class corporate registry with automated VIES VAT validation & bidirectional CRM rollup sync
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRecomputeTiers}
              disabled={isTierRecomputing}
              className="bg-white hover:bg-slate-50 border-indigo-200 text-indigo-700 shadow-sm"
            >
              <Layers className={`w-4 h-4 mr-2 text-indigo-500 ${isTierRecomputing ? 'animate-pulse' : ''}`} />
              {isTierRecomputing ? "Recomputing Tiers..." : "Recompute Client Tiers"}
            </Button>
          )}
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleReconcile}
              disabled={isReconciling}
              className="bg-white hover:bg-slate-50 border-slate-200 text-slate-700 shadow-sm"
            >
              <RefreshCw className={`w-4 h-4 mr-2 text-[#2f6fa3] ${isReconciling ? 'animate-spin' : ''}`} />
              {isReconciling ? "Reconciling Rollups..." : "Run Nightly Reconciliation"}
            </Button>
          )}
          {isAdmin && counterparties.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (confirm(`WARNING: Are you sure you want to delete ALL ${counterparties.length} current counterparties? This will clean out the entire existing registry so you can import clean data.`)) {
                  await deleteAllCounterparties();
                  notifySuccess('All counterparties have been removed.');
                }
              }}
              className="bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200 font-bold shadow-2xs cursor-pointer flex items-center gap-1.5"
            >
              <Trash2 className="w-4 h-4 text-rose-600" />
              <span>Delete All Companies</span>
            </Button>
          )}
          {isAdmin && (
            <Button 
              onClick={() => setShowNewModal(true)} 
              size="sm"
              className="bg-gradient-to-r from-[#2f6fa3] to-indigo-600 hover:from-blue-600 hover:to-indigo-500 text-white shadow-md shadow-blue-500/20"
            >
              <Plus className="w-4 h-4 mr-2" />
              Register New Entity
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard 
          title="Total Corporate Registry" 
          value={totalEntities} 
          icon={<Building2 className="w-5 h-5 text-indigo-500" />}
          subtitle="Verified Active Accounts"
        />
        <StatCard 
          title="Active Client Base" 
          value={clientCount} 
          icon={<ArrowUpRight className="w-5 h-5 text-emerald-500" />}
          subtitle="Generating revenue"
        />
        <StatCard 
          title="Active Supplier Spend" 
          value={supplierCount} 
          icon={<Building2 className="w-5 h-5 text-amber-500" />}
          subtitle="Vendor partnerships"
        />
        <StatCard 
          title="Attio CRM Sync Coverage" 
          value={`${totalEntities > 0 ? Math.round((linkedCount / totalEntities) * 100) : 0}%`} 
          icon={<RefreshCw className="w-5 h-5 text-[#2f6fa3]" />}
          subtitle={`${linkedCount} of ${totalEntities} linked`}
        />
        <StatCard 
          title="Attio Review Queue" 
          value={pendingReviewCount} 
          icon={<AlertCircle className={`w-5 h-5 ${pendingReviewCount > 0 ? 'text-amber-500 animate-pulse' : 'text-slate-400'}`} />}
          subtitle={pendingReviewCount > 0 ? "Action required" : "All clear"}
        />
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap border-b border-slate-200 gap-2">
        <button
          onClick={() => setActiveTab('registry')}
          className={`pb-3 px-5 text-sm font-medium transition-all relative cursor-pointer flex items-center gap-2 ${
            activeTab === 'registry'
              ? 'text-[#2f6fa3] font-semibold border-b-2 border-[#2f6fa3]'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Building2 className="w-4 h-4" />
          Corporate Entity Registry
          <span className="ml-1.5 px-2 py-0.5 text-[10px] rounded-full bg-slate-100 text-slate-600 font-bold">{totalEntities}</span>
        </button>

        <button
          onClick={() => setActiveTab('queue')}
          className={`pb-3 px-5 text-sm font-medium transition-all relative cursor-pointer flex items-center gap-2 ${
            activeTab === 'queue'
              ? 'text-[#2f6fa3] font-semibold border-b-2 border-[#2f6fa3]'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Sparkles className="w-4 h-4 text-amber-500" />
          Attio CRM Inbound Queue
          {pendingReviewCount > 0 && (
            <span className="ml-1.5 px-2 py-0.5 text-[10px] rounded-full bg-amber-100 text-amber-700 font-extrabold animate-bounce">{pendingReviewCount}</span>
          )}
        </button>
      </div>

      {/* TAB 1: CORPORATE REGISTRY */}
      {activeTab === 'registry' && (
        <Card className="p-0 overflow-hidden shadow-sm border-slate-200/80">
          <div className="p-4 bg-slate-50/70 border-b border-slate-200/60 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by Legal Name, Trade Name, VAT, Domain, Country..."
                className="w-full pl-10 pr-4 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#2f6fa3] focus:ring-2 focus:ring-[#2f6fa3]/10 transition-all shadow-2xs"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
              {[
                { id: 'all', label: 'All Entities' },
                { id: 'clients', label: 'Clients' },
                { id: 'suppliers', label: 'Suppliers' },
                { id: 'both', label: 'Dual Role (Client & Supplier)' },
                { id: 'unlinked', label: 'Unlinked CRM' },
                { id: 'archived', label: 'Archived' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setRoleFilter(tab.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                    roleFilter === tab.id
                      ? 'bg-[#2f6fa3] text-white shadow-xs'
                      : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <CounterpartiesGrid
            counterparties={filteredRegistry}
            isAdmin={isAdmin}
            externalFilters={{
              active: search.trim().length > 0 || roleFilter !== 'all',
              onClear: () => { setSearch(''); setRoleFilter('all'); }
            }}
            onOpen={(cp) => openDossier(cp)}
            onDelete={async (cp) => {
              if (confirm(`Delete corporate entity "${cp.legal_name}"?`)) {
                await deleteCounterparty(cp.id);
              }
            }}
            getContractCount={getContractCount}
            getContractArr={getContractArr}
          />
        </Card>
      )}

      {/* TAB 2: ATTIO CRM INBOUND REVIEW QUEUE */}
      {activeTab === 'queue' && (
        <div className="space-y-6">
          <Card className="p-6 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-slate-700 text-white shadow-xl rounded-2xl">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-amber-500/20 border border-amber-500/30 text-amber-400 rounded-2xl shrink-0 mt-0.5">
                <Sparkles className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  Attio CRM Webhook Review Queue (Inbound Sync)
                </h3>
                <p className="text-sm text-slate-300 mt-1 max-w-3xl leading-relaxed">
                  Per Orbit's CRM sync architecture: <strong>Attio owns the relationship; Orbit owns the money.</strong> When new companies transition to active status in Attio CRM, incoming webhooks appear here for administrator verification to preserve corporate registry data integrity.
                </p>
                <div className="mt-4 flex items-center gap-4 text-xs font-mono text-slate-400 bg-slate-950/60 px-3 py-2 rounded-xl border border-slate-800 w-fit">
                  <span>Webhook Endpoint: <strong className="text-blue-400">api/v1/webhooks/attio</strong></span>
                  <span>•</span>
                  <span>Status: <strong className="text-emerald-400">Active Listening</strong></span>
                </div>
              </div>
            </div>
          </Card>

          {/* On-Demand Attio Companies Filter & Sync */}
          <div className="p-6 bg-gradient-to-r from-indigo-900 via-slate-900 to-indigo-950 text-white rounded-2xl border border-indigo-500/30 shadow-xl space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-indigo-500/20 pb-4">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 text-[10px] font-mono font-bold uppercase">
                  <Sparkles className="w-3 h-3 text-indigo-300 animate-pulse" />
                  <span>On-Demand CRM Synchronizer</span>
                </div>
                <h4 className="text-lg font-bold text-white flex items-center gap-2">
                  Pull Qualified Attio Companies by Sync Criteria
                </h4>
                <p className="text-xs text-indigo-200">
                  Instantly query Attio CRM for companies matching your configured Relationship Type whitelist (Client, Supplier, etc.) and import them into Orbit with 1-click.
                </p>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                {attioSyncCompanies && attioSyncCompanies.length > 0 && (
                  <Button
                    type="button"
                    onClick={handleBulkImportAll}
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-md shadow-emerald-500/20 px-4 py-2 cursor-pointer flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4 text-white" />
                    <span>Import All Filtered ({attioSyncCompanies.filter(c => !isCompanyImported(c)).length})</span>
                  </Button>
                )}
                <Button
                  type="button"
                  onClick={handleFetchAttioCompanies}
                  disabled={fetchingAttioSync}
                  size="sm"
                  className="bg-[#2f6fa3] hover:bg-blue-600 text-white font-bold shadow-md shadow-blue-500/20 px-5 py-2 cursor-pointer flex items-center gap-2"
                >
                  <RefreshCw className={`w-4 h-4 ${fetchingAttioSync ? 'animate-spin' : ''}`} />
                  <span>{fetchingAttioSync ? "Querying Attio CRM..." : "Sync & Filter Attio Companies"}</span>
                </Button>
              </div>
            </div>

            {attioSyncCompanies && (
              <div className="space-y-3 animate-in fade-in duration-300">
                <div className="flex items-center justify-between text-xs text-indigo-200 font-medium px-1">
                  <span>
                    Found <strong>{attioSyncCompanies.length}</strong> companies in Attio CRM ·{" "}
                    <strong>{attioSyncCompanies.filter(c => c.qualified !== false).length}</strong> match your Relationship Type sync criteria
                  </span>
                  <span className="font-mono text-[11px] text-slate-300">Not-yet-imported companies surface first</span>
                </div>

                <AttioCompaniesGrid
                  companies={attioSyncCompanies}
                  importingRecordId={importingRecordId}
                  isImported={isCompanyImported}
                  onImport={handleImportCompany}
                />
              </div>
            )}
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-bold uppercase tracking-wider text-slate-600 pl-1">
              Pending Verification Items ({pendingReviewCount})
            </h4>

            {attioEvents.filter(e => e.status === 'pending_review').length > 0 ? (
              attioEvents.filter(e => e.status === 'pending_review').map(event => {
                const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
                
                return (
                  <Card key={event.id} className="p-5 border-l-4 border-l-amber-500 bg-white hover:shadow-md transition-all">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 text-[11px] font-bold uppercase bg-amber-100 text-amber-800 rounded">
                            {event.event_type}
                          </span>
                          <span className="text-xs text-slate-400 font-mono">ID: {event.attio_event_id}</span>
                          <span className="text-xs text-slate-400">Received: {event.received_at ? formatDateTime(event.received_at) : 'Recent'}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <h4 className="text-lg font-bold text-slate-900">{payload.name || "Attio CRM Company"}</h4>
                          {payload.domain && (
                            <span className="text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-mono flex items-center gap-1">
                              <Globe className="w-3 h-3 text-slate-400" /> {payload.domain}
                            </span>
                          )}
                          {payload.country && (
                            <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-medium flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-blue-500" /> {payload.country}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-600 flex items-center gap-4">
                          <span>Attio Record UUID: <strong className="font-mono text-slate-800">{payload.record_id}</strong></span>
                          {payload.vat_guess && (
                            <span>VIES VAT Guess: <strong className="font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">{payload.vat_guess}</strong></span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0 border-t md:border-t-0 pt-3 md:pt-0 border-slate-100">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => processAttioReviewEvent(event.id, 'skip')}
                          className="text-slate-600 hover:text-red-600 hover:bg-red-50 border-slate-200"
                        >
                          Dismiss (Not a Client/Supplier)
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => {
                            if (confirm(`Accept "${payload.name}" into Orbit's verified corporate registry and bind Attio sync link?`)) {
                              processAttioReviewEvent(event.id, 'confirm');
                              notifySuccess('Imported and validated against the corporate registry.');
                            }
                          }}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20"
                        >
                          <Check className="w-4 h-4 mr-1.5" />
                          Verify & Import to Orbit Registry
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })
            ) : (
              <Card className="p-12 text-center text-slate-500 bg-slate-50/50 border-dashed">
                <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500 mb-3" />
                <h4 className="text-base font-bold text-slate-800">Review Queue is Empty!</h4>
                <p className="text-sm text-slate-500 max-w-md mx-auto mt-1">
                  All inbound CRM webhooks have been verified or dismissed. Orbit corporate registry is up to date.
                </p>
              </Card>
            )}

            {/* Recently Processed Events */}
            <h4 className="text-sm font-bold uppercase tracking-wider text-slate-600 pt-6 pl-1 border-t border-slate-200/80">
              Recently Processed Webhooks
            </h4>
            <div className="space-y-2">
              {attioEvents.filter(e => e.status !== 'pending_review').slice(0, 5).map(event => {
                const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
                return (
                  <div key={event.id} className="p-3.5 bg-white border border-slate-200/80 rounded-xl flex items-center justify-between text-xs text-slate-600">
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-0.5 rounded font-bold uppercase text-[10px] ${
                        event.status === 'processed' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {event.status}
                      </span>
                      <span className="font-bold text-slate-800">{payload.name || event.attio_event_id}</span>
                      <span className="font-mono text-slate-400">({payload.record_id})</span>
                    </div>
                    <span className="text-slate-400 font-mono">{event.processed_at ? formatDateTime(event.processed_at) : 'Resolved'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* DOSSIER DRAWER / MODAL */}
      {selectedEntity && (
        <Modal
          isOpen={true}
          onClose={() => setSelectedEntity(null)}
          title={`Corporate Registry Dossier: ${selectedEntity.legal_name}`}
          size="4xl"
        >
          <div className="space-y-6 text-sm">
            {/* Top Bar with badges */}
            <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 to-slate-800 text-white flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-400 text-lg font-black">
                  {selectedEntity.legal_name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    {selectedEntity.legal_name}
                    {selectedEntity.vat_valid && <span title="VIES Verified"><ShieldCheck className="w-5 h-5 text-emerald-400" /></span>}
                  </h2>
                  <div className="flex items-center gap-3 text-xs text-slate-300 mt-1 flex-wrap">
                    <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-slate-400" /> {selectedEntity.country}</span>
                    <span className="font-mono bg-slate-800 px-2 py-0.5 rounded border border-slate-700">ΑΦΜ/VAT: {selectedEntity.vat_number || selectedEntity.afm || 'None'}</span>
                    <button
                      type="button"
                      onClick={() => copyUuid(selectedEntity.id)}
                      className="font-mono bg-slate-800 hover:bg-slate-700 px-2.5 py-0.5 rounded border border-slate-600 text-blue-300 hover:text-blue-200 flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="Click to copy full UUID"
                    >
                      <span>UUID: {selectedEntity.id}</span>
                      {copiedId === selectedEntity.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      )}
                    </button>
                    {getRoleBadge(selectedEntity.roles)}
                    {selectedEntity.tier && (
                      <button
                        type="button"
                        onClick={() => setDossierTab('tier')}
                        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-[11px] font-black border cursor-pointer hover:brightness-110 transition-all"
                        style={{ color: selectedEntity.tier.color, borderColor: `${selectedEntity.tier.color}55`, backgroundColor: `${selectedEntity.tier.color}1a` }}
                        title={selectedEntity.tier.score !== null ? `Client tier score ${selectedEntity.tier.score}/100 — open the Client Tier tab` : 'Open the Client Tier tab'}
                      >
                        <Award className="w-3.5 h-3.5 shrink-0" />
                        {selectedEntity.tier.label}
                        {selectedEntity.tier.overridden && <Pin className="w-3 h-3 shrink-0" />}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!isEditMode && isAdmin && (
                  <Button size="sm" variant="outline" onClick={() => setIsEditMode(true)} className="text-slate-200 border-slate-600 hover:bg-slate-700">
                    <Edit3 className="w-4 h-4 mr-1.5" /> Edit Entity
                  </Button>
                )}
                {isAdmin && (
                  <Button size="sm" variant="outline" onClick={() => { setMergeOpen(true); setMergeSourceId(''); setMergeError(null); }} className="text-slate-200 border-slate-600 hover:bg-slate-700" title="Transfer a duplicate counterparty's data into this one">
                    <Merge className="w-4 h-4 mr-1.5" /> Merge Duplicate Into This
                  </Button>
                )}
                {isAdmin && (
                  <Button size="sm" variant="danger" onClick={() => {
                    if (getContractCount(selectedEntity.id) > 0) {
                      alert("Cannot archive counterparty while active contract agreements exist! Reassign or archive associated contracts first.");
                      return;
                    }
                    if (confirm(`Archive corporate record for "${selectedEntity.legal_name}"?`)) {
                      updateCounterparty({ ...selectedEntity, status: 'archived' });
                      setSelectedEntity(null);
                    }
                  }}>
                    <Trash2 className="w-4 h-4 mr-1.5" /> Archive
                  </Button>
                )}
              </div>
            </div>

            {/* Dossier Tabs */}
            <div className="flex items-center border-b border-slate-200 pb-2 space-x-6">
              <button
                type="button"
                onClick={() => setDossierTab('profile')}
                className={`pb-2.5 text-xs font-extrabold transition-all border-b-2 -mb-[9px] cursor-pointer flex items-center ${
                  dossierTab === 'profile' ? 'border-[#2f6fa3] text-[#2f6fa3]' : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <Building2 className="w-4 h-4 mr-2" /> Corporate Profile & Attio CRM Link
              </button>
              <button
                type="button"
                onClick={() => setDossierTab('invoices')}
                className={`pb-2.5 text-xs font-extrabold transition-all border-b-2 -mb-[9px] cursor-pointer flex items-center ${
                  dossierTab === 'invoices' ? 'border-[#2f6fa3] text-[#2f6fa3]' : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <Receipt className="w-4 h-4 mr-2 text-emerald-600" /> Invoices & Financial Balance
                {invoices?.filter(i => i.counterparty_id === selectedEntity.id).length > 0 && (
                  <Badge variant="info" className="ml-2 text-[11px] px-2 py-0.5">{invoices?.filter(i => i.counterparty_id === selectedEntity.id).length}</Badge>
                )}
              </button>
              <button
                type="button"
                onClick={() => setDossierTab('tier')}
                className={`pb-2.5 text-xs font-extrabold transition-all border-b-2 -mb-[9px] cursor-pointer flex items-center ${
                  dossierTab === 'tier' ? 'border-[#2f6fa3] text-[#2f6fa3]' : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <Award className="w-4 h-4 mr-2 text-indigo-600" /> Client Tier
                {selectedEntity.tier?.tier_index !== null && selectedEntity.tier?.tier_index !== undefined && (
                  <Badge variant="info" className="ml-2 text-[11px] px-2 py-0.5">Tier {selectedEntity.tier.tier_index + 1}</Badge>
                )}
              </button>
            </div>

            {dossierTab === 'tier' ? (
              <div className="pt-3 space-y-4 animate-fadeIn">
                {(() => {
                  const tier = selectedEntity.tier;
                  if (!tier) {
                    return (
                      <div className="p-8 text-center rounded-2xl border border-dashed border-slate-300 bg-slate-50">
                        <Award className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                        <p className="text-sm font-bold text-slate-600">No client tier has been computed for this entity yet</p>
                        <p className="text-xs text-slate-500 mt-1">
                          Run “Recompute Client Tiers” from the registry toolbar to score the revenue of this entity, then reopen this dossier.
                        </p>
                      </div>
                    );
                  }
                  const rawBreakdown = tier.breakdown || {};
                  const breakdown = Array.isArray(rawBreakdown)
                    ? rawBreakdown as Array<{
                        key: string; label: string; value: number | null; points: number | null;
                        weight: number; contribution: number | null; notApplicable: boolean;
                      }>
                    : [];
                  return (
                    <>
                      <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-xs">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Client Tier</span>
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-black border"
                              style={{ color: tier.color, borderColor: `${tier.color}55`, backgroundColor: `${tier.color}14` }}>
                              {tier.overridden && <Pin className="w-3.5 h-3.5 shrink-0" />}
                              {tier.label}
                            </span>
                            {tier.score !== null && (
                              <span className="font-mono text-xs text-slate-600">Score <strong className="text-slate-900">{tier.score}</strong>/100</span>
                            )}
                            {tier.overridden && (
                              <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1" title={tier.override_reason || 'Manual override'}>
                                <Pin className="w-3 h-3 inline mr-1" />
                                Pinned{tier.override_reason ? ` — ${tier.override_reason}` : ''}
                                {tier.override_expires_on ? ` · expires ${tier.override_expires_on}` : ''}
                                {tier.tier_index !== null && <span className="text-slate-500 ml-1">(computed {tier.tier_index === null ? 'Unrated' : `Tier ${tier.tier_index + 1}`})</span>}
                              </span>
                            )}
                          </div>
                          {isAdmin && (
                            <TierOverrideForm counterpartyId={selectedEntity.id} tierCount={tier.tier_count} currentOverride={tier} />
                          )}
                        </div>
                        {breakdown.length > 0 && (
                          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                            {breakdown.map(m => (
                              <div key={m.key} className={`p-2.5 rounded-xl border text-[11px] ${m.notApplicable ? 'bg-slate-50 border-slate-200' : 'bg-slate-50/60 border-slate-200'}`}>
                                <div className="font-bold text-slate-700">{m.label}</div>
                                {m.notApplicable ? (
                                  <div className="text-[10px] text-slate-400 italic mt-0.5">Not scored — insufficient data</div>
                                ) : (
                                  <div className="font-mono text-slate-600 mt-0.5">
                                    {m.value !== null ? m.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'} →
                                    <strong className="text-indigo-700"> {m.points}pts</strong>
                                    <span className="text-slate-400"> · w{m.weight}</span>
                                    {m.contribution !== null && <span className="block text-emerald-700 font-bold">+{m.contribution.toFixed(1)}</span>}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {breakdown.length === 0 && (
                          <p className="mt-3 text-xs text-slate-500 italic">This entity is scored, but the model produced no per-metric breakdown.</p>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Scores come from the configurable client tiering model (Settings → Tiering): each metric is weighted,
                        normalised to points and summed into the 0–100 score. A manual pin overrides the computed tier until it expires.
                      </p>
                    </>
                  );
                })()}
              </div>
            ) : dossierTab === 'invoices' ? (
              <div className="space-y-6 pt-2 animate-fadeIn">
                {(() => {
                  const entityInvoices = accountingInvoices((invoices || []).filter(i => i.counterparty_id === selectedEntity.id));
                  const arInvoices = entityInvoices.filter(i => i.direction === 'outgoing');
                  const apInvoices = entityInvoices.filter(i => i.direction === 'incoming');

                  const totalArGross = arInvoices.reduce((s, i) => s + i.gross_eur, 0);
                  const totalArPaid = arInvoices.reduce((s, i) => s + (i.payments || []).reduce((ps, p) => ps + p.amount, 0), 0);
                  const openAr = Math.max(0, totalArGross - totalArPaid);

                  const totalApGross = apInvoices.reduce((s, i) => s + i.gross_eur, 0);
                  const totalApPaid = apInvoices.reduce((s, i) => s + (i.payments || []).reduce((ps, p) => ps + p.amount, 0), 0);
                  const openAp = Math.max(0, totalApGross - totalApPaid);

                  return (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <Card className="p-4 bg-emerald-50/60 border-emerald-200 rounded-2xl">
                          <span className="text-xs font-bold text-emerald-800 block">Open Client AR (Receivables)</span>
                          <span className="text-2xl font-black text-emerald-900 mt-1 block font-mono">€{openAr.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                          <span className="text-[11px] text-emerald-700 font-medium">Total Issued AR: €{totalArGross.toLocaleString('en-US', { minimumFractionDigits: 0 })}</span>
                        </Card>

                        <Card className="p-4 bg-blue-50/60 border-blue-200 rounded-2xl">
                          <span className="text-xs font-bold text-blue-800 block">Open Supplier AP (Payables)</span>
                          <span className="text-2xl font-black text-blue-900 mt-1 block font-mono">€{openAp.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                          <span className="text-[11px] text-blue-700 font-medium">Total Billed AP: €{totalApGross.toLocaleString('en-US', { minimumFractionDigits: 0 })}</span>
                        </Card>

                        <Card className="p-4 bg-purple-50/60 border-purple-200 rounded-2xl">
                          <span className="text-xs font-bold text-purple-800 block">Net Financial Position</span>
                          <span className="text-2xl font-black text-purple-900 mt-1 block font-mono">
                            €{(openAr - openAp >= 0 ? '+' : '') + (openAr - openAp).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </span>
                          <span className="text-[11px] text-purple-700 font-medium">
                            {openAr > openAp ? 'Net Debtor (Client owes Orbit)' : openAp > openAr ? 'Net Creditor (Orbit owes Vendor)' : 'Balanced / Settled'}
                          </span>
                        </Card>
                      </div>

                      <div className="bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
                        <div className="p-4 bg-white border-b border-slate-200 flex items-center justify-between">
                          <div>
                            <h4 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
                              <Receipt className="w-4 h-4 text-emerald-600" />
                              Entity Tax Ledger ({entityInvoices.length} invoices)
                            </h4>
                            <p className="text-xs text-slate-500">Includes both client billing agreements and supplier operating bills</p>
                          </div>
                          <a href="/invoices" className="text-xs font-bold text-[#2f6fa3] hover:underline flex items-center gap-1">
                            <span>Open in Invoices Hub</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </a>
                        </div>

                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-100 border-b border-slate-200 font-bold text-slate-600 uppercase text-[10px] tracking-wider">
                            <tr>
                              <th className="p-3.5">Type & Direction</th>
                              <th className="p-3.5">Invoice # & MARK</th>
                              <th className="p-3.5">Issue & Due Date</th>
                              <th className="p-3.5 text-right">Gross EUR</th>
                              <th className="p-3.5 text-right">Paid Amount</th>
                              <th className="p-3.5 text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200/60 bg-white font-medium">
                            {entityInvoices.map(inv => {
                              const pAmt = (inv.payments || []).reduce((s, p) => s + p.amount, 0);
                              return (
                                <tr key={inv.id} className="hover:bg-slate-50/70 transition-colors">
                                  <td className="p-3.5">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                      inv.direction === 'outgoing' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-blue-50 text-[#2f6fa3] border border-blue-200'
                                    }`}>
                                      {inv.direction === 'outgoing' ? 'Client AR' : 'Supplier AP'}
                                    </span>
                                  </td>
                                  <td className="p-3.5">
                                    <span className="font-bold text-slate-900 font-mono block">{inv.invoice_number}</span>
                                    {inv.reference_period && (
                                      <span className="text-[10px] bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded font-mono font-bold block w-fit my-0.5">
                                        Ref: {inv.reference_period}
                                      </span>
                                    )}
                                    {inv.mark ? <span className="text-[10px] text-emerald-600 font-mono block">MARK: {inv.mark}</span> : <span className="text-[10px] text-amber-600 italic block">No MARK code</span>}
                                  </td>
                                  <td className="p-3.5 text-slate-700">
                                    <span className="block">{formatDate(inv.issue_date)}</span>
                                    <span className="text-[11px] text-slate-400">Due: {formatDate(inv.due_date)}</span>
                                  </td>
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
                            {entityInvoices.length === 0 && (
                              <tr>
                                <td colSpan={6} className="p-8 text-center text-slate-400 font-semibold italic">
                                  No invoices associated with this corporate entity yet. Open the Invoices Register to register a bill!
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
            ) : isEditMode ? (
              <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-4">
                <h4 className="font-bold text-slate-800 pb-2 border-b">Edit Corporate Attributes</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Legal Name</label>
                    <input type="text" value={editLegalName} onChange={(e) => setEditLegalName(e.target.value)} className="w-full p-2 bg-white border rounded text-slate-800 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Trade Name</label>
                    <input type="text" value={editTradeName} onChange={(e) => setEditTradeName(e.target.value)} className="w-full p-2 bg-white border rounded text-slate-800 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">VAT Number / ΑΦΜ</label>
                    <input type="text" value={editVat} onChange={(e) => setEditVat(e.target.value)} className="w-full p-2 bg-white border rounded text-slate-800 font-mono text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Country Jurisdiction</label>
                    <input type="text" value={editCountry} onChange={(e) => setEditCountry(e.target.value)} className="w-full p-2 bg-white border rounded text-slate-800 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Manual Roles</label>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {counterpartyRoles.map(roleOption => (
                        <label key={roleOption.id} className="flex items-center gap-1.5 cursor-pointer text-sm text-slate-700 bg-white border border-slate-200 px-2 py-1 rounded shadow-sm hover:bg-slate-50 transition-colors">
                          <input 
                            type="checkbox" 
                            checked={editRoles.some(r => r.id === roleOption.id)}
                            onChange={(e) => {
                              if (e.target.checked) setEditRoles([...editRoles, roleOption]);
                              else setEditRoles(editRoles.filter(r => r.id !== roleOption.id));
                            }}
                            className="rounded border-slate-300 text-[#2f6fa3] focus:ring-[#2f6fa3]"
                          />
                          <span>{roleOption.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Website Domain</label>
                    <input type="text" value={editDomain} onChange={(e) => setEditDomain(e.target.value)} placeholder="volue.com" className="w-full p-2 bg-white border rounded text-slate-800 text-sm" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Accounting & Legal Notes</label>
                    <textarea rows={2} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className="w-full p-2 bg-white border rounded text-slate-800 text-sm" />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={() => setIsEditMode(false)}>Cancel</Button>
                  <Button variant="primary" size="sm" onClick={handleSaveEdit} className="bg-[#2f6fa3] text-white">Save Attributes</Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Left: Attio CRM Link Integration */}
                <div className="md:col-span-2 space-y-6">
                  <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
                    <div className="flex items-center justify-between border-b pb-3 border-slate-200">
                      <h4 className="font-bold text-slate-900 flex items-center gap-2">
                        <RefreshCw className="w-4 h-4 text-[#2f6fa3]" />
                        Attio CRM Bidirectional Synchronization
                      </h4>
                      <span className="text-[11px] text-slate-500 font-mono">Object: companies</span>
                    </div>

                    {selectedEntity.attio_link?.link_status === 'linked' ? (
                      <div className="space-y-4">
                        <div className="p-3.5 bg-blue-50/60 border border-blue-200/80 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-600 text-white rounded-lg shadow-sm">
                              <Check className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                                Active CRM Sync Established
                                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-extrabold">Connected</span>
                              </div>
                              <div className="text-xs font-mono text-slate-600">Attio ID: {selectedEntity.attio_link.attio_record_id}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <a
                              href={`https://app.attio.com/stellar-blue/company/${selectedEntity.attio_link.attio_record_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold bg-[#2f6fa3] hover:bg-blue-600 text-white rounded-xl shadow-md shadow-blue-500/20 transition-all no-underline shrink-0"
                            >
                              <span>Open in Attio CRM</span>
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => {
                                if (confirm("Unlink this entity from Attio CRM? Future contract financial rollups will no longer push automatically.")) {
                                  linkToAttio(selectedEntity.id, "");
                                  setSelectedEntity(prev => prev ? { ...prev, attio_link: { ...prev.attio_link!, link_status: 'unlinked' } } : null);
                                }
                              }}
                              className="text-red-600 border-red-200 hover:bg-red-50 py-2 h-auto text-xs"
                            >
                              <Unlink className="w-3.5 h-3.5 mr-1" /> Unlink
                            </Button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div className="p-3 bg-white rounded-xl border border-slate-200/80">
                            <span className="text-slate-400 uppercase font-semibold text-[10px]">Orbit-Owned ARR Rollup</span>
                            <div className="text-base font-black text-emerald-600 font-mono mt-1">
                              €{getContractArr(selectedEntity.id).toLocaleString()}/yr
                            </div>
                            <span className="text-[10px] text-slate-400">Master field pushed to CRM</span>
                          </div>
                          <div className="p-3 bg-white rounded-xl border border-slate-200/80">
                            <span className="text-slate-400 uppercase font-semibold text-[10px]">Last Sync Checkpoint</span>
                            <div className="text-sm font-bold text-slate-800 mt-1">
                              {selectedEntity.attio_link.last_outbound_at ? formatDateTime(selectedEntity.attio_link.last_outbound_at) : 'Up to date'}
                            </div>
                            <span className="text-[10px] text-blue-500 font-semibold">Ready for next scheduled push</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 bg-amber-50/50 border border-amber-200/80 rounded-xl space-y-3">
                        <div className="flex items-center gap-2 text-amber-800 font-semibold text-sm">
                          <AlertTriangle className="w-4 h-4 text-amber-600" />
                          No Attio CRM link is established for this entity.
                        </div>
                        <p className="text-xs text-slate-600">
                          To link manually, provide the Attio Company Record ID or click quick auto-bind to register an outbound link.
                        </p>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={linkRecordId}
                            onChange={(e) => setLinkRecordId(e.target.value)}
                            placeholder="e.g. attio_rec_volue_01"
                            className="flex-1 p-2 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-800"
                          />
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => {
                              const rec = linkRecordId.trim() || `attio_rec_${selectedEntity.id.slice(0, 6)}`;
                              linkToAttio(selectedEntity.id, rec);
                              setSelectedEntity(prev => prev ? { ...prev, attio_link: { id: 'l1', counterparty_id: prev.id, attio_record_id: rec, link_status: 'linked' } } : null);
                              notifySuccess('Attio relationship linked.');
                            }}
                            className="bg-[#2f6fa3] text-white shrink-0"
                          >
                            <LinkIcon className="w-3.5 h-3.5 mr-1.5" /> Bind Attio Record
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Associated Agreements list */}
                  <div className="space-y-3">
                    <h4 className="font-bold text-slate-800 text-sm flex items-center justify-between">
                      <span>Associated Agreements ({getContractCount(selectedEntity.id)})</span>
                      <span className="text-xs text-slate-400 font-normal">Active agreements determine relationship role</span>
                    </h4>
                    
                    <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-2xl bg-white overflow-hidden">
                      {contracts.filter(c => c.counterparty_id === selectedEntity.id).length > 0 ? (
                        contracts.filter(c => c.counterparty_id === selectedEntity.id).map(cnt => (
                          <Link
                            key={cnt.id}
                            href={`/contracts/${cnt.id}`}
                            className="p-3.5 flex items-center justify-between hover:bg-blue-50/50 transition-colors group"
                            title={`Open contract ${cnt.reference} in the Contract Registry`}
                          >
                            <div>
                              <div className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                <span className="text-[#2f6fa3] group-hover:underline">{cnt.reference}</span>
                                <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#2f6fa3] transition-colors" />
                                <span className={`px-2 py-0.5 text-[10px] uppercase font-bold rounded ${
                                  cnt.direction === 'revenue' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                                }`}>
                                  {cnt.direction === 'revenue' ? 'Revenue (Client)' : 'Cost (Supplier)'}
                                </span>
                              </div>
                              <div className="text-xs text-slate-500 mt-0.5">
                                {cnt.product || cnt.type} • Status: <strong className="uppercase font-semibold text-slate-700">{cnt.status}</strong>
                              </div>
                            </div>
                            <div className="text-right">
                              {(() => {
                                const val = getContractVal(cnt);
                                return val.netARR > 0 ? (
                                  <>
                                    <div className="font-mono font-bold text-slate-900">€{val.netARR.toLocaleString(undefined, { maximumFractionDigits: 0 })}<span className="text-[11px] text-slate-400">/yr</span></div>
                                    <div className="text-[11px] text-slate-400 font-mono">{cnt.billing_cadence} · ARR</div>
                                  </>
                                ) : (
                                  <>
                                    <div className="font-mono font-bold text-slate-900">€{(val.oneTimeValue || cnt.value || 0).toLocaleString()}<span className="text-[11px] text-slate-400">/yr</span></div>
                                    <div className="text-[11px] text-slate-400 font-mono">one-off</div>
                                  </>
                                );
                              })()}
                            </div>
                          </Link>
                        ))
                      ) : (
                        <div className="p-6 text-center text-slate-400 text-xs">
                          No active contracts linked to this counterparty yet. Register agreements in the Contract Management Registry.
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Column: Contact Persons Directory */}
                <div className="space-y-4">
                  <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-4 h-full">
                    <h4 className="font-bold text-slate-900 flex items-center gap-2 border-b pb-3 border-slate-200">
                      <Users className="w-4 h-4 text-[#2f6fa3]" />
                      Corporate People Directory
                    </h4>

                    <div className="space-y-2.5 max-h-[280px] overflow-y-auto">
                      {(selectedEntity.contacts && selectedEntity.contacts.length > 0) ? (
                        selectedEntity.contacts.map((ct: any) => (
                          <div key={ct.id} className="p-3 bg-white border border-slate-200/80 rounded-xl space-y-1 text-xs">
                            <div className="font-bold text-slate-800 text-sm">{ct.name}</div>
                            {ct.role && <div className="text-slate-500 font-medium">{ct.role}</div>}
                            {ct.email && <div className="text-blue-600 font-mono">{ct.email}</div>}
                            {ct.phone && <div className="text-slate-600 font-mono">{ct.phone}</div>}
                            <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-100 flex items-center gap-1 font-mono">
                              Attio Person ID: {ct.attio_person_id || 'unlinked'}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-6 text-slate-400 text-xs border border-dashed border-slate-200 rounded-xl bg-white">
                          No contact persons listed.
                        </div>
                      )}
                    </div>

                    {/* Add Contact form */}
                    {isAdmin && (
                      <form onSubmit={async (e) => {
                        e.preventDefault();
                        if (!contactName.trim()) return;
                        const ok = await addCounterpartyContact({
                          counterparty_id: selectedEntity.id,
                          name: contactName.trim(),
                          email: contactEmail.trim() || undefined,
                          role: contactRole.trim() || undefined,
                          phone: contactPhone.trim() || undefined
                        });
                        if (ok) {
                          setContactName(""); setContactEmail(""); setContactRole(""); setContactPhone("");
                          setSelectedEntity(prev => prev ? { 
                            ...prev, 
                            contacts: [...(prev.contacts || []), { id: 'tmp_'+Date.now(), counterparty_id: prev.id, name: contactName, email: contactEmail, role: contactRole, phone: contactPhone }] 
                          } : null);
                        }
                      }} className="pt-4 border-t border-slate-200 space-y-2.5">
                        <span className="text-xs font-bold text-slate-700 block">Add Designated Representative</span>
                        <input
                          type="text"
                          required
                          placeholder="Full Name *"
                          value={contactName}
                          onChange={e => setContactName(e.target.value)}
                          className="w-full p-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-800"
                        />
                        <input
                          type="text"
                          placeholder="Role (e.g. Head of Trading / Legal)"
                          value={contactRole}
                          onChange={e => setContactRole(e.target.value)}
                          className="w-full p-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-800"
                        />
                        <input
                          type="email"
                          placeholder="Corporate Email"
                          value={contactEmail}
                          onChange={e => setContactEmail(e.target.value)}
                          className="w-full p-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-800"
                        />
                        <Button type="submit" size="sm" variant="outline" className="w-full justify-center text-slate-700 bg-white hover:bg-blue-50 border-slate-300">
                          <Plus className="w-3 h-3 mr-1" /> Save Contact Person
                        </Button>
                      </form>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* MERGE DUPLICATE COUNTERPARTY MODAL */}
      {mergeOpen && selectedEntity && (() => {
        const source = mergeSourceId ? counterparties.find(c => c.id === mergeSourceId) || null : null;
        const sourceContacts = source?.contacts?.length || 0;
        const sourceContracts = contracts.filter(c => c.counterparty_id === mergeSourceId).length;
        const sourceInvoices = (invoices || []).filter(i => i.counterparty_id === mergeSourceId).length;
        return (
          <Modal isOpen onClose={() => setMergeOpen(false)} title="Merge Duplicate Counterparty" size="3xl">
            <div className="space-y-5 text-sm">
              <p className="text-xs text-slate-500">
                Pick the <strong>duplicate</strong> counterparty whose data should be transferred into{' '}
                <strong className="text-emerald-700">{selectedEntity.legal_name}</strong>. All contacts, contracts,
                invoices, Attio link and tier data move over; the duplicate record is then deleted. This cannot be undone.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                {/* SOURCE (duplicate) */}
                <div className="p-4 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50">
                  <div className="text-[10px] uppercase font-black text-rose-600 bg-rose-100 px-2 py-0.5 rounded-full mb-3 w-fit">Duplicate — will be deleted</div>
                  <CounterpartyPicker value={mergeSourceId} onChange={setMergeSourceId} placeholder="Search the duplicate entity…" allowClear />
                  {source && (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-[11px] space-y-1.5">
                      <div className="font-extrabold text-slate-900 text-xs">{source.legal_name} <span className="text-slate-400 font-mono font-normal">({source.vat_number || source.afm || 'no VAT'} · {source.country})</span></div>
                      <div className="text-emerald-700 font-mono">→ {sourceContacts} contact(s) will transfer</div>
                      <div className="text-emerald-700 font-mono">→ {sourceContracts} contract(s) will transfer</div>
                      <div className="text-emerald-700 font-mono">→ {sourceInvoices} invoice(s) will transfer</div>
                      <div className="text-emerald-700 font-mono">→ {source.attio_link?.link_status === 'linked' ? 'Attio link (moves only if the target has none)' : 'No Attio link'}</div>
                    </div>
                  )}
                </div>

                {/* TARGET (kept) */}
                <div className="p-4 rounded-2xl border-2 border-emerald-300 bg-emerald-50/60">
                  <div className="text-[10px] uppercase font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full mb-3 w-fit">Kept — receives everything</div>
                  <div className="font-extrabold text-slate-900">{selectedEntity.legal_name}</div>
                  <div className="text-[11px] text-slate-500 font-mono">{selectedEntity.vat_number || selectedEntity.afm || 'No VAT'} · {selectedEntity.country}</div>
                  <div className="mt-3 rounded-xl border border-emerald-200 bg-white p-3 text-[11px] space-y-1.5">
                    <div className="font-mono text-slate-600">Already holds: {selectedEntity.contacts?.length || 0} contact(s) · {contracts.filter(c => c.counterparty_id === selectedEntity.id).length} contract(s) · {(invoices || []).filter(i => i.counterparty_id === selectedEntity.id).length} invoice(s)</div>
                    <div className="text-slate-500">Missing profile fields (VAT, domain, address, notes…) are filled from the duplicate.</div>
                  </div>
                </div>
              </div>

              {mergeError && (
                <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{mergeError}</div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => setMergeOpen(false)}>Cancel</Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={!source || merging || mergeSourceId === selectedEntity.id}
                  onClick={async () => {
                    if (!source || mergeSourceId === selectedEntity.id) return;
                    setMerging(true);
                    setMergeError(null);
                    const res = await mergeCounterparties(selectedEntity.id, mergeSourceId);
                    setMerging(false);
                    if (!res.ok) {
                      setMergeError(res.error || 'Merge failed.');
                      return;
                    }
                    const counts = res.counts || {};
                    notifySuccess(`Merged "${source.legal_name}" into "${selectedEntity.legal_name}" — ${(counts.invoices as number) || 0} invoice(s), ${(counts.contracts as number) || 0} contract(s), ${(counts.contacts as number) || 0} contact(s) transferred.`);
                    setMergeOpen(false);
                    setMergeSourceId('');
                    setSelectedEntity(null);
                    setTimeout(() => window.location.reload(), 900);
                  }}
                  className="bg-rose-600 text-white"
                >
                  <Merge className="w-4 h-4 mr-1.5" /> {merging ? 'Merging…' : 'Merge Into This'}
                </Button>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* NEW ENTITY MODAL */}
      {showNewModal && (
        <Modal isOpen={true} onClose={() => setShowNewModal(false)} title="Register Corporate Counterparty Entity" size="xl">
          <form onSubmit={handleCreateNew} className="space-y-4 text-xs text-slate-700">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block font-semibold uppercase text-slate-500 mb-1">Legal Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required
                  value={newLegalName}
                  onChange={e => setNewLegalName(e.target.value)}
                  placeholder="e.g. Volue AS or DEPA COMMERCIAL S.A."
                  className="w-full p-2 bg-white border border-slate-300 rounded text-sm text-slate-800 focus:outline-none focus:border-[#2f6fa3]"
                />
              </div>
              <div>
                <label className="block font-semibold uppercase text-slate-500 mb-1">Trade Name (Optional)</label>
                <input
                  type="text"
                  value={newTradeName}
                  onChange={e => setNewTradeName(e.target.value)}
                  placeholder="e.g. Volue / ΔΕΠΑ"
                  className="w-full p-2 bg-white border border-slate-300 rounded text-sm text-slate-800"
                />
              </div>
              <div>
                <label className="block font-semibold uppercase text-slate-500 mb-1">Jurisdiction Country</label>
                <select
                  value={newCountry}
                  onChange={e => setNewCountry(e.target.value)}
                  className="w-full p-2 bg-white border border-slate-300 rounded text-sm text-slate-800"
                >
                  <option value="Greece">Greece (GR)</option>
                  <option value="Norway">Norway (NO)</option>
                  <option value="Germany">Germany (DE)</option>
                  <option value="United Kingdom">United Kingdom (UK)</option>
                  <option value="Cyprus">Cyprus (CY)</option>
                  <option value="United States">United States (US)</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold uppercase text-slate-500 mb-1">VAT Number / ΑΦΜ</label>
                <input
                  type="text"
                  value={newVat}
                  onChange={e => setNewVat(e.target.value)}
                  placeholder="090123456"
                  className="w-full p-2 bg-white border border-slate-300 rounded font-mono text-sm text-slate-800"
                />
              </div>
              <div>
                <label className="block font-semibold uppercase text-slate-500 mb-1">Website Domain</label>
                <input
                  type="text"
                  value={newDomain}
                  onChange={e => setNewDomain(e.target.value)}
                  placeholder="volue.com"
                  className="w-full p-2 bg-white border border-slate-300 rounded text-sm text-slate-800"
                />
              </div>
              <div className="col-span-2">
                <label className="block font-semibold uppercase text-slate-500 mb-1">Roles</label>
                <div className="flex flex-wrap gap-2 pt-1">
                  {counterpartyRoles.map(roleOption => (
                    <label key={roleOption.id} className="flex items-center gap-1.5 cursor-pointer text-sm text-slate-700 bg-white border border-slate-200 px-3 py-1.5 rounded shadow-sm hover:bg-slate-50 transition-colors">
                      <input 
                        type="checkbox" 
                        checked={newRoles.some(r => r.id === roleOption.id)}
                        onChange={(e) => {
                          if (e.target.checked) setNewRoles([...newRoles, roleOption]);
                          else setNewRoles(newRoles.filter(r => r.id !== roleOption.id));
                        }}
                        className="rounded border-slate-300 text-[#2f6fa3] focus:ring-[#2f6fa3] w-4 h-4"
                      />
                      <span>{roleOption.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="col-span-2">
                <label className="block font-semibold uppercase text-slate-500 mb-1">Internal Accounting Notes</label>
                <textarea
                  rows={2}
                  value={newNotes}
                  onChange={e => setNewNotes(e.target.value)}
                  className="w-full p-2 bg-white border border-slate-300 rounded text-sm text-slate-800"
                />
              </div>
            </div>

            <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-xl flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-800 block text-sm">Bind Attio CRM Link on Create</span>
                <span className="text-slate-500 text-xs">Orbit will synchronize ARR rollups and renewal dates automatically.</span>
              </div>
              <input
                type="checkbox"
                checked={syncToAttio}
                onChange={e => setSyncToAttio(e.target.checked)}
                className="w-5 h-5 text-[#2f6fa3] rounded cursor-pointer"
              />
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t">
              <Button type="button" variant="outline" onClick={() => setShowNewModal(false)}>Cancel</Button>
              <Button type="submit" variant="primary" className="bg-[#2f6fa3] text-white">
                <Check className="w-4 h-4 mr-1.5" /> Save to Registry
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
