"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { 
  Users, FileText, Calendar, Globe, DollarSign, 
  ChevronDown, AlertTriangle, Sliders, LogOut, 
  Settings, CalendarDays, Home, Briefcase, X, Eye, EyeOff, Building2, Receipt, UserRound, Clock, BarChart3
} from 'lucide-react';
import { Badge } from '@/components/ui/primitives';

interface SidebarProps {
  mobileMenuOpen?: boolean;
  setMobileMenuOpen?: (open: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ mobileMenuOpen = false, setMobileMenuOpen }) => {
  const pathname = usePathname();
  const { currentUser, profiles, switchUser, isDevMode, signOut, isViewAsEmployee, setIsViewAsEmployee, realUserRole, companyProfile } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const isContractor = currentUser.employment_type === 'contractor';
  const isAdmin = currentUser.role === 'admin';

  // Primary General Links (Top)
  const primaryItems = [
    { label: 'Home', path: '/', icon: <Home className="w-4 h-4 mr-3 text-[#3D87D3]" />, show: true },
  ];

  // Personal Section
  const personalItems = [
    { label: 'My Profile', path: '/profile', icon: <UserRound className="w-4 h-4 mr-3 text-emerald-500" />, show: true },
    { label: 'Leave Management', path: '/leave', icon: <Calendar className="w-4 h-4 mr-3 text-amber-500" />, show: !isContractor },
    { label: 'Remote Work Log', path: '/remote', icon: <Globe className="w-4 h-4 mr-3 text-cyan-500" />, show: !isContractor },
    { label: 'Timesheets', path: '/timesheets', icon: <Clock className="w-4 h-4 mr-3 text-sky-500" />, show: true },
    { label: 'Compensation & Payroll', path: '/compensation', icon: <DollarSign className="w-4 h-4 mr-3 text-emerald-500" />, show: true },
  ];

  // Company Section
  const companyItems = [
    { label: 'People Directory', path: '/people', icon: <Users className="w-4 h-4 mr-3 text-blue-500" />, show: true, adminOnly: false },
    { label: 'Leave Management', path: '/company-leave', icon: <Calendar className="w-4 h-4 mr-3 text-amber-500" />, show: isAdmin, adminOnly: true },
    { label: 'Contracts', path: '/contracts', icon: <FileText className="w-4 h-4 mr-3 text-indigo-400" />, show: isAdmin, adminOnly: true },
    { label: 'Invoices', path: '/invoices', icon: <Receipt className="w-4 h-4 mr-3 text-emerald-400" />, show: isAdmin, adminOnly: true },
    { label: 'Reports', path: '/reports', icon: <BarChart3 className="w-4 h-4 mr-3 text-rose-400" />, show: isAdmin, adminOnly: true },
    { label: 'Counterparties & Attio', path: '/counterparties', icon: <Building2 className="w-4 h-4 mr-3 text-cyan-400" />, show: isAdmin, adminOnly: true },
    { label: 'Compensation & Payroll', path: '/payroll', icon: <Briefcase className="w-4 h-4 mr-3 text-purple-500" />, show: isAdmin, adminOnly: true },
  ];

  // Bottom Settings
  const settingsItem = { label: 'Settings', path: '/settings', icon: <Settings className="w-4 h-4 mr-3 text-slate-500" />, show: isAdmin };

  const handleNavClick = () => {
    if (setMobileMenuOpen) {
      setMobileMenuOpen(false);
    }
  };

  const renderNavItem = (item: { label: string; path: string; icon: React.ReactNode; show: boolean; adminOnly?: boolean }) => {
    if (!item.show) return null;
    const active = pathname === item.path;
    return (
      <Link 
        key={item.path} 
        href={item.path}
        onClick={handleNavClick}
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

  const renderSidebarContent = (isMobile: boolean = false) => (
    <>
      <div className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden">
        {/* Brand Header */}
        <div className="px-6 py-4 border-b border-slate-200/80 flex items-center justify-between shrink-0">
          <Link href="/" onClick={handleNavClick} className="flex items-center space-x-3 group pr-8 md:pr-0">
            <div className="w-9 h-9 rounded-xl bg-[#3D87D3]/10 border border-[#3D87D3]/20 flex items-center justify-center p-1.5 shadow-xs group-hover:scale-105 transition-transform shrink-0">
              <img src={companyProfile?.logo_url || "/icon.png"} alt={`${companyProfile?.name || 'Company'} Icon`} className="w-6 h-6 object-contain" />
            </div>
            <div className="truncate">
              <span className="font-extrabold text-lg text-slate-900 tracking-tight block leading-tight truncate">Orbit</span>
              <span className="text-[10px] uppercase font-bold text-[#3D87D3] tracking-widest block truncate">{companyProfile?.name || 'StellarBlue'}</span>
            </div>
          </Link>
          {isMobile && (
            <button
              onClick={() => setMobileMenuOpen && setMobileMenuOpen(false)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
          )}
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
        {realUserRole === 'admin' && (
          <div className="mb-3">
            <button
              onClick={() => setIsViewAsEmployee(!isViewAsEmployee)}
              className={`w-full p-2.5 rounded-xl text-xs font-extrabold flex items-center justify-between transition-all cursor-pointer shadow-2xs border ${
                isViewAsEmployee 
                  ? 'bg-amber-500 text-white border-amber-600 hover:bg-amber-600' 
                  : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50/80'
              }`}
              title={isViewAsEmployee ? "Return to Full Admin view" : "Switch view to experience platform as an ordinary employee"}
            >
              <span className="flex items-center truncate">
                {isViewAsEmployee ? (
                  <EyeOff className="w-3.5 h-3.5 mr-2 shrink-0 text-white" />
                ) : (
                  <Eye className="w-3.5 h-3.5 mr-2 shrink-0 text-indigo-600" />
                )}
                <span>{isViewAsEmployee ? 'Exit Employee Preview' : 'View as Employee'}</span>
              </span>
              <Badge variant={isViewAsEmployee ? 'neutral' : 'info'} className={`text-[9px] px-1.5 py-0.5 font-black shrink-0 ${isViewAsEmployee ? 'bg-white text-amber-950 border-amber-300' : ''}`}>
                {isViewAsEmployee ? 'ACTIVE' : 'PREVIEW'}
              </Badge>
            </button>
          </div>
        )}

        {isDevMode && (
          <div className="mb-3 px-2.5 py-1.5 rounded-lg bg-blue-50/90 border border-blue-200/80 text-[#3D87D3] flex items-center justify-between text-xs shadow-2xs">
            <span className="flex items-center font-extrabold truncate">
              <Sliders className="w-3.5 h-3.5 mr-1.5 animate-spin shrink-0" style={{ animationDuration: '8s' }} /> Dev Auth Mode
            </span>
            <Badge variant={isAdmin ? 'info' : 'neutral'} className="font-extrabold text-[10px] shrink-0">{currentUser.role.toUpperCase()}</Badge>
          </div>
        )}

        <div className="relative">
          <button 
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-slate-200/50 transition-colors border border-transparent hover:border-slate-300 text-left cursor-pointer"
          >
            <div className="flex items-center space-x-3 overflow-hidden">
              <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-extrabold text-xs shadow-xs shrink-0 overflow-hidden">
                {currentUser.photo_url ? (
                  <img src={currentUser.photo_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span>{currentUser.first_name[0]}{currentUser.last_name[0]}</span>
                )}
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
    </>
  );

  return (
    <>
      {/* Desktop Sticky Sidebar */}
      <aside className="hidden md:flex w-64 bg-white border-r border-slate-200/80 flex-col justify-between h-screen sticky top-0 z-30 select-none shadow-xs shrink-0">
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile Slide-over Sheet */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          {/* Backdrop overlay */}
          <div 
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200" 
            onClick={() => setMobileMenuOpen && setMobileMenuOpen(false)} 
            aria-hidden="true"
          />
          {/* Drawer container */}
          <aside className="relative w-72 max-w-[85vw] bg-white h-full z-50 flex flex-col justify-between shadow-2xl animate-in slide-in-from-left duration-200 overflow-hidden">
            {renderSidebarContent(true)}
          </aside>
        </div>
      )}
    </>
  );
};
