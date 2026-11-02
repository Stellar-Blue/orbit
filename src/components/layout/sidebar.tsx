"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { roleLabel } from '@/lib/profile-role';
import { 
  Users, FileText, Calendar, Globe, DollarSign, 
  ChevronDown, AlertTriangle, Sliders, LogOut, 
  Settings, CalendarDays, Home, Briefcase, X, Eye, EyeOff, Building2, Receipt, UserRound, Clock, BarChart3, DoorOpen
} from 'lucide-react';
import { Badge } from '@/components/ui/primitives';

interface SidebarProps {
  mobileMenuOpen?: boolean;
  setMobileMenuOpen?: (open: boolean) => void;
  /** Desktop only: shrink to an icon rail (labels move to tooltips). The mobile drawer is always full. */
  collapsed?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({ mobileMenuOpen = false, setMobileMenuOpen, collapsed = false }) => {
  const pathname = usePathname();
  const { currentUser, profiles, switchUser, isDevMode, signOut, isViewAsEmployee, setIsViewAsEmployee, realUserRole, companyProfile, previewProfileId, stopPreview, profileRoleHistory, jobRoles, seniorityLevels, hiddenScreens } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const isContractor = currentUser.employment_type === 'contractor';
  const isAdmin = currentUser.role === 'admin';

  // A screen is visible unless an admin hid it AND the active identity is not an admin.
  // Previewing forces currentUser.role to 'employee', so the switches apply in preview too.
  const canSeeScreen = (key?: string) => isAdmin || !key || !hiddenScreens.includes(key);

  // Primary General Links (Top)
  const primaryItems = [
    { label: 'Home', path: '/', icon: <Home className="w-4 h-4 mr-2.5 text-[var(--accent)]" />, show: true },
  ];

  // Personal Section
  const personalItems = [
    { label: 'My Profile', path: '/profile', icon: <UserRound className="w-4 h-4 mr-2.5 text-emerald-500" />, show: canSeeScreen('profile') },
    { label: 'Leave Management', path: '/leave', icon: <Calendar className="w-4 h-4 mr-2.5 text-amber-500" />, show: !isContractor && canSeeScreen('leave') },
    { label: 'Remote Work Log', path: '/remote', icon: <Globe className="w-4 h-4 mr-2.5 text-cyan-500" />, show: !isContractor && canSeeScreen('remote') },
    { label: 'Timesheets', path: '/timesheets', icon: <Clock className="w-4 h-4 mr-2.5 text-sky-500" />, show: canSeeScreen('timesheets') },
    { label: 'Compensation & Payroll', path: '/compensation', icon: <DollarSign className="w-4 h-4 mr-2.5 text-emerald-500" />, show: canSeeScreen('compensation') },
  ];

  // Company Section
  const companyItems = [
    { label: 'People Directory', path: '/people', icon: <Users className="w-4 h-4 mr-2.5 text-blue-500" />, show: canSeeScreen('people'), adminOnly: false },
    { label: 'Spaces & Rooms', path: '/spaces', icon: <DoorOpen className="w-4 h-4 mr-2.5 text-fuchsia-500" />, show: canSeeScreen('spaces'), adminOnly: false },
    { label: 'Leave Control Center', path: '/company-leave', icon: <Calendar className="w-4 h-4 mr-2.5 text-amber-500" />, show: isAdmin, adminOnly: true },
    { label: 'Contracts', path: '/contracts', icon: <FileText className="w-4 h-4 mr-2.5 text-indigo-500" />, show: isAdmin, adminOnly: true },
    { label: 'Invoices', path: '/invoices', icon: <Receipt className="w-4 h-4 mr-2.5 text-teal-600" />, show: isAdmin, adminOnly: true },
    { label: 'Reports', path: '/reports', icon: <BarChart3 className="w-4 h-4 mr-2.5 text-rose-500" />, show: isAdmin, adminOnly: true },
    { label: 'Counterparties & Attio', path: '/counterparties', icon: <Building2 className="w-4 h-4 mr-2.5 text-cyan-600" />, show: isAdmin, adminOnly: true },
    { label: 'Compensation & Payroll', path: '/payroll', icon: <Briefcase className="w-4 h-4 mr-2.5 text-violet-500" />, show: isAdmin, adminOnly: true },
  ];

  // Bottom Settings
  const settingsItem = { label: 'Settings', path: '/settings', icon: <Settings className="w-4 h-4 mr-2.5 text-slate-500" />, show: isAdmin };

  const handleNavClick = () => {
    if (setMobileMenuOpen) {
      setMobileMenuOpen(false);
    }
  };

  const renderNavItem = (item: { label: string; path: string; icon: React.ReactNode; show: boolean; adminOnly?: boolean }, compact = false) => {
    if (!item.show) return null;
    const active = pathname === item.path;
    return (
      <Link 
        key={item.path} 
        href={item.path}
        onClick={handleNavClick}
        aria-current={active ? 'page' : undefined}
        aria-label={compact ? item.label : undefined}
        title={compact ? item.label : undefined}
        className={`relative flex items-center h-8 rounded-[4px] text-[12.5px] transition-colors duration-150 group ${compact ? 'justify-center' : 'pl-3 pr-2.5'} ${
          active
            ? 'bg-[var(--accent-soft)] text-[var(--accent-ink)] font-semibold'
            : 'text-[var(--ink-2)] font-medium hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]'
        }`}
      >
        {active && <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-[var(--accent)]" />}
        <span className={`shrink-0 opacity-95 group-hover:opacity-100 ${compact ? '[&>svg]:mr-0' : ''}`}>{item.icon}</span>
        {!compact && <span className="flex-1 truncate">{item.label}</span>}
      </Link>
    );
  };

  const renderSidebarContent = (isMobile: boolean = false) => {
    const compact = collapsed && !isMobile;
    const sectionLabel = (label: string) => compact
      ? <div aria-hidden className="mx-2 mb-1.5 border-t border-[var(--line)]" />
      : <div className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ink-4)]">{label}</div>;
    return (
    <>
      <div className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden">
        {/* Brand Header */}
        <div className={`py-4 border-b border-[var(--line)] flex items-center shrink-0 ${compact ? 'justify-center px-2' : 'justify-between px-3'}`}>
          <Link href="/" onClick={handleNavClick} title={compact ? 'Orbit · Home' : undefined} className={`flex items-center group ${compact ? '' : 'space-x-2.5 pr-8 md:pr-0'}`}>
            <div className="w-8 h-8 rounded-[5px] bg-[var(--surface-muted)] border border-[var(--line)] flex items-center justify-center p-1.5 shrink-0">
              <img src={companyProfile?.logo_url || "/icon.png"} alt={`${companyProfile?.name || 'Company'} Icon`} className="w-6 h-6 object-contain" />
            </div>
            <div className={compact ? 'hidden' : 'truncate'}>
              <span className="text-[14px] font-semibold uppercase tracking-[0.16em] text-[var(--ink)] block leading-tight truncate">Orbit</span>
              <span className="block truncate font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--ink-4)]">{companyProfile?.name || 'StellarBlue'}</span>
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
        <div className={`py-3 space-y-5 flex-1 ${compact ? 'px-2' : 'px-2.5'}`}>
          {/* 1. Primary Top Section */}
          <nav className="space-y-1">
            {primaryItems.map(item => renderNavItem(item, compact))}
          </nav>

          {/* 2. Personal Section */}
          {personalItems.some(i => i.show) && (
            <nav className="space-y-1" aria-label="Personal">
              {sectionLabel('Personal')}
              {personalItems.map(item => renderNavItem(item, compact))}
            </nav>
          )}

          {/* 3. Company Section */}
          {companyItems.some(i => i.show) && (
            <nav className="space-y-1" aria-label="Company">
              {sectionLabel('Company')}
              {companyItems.map(item => renderNavItem(item, compact))}
            </nav>
          )}
        </div>

        {/* Bottom Navigation Item (Settings) */}
        {settingsItem.show && (
          <div className={`pb-2 pt-2 border-t border-[var(--line)] shrink-0 ${compact ? 'px-2' : 'px-2.5'}`}>
            {renderNavItem(settingsItem, compact)}
          </div>
        )}

        {isContractor && !compact && (
          <div className="mx-3 mb-3 p-2.5 rounded-[6px] bg-[var(--warning-soft)] border border-amber-300/70 text-[11px] text-[var(--warning)] font-medium flex items-start space-x-2 shrink-0">
            <AlertTriangle className="w-3.5 h-3.5 text-[var(--warning)] shrink-0 mt-0.5" />
            <span>Contractor profile active: Leave & Remote logs auto-hidden.</span>
          </div>
        )}
      </div>

      {/* Footer / User Profile & Dev Mode Switcher. The icon rail keeps only the avatar: the header
          carries the preview switches and the ribbon the way out of a preview. */}
      <div className={`border-t border-[var(--line)] shrink-0 ${compact ? 'p-2' : 'p-3'}`}>
        {!compact && realUserRole === 'admin' && previewProfileId && (
          <div className="mb-3">
            <button
              onClick={stopPreview}
              className="w-full p-2.5 rounded-xl text-xs font-extrabold flex items-center justify-between transition-all cursor-pointer shadow-2xs border bg-amber-500 text-white border-amber-600 hover:bg-amber-600"
              title="Return to Full Admin view"
            >
              <span className="flex items-center truncate">
                <EyeOff className="w-3.5 h-3.5 mr-2 shrink-0 text-white" />
                <span>Exit Preview — {currentUser.first_name} {currentUser.last_name}</span>
              </span>
              <Badge variant="neutral" className="text-[9px] px-1.5 py-0.5 font-black shrink-0 bg-white text-amber-950 border-amber-300">
                ACTIVE
              </Badge>
            </button>
          </div>
        )}

        {!compact && realUserRole === 'admin' && !previewProfileId && (
          <div className="mb-3">
            <button
              onClick={() => setIsViewAsEmployee(!isViewAsEmployee)}
              className={`w-full p-2.5 rounded-xl text-xs font-extrabold flex items-center justify-between transition-all cursor-pointer shadow-2xs border ${
                isViewAsEmployee
                  ? 'bg-amber-500 text-white border-amber-600 hover:bg-amber-600'
                  : 'bg-white text-[var(--ink-2)] border-[var(--line-strong)] hover:bg-[var(--surface-muted)]'
              }`}
              title={isViewAsEmployee ? "Return to Full Admin view" : "Switch view to experience platform as an ordinary employee"}
            >
              <span className="flex items-center truncate">
                {isViewAsEmployee ? (
                  <EyeOff className="w-3.5 h-3.5 mr-2 shrink-0 text-white" />
                ) : (
                  <Eye className="w-3.5 h-3.5 mr-2 shrink-0 text-[var(--accent)]" />
                )}
                <span>{isViewAsEmployee ? 'Exit Employee Preview' : 'View as Employee'}</span>
              </span>
              <Badge variant={isViewAsEmployee ? 'neutral' : 'info'} className={`text-[9px] px-1.5 py-0.5 font-black shrink-0 ${isViewAsEmployee ? 'bg-white text-amber-950 border-amber-300' : ''}`}>
                {isViewAsEmployee ? 'ACTIVE' : 'PREVIEW'}
              </Badge>
            </button>
          </div>
        )}

        {isDevMode && !compact && (
          <div className="mb-3 px-2.5 py-1.5 rounded-[4px] bg-[var(--surface-muted)] border border-[var(--line)] text-[var(--ink-2)] flex items-center justify-between text-[11px]">
            <span className="flex items-center font-semibold truncate">
              <Sliders className="w-3.5 h-3.5 mr-1.5 animate-spin shrink-0" style={{ animationDuration: '8s' }} /> Dev Auth Mode
            </span>
            <Badge variant={isAdmin ? 'info' : 'neutral'} className="font-extrabold text-[10px] shrink-0">{currentUser.role.toUpperCase()}</Badge>
          </div>
        )}

        <div className="relative">
          <button 
            onClick={() => setDropdownOpen(!dropdownOpen)}
            title={compact ? `${currentUser.first_name} ${currentUser.last_name}` : undefined}
            className={`w-full flex items-center rounded-[4px] hover:bg-[var(--surface-muted)] transition-colors border border-transparent hover:border-[var(--line)] text-left cursor-pointer ${compact ? 'justify-center p-1' : 'justify-between p-2'}`}
          >
            <div className="flex items-center space-x-2.5 overflow-hidden">
              <div className="w-8 h-8 rounded-[4px] bg-[var(--ink)] text-[var(--canvas)] flex items-center justify-center font-bold text-xs shrink-0 overflow-hidden border border-[var(--ink)]">
                {currentUser.photo_url ? (
                  <img src={currentUser.photo_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span>{currentUser.first_name[0]}{currentUser.last_name[0]}</span>
                )}
              </div>
              <div className={compact ? 'hidden' : 'truncate'}>
                <p className="text-[12.5px] font-semibold text-[var(--ink)] truncate">{currentUser.first_name} {currentUser.last_name}</p>
                <p className="text-[10.5px] text-[var(--ink-4)] font-medium truncate">{roleLabel(currentUser, profileRoleHistory, jobRoles, seniorityLevels)}</p>
              </div>
            </div>
            {!compact && <ChevronDown className="w-4 h-4 text-[var(--ink-4)] shrink-0 ml-1" />}
          </button>
          
          {/* Dev Role Switcher & Sign Out Dropdown */}
          {dropdownOpen && (
            <div className={`absolute bg-white ${compact ? 'bottom-0 left-full ml-2 w-64' : 'bottom-14 left-0 w-full'} border border-slate-200 rounded-xl shadow-xl p-2 z-50 max-h-80 overflow-y-auto space-y-1`}>
              {isDevMode && (
                <>
                  <div className="px-2 py-1 text-[10px] uppercase font-extrabold text-slate-400 border-b border-slate-100 mb-1">
                    Switch Test Identity (Dev Only)
                  </div>
                  {profiles.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { switchUser(p.id); setDropdownOpen(false); }}
                      className={`w-full text-left p-2 rounded-lg text-xs flex items-center justify-between hover:bg-slate-100 transition-colors cursor-pointer ${p.id === currentUser.id ? 'bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20 font-extrabold' : 'text-slate-700 font-medium'}`}
                    >
                      <div className="truncate pr-2">
                        <div className="font-bold truncate">{p.first_name} {p.last_name}</div>
                        <div className="text-[10px] text-slate-400 truncate">{roleLabel(p, profileRoleHistory, jobRoles, seniorityLevels)} ({p.employment_type})</div>
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
  };

  return (
    <>
      {/* Desktop Sticky Sidebar */}
      <aside className={`hidden md:flex ${collapsed ? 'w-14' : 'w-[232px]'} transition-[width] duration-150 bg-white border-r border-[var(--line-strong)] flex-col justify-between h-screen sticky top-0 z-30 select-none shrink-0`}>
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
          <aside className="relative w-72 max-w-[85vw] bg-white h-full z-50 flex flex-col justify-between shadow-[var(--shadow-pop)] animate-in slide-in-from-left duration-200 overflow-hidden">
            {renderSidebarContent(true)}
          </aside>
        </div>
      )}
    </>
  );
};
