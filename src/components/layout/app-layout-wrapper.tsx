"use client";

import React, { useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { CommandMenu } from "@/components/layout/command-menu";
import { useAuth } from "@/lib/auth-context";
import { roleLabel } from "@/lib/profile-role";
import { hiddenScreenForPath } from "@/lib/screens";
import { exitDemoMode } from "@/lib/demo-mode";
import { ThemeToggle } from "@/lib/theme";
import { Menu, Search, Eye, EyeOff, Users, ShieldAlert, Sparkles, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";

// The desktop navigation can shrink to an icon rail for more room. The choice is kept per browser;
// an in-memory copy keeps the toggle working where storage is blocked.
const NAV_COLLAPSED_KEY = "orbit-nav-collapsed";
const NAV_COLLAPSED_EVENT = "orbit-nav-collapsed-change";
let navCollapsedFallback = false;

function readNavCollapsed(): boolean {
  try {
    return localStorage.getItem(NAV_COLLAPSED_KEY) === "1";
  } catch {
    return navCollapsedFallback;
  }
}

function subscribeNavCollapsed(onChange: () => void) {
  window.addEventListener(NAV_COLLAPSED_EVENT, onChange);
  return () => window.removeEventListener(NAV_COLLAPSED_EVENT, onChange);
}

function setNavCollapsed(collapsed: boolean) {
  navCollapsedFallback = collapsed;
  try {
    localStorage.setItem(NAV_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Storage blocked: the in-memory copy still carries the choice for this visit.
  }
  window.dispatchEvent(new Event(NAV_COLLAPSED_EVENT));
}

export const AppLayoutWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const pathname = usePathname();
  // Orientation: the header names the screen you are on, not just the workspace.
  const PAGE_TITLES: Array<[string, string]> = [
    ['/contracts', 'Contracts'], ['/invoices', 'Invoices'], ['/counterparties', 'Counterparties'],
    ['/company-leave', 'Leave control'], ['/reports', 'Reports'], ['/people', 'People'],
    ['/payroll', 'Payroll'], ['/compensation', 'Compensation'], ['/timesheets', 'Timesheets'],
    ['/leave', 'Leave'], ['/remote', 'Remote work'], ['/reconciliation', 'Reconciliation'],
    ['/settings', 'Settings'], ['/profile', 'Profile'],
  ];
  const currentPage = pathname === '/' ? 'Home'
    : PAGE_TITLES.find(([prefix]) => pathname?.startsWith(prefix))?.[1] || 'Orbit';
  const isAuthPage = pathname?.startsWith("/login") || pathname?.startsWith("/auth");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navCollapsed = useSyncExternalStore(subscribeNavCollapsed, readNavCollapsed, () => false);

  const { currentUser, profiles, isViewAsEmployee, setIsViewAsEmployee, realUserRole, previewProfileId, startPreviewAs, stopPreview, slackIntegration, isLoading, isDemo, companyProfile, profileRoleHistory, jobRoles, seniorityLevels, hiddenScreens } = useAuth();
  const [previewMenuOpen, setPreviewMenuOpen] = useState(false);

  // Admin-switched-off screen. `currentUser.role` is 'employee' in both preview modes,
  // so "View as Employee" / "Preview as …" show exactly what that person would see.
  const blockedScreen = currentUser.role === 'admin' ? null : hiddenScreenForPath(pathname, hiddenScreens);

  if (isAuthPage) {
    return (
      <div className="flex-1 flex flex-col min-h-screen w-full bg-slate-50 selection:bg-[var(--accent)] selection:text-white">
        {children}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-screen bg-slate-50">
        <div className="flex flex-col items-center justify-center">
          <div className="w-8 h-8 rounded-full border-4 border-[var(--accent)] border-t-transparent animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <>
      <Sidebar mobileMenuOpen={mobileMenuOpen} setMobileMenuOpen={setMobileMenuOpen} collapsed={navCollapsed} />
      <CommandMenu />
      <div className="flex-1 flex flex-col min-h-screen overflow-x-hidden w-full max-w-full">
        {isDemo && (
          <div className="bg-[var(--signal-soft)] text-[var(--signal)] border-b border-[color-mix(in_srgb,var(--signal)_35%,transparent)] px-3 sm:px-4 md:px-5 py-2 text-[11px] sm:text-xs font-medium flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-[var(--signal)] shrink-0" />
              <span>Demo workspace — sample data only. Nothing you change here is saved.</span>
            </span>
            <button
              type="button"
              onClick={() => { exitDemoMode(); window.location.assign('/login'); }}
              className="flex items-center gap-1.5 rounded-[4px] border border-[color-mix(in_srgb,var(--signal)_40%,transparent)] bg-[var(--surface)] hover:bg-[var(--surface-muted)] px-2.5 py-1 font-semibold text-[var(--signal)] transition-colors cursor-pointer shrink-0"
            >
              <LogOut className="w-3 h-3" /> Exit demo
            </button>
          </div>
        )}
        {/* Header / Quick Action & Mobile Toggle Bar */}
        <header className="h-12 border-b border-[var(--line-strong)] bg-[var(--surface)] px-4 sm:px-6 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center space-x-3 text-sm text-slate-500 overflow-hidden">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-1.5 rounded-[4px] text-[var(--ink)] hover:bg-[var(--surface-muted)] border border-[var(--line)] focus:outline-none transition-colors shrink-0 cursor-pointer"
              aria-label="Open Navigation Menu"
            >
              <Menu className="w-4 h-4 text-[var(--ink)]" />
            </button>
            <button
              type="button"
              onClick={() => setNavCollapsed(!navCollapsed)}
              className="hidden md:inline-flex items-center justify-center w-7 h-7 rounded-[4px] text-[var(--ink-3)] hover:text-[var(--ink)] hover:bg-[var(--surface-muted)] transition-colors shrink-0 cursor-pointer"
              aria-label={navCollapsed ? "Expand navigation" : "Collapse navigation"}
              aria-expanded={!navCollapsed}
              title={navCollapsed ? "Expand navigation" : "Collapse navigation"}
            >
              {navCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 truncate font-mono text-[10.5px] uppercase tracking-[0.12em]">
              <span className="text-[var(--ink-4)] font-medium truncate">{companyProfile?.name || 'StellarBlue'}</span>
              <span className="text-[var(--line-strong)]">/</span>
              <span className="text-[var(--ink)] font-semibold truncate">{currentPage}</span>
            </nav>
          </div>
          
          <div className="flex items-center space-x-3 shrink-0">
            <ThemeToggle />
            {realUserRole === 'admin' && !isViewAsEmployee && (
              <>
                <button
                  onClick={() => setIsViewAsEmployee(true)}
                  className="h-7 px-2.5 rounded-[var(--radius-control)] bg-white hover:bg-[var(--surface-muted)] text-[var(--ink-2)] border border-[var(--line-strong)] font-semibold text-[11.5px] flex items-center transition-colors cursor-pointer shrink-0"
                  title="Switch view to experience Orbit exactly as an ordinary employee"
                >
                  <Eye className="w-3.5 h-3.5 mr-1.5 text-indigo-600 shrink-0" />
                  <span>View as Employee</span>
                </button>

                <div className="relative">
                  <button
                    onClick={() => setPreviewMenuOpen(v => !v)}
                    className="h-7 px-2.5 rounded-[var(--radius-control)] bg-white hover:bg-[var(--surface-muted)] text-[var(--ink-2)] border border-[var(--line-strong)] font-semibold text-[11.5px] flex items-center transition-colors cursor-pointer shrink-0"
                    title="Preview exactly what a specific employee can see"
                  >
                    <Users className="w-3.5 h-3.5 mr-1.5 text-slate-500 shrink-0" />
                    <span>Preview as…</span>
                  </button>
                  {previewMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setPreviewMenuOpen(false)} />
                      <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-2xl p-2 z-40 max-h-80 overflow-y-auto space-y-0.5">
                        <div className="px-2 py-1 text-[10px] uppercase font-extrabold text-slate-400 border-b border-slate-100 mb-1">
                          Preview Orbit as an employee
                        </div>
                        {profiles.filter(p => p.status === 'active' && p.role !== 'admin').map(p => (
                          <button
                            key={p.id}
                            onClick={() => { startPreviewAs(p.id); setPreviewMenuOpen(false); }}
                            className="w-full text-left px-2 py-1.5 rounded-lg text-xs hover:bg-slate-100 flex items-center justify-between gap-2 cursor-pointer"
                          >
                            <span className="truncate font-semibold text-slate-700">
                              {p.first_name} {p.last_name}
                            </span>
                            <span className="text-[10px] text-slate-400 truncate">{roleLabel(p, profileRoleHistory, jobRoles, seniorityLevels)}</span>
                          </button>
                        ))}
                        {profiles.filter(p => p.status === 'active' && p.role !== 'admin').length === 0 && (
                          <div className="p-3 text-center text-[11px] text-slate-400">No active employees to preview.</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            <button
              type="button"
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
              className="hidden sm:inline-flex items-center gap-2 h-7 pl-2.5 pr-1.5 rounded-[var(--radius-control)] bg-white border border-[var(--line-strong)] text-[var(--ink-3)] hover:text-[var(--ink)] hover:border-[var(--ink-4)] transition-colors cursor-pointer"
              aria-label="Search the workspace"
            >
              <Search className="w-3.5 h-3.5" />
              <span className="text-[12px] font-medium">Search</span>
              <kbd className="px-1.5 py-0.5 rounded-[3px] border border-[var(--line)] bg-[var(--surface-muted)] font-mono font-semibold text-[10px] text-[var(--ink-3)]">⌘K</kbd>
            </button>
          </div>
        </header>

        {/* Persistent Admin Employee-Preview Mode Ribbon */}
        {realUserRole === 'admin' && isViewAsEmployee && (
          <div className="bg-[var(--signal)] text-white px-3 sm:px-4 md:px-5 py-2 text-[11.5px] font-semibold flex flex-wrap items-center justify-between gap-3 border-b border-[color-mix(in_srgb,var(--signal)_70%,black)] animate-in slide-in-from-top duration-200">
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse shrink-0" />
              <span>
                {previewProfileId ? (
                  <>
                    <strong>Previewing as {currentUser?.first_name} {currentUser?.last_name}:</strong> you are seeing only what this employee can access. Admin menus and managerial overrides are hidden.
                  </>
                ) : (
                  <>
                    <strong>Admin Preview Mode Active:</strong> You are currently experiencing Orbit as an ordinary employee. Admin menu items and managerial overrides are temporarily hidden.
                  </>
                )}
              </span>
            </div>
            <button
              onClick={() => previewProfileId ? stopPreview() : setIsViewAsEmployee(false)}
              className="px-3.5 py-1.5 bg-white text-amber-950 rounded-xl hover:bg-amber-50 font-black shadow-sm cursor-pointer transition-transform active:scale-95 flex items-center shrink-0 text-xs border border-amber-200/80"
            >
              <EyeOff className="w-3.5 h-3.5 mr-1.5 text-amber-700 shrink-0" />
              <span>Exit Preview</span>
            </button>
          </div>
        )}

        {/* Persistent Slack Reconnect Ribbon (token revoked — gate re-arms at next sign-in) */}
        {slackIntegration?.status === 'revoked' && (
          <div className="bg-rose-700 text-white px-3 sm:px-4 md:px-5 py-2 text-[11.5px] font-semibold flex flex-wrap items-center justify-between gap-3 border-b border-rose-900 animate-in slide-in-from-top duration-200">
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse shrink-0" />
              <span>
                <strong>Slack connection revoked:</strong> Orbit can no longer mirror your leave & remote status. Reconnect to continue using Orbit after your next sign-in.
              </span>
            </div>
            <a
              href={`/onboarding?next=${encodeURIComponent(pathname || '/')}`}
              className="px-3.5 py-1.5 bg-white text-rose-950 rounded-xl hover:bg-rose-50 font-black shadow-sm cursor-pointer transition-transform active:scale-95 flex items-center shrink-0 text-xs border border-rose-200/80 no-underline"
            >
              Reconnect Slack
            </a>
          </div>
        )}

        {/* Page Content with Responsive Full-Width Layout */}
        <main className="px-4 sm:px-6 py-5 w-full max-w-full flex-1 overflow-x-hidden">
          {blockedScreen ? (
            <div className="p-10 text-center bg-slate-50 border border-slate-200 rounded-2xl max-w-xl mx-auto my-12 space-y-3 shadow-xs">
              <ShieldAlert className="w-10 h-10 mx-auto text-slate-400" />
              <h2 className="text-xl font-semibold text-slate-800">{blockedScreen.label} is not available</h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                An administrator has turned off this screen. If you need it, ask an administrator
                to switch it back on in Settings &rsaquo; Screen Visibility.
              </p>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </>
  );
};
