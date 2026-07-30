"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { 
  Users, FileText, Calendar, Globe, DollarSign, 
  ShieldCheck, LayoutDashboard, Search, ChevronDown, 
  Sparkles, CheckCircle2, AlertTriangle, Building2, Sliders, LogOut 
} from 'lucide-react';
import { Badge } from '@/components/ui/primitives';

export const Sidebar: React.FC = () => {
  const pathname = usePathname();
  const { currentUser, profiles, switchUser, isDevMode, signOut } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const isContractor = currentUser.employment_type === 'contractor';
  const isAdmin = currentUser.role === 'admin';

  const navItems = [
    { label: 'Dashboard', path: '/', icon: <LayoutDashboard className="w-4 h-4 mr-3 text-blue-400" />, show: true },
    { label: 'People Directory', path: '/people', icon: <Users className="w-4 h-4 mr-3 text-emerald-400" />, show: true },
    { label: 'Contracts Registry', path: '/contracts', icon: <FileText className="w-4 h-4 mr-3 text-indigo-400" />, show: true },
    { label: 'Leave Management', path: '/leave', icon: <Calendar className="w-4 h-4 mr-3 text-amber-400" />, show: !isContractor },
    { label: 'Remote Work Log', path: '/remote', icon: <Globe className="w-4 h-4 mr-3 text-cyan-400" />, show: !isContractor },
    { label: 'Compensation & Payroll', path: '/payroll', icon: <DollarSign className="w-4 h-4 mr-3 text-purple-400" />, show: isAdmin },
    { label: 'ΕΡΓΑΝΗ Reconciliation', path: '/reconciliation', icon: <ShieldCheck className="w-4 h-4 mr-3 text-rose-400" />, show: isAdmin },
  ];

  return (
    <aside className="w-64 bg-white border-r border-slate-200/80 flex flex-col justify-between h-screen sticky top-0 z-30 select-none shadow-xs">
      <div>
        {/* Brand Header */}
        <div className="px-6 py-5 border-b border-slate-200/80 flex items-center justify-between">
          <Link href="/" className="flex items-center space-x-3 group">
            <div className="w-9 h-9 rounded-xl bg-[#3D87D3]/10 border border-[#3D87D3]/20 flex items-center justify-center p-1.5 shadow-xs group-hover:scale-105 transition-transform">
              <img src="/icon.png" alt="StellarBlue Icon" className="w-6 h-6 object-contain" />
            </div>
            <div>
              <span className="font-bold text-lg text-slate-800 tracking-tight block leading-tight">Orbit</span>
              <span className="text-[10px] uppercase font-semibold text-[#3D87D3] tracking-widest block">StellarBlue</span>
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="p-3 space-y-1 mt-2">
          <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Modules
          </div>
          {navItems.filter(i => i.show).map(item => {
            const active = pathname === item.path;
            return (
              <Link 
                key={item.path} 
                href={item.path}
                className={`flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                  active 
                    ? 'bg-[#3D87D3]/10 text-[#3D87D3] font-semibold border-l-4 border-[#3D87D3] rounded-l-none' 
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
                }`}
              >
                {item.icon}
                <span className="flex-1">{item.label}</span>
                {item.label === 'Compensation & Payroll' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">Admin</span>
                )}
              </Link>
            );
          })}
        </nav>

        {isContractor && (
          <div className="mx-4 mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start space-x-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>Contractor profile active: Leave & Remote modules auto-hidden per company policy.</span>
          </div>
        )}
      </div>

      {/* Footer / User Profile & Dev Mode Switcher */}
      <div className="p-4 border-t border-slate-200/80 bg-slate-50/60">
        {isDevMode && (
          <div className="mb-3 px-2.5 py-1.5 rounded bg-blue-50/80 border border-blue-200 text-[#3D87D3] flex items-center justify-between text-xs">
            <span className="flex items-center font-semibold">
              <Sliders className="w-3.5 h-3.5 mr-1.5 animate-spin" style={{ animationDuration: '8s' }} /> Dev Auth Mode
            </span>
            <Badge variant={isAdmin ? 'info' : 'neutral'}>{currentUser.role.toUpperCase()}</Badge>
          </div>
        )}

        <div className="relative">
          <button 
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-slate-200/50 transition-colors border border-transparent hover:border-slate-300 text-left cursor-pointer"
          >
            <div className="flex items-center space-x-3 overflow-hidden">
              <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-xs shadow-xs shrink-0">
                {currentUser.first_name[0]}{currentUser.last_name[0]}
              </div>
              <div className="truncate">
                <p className="text-sm font-semibold text-slate-800 truncate">{currentUser.first_name} {currentUser.last_name}</p>
                <p className="text-xs text-slate-500 truncate">{currentUser.title}</p>
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 ml-1" />
          </button>

          {/* Dev Role Switcher & Sign Out Dropdown */}
          {dropdownOpen && (
            <div className="absolute bottom-14 left-0 w-full bg-white border border-slate-200 rounded-xl shadow-xl p-2 z-50 max-h-80 overflow-y-auto space-y-1">
              {isDevMode && (
                <>
                  <div className="px-2 py-1 text-[10px] uppercase font-bold text-slate-400 border-b border-slate-100 mb-1">
                    Switch Test Identity (Dev Only)
                  </div>
                  {profiles.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { switchUser(p.id); setDropdownOpen(false); }}
                      className={`w-full text-left p-2 rounded-lg text-xs flex items-center justify-between hover:bg-slate-100 transition-colors cursor-pointer ${p.id === currentUser.id ? 'bg-[#3D87D3]/10 text-[#3D87D3] border border-[#3D87D3]/20 font-semibold' : 'text-slate-700'}`}
                    >
                      <div className="truncate pr-2">
                        <div className="font-medium truncate">{p.first_name} {p.last_name}</div>
                        <div className="text-[10px] text-slate-400 truncate">{p.title} ({p.employment_type})</div>
                      </div>
                      <Badge variant={p.role === 'admin' ? 'info' : 'neutral'} className="text-[10px] px-1 py-0">{p.role}</Badge>
                    </button>
                  ))}
                  <div className="border-t border-slate-100 my-1"></div>
                </>
              )}
              <button
                onClick={() => { signOut(); setDropdownOpen(false); }}
                className="w-full text-left p-2 rounded-lg text-xs flex items-center space-x-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700 transition-colors font-semibold cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                <span>Sign Out of Orbit</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
