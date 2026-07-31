"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { 
  Users, FileText, Calendar, Globe, DollarSign, 
  LayoutDashboard, ChevronDown, AlertTriangle, 
  Sliders, LogOut, Settings, CalendarDays, Home, Briefcase, UserCheck
} from 'lucide-react';
import { Badge } from '@/components/ui/primitives';

export const Sidebar: React.FC = () => {
  const pathname = usePathname();
  const { currentUser, profiles, switchUser, isDevMode, signOut } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const isContractor = currentUser.employment_type === 'contractor';
  const isAdmin = currentUser.role === 'admin';

  // Primary General Links (Top)
  const primaryItems = [
    { label: 'Home', path: '/', icon: <Home className="w-4 h-4 mr-3 text-[#3D87D3]" />, show: true },
    { label: 'Calendar', path: '/calendar', icon: <CalendarDays className="w-4 h-4 mr-3 text-indigo-500" />, show: true },
  ];

  // Personal Section
  const personalItems = [
    { label: 'Leave Management', path: '/leave', icon: <Calendar className="w-4 h-4 mr-3 text-amber-500" />, show: !isContractor },
    { label: 'Remote Work Log', path: '/remote', icon: <Globe className="w-4 h-4 mr-3 text-cyan-500" />, show: !isContractor },
    { label: 'Compensation & Payroll', path: '/compensation', icon: <DollarSign className="w-4 h-4 mr-3 text-emerald-500" />, show: true },
  ];

  // Company Section
  const companyItems = [
    { label: 'People Directory', path: '/people', icon: <Users className="w-4 h-4 mr-3 text-blue-500" />, show: true, adminOnly: false },
    { label: 'Contract Management', path: '/contracts', icon: <FileText className="w-4 h-4 mr-3 text-indigo-400" />, show: isAdmin, adminOnly: true },
    { label: 'Compensation & Payroll', path: '/payroll', icon: <Briefcase className="w-4 h-4 mr-3 text-purple-500" />, show: isAdmin, adminOnly: true },
  ];

  // Bottom Settings
  const settingsItem = { label: 'Settings', path: '/settings', icon: <Settings className="w-4 h-4 mr-3 text-slate-500" />, show: isAdmin };

  const renderNavItem = (item: { label: string; path: string; icon: React.ReactNode; show: boolean; adminOnly?: boolean }) => {
    if (!item.show) return null;
    const active = pathname === item.path;
    return (
      <Link 
        key={item.path} 
        href={item.path}
        className={`flex items-center px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-150 group ${
          active 
            ? 'bg-[#3D87D3]/10 text-[#3D87D3] font-bold border-l-4 border-[#3D87D3] rounded-l-none shadow-2xs' 
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
        }`}
      >
        <span className="shrink-0 transition-transform group-hover:scale-110 duration-150">{item.icon}</span>
        <span className="flex-1 truncate">{item.label}</span>
        {item.adminOnly && (
          <span className="text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 shrink-0 shadow-2xs">
            Admin
          </span>
        )}
      </Link>
    );
  };

  return (
    <aside className="w-64 bg-white border-r border-slate-200/80 flex flex-col justify-between h-screen sticky top-0 z-30 select-none shadow-xs">
      <div className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden">
        {/* Brand Header */}
        <div className="px-6 py-4 border-b border-slate-200/80 flex items-center justify-between shrink-0">
          <Link href="/" className="flex items-center space-x-3 group">
            <div className="w-9 h-9 rounded-xl bg-[#3D87D3]/10 border border-[#3D87D3]/20 flex items-center justify-center p-1.5 shadow-xs group-hover:scale-105 transition-transform">
              <img src="/icon.png" alt="StellarBlue Icon" className="w-6 h-6 object-contain" />
            </div>
            <div>
              <span className="font-extrabold text-lg text-slate-900 tracking-tight block leading-tight">Orbit</span>
              <span className="text-[10px] uppercase font-bold text-[#3D87D3] tracking-widest block">StellarBlue</span>
            </div>
          </Link>
        </div>

        {/* Navigation Sections */}
        <div className="p-3 space-y-5 flex-1 mt-1">
          {/* 1. Primary Top Section */}
          <nav className="space-y-1">
            {primaryItems.map(item => renderNavItem(item))}
          </nav>

          {/* 2. Personal Section */}
          <nav className="space-y-1">
            <div className="px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
              Personal
            </div>
            {personalItems.map(item => renderNavItem(item))}
          </nav>

          {/* 3. Company Section */}
          <nav className="space-y-1">
            <div className="px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
              Company
            </div>
            {companyItems.map(item => renderNavItem(item))}
          </nav>
        </div>

        {/* Bottom Navigation Item (Settings) */}
        {settingsItem.show && (
          <div className="px-3 pb-2 pt-2 border-t border-slate-100 shrink-0">
            {renderNavItem(settingsItem)}
          </div>
        )}

        {isContractor && (
          <div className="mx-3 mb-3 p-2.5 rounded-xl bg-amber-50 border border-amber-200/80 text-[11px] text-amber-900 font-medium flex items-start space-x-2 shadow-2xs shrink-0">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <span>Contractor profile active: Leave & Remote logs auto-hidden.</span>
          </div>
        )}
      </div>

      {/* Footer / User Profile & Dev Mode Switcher */}
      <div className="p-4 border-t border-slate-200/80 bg-slate-50/60 shrink-0">
        {isDevMode && (
          <div className="mb-3 px-2.5 py-1.5 rounded-lg bg-blue-50/90 border border-blue-200/80 text-[#3D87D3] flex items-center justify-between text-xs shadow-2xs">
            <span className="flex items-center font-extrabold">
              <Sliders className="w-3.5 h-3.5 mr-1.5 animate-spin" style={{ animationDuration: '8s' }} /> Dev Auth Mode
            </span>
            <Badge variant={isAdmin ? 'info' : 'neutral'} className="font-extrabold text-[10px]">{currentUser.role.toUpperCase()}</Badge>
          </div>
        )}

        <div className="relative">
          <button 
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-slate-200/50 transition-colors border border-transparent hover:border-slate-300 text-left cursor-pointer"
          >
            <div className="flex items-center space-x-3 overflow-hidden">
              <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-extrabold text-xs shadow-xs shrink-0">
                {currentUser.first_name[0]}{currentUser.last_name[0]}
              </div>
              <div className="truncate">
                <p className="text-sm font-extrabold text-slate-900 truncate">{currentUser.first_name} {currentUser.last_name}</p>
                <p className="text-xs text-slate-500 font-medium truncate">{currentUser.title || 'Team Member'}</p>
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 ml-1" />
          </button>
          
          {/* Dev Role Switcher & Sign Out Dropdown */}
          {dropdownOpen && (
            <div className="absolute bottom-14 left-0 w-full bg-white border border-slate-200 rounded-xl shadow-xl p-2 z-50 max-h-80 overflow-y-auto space-y-1">
              {isDevMode && (
                <>
                  <div className="px-2 py-1 text-[10px] uppercase font-extrabold text-slate-400 border-b border-slate-100 mb-1">
                    Switch Test Identity (Dev Only)
                  </div>
                  {profiles.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { switchUser(p.id); setDropdownOpen(false); }}
                      className={`w-full text-left p-2 rounded-lg text-xs flex items-center justify-between hover:bg-slate-100 transition-colors cursor-pointer ${p.id === currentUser.id ? 'bg-[#3D87D3]/10 text-[#3D87D3] border border-[#3D87D3]/20 font-extrabold' : 'text-slate-700 font-medium'}`}
                    >
                      <div className="truncate pr-2">
                        <div className="font-bold truncate">{p.first_name} {p.last_name}</div>
                        <div className="text-[10px] text-slate-400 truncate">{p.title || 'Team Member'} ({p.employment_type})</div>
                      </div>
                      <Badge variant={p.role === 'admin' ? 'info' : 'neutral'} className="text-[10px] px-1.5 py-0 font-bold">{p.role}</Badge>
                    </button>
                  ))}
                  <div className="border-t border-slate-100 my-1"></div>
                </>
              )}
              <button
                onClick={() => { signOut(); setDropdownOpen(false); }}
                className="w-full text-left p-2 rounded-lg text-xs flex items-center space-x-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700 transition-colors font-extrabold cursor-pointer"
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
