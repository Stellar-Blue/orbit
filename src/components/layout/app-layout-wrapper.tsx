"use client";

import React, { useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { CommandMenu } from "@/components/layout/command-menu";
import { Menu, Search } from "lucide-react";

export const AppLayoutWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const pathname = usePathname();
  const isAuthPage = pathname?.startsWith("/login") || pathname?.startsWith("/auth");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (isAuthPage) {
    return (
      <div className="flex-1 flex flex-col min-h-screen w-full bg-slate-50 selection:bg-[#3D87D3] selection:text-white">
        {children}
      </div>
    );
  }

  return (
    <>
      <Sidebar mobileMenuOpen={mobileMenuOpen} setMobileMenuOpen={setMobileMenuOpen} />
      <CommandMenu />
      <div className="flex-1 flex flex-col min-h-screen overflow-x-hidden w-full max-w-full">
        {/* Header / Quick Action & Mobile Toggle Bar */}
        <header className="h-16 border-b border-slate-200/80 bg-white/85 backdrop-blur-md px-4 sm:px-6 md:px-8 flex items-center justify-between sticky top-0 z-20 shadow-xs">
          <div className="flex items-center space-x-3 text-sm text-slate-500 overflow-hidden">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-2 rounded-xl text-slate-800 hover:bg-slate-100 border border-slate-200 shadow-2xs focus:outline-none transition-colors shrink-0 cursor-pointer"
              aria-label="Open Navigation Menu"
            >
              <Menu className="w-5 h-5 text-slate-800" />
            </button>
            <div className="flex items-center space-x-1 sm:space-x-2 truncate font-sans">
              <span className="font-extrabold text-[#3D87D3] tracking-tight truncate">StellarBlue</span>
              <span className="text-slate-300">/</span>
              <span className="text-slate-900 font-extrabold tracking-tight truncate">Orbit Workspace</span>
            </div>
          </div>
          
          <div className="flex items-center space-x-3 shrink-0">
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

        {/* Page Content with Responsive Padding */}
        <main className="p-4 sm:p-6 md:p-8 max-w-7xl w-full mx-auto flex-1 overflow-x-hidden">
          {children}
        </main>
      </div>
    </>
  );
};
