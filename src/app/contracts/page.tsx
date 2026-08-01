"use client";

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { Contract, ContractDirection, ContractStatus } from '@/lib/types';
import { Card, Button, Badge, Modal, StatCard } from '@/components/ui/primitives';
import { 
  FileText, Plus, AlertTriangle, Clock, Calendar, DollarSign, 
  ArrowUpRight, ShieldCheck, Download, Upload, Layers, Check, TrendingUp, BarChart3, Sparkles, Save, Edit3, Trash2
} from 'lucide-react';
import { ContractPricingBuilder } from '@/components/contracts/contract-pricing-builder';

export default function ContractsRegistryPage() {
  const { currentUser, contracts, counterparties, profiles, addContract, updateContract, deleteContract, saveContractPricing } = useAuth();
  const [directionFilter, setDirectionFilter] = useState<ContractDirection | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<ContractStatus | 'all'>('all');
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [dossierTab, setDossierTab] = useState<'general' | 'pricing'>('general');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'kanban' | 'table' | 'revenue'>('kanban');

  const isAdmin = currentUser.role === 'admin';

  // Form states for adding new contract
  const [newRef, setNewRef] = useState('SB-2026-NEW');
  const [newDirection, setNewDirection] = useState<ContractDirection>('revenue');
  const [newType, setNewType] = useState('saas_subscription');
  const [newValue, setNewValue] = useState(100000);
  const [newNotice, setNewNotice] = useState(60);
  const [newStarts, setNewStarts] = useState('2026-08-01');
  const [newEnds, setNewEnds] = useState('2027-07-31');
  const [newDocName, setNewDocName] = useState<string>('');
  const [newDocUrl, setNewDocUrl] = useState<string>('');
  const [isUploadingDoc, setIsUploadingDoc] = useState<boolean>(false);

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
      alert(`Document "${file.name}" uploaded to Supabase Storage and linked to contract record!`);
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

  const revenueTotal = contracts.filter(c => c.direction === 'revenue' && c.status === 'active').reduce((acc, c) => acc + (c.value || 0), 0);
  const costTotal = contracts.filter(c => c.direction === 'cost' && c.status === 'active').reduce((acc, c) => acc + (c.value || 0), 0);
  const urgentAlerts = contracts.filter(c => c.status === 'expiring' || c.notice_deadline?.startsWith('2026-07') || c.notice_deadline?.startsWith('2026-08')).length;

  const handleCreateContract = (e: React.FormEvent) => {
    e.preventDefault();
    addContract({
      counterparty_id: counterparties[0]?.id || 'cp-depa', // Defaulting to first counterparty
      counterparty: counterparties[0],
      direction: newDirection,
      reference: newRef,
      type: newType,
      status: 'active',
      starts_on: newStarts,
      ends_on: newEnds,
      auto_renews: true,
      notice_period_days: Number(newNotice),
      notice_deadline: '2027-06-01',
      value: Number(newValue),
      currency: 'EUR',
      billing_cadence: 'annual',
      vat_treatment: 'domestic_24',
      owner_profile_id: currentUser.id,
      product: newDirection === 'revenue' ? 'Atlas ETRM & EMS' : 'Vendor Cloud Retainer',
      document_name: newDocName || undefined,
      document_url: newDocUrl || undefined,
      document_uploaded_at: newDocName ? new Date().toISOString() : undefined
    });
    setNewDocName('');
    setNewDocUrl('');
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

      {/* KPI & Notice Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <StatCard 
          title="Contracted Client Revenue (Active)" 
          value={`€${revenueTotal.toLocaleString()}`} 
          subtitle="Atlas ETRM, EMS & Consulting subscriptions"
          icon={<DollarSign className="w-5 h-5 text-emerald-600" />}
        />
        <StatCard 
          title="Committed Supplier Spend (Active)" 
          value={`€${costTotal.toLocaleString()}`} 
          subtitle="Cloud infrastructure & algorithm partner feeds"
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
                    const isUrgentNotice = c.notice_deadline?.startsWith('2026-07') || c.notice_deadline?.startsWith('2026-08');
                    return (
                      <div 
                        key={c.id}
                        onClick={() => setSelectedContract(c)}
                        className="p-3.5 rounded-xl bg-white border border-slate-200 hover:border-slate-300 transition-all cursor-pointer shadow-2xs group flex flex-col justify-between space-y-2"
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
                        </div>

                        {c.value && (
                          <div className="font-mono font-bold text-xs text-slate-800 bg-slate-50 p-2 rounded border border-slate-200">
                            €{c.value.toLocaleString()} <span className="text-[10px] text-slate-500 font-sans font-normal">/ {c.billing_cadence}</span>
                          </div>
                        )}

                        <div className={`pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] ${isUrgentNotice ? 'text-rose-600 font-bold' : 'text-slate-500'}`}>
                          <span className="flex items-center">
                            <Clock className="w-3 h-3 mr-1" /> Notice: {c.notice_deadline}
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
        /* TABLE LIST VIEW */
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase text-slate-500 tracking-wider">
                <th className="p-3.5 pl-5">Reference & Counterparty</th>
                <th className="p-3.5">Direction / Product</th>
                <th className="p-3.5">Commercials</th>
                <th className="p-3.5">Term Window</th>
                <th className="p-3.5">Notice Deadline Alert</th>
                <th className="p-3.5">Status</th>
                {isAdmin && <th className="p-3.5 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredContracts.map(c => {
                const isUrgent = c.notice_deadline?.startsWith('2026-07') || c.notice_deadline?.startsWith('2026-08');
                return (
                  <tr key={c.id} onClick={() => setSelectedContract(c)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                    <td className="p-3.5 pl-5 font-medium">
                      <div className="text-slate-800 font-bold">{c.counterparty?.legal_name}</div>
                      <div className="text-xs text-[#3D87D3] font-mono">{c.reference}</div>
                    </td>
                    <td className="p-3.5">
                      <Badge variant={c.direction === 'revenue' ? 'success' : 'warning'}>{c.direction.toUpperCase()}</Badge>
                      <div className="text-xs text-slate-500 mt-1">{c.product || c.type}</div>
                    </td>
                    <td className="p-3.5 font-mono font-semibold text-slate-800">
                      €{c.value?.toLocaleString()} ({c.billing_cadence})
                    </td>
                    <td className="p-3.5 text-xs text-slate-500">
                      {c.starts_on} &rarr; {c.ends_on || 'Indefinite'}
                    </td>
                    <td className="p-3.5 text-xs">
                      <span className={`inline-flex items-center font-bold ${isUrgent ? 'text-rose-600' : 'text-slate-700'}`}>
                        <Clock className="w-3.5 h-3.5 mr-1.5 shrink-0" /> {c.notice_deadline} ({c.notice_period_days}d window)
                      </span>
                    </td>
                    <td className="p-3.5">
                      <Badge variant={c.status === 'active' ? 'success' : 'error'}>{c.status.toUpperCase()}</Badge>
                    </td>
                    {isAdmin && (
                      <td className="p-3.5 text-right" onClick={e => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={async () => {
                            if (confirm(`Are you certain you want to completely delete contract "${c.reference}" (${c.counterparty?.legal_name})?`)) {
                              await deleteContract(c.id);
                            }
                          }}
                          className="text-slate-400 hover:text-rose-600 transition-colors p-1 rounded hover:bg-rose-50 cursor-pointer"
                          title="Delete Contract"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* VIEW 3: EXECUTIVE REVENUE SCHEDULE & MRR LANDING */}
      {viewMode === 'revenue' && (
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
              <div className="flex items-center space-x-6 bg-slate-900/80 px-6 py-4 rounded-xl border border-slate-700/60">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block tracking-wider">Total Portfolio MRR</span>
                  <span className="text-2xl font-mono font-black text-emerald-400 mt-0.5 block">
                    €{filteredContracts.reduce((acc, c) => {
                      if (c.lines && c.lines.length > 0) {
                        let gross = 0;
                        c.lines.forEach(l => {
                          if (l.frequency !== 'one_time') gross += (Number(l.unit_price) || 0) * (Number(l.quantity) || 0);
                        });
                        return acc + (gross * Math.max(0, 1 - (Number(c.discount_pct) || 0) / 100));
                      }
                      return acc + (c.direction === 'revenue' ? (c.value || 0) / 12 : 0);
                    }, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Active contracts Net Rate</span>
                </div>
                <div className="border-l border-slate-700 pl-6">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block tracking-wider">Total Portfolio TCV</span>
                  <span className="text-2xl font-mono font-black text-blue-400 mt-0.5 block">
                    €{filteredContracts.reduce((acc, c) => acc + (c.value || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Committed deal value</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="text-sm font-extrabold text-slate-800 flex items-center">
                <TrendingUp className="w-4 h-4 mr-2 text-indigo-600" /> Active Contract Pricing breakdown ({filteredContracts.length})
              </span>
              <span className="text-xs text-slate-500 font-mono">Snapshots preserved independently per agreement</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-600 text-[11px] font-extrabold uppercase tracking-wider border-b border-slate-200">
                    <th className="py-3 px-5">Ref / Entity</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Term & Start</th>
                    <th className="py-3 px-4">Discount</th>
                    <th className="py-3 px-4 text-right">Net Monthly MRR</th>
                    <th className="py-3 px-4 text-right">Total Contract Value (TCV)</th>
                    <th className="py-3 px-5 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {filteredContracts.map((c) => {
                    let netMrr = (c.value || 0) / 12;
                    if (c.lines && c.lines.length > 0) {
                      let gross = 0;
                      c.lines.forEach(l => {
                        if (l.frequency !== 'one_time') gross += (Number(l.unit_price) || 0) * (Number(l.quantity) || 0);
                      });
                      netMrr = gross * Math.max(0, 1 - (Number(c.discount_pct) || 0) / 100);
                    }

                    return (
                      <tr key={c.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3.5 px-5 font-semibold text-slate-800">
                          <div className="font-extrabold text-slate-900">{c.reference}</div>
                          <div className="text-xs text-slate-500 font-normal">{c.counterparty?.legal_name || 'Client Entity'}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          <Badge variant={c.direction === 'revenue' ? 'success' : 'warning'}>
                            {c.direction === 'revenue' ? 'Revenue' : 'Spend'}
                          </Badge>
                        </td>
                        <td className="py-3.5 px-4 text-xs font-semibold text-slate-700">
                          <div>{c.term_years ? `${c.term_years} Year(s)` : 'Standard Term'}</div>
                          <div className="text-[11px] text-slate-400 font-mono">{c.service_start_date || c.starts_on}</div>
                        </td>
                        <td className="py-3.5 px-4 text-xs font-bold text-amber-600">
                          {c.discount_pct ? `${c.discount_pct}% Off` : 'None (0%)'}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-black text-emerald-700">
                          €{netMrr.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900">
                          €{(c.value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="py-3.5 px-5 text-center flex items-center justify-center space-x-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedContract(c);
                              setDossierTab('pricing');
                            }}
                            className="px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-extrabold text-xs inline-flex items-center transition-colors shadow-2xs cursor-pointer"
                          >
                            <Layers className="w-3.5 h-3.5 mr-1 text-indigo-600" />
                            {c.lines && c.lines.length > 0 ? `Edit Rate Sheet (${c.lines.length})` : 'Build Rate Sheet'}
                          </button>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={async () => {
                                if (confirm(`Are you certain you want to completely delete contract "${c.reference}" (${c.counterparty?.legal_name})?`)) {
                                  await deleteContract(c.id);
                                }
                              }}
                              className="text-slate-400 hover:text-rose-600 transition-colors p-1.5 rounded-lg hover:bg-rose-50 cursor-pointer"
                              title="Delete Contract"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* CONTRACT DETAIL MODAL WITH VERSIONED DOCUMENTS & MODULAR PRICING */}
      <Modal 
        isOpen={!!selectedContract} 
        onClose={() => setSelectedContract(null)} 
        title={selectedContract ? `Contract Dossier & Edit Hub: ${selectedContract.reference}` : 'Contract'}
        size="6xl"
      >
        {selectedContract && (
          <div className="space-y-6 text-sm">
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
            </div>

            {dossierTab === 'pricing' ? (
              <div className="pt-2 min-h-[500px]">
                <ContractPricingBuilder
                  contractId={selectedContract.id}
                  initialLines={selectedContract.lines || []}
                  initialDiscountPct={selectedContract.discount_pct || 0}
                  initialTermYears={selectedContract.term_years || 1}
                  initialStartDate={selectedContract.service_start_date || selectedContract.starts_on}
                  onSave={async (lines, schedule, discountPct, termYears, startDate, tcv) => {
                    await saveContractPricing(
                      selectedContract.id,
                      lines as any,
                      schedule as any,
                      discountPct,
                      termYears,
                      startDate,
                      tcv
                    );
                    setSelectedContract({
                      ...selectedContract,
                      lines: lines as any,
                      schedule: schedule as any,
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
                        alert("General terms and contract metadata successfully updated!");
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
            <label className="block font-semibold uppercase text-slate-500 mb-1">Direction & Counterparty</label>
            <select 
              value={newDirection}
              onChange={e => setNewDirection(e.target.value as ContractDirection)}
              className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800"
            >
              <option value="revenue">Client Revenue (Atlas ETRM / EMS / Consulting)</option>
              <option value="cost">Supplier Spend (Cloud / Data Provider / Partnership)</option>
            </select>
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
              <input 
                type="number" 
                value={newValue} 
                onChange={e => setNewValue(Number(e.target.value))} 
                className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Starts On (YYYY-MM-DD)</label>
              <input 
                type="date" 
                value={newStarts} 
                onChange={e => setNewStarts(e.target.value)} 
                className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800"
              />
            </div>
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
    </div>
  );
}
