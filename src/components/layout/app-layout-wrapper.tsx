"use client";

import React, { useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { CommandMenu } from "@/components/layout/command-menu";
import { useAuth } from "@/lib/auth-context";
import { Menu, Search, Eye, EyeOff, Users } from "lucide-react";

export const AppLayoutWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const pathname = usePathname();
  const isAuthPage = pathname?.startsWith("/login") || pathname?.startsWith("/auth");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const { currentUser, profiles, isViewAsEmployee, setIsViewAsEmployee, realUserRole, previewProfileId, startPreviewAs, stopPreview, slackIntegration, isLoading, companyProfile } = useAuth();
  const [previewMenuOpen, setPreviewMenuOpen] = useState(false);

  if (isAuthPage) {
    return (
      <div className="flex-1 flex flex-col min-h-screen w-full bg-slate-50 selection:bg-[#3D87D3] selection:text-white">
        {children}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-screen bg-slate-50">
        <div className="flex flex-col items-center justify-center">
          <div className="w-8 h-8 rounded-full border-4 border-[#3D87D3] border-t-transparent animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <>
      <Sidebar mobileMenuOpen={mobileMenuOpen} setMobileMenuOpen={setMobileMenuOpen} />
      <CommandMenu />
      <div className="flex-1 flex flex-col min-h-screen overflow-x-hidden w-full max-w-full">
        {/* Header / Quick Action & Mobile Toggle Bar */}
        <header className="h-16 border-b border-slate-200/80 bg-white/85 backdrop-blur-md px-3 sm:px-4 md:px-5 flex items-center justify-between sticky top-0 z-20 shadow-xs">
          <div className="flex items-center space-x-3 text-sm text-slate-500 overflow-hidden">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-2 rounded-xl text-slate-800 hover:bg-slate-100 border border-slate-200 shadow-2xs focus:outline-none transition-colors shrink-0 cursor-pointer"
              aria-label="Open Navigation Menu"
            >
              <Menu className="w-5 h-5 text-slate-800" />
            </button>
            <div className="flex items-center space-x-1 sm:space-x-2 truncate font-sans">
              <span className="font-extrabold text-[#3D87D3] tracking-tight truncate">{companyProfile?.name || 'StellarBlue'}</span>
              <span className="text-slate-300">/</span>
              <span className="text-slate-900 font-extrabold tracking-tight truncate">Orbit Workspace</span>
            </div>
          </div>
          
          <div className="flex items-center space-x-3 shrink-0">
            {realUserRole === 'admin' && !isViewAsEmployee && (
              <>
                <button
                  onClick={() => setIsViewAsEmployee(true)}
                  className="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-extrabold text-xs flex items-center transition-all shadow-2xs cursor-pointer shrink-0"
                  title="Switch view to experience Orbit exactly as an ordinary employee"
                >
                  <Eye className="w-3.5 h-3.5 mr-1.5 text-indigo-600 shrink-0" />
                  <span>View as Employee</span>
                </button>

                <div className="relative">
                  <button
                    onClick={() => setPreviewMenuOpen(v => !v)}
                    className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-extrabold text-xs flex items-center transition-all shadow-2xs cursor-pointer shrink-0"
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
                            <span className="text-[10px] text-slate-400 truncate">{p.title || p.employment_type.replace('_', ' ')}</span>
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

            <div className="hidden sm:flex text-xs text-slate-500 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200/90 items-center space-x-2 shadow-2xs">
              <Search className="w-3.5 h-3.5 text-slate-400" />
              <span>Press</span>
              <kbd className="px-1.5 py-0.5 rounded-md bg-white border border-slate-300/80 font-sans font-extrabold text-[11px] text-slate-800 shadow-2xs">⌘K</kbd>
              <span>to jump anywhere</span>
            </div>
            <div className="sm:hidden text-[11px] text-slate-500 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 font-extrabold shadow-2xs">
              Orbit HRMS
            </div>
          </div>
        </header>

        {/* Persistent Admin Employee-Preview Mode Ribbon */}
        {realUserRole === 'admin' && isViewAsEmployee && (
          <div className="bg-gradient-to-r from-amber-500 via-amber-600 to-orange-600 text-white px-3 sm:px-4 md:px-5 py-2.5 text-xs font-bold flex flex-wrap items-center justify-between gap-3 shadow-md border-b border-amber-700 animate-in slide-in-from-top duration-200">
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
          <div className="bg-gradient-to-r from-rose-500 via-rose-600 to-orange-600 text-white px-3 sm:px-4 md:px-5 py-2.5 text-xs font-bold flex flex-wrap items-center justify-between gap-3 shadow-md border-b border-rose-700 animate-in slide-in-from-top duration-200">
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
        <main className="px-3 sm:px-4 md:px-5 py-5 w-full max-w-full flex-1 overflow-x-hidden">
          {children}
        </main>
      </div>
    </>
  );
};
