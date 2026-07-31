"use client";

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Contract, ContractDirection, ContractStatus } from '@/lib/types';
import { Card, Button, Badge, Modal, StatCard } from '@/components/ui/primitives';
import { 
  FileText, Plus, AlertTriangle, Clock, Calendar, DollarSign, 
  ArrowUpRight, ShieldCheck, Download, Upload, Layers, Check 
} from 'lucide-react';

export default function ContractsRegistryPage() {
  const { currentUser, contracts, counterparties, profiles, addContract } = useAuth();
  const [directionFilter, setDirectionFilter] = useState<ContractDirection | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<ContractStatus | 'all'>('all');
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban');

  const isAdmin = currentUser.role === 'admin';

  // Form states for adding new contract
  const [newRef, setNewRef] = useState('SB-2026-NEW');
  const [newDirection, setNewDirection] = useState<ContractDirection>('revenue');
  const [newType, setNewType] = useState('saas_subscription');
  const [newValue, setNewValue] = useState(100000);
  const [newNotice, setNewNotice] = useState(60);
  const [newStarts, setNewStarts] = useState('2026-08-01');
  const [newEnds, setNewEnds] = useState('2027-07-31');

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
      product: newDirection === 'revenue' ? 'Atlas ETRM & EMS' : 'Vendor Cloud Retainer'
    });
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
                            <span className="font-mono text-slate-400">{c.reference}</span>
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* CONTRACT DETAIL MODAL WITH VERSIONED DOCUMENTS */}
      <Modal 
        isOpen={!!selectedContract} 
        onClose={() => setSelectedContract(null)} 
        title={selectedContract ? `Contract Dossier: ${selectedContract.reference}` : 'Contract'}
      >
        {selectedContract && (
          <div className="space-y-5 text-sm">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold uppercase text-slate-400 block">Counterparty Entity</span>
                <span className="text-lg font-bold text-slate-800">{selectedContract.counterparty?.legal_name}</span>
                <span className="text-xs text-slate-500 block mt-0.5">ΑΦΜ: <strong className="text-slate-700 font-mono">{selectedContract.counterparty?.afm || 'Unspecified'}</strong> &bull; Country: {selectedContract.counterparty?.country}</span>
              </div>
              <Badge variant={selectedContract.direction === 'revenue' ? 'success' : 'warning'} className="text-xs py-1">
                {selectedContract.direction === 'revenue' ? 'Client Revenue' : 'Supplier Spend'}
              </Badge>
            </div>

            {/* Notice Window High-ROI Warning Box */}
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 space-y-2">
              <div className="flex items-center justify-between text-rose-900 font-bold text-sm">
                <span className="flex items-center"><AlertTriangle className="w-4 h-4 mr-2 text-rose-600" /> Notice Deadline Alert Trigger</span>
                <span>{selectedContract.notice_deadline}</span>
              </div>
              <p className="text-xs text-rose-800">
                This contract auto-renews with a required <strong className="font-extrabold">{selectedContract.notice_period_days}-day notice period</strong> prior to its end date ({selectedContract.ends_on}). Missing this window locks in auto-renewal spend or subscription term!
              </p>
            </div>

            {/* Key Clauses & Notes */}
            <div className="space-y-2">
              <span className="text-xs uppercase font-bold text-slate-400 tracking-wider">Key Clauses & Legal Notes</span>
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 leading-relaxed font-mono">
                {selectedContract.notes || 'Standard terms apply. No custom indemnities or liability caps flagged.'}
              </div>
            </div>

            {/* Supabase Signed URL PDF Documents Simulation */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase font-bold text-slate-400 tracking-wider">Versioned Signed Documents</span>
                <Button size="sm" variant="outline" className="text-[11px] py-1 cursor-pointer">
                  <Upload className="w-3 h-3 mr-1" /> Upload PDF to Private Storage
                </Button>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2.5">
                  <FileText className="w-5 h-5 text-[#3D87D3]" />
                  <div>
                    <p className="font-semibold text-slate-800">{selectedContract.reference}_v1_signed.pdf</p>
                    <p className="text-[10px] text-slate-500">Encrypted in Supabase Storage · Signed URL (60s access)</p>
                  </div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => alert('Generated short-lived server signed URL for private PDF access.')}>
                  <Download className="w-3.5 h-3.5 mr-1" /> Download PDF
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* CREATE CONTRACT MODAL */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Register New Contract">
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

          <div className="pt-3 flex justify-end space-x-2">
            <Button variant="outline" size="sm" type="button" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" type="submit">Save to Registry &rarr;</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
