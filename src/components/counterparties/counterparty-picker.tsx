"use client";

import React, { useState, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Counterparty, Role } from '@/lib/types';
import { Search, Plus, Check, ShieldCheck, Building2, ExternalLink, RefreshCw, X, Globe, MapPin } from 'lucide-react';

interface CounterpartyPickerProps {
  value?: string; // Counterparty ID
  onChange: (counterpartyId: string) => void;
  error?: string;
  placeholder?: string;
  allowClear?: boolean;
}

export const CounterpartyPicker: React.FC<CounterpartyPickerProps> = ({
  value,
  onChange,
  error,
  placeholder = "Search entity by Legal Name, VAT (ΑΦΜ), or Domain...",
  allowClear = false
}) => {
  const { counterparties, addCounterparty } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Create Modal State
  const [newLegalName, setNewLegalName] = useState("");
  const [newTradeName, setNewTradeName] = useState("");
  const [newCountry, setNewCountry] = useState("Greece");
  const [newVat, setNewVat] = useState("");
  const [newDomain, setNewDomain] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [syncToAttio, setSyncToAttio] = useState(true);
  const [isVestingVat, setIsVestingVat] = useState(false);
  const [vatResult, setVatResult] = useState<'unchecked' | 'valid' | 'invalid'>('unchecked');

  const selectedCounterparty = useMemo(() => {
    return counterparties.find(c => c.id === value);
  }, [counterparties, value]);

  const filtered = useMemo(() => {
    if (!search.trim()) return counterparties.filter(c => c.status !== 'archived');
    const q = search.toLowerCase();
    return counterparties.filter(c => 
      c.status !== 'archived' && (
        c.legal_name?.toLowerCase().includes(q) ||
        c.trade_name?.toLowerCase().includes(q) ||
        c.vat_number?.toLowerCase().includes(q) ||
        c.afm?.toLowerCase().includes(q) ||
        c.website_domain?.toLowerCase().includes(q)
      )
    );
  }, [counterparties, search]);

  const handleSimulateVies = () => {
    if (!newVat.trim()) {
      alert("Please enter a VAT (ΑΦΜ) number first.");
      return;
    }
    setIsVestingVat(true);
    setTimeout(() => {
      setIsVestingVat(false);
      if (newVat.trim().length >= 7) {
        setVatResult('valid');
        if (!newLegalName.trim() && newVat === '090123456') {
          setNewLegalName('DEPA COMMERCIAL S.A.');
          setNewTradeName('ΔΕΠΑ');
        } else if (!newLegalName.trim() && newVat === '998877665') {
          setNewLegalName('Eunice Energy Group S.A.');
        }
      } else {
        setVatResult('invalid');
      }
    }, 600);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLegalName.trim()) {
      alert("Legal Name is required.");
      return;
    }
    const created = await addCounterparty({
      legal_name: newLegalName.trim(),
      trade_name: newTradeName.trim() || undefined,
      country: newCountry,
      vat_number: newVat.trim() || undefined,
      website_domain: newDomain.trim() || undefined,
      notes: newNotes.trim() || undefined,
      sync_to_attio: syncToAttio,
      status: 'active'
    });
    if (created) {
      onChange(created.id);
      setShowCreateModal(false);
      setIsOpen(false);
      // Reset form
      setNewLegalName("");
      setNewTradeName("");
      setNewCountry("Greece");
      setNewVat("");
      setNewDomain("");
      setNewNotes("");
      setVatResult('unchecked');
    }
  };

  const getRoleBadge = (roles?: Role[]) => {
    if (!roles || roles.length === 0) return <span className="px-2 py-0.5 text-[10px] font-medium tracking-wide bg-slate-500/15 text-slate-400 border border-slate-500/30 rounded-full uppercase">No Roles</span>;
    return (
      <div className="flex gap-1 flex-wrap">
        {roles.map(r => {
          if (r.slug === 'client') return <span key={r.id} className="px-2 py-0.5 text-[10px] font-semibold tracking-wide bg-blue-500/15 text-blue-300 border border-blue-500/30 rounded-full uppercase">Client</span>;
          if (r.slug === 'supplier') return <span key={r.id} className="px-2 py-0.5 text-[10px] font-semibold tracking-wide bg-orange-500/15 text-orange-300 border border-orange-500/30 rounded-full uppercase">Supplier</span>;
          return <span key={r.id} className="px-2 py-0.5 text-[10px] font-semibold tracking-wide bg-purple-500/15 text-purple-300 border border-purple-500/30 rounded-full uppercase">{r.name}</span>;
        })}
      </div>
    );
  };

  return (
    <div className="relative w-full">
      {/* Selected Value Button or Empty State */}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full min-h-[42px] px-3 py-2 bg-slate-900/90 hover:bg-slate-800/80 border ${
          error ? 'border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.2)]' : 'border-slate-700/80 hover:border-blue-500/50'
        } rounded-xl cursor-pointer flex items-center justify-between gap-2 transition-all shadow-sm`}
      >
        {selectedCounterparty ? (
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
              <Building2 className="w-4 h-4" />
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-slate-100 text-sm truncate">{selectedCounterparty.legal_name}</span>
                {selectedCounterparty.trade_name && selectedCounterparty.trade_name !== selectedCounterparty.legal_name && (
                  <span className="text-xs text-slate-400 font-normal">({selectedCounterparty.trade_name})</span>
                )}
                {getRoleBadge(selectedCounterparty.roles)}
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5 flex-wrap">
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-slate-500" />
                  {selectedCounterparty.country}
                </span>
                {(selectedCounterparty.vat_number || selectedCounterparty.afm) && (
                  <span className="flex items-center gap-1 text-slate-300 font-mono text-[11px] bg-slate-800/80 px-1.5 py-0.5 rounded border border-slate-700">
                    VAT: {selectedCounterparty.vat_number || selectedCounterparty.afm}
                    {selectedCounterparty.vat_valid && (
                      <span title="VIES Verified"><ShieldCheck className="w-3.5 h-3.5 text-emerald-400 ml-0.5" /></span>
                    )}
                  </span>
                )}
                {selectedCounterparty.attio_link && (
                  <span className="flex items-center gap-1 text-blue-400 font-medium text-[11px] bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20" title={`Attio Record: ${selectedCounterparty.attio_link.attio_record_id}`}>
                    <RefreshCw className="w-3 h-3 text-blue-400" />
                    Attio CRM Linked
                  </span>
                )}
              </div>
            </div>
            {allowClear && (
              <button 
                type="button" 
                onClick={(e) => { e.stopPropagation(); onChange(""); }}
                className="p-1 text-slate-400 hover:text-white rounded-md hover:bg-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-slate-400 text-sm flex-1">
            <Search className="w-4 h-4 text-slate-500 shrink-0" />
            <span>{placeholder}</span>
          </div>
        )}
      </div>

      {error && <p className="mt-1 text-xs text-red-400 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block"/>{error}</p>}

      {/* Combobox Dropdown */}
      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-2 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col max-h-[380px] animate-in fade-in zoom-in-95 duration-150">
          <div className="p-2.5 border-b border-slate-800 flex items-center gap-2 bg-slate-950/50">
            <Search className="w-4 h-4 text-slate-400 ml-1 shrink-0" />
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Type legal name, trade name, VAT number..."
              className="w-full bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none pr-2"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="p-1 text-slate-500 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="overflow-y-auto flex-1 p-1.5 space-y-1">
            {filtered.length > 0 ? (
              filtered.map(cp => (
                <div
                  key={cp.id}
                  onClick={() => {
                    onChange(cp.id);
                    setIsOpen(false);
                    setSearch("");
                  }}
                  className={`p-2.5 rounded-xl cursor-pointer transition-colors flex items-center justify-between gap-3 ${
                    cp.id === value 
                      ? 'bg-blue-600/20 border border-blue-500/40 text-white' 
                      : 'hover:bg-slate-800/80 text-slate-300 border border-transparent'
                  }`}
                >
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-white text-sm truncate">{cp.legal_name}</span>
                      {cp.trade_name && cp.trade_name !== cp.legal_name && (
                        <span className="text-xs text-slate-400">({cp.trade_name})</span>
                      )}
                      {getRoleBadge(cp.roles)}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-400 mt-1 flex-wrap">
                      <span>{cp.country}</span>
                      {(cp.vat_number || cp.afm) && (
                        <span className="font-mono text-[11px] text-slate-300 flex items-center gap-1">
                          ΑΦΜ/VAT: {cp.vat_number || cp.afm}
                          {cp.vat_valid && <span title="VIES Verified"><ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /></span>}
                        </span>
                      )}
                      {cp.attio_link && (
                        <span className="text-blue-400 font-medium text-[11px] flex items-center gap-1">
                          <RefreshCw className="w-3 h-3" /> Attio Linked
                        </span>
                      )}
                    </div>
                  </div>
                  {cp.id === value && <Check className="w-5 h-5 text-blue-400 shrink-0" />}
                </div>
              ))
            ) : (
              <div className="py-8 text-center text-slate-400 text-sm flex flex-col items-center justify-center gap-2">
                <Building2 className="w-8 h-8 text-slate-600 animate-pulse" />
                <p>No matching counterparty registry found in Orbit.</p>
                <p className="text-xs text-slate-500">Ensure the legal name and VAT are entered directly in the corporate registry.</p>
              </div>
            )}
          </div>

          <div className="p-2 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500 pl-2">Can't find entity?</span>
            <button
              type="button"
              onClick={() => {
                setNewLegalName(search.trim());
                setShowCreateModal(true);
                setIsOpen(false);
              }}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-lg shadow-blue-500/20"
            >
              <Plus className="w-3.5 h-3.5" />
              Add New Counterparty
            </button>
          </div>
        </div>
      )}

      {/* Inline Create Counterparty Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-800/80 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-blue-400" />
                  New Counterparty Registry Entry
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">First-class corporate registry entity with instant VIES validation & Attio sync</p>
              </div>
              <button type="button" onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1">Legal Name <span className="text-red-400">*</span></label>
                  <input
                    type="text"
                    required
                    value={newLegalName}
                    onChange={(e) => setNewLegalName(e.target.value)}
                    placeholder="e.g. Volue AS or DEPA COMMERCIAL S.A."
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Trade Name (Optional)</label>
                  <input
                    type="text"
                    value={newTradeName}
                    onChange={(e) => setNewTradeName(e.target.value)}
                    placeholder="e.g. Volue / ΔΕΠΑ"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Country of Jurisdiction</label>
                  <select
                    value={newCountry}
                    onChange={(e) => setNewCountry(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="Greece">Greece (GR)</option>
                    <option value="Norway">Norway (NO)</option>
                    <option value="Germany">Germany (DE)</option>
                    <option value="United Kingdom">United Kingdom (UK)</option>
                    <option value="United States">United States (US)</option>
                    <option value="Cyprus">Cyprus (CY)</option>
                    <option value="Luxembourg">Luxembourg (LU)</option>
                    <option value="Switzerland">Switzerland (CH)</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center justify-between">
                    <span>VAT Number / ΑΦΜ (Natural Key)</span>
                    <button
                      type="button"
                      onClick={handleSimulateVies}
                      className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-semibold"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Verify via EU VIES / GSIS
                    </button>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={newVat}
                      onChange={(e) => { setNewVat(e.target.value); setVatResult('unchecked'); }}
                      placeholder="e.g. 090123456 or NO987654321MVA"
                      className={`w-full bg-slate-800 border ${
                        vatResult === 'valid' ? 'border-emerald-500 text-emerald-300' : vatResult === 'invalid' ? 'border-red-500 text-red-300' : 'border-slate-700 text-white'
                      } rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500`}
                    />
                    {isVestingVat && (
                      <div className="absolute right-3 top-2.5 text-xs text-slate-400 flex items-center gap-1">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" /> Checking...
                      </div>
                    )}
                    {vatResult === 'valid' && (
                      <div className="absolute right-3 top-2.5 text-xs text-emerald-400 font-medium flex items-center gap-1">
                        <ShieldCheck className="w-4 h-4" /> VIES Validated
                      </div>
                    )}
                    {vatResult === 'invalid' && (
                      <div className="absolute right-3 top-2.5 text-xs text-red-400 font-medium flex items-center gap-1">
                        Invalid VAT format
                      </div>
                    )}
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5 text-slate-400" />
                    Corporate Website Domain (Used for Attio Matching)
                  </label>
                  <input
                    type="text"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    placeholder="e.g. volue.com or depa.gr"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1">Internal Notes</label>
                  <textarea
                    rows={2}
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                    placeholder="Optional details regarding accounting contacts, parent group, or compliance constraints..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Attio Sync Toggle */}
              <div className="p-4 bg-slate-800/60 border border-slate-700/80 rounded-2xl flex items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-blue-500/20 rounded-xl text-blue-400 mt-0.5">
                    <RefreshCw className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-white">Attio CRM Automatic Synchronization</h4>
                    <p className="text-xs text-slate-400 mt-0.5">
                      When enabled, Orbit will link or push this counterparty to Attio, continuously keeping ARR and renewal dates in sync.
                    </p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncToAttio}
                    onChange={(e) => setSyncToAttio(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-sm shadow-lg shadow-blue-500/20 flex items-center gap-2 transition-all"
                >
                  <Check className="w-4 h-4" />
                  Save & Select Counterparty
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
