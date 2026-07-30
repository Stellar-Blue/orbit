"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Search, Users, FileText, Calendar, ArrowRight, CornerDownLeft } from 'lucide-react';
import { Modal } from '@/components/ui/primitives';

export const CommandMenu: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const router = useRouter();
  const { profiles, contracts } = useAuth();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const filteredProfiles = profiles.filter(p => 
    `${p.first_name} ${p.last_name} ${p.name_el} ${p.work_email} ${p.title}`.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 4);

  const filteredContracts = contracts.filter(c => 
    `${c.reference} ${c.counterparty?.legal_name} ${c.product}`.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 3);

  const navigate = (path: string) => {
    setIsOpen(false);
    setQuery('');
    router.push(path);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-xl rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        <div className="flex items-center px-4 py-3 border-b border-slate-800 bg-slate-950">
          <Search className="w-5 h-5 text-slate-400 mr-3 shrink-0" />
          <input
            type="text"
            autoFocus
            placeholder="Type a command, employee name, or contract reference (ESC to exit)..."
            className="w-full bg-transparent text-slate-200 text-sm focus:outline-none placeholder:text-slate-500"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        <div className="p-3 max-h-96 overflow-y-auto space-y-4 text-sm">
          {query.trim() === '' ? (
            <div className="text-xs text-slate-500 p-2 text-center">
              Start typing to search across StellarBlue directory, contracts registry, and modules...
            </div>
          ) : null}

          {/* Quick Links */}
          <div>
            <div className="px-2 pb-1.5 text-[10px] uppercase font-bold text-slate-400 tracking-wider">Navigation</div>
            <div className="space-y-1">
              <button onClick={() => navigate('/people')} className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-800/80 text-slate-300 hover:text-white transition-colors cursor-pointer">
                <span className="flex items-center"><Users className="w-4 h-4 mr-2.5 text-emerald-400" /> Go to People Directory</span>
                <CornerDownLeft className="w-3.5 h-3.5 text-slate-500" />
              </button>
              <button onClick={() => navigate('/contracts')} className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-800/80 text-slate-300 hover:text-white transition-colors cursor-pointer">
                <span className="flex items-center"><FileText className="w-4 h-4 mr-2.5 text-indigo-400" /> Go to Contracts Registry</span>
                <CornerDownLeft className="w-3.5 h-3.5 text-slate-500" />
              </button>
              <button onClick={() => navigate('/leave')} className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-800/80 text-slate-300 hover:text-white transition-colors cursor-pointer">
                <span className="flex items-center"><Calendar className="w-4 h-4 mr-2.5 text-amber-400" /> Go to Leave Management</span>
                <CornerDownLeft className="w-3.5 h-3.5 text-slate-500" />
              </button>
            </div>
          </div>

          {/* People Matches */}
          {filteredProfiles.length > 0 && (
            <div>
              <div className="px-2 pb-1.5 text-[10px] uppercase font-bold text-slate-400 tracking-wider">StellarBlue Team Members</div>
              <div className="space-y-1">
                {filteredProfiles.map(p => (
                  <button key={p.id} onClick={() => navigate('/people')} className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-800/80 text-left transition-colors cursor-pointer">
                    <div>
                      <p className="text-slate-200 font-medium">{p.first_name} {p.last_name} (<span className="text-slate-400 text-xs">{p.name_el}</span>)</p>
                      <p className="text-xs text-slate-400">{p.title} &bull; {p.work_email}</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-500" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Contract Matches */}
          {filteredContracts.length > 0 && (
            <div>
              <div className="px-2 pb-1.5 text-[10px] uppercase font-bold text-slate-400 tracking-wider">Contracts Registry</div>
              <div className="space-y-1">
                {filteredContracts.map(c => (
                  <button key={c.id} onClick={() => navigate('/contracts')} className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-800/80 text-left transition-colors cursor-pointer">
                    <div>
                      <p className="text-slate-200 font-medium">{c.reference} &mdash; {c.counterparty?.legal_name}</p>
                      <p className="text-xs text-slate-400">{c.product || c.type} &bull; {c.status.toUpperCase()}</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-500" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
