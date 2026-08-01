"use client";

import React, { useState, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Counterparty, AttioLink, CounterpartyContact } from '@/lib/types';
import { CounterpartyPicker } from '@/components/counterparties/counterparty-picker';
import { Card, Button, Badge, Modal, StatCard } from '@/components/ui/primitives';
import { 
  Building2, Search, RefreshCw, ShieldCheck, Plus, Check, ExternalLink, 
  AlertTriangle, ArrowUpRight, Users, Link as LinkIcon, Unlink, FileText, 
  Filter, Sparkles, Globe, MapPin, Trash2, Edit3, CheckCircle2, AlertCircle, HelpCircle
} from 'lucide-react';

export default function CounterpartiesRegistryPage() {
  const { 
    counterparties, contracts, attioEvents, addCounterparty, updateCounterparty, 
    linkToAttio, processAttioReviewEvent, reconcileAttio, reassignContracts, 
    addCounterpartyContact, currentUser 
  } = useAuth();

  const [activeTab, setActiveTab] = useState<'registry' | 'queue' | 'repair'>('registry');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [selectedEntity, setSelectedEntity] = useState<Counterparty | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);

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

  // Attio manual link inputs
  const [linkRecordId, setLinkRecordId] = useState("");

  // New Contact person inputs
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactRole, setContactRole] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  // Data Repair State
  const [repairSourceCpId, setRepairSourceCpId] = useState<string>("");
  const [repairTargetCpId, setRepairTargetCpId] = useState<string>("");
  const [selectedContractIds, setSelectedContractIds] = useState<string[]>([]);

  const isAdmin = currentUser.role === 'admin';

  // Default repair source to DEPA if present
  const depaEntity = useMemo(() => {
    return counterparties.find(c => c.legal_name?.toLowerCase().includes('depa') || c.trade_name?.toLowerCase().includes('депа') || c.trade_name?.toLowerCase().includes('depa') || c.id === 'cp-depa');
  }, [counterparties]);

  React.useEffect(() => {
    if (depaEntity && !repairSourceCpId) {
      setRepairSourceCpId(depaEntity.id);
    } else if (!repairSourceCpId && counterparties.length > 0) {
      setRepairSourceCpId(counterparties[0].id);
    }
  }, [depaEntity, counterparties, repairSourceCpId]);

  // KPIs
  const totalEntities = counterparties.filter(c => c.status !== 'archived').length;
  const clientCount = counterparties.filter(c => c.status !== 'archived' && (c.derived_role === 'client' || c.derived_role === 'both')).length;
  const supplierCount = counterparties.filter(c => c.status !== 'archived' && (c.derived_role === 'supplier' || c.derived_role === 'both')).length;
  const linkedCount = counterparties.filter(c => c.status !== 'archived' && c.attio_link?.link_status === 'linked').length;
  const pendingReviewCount = attioEvents.filter(e => e.status === 'pending_review').length;

  const filteredRegistry = useMemo(() => {
    return counterparties.filter(cp => {
      if (roleFilter === 'clients' && cp.derived_role !== 'client' && cp.derived_role !== 'both') return false;
      if (roleFilter === 'suppliers' && cp.derived_role !== 'supplier' && cp.derived_role !== 'both') return false;
      if (roleFilter === 'both' && cp.derived_role !== 'both') return false;
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
      notes: editNotes.trim()
    });
    if (success) {
      setSelectedEntity(prev => prev ? { ...prev, legal_name: editLegalName, trade_name: editTradeName, vat_number: editVat, afm: editVat, country: editCountry, website_domain: editDomain, notes: editNotes } : null);
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
      status: 'active'
    });
    setShowNewModal(false);
    setNewLegalName(""); setNewTradeName(""); setNewVat(""); setNewDomain(""); setNewNotes("");
  };

  const getRoleBadge = (role?: string) => {
    switch(role) {
      case 'client': return <Badge variant="info">Client</Badge>;
      case 'supplier': return <Badge variant="warning">Supplier</Badge>;
      case 'both': return <Badge variant="info" className="bg-purple-500/10 text-purple-600 border border-purple-300">Client & Supplier</Badge>;
      default: return <Badge variant="neutral">No Contracts Yet</Badge>;
    }
  };

  const getContractArr = (cpId: string) => {
    const cpContracts = contracts.filter(c => c.counterparty_id === cpId && c.status === 'active' && c.direction === 'revenue');
    return cpContracts.reduce((sum, c) => {
      let val = c.value || 0;
      if (c.billing_cadence === 'monthly') val = val * 12;
      else if (c.billing_cadence === 'quarterly') val = val * 4;
      return sum + val;
    }, 0);
  };

  const getContractCount = (cpId: string) => {
    return contracts.filter(c => c.counterparty_id === cpId && c.status === 'active').length;
  };

  // Contracts for repair tab
  const repairSourceContracts = useMemo(() => {
    return contracts.filter(c => c.counterparty_id === repairSourceCpId);
  }, [contracts, repairSourceCpId]);

  const handleToggleSelectContract = (id: string) => {
    setSelectedContractIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleSelectAllRepair = () => {
    if (selectedContractIds.length === repairSourceContracts.length) {
      setSelectedContractIds([]);
    } else {
      setSelectedContractIds(repairSourceContracts.map(c => c.id));
    }
  };

  const handleExecuteRepair = async () => {
    if (selectedContractIds.length === 0) {
      alert("Please check at least one contract to reassign.");
      return;
    }
    if (!repairTargetCpId || repairTargetCpId === repairSourceCpId) {
      alert("Please select a different target counterparty to reassign these contracts to.");
      return;
    }
    const targetCp = counterparties.find(c => c.id === repairTargetCpId);
    if (confirm(`Are you sure you want to reassign ${selectedContractIds.length} contract(s) from "${counterparties.find(c => c.id === repairSourceCpId)?.legal_name}" to "${targetCp?.legal_name}"?`)) {
      const success = await reassignContracts(repairSourceCpId, selectedContractIds, repairTargetCpId);
      if (success) {
        setSelectedContractIds([]);
        setRepairTargetCpId("");
        alert("Contracts successfully reassigned! Financial rollups and derived relationship roles updated.");
      }
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Header & KPI Summary */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200/80 pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-[#3D87D3] to-indigo-600 text-white shadow-md shadow-blue-500/20">
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
              onClick={handleReconcile}
              disabled={isReconciling}
              className="bg-white hover:bg-slate-50 border-slate-200 text-slate-700 shadow-sm"
            >
              <RefreshCw className={`w-4 h-4 mr-2 text-[#3D87D3] ${isReconciling ? 'animate-spin' : ''}`} />
              {isReconciling ? "Reconciling Rollups..." : "Run Nightly Reconciliation"}
            </Button>
          )}
          {isAdmin && (
            <Button 
              onClick={() => setShowNewModal(true)} 
              size="sm"
              className="bg-gradient-to-r from-[#3D87D3] to-indigo-600 hover:from-blue-600 hover:to-indigo-500 text-white shadow-md shadow-blue-500/20"
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
          icon={<RefreshCw className="w-5 h-5 text-[#3D87D3]" />}
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
              ? 'text-[#3D87D3] font-semibold border-b-2 border-[#3D87D3]'
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
              ? 'text-[#3D87D3] font-semibold border-b-2 border-[#3D87D3]'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Sparkles className="w-4 h-4 text-amber-500" />
          Attio CRM Inbound Queue
          {pendingReviewCount > 0 && (
            <span className="ml-1.5 px-2 py-0.5 text-[10px] rounded-full bg-amber-100 text-amber-700 font-extrabold animate-bounce">{pendingReviewCount}</span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('repair')}
          className={`pb-3 px-5 text-sm font-medium transition-all relative cursor-pointer flex items-center gap-2 ${
            activeTab === 'repair'
              ? 'text-indigo-600 font-semibold border-b-2 border-indigo-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <RefreshCw className="w-4 h-4 text-indigo-500" />
          Data Repair & Contract Reassigner
          <span className="ml-1.5 px-2 py-0.5 text-[10px] rounded-full bg-indigo-50 text-indigo-700 font-semibold">Utility</span>
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
                className="w-full pl-10 pr-4 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#3D87D3] focus:ring-2 focus:ring-[#3D87D3]/10 transition-all shadow-2xs"
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
                      ? 'bg-[#3D87D3] text-white shadow-xs'
                      : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200/80 text-[11px] uppercase font-bold text-slate-500 bg-slate-50/50">
                  <th className="p-4 pl-6">Legal / Trade Name</th>
                  <th className="p-4">Jurisdiction</th>
                  <th className="p-4">VAT (ΑΦΜ) / VIES Status</th>
                  <th className="p-4">Derived Relationship Role</th>
                  <th className="p-4">Active Agreements & ARR</th>
                  <th className="p-4">Attio CRM Status</th>
                  <th className="p-4 pr-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredRegistry.length > 0 ? (
                  filteredRegistry.map(cp => {
                    const activeCount = getContractCount(cp.id);
                    const arr = getContractArr(cp.id);
                    const isLinked = cp.attio_link?.link_status === 'linked';

                    return (
                      <tr 
                        key={cp.id} 
                        onClick={() => openDossier(cp)}
                        className="hover:bg-blue-50/30 transition-colors cursor-pointer group"
                      >
                        <td className="p-4 pl-6 font-medium text-slate-900">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-[#3D87D3] font-bold text-xs shrink-0 group-hover:bg-[#3D87D3] group-hover:text-white transition-all">
                              {cp.legal_name.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-bold text-slate-800 group-hover:text-[#3D87D3] transition-colors flex items-center gap-1.5">
                                {cp.legal_name}
                                {cp.is_internal && <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">INTERNAL JV</span>}
                              </div>
                              <div className="text-xs text-slate-500 flex items-center gap-1">
                                {cp.trade_name && cp.trade_name !== cp.legal_name ? (
                                  <span>Trade: <strong className="text-slate-700 font-normal">{cp.trade_name}</strong></span>
                                ) : (
                                  <span>{cp.website_domain || "No domain registered"}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="p-4 text-slate-600 font-medium">
                          <span className="inline-flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded text-xs text-slate-700">
                            <MapPin className="w-3 h-3 text-slate-500" />
                            {cp.country}
                          </span>
                        </td>
                        <td className="p-4">
                          {cp.vat_number || cp.afm ? (
                            <div className="flex items-center gap-1.5 font-mono text-xs text-slate-800 font-semibold bg-slate-100/80 px-2.5 py-1 rounded-md border border-slate-200 w-fit">
                              <span>{cp.vat_number || cp.afm}</span>
                              {cp.vat_valid && (
                                <span title="VIES Verified Natural Key"><ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" /></span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400 font-mono">Unregistered</span>
                          )}
                        </td>
                        <td className="p-4">
                          {getRoleBadge(cp.derived_role)}
                        </td>
                        <td className="p-4">
                          <div className="flex flex-col">
                            <span className="text-xs font-semibold text-slate-800">{activeCount} active agreements</span>
                            {arr > 0 ? (
                              <span className="text-xs font-bold text-emerald-600 font-mono">€{arr.toLocaleString()}/yr ARR</span>
                            ) : (
                              <span className="text-[11px] text-slate-400 font-mono">No active revenue</span>
                            )}
                          </div>
                        </td>
                        <td className="p-4" onClick={e => e.stopPropagation()}>
                          {isLinked ? (
                            <a
                              href={`https://app.attio.com/companies/${cp.attio_link?.attio_record_id || cp.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-extrabold bg-gradient-to-r from-blue-50 via-cyan-50 to-indigo-50 hover:from-blue-100 hover:to-cyan-100 text-blue-700 hover:text-blue-900 border border-blue-200/80 rounded-full transition-all shadow-2xs group/link cursor-pointer"
                              title={`Click to open Attio CRM profile (${cp.attio_link?.attio_record_id})`}
                            >
                              <RefreshCw className="w-3.5 h-3.5 text-blue-600 group-hover/link:rotate-180 transition-transform duration-500" />
                              <span>Attio Linked</span>
                              <ExternalLink className="w-3.5 h-3.5 ml-0.5 text-blue-500 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 transition-transform" />
                            </a>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-slate-100 text-slate-500 border border-slate-200 rounded-full">
                              <Unlink className="w-3.5 h-3.5 text-slate-400" />
                              Unlinked
                            </span>
                          )}
                        </td>
                        <td className="p-4 pr-6 text-right" onClick={e => e.stopPropagation()}>
                          <Button size="sm" variant="outline" onClick={() => openDossier(cp)}>
                            Manage Dossier
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="text-center py-16 text-slate-500">
                      <Building2 className="w-10 h-10 mx-auto mb-3 text-slate-300 animate-pulse" />
                      <p className="text-base font-semibold text-slate-700">No counterparties found matching current filter</p>
                      <p className="text-xs text-slate-400 mt-1">Try resetting your search query or register a new corporate entity.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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
                          <span className="text-xs text-slate-400">Received: {event.received_at ? new Date(event.received_at).toLocaleString() : 'Recent'}</span>
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
                              alert("Successfully imported and validated against corporate registry!");
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
                    <span className="text-slate-400 font-mono">{event.processed_at ? new Date(event.processed_at).toLocaleString() : 'Resolved'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: DATA REPAIR (THE ΔΕΠΑ SITUATION) */}
      {activeTab === 'repair' && (
        <div className="space-y-6">
          <Card className="p-6 bg-gradient-to-r from-indigo-900 via-slate-900 to-indigo-950 text-white border-indigo-500/30 shadow-xl rounded-2xl">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 rounded-2xl shrink-0 mt-0.5">
                <RefreshCw className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  Bulk Contract Reassignment & Registry Data Repair Utility
                </h3>
                <p className="text-sm text-indigo-200 mt-1 max-w-3xl leading-relaxed">
                  Previously, contract registration defaulted to the first database entity (often <strong>DEPA COMMERCIAL S.A.</strong>) when no counterparty was explicitly selected. Use this utility to inspect agreements currently assigned to a source entity and batch reassign them to their genuine Client or Supplier record.
                </p>
                <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-400/20 text-xs font-semibold text-indigo-200">
                  <Check className="w-4 h-4 text-emerald-400" />
                  Automatically recomputes ARR rollups, active counts, and relationship roles upon transfer.
                </div>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Step 1: Select Source & Contracts */}
            <div className="lg:col-span-2 space-y-4">
              <Card className="p-5 border-slate-200/80 shadow-sm">
                <div className="flex items-center justify-between mb-4 border-b pb-3 border-slate-100">
                  <h4 className="font-bold text-slate-800 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs flex items-center justify-center font-extrabold">1</span>
                    Select Source Entity to Clean Up
                  </h4>
                  <select
                    value={repairSourceCpId}
                    onChange={(e) => { setRepairSourceCpId(e.target.value); setSelectedContractIds([]); }}
                    className="bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:border-[#3D87D3]"
                  >
                    {counterparties.map(cp => (
                      <option key={cp.id} value={cp.id}>
                        {cp.legal_name} ({getContractCount(cp.id)} agreements)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
                  <span>Showing agreements under {counterparties.find(c => c.id === repairSourceCpId)?.legal_name}</span>
                  <button
                    type="button"
                    onClick={handleSelectAllRepair}
                    className="text-indigo-600 font-semibold hover:underline"
                  >
                    {selectedContractIds.length === repairSourceContracts.length && repairSourceContracts.length > 0 ? "Deselect All" : "Select All"}
                  </button>
                </div>

                <div className="divide-y divide-slate-100 max-h-[380px] overflow-y-auto border border-slate-200/80 rounded-xl">
                  {repairSourceContracts.length > 0 ? (
                    repairSourceContracts.map(c => {
                      const isChecked = selectedContractIds.includes(c.id);
                      return (
                        <div
                          key={c.id}
                          onClick={() => handleToggleSelectContract(c.id)}
                          className={`p-3.5 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                            isChecked ? 'bg-indigo-50/70 border-l-4 border-l-indigo-600' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-0 cursor-pointer"
                            />
                            <div className="min-w-0">
                              <div className="font-bold text-slate-800 text-sm truncate flex items-center gap-2">
                                {c.reference}
                                <span className={`px-2 py-0.5 text-[10px] uppercase font-bold rounded ${
                                  c.direction === 'revenue' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                                }`}>
                                  {c.direction === 'revenue' ? 'Client Rev' : 'Supplier Cost'}
                                </span>
                              </div>
                              <div className="text-xs text-slate-500 truncate mt-0.5">
                                {c.product || c.type} • Ends on {c.ends_on || 'Indefinite'}
                              </div>
                            </div>
                          </div>
                          <div className="text-right font-mono font-bold text-slate-900 text-sm shrink-0">
                            €{(c.value || 0).toLocaleString()}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-10 text-center text-slate-400 text-sm">
                      <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                      No contracts associated with this entity. Clean slate!
                    </div>
                  )}
                </div>
              </Card>
            </div>

            {/* Step 2: Pick Target & Transfer */}
            <div className="space-y-4">
              <Card className="p-6 border-slate-200/80 shadow-sm bg-slate-50/50 flex flex-col justify-between h-full min-h-[340px]">
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-800 flex items-center gap-2 pb-3 border-b border-slate-200">
                    <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-extrabold">2</span>
                    Assign to True Counterparty
                  </h4>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-500 mb-2">
                      Target Entity Registry Lookup
                    </label>
                    <CounterpartyPicker
                      value={repairTargetCpId}
                      onChange={(val) => setRepairTargetCpId(val)}
                      placeholder="Search or add correct entity..."
                    />
                  </div>

                  <div className="p-3 bg-white border border-slate-200 rounded-xl text-xs space-y-2">
                    <div className="flex justify-between font-medium text-slate-600">
                      <span>Selected Agreements:</span>
                      <span className="font-bold text-indigo-600">{selectedContractIds.length}</span>
                    </div>
                    <div className="flex justify-between font-medium text-slate-600">
                      <span>Total Value to Transfer:</span>
                      <span className="font-bold font-mono text-slate-800">
                        €{repairSourceContracts.filter(c => selectedContractIds.includes(c.id)).reduce((a, b) => a + (b.value || 0), 0).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-6">
                  <Button
                    variant="primary"
                    disabled={selectedContractIds.length === 0 || !repairTargetCpId || repairTargetCpId === repairSourceCpId}
                    onClick={handleExecuteRepair}
                    className="w-full py-3 bg-gradient-to-r from-indigo-600 to-[#3D87D3] hover:from-indigo-700 hover:to-blue-600 text-white font-bold shadow-lg shadow-indigo-500/25 justify-center"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Execute Reassignment ({selectedContractIds.length})
                  </Button>
                </div>
              </Card>
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
                    {getRoleBadge(selectedEntity.derived_role)}
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

            {/* General Info / Edit Form */}
            {isEditMode ? (
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
                  <Button variant="primary" size="sm" onClick={handleSaveEdit} className="bg-[#3D87D3] text-white">Save Attributes</Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Left: Attio CRM Link Integration */}
                <div className="md:col-span-2 space-y-6">
                  <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
                    <div className="flex items-center justify-between border-b pb-3 border-slate-200">
                      <h4 className="font-bold text-slate-900 flex items-center gap-2">
                        <RefreshCw className="w-4 h-4 text-[#3D87D3]" />
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
                              href={`https://app.attio.com/companies/${selectedEntity.attio_link.attio_record_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold bg-[#3D87D3] hover:bg-blue-600 text-white rounded-xl shadow-md shadow-blue-500/20 transition-all no-underline shrink-0"
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
                              {selectedEntity.attio_link.last_outbound_at ? new Date(selectedEntity.attio_link.last_outbound_at).toLocaleString() : 'Up to date'}
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
                              alert("Attio relationship bound successfully!");
                            }}
                            className="bg-[#3D87D3] text-white shrink-0"
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
                          <div key={cnt.id} className="p-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                            <div>
                              <div className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                {cnt.reference}
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
                              <div className="font-mono font-bold text-slate-900">€{(cnt.value || 0).toLocaleString()}</div>
                              <div className="text-[11px] text-slate-400 font-mono">{cnt.billing_cadence}</div>
                            </div>
                          </div>
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
                      <Users className="w-4 h-4 text-[#3D87D3]" />
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
                  className="w-full p-2 bg-white border border-slate-300 rounded text-sm text-slate-800 focus:outline-none focus:border-[#3D87D3]"
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
                className="w-5 h-5 text-[#3D87D3] rounded cursor-pointer"
              />
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t">
              <Button type="button" variant="outline" onClick={() => setShowNewModal(false)}>Cancel</Button>
              <Button type="submit" variant="primary" className="bg-[#3D87D3] text-white">
                <Check className="w-4 h-4 mr-1.5" /> Save to Registry
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
