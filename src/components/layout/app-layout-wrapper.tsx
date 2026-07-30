"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { CommandMenu } from "@/components/layout/command-menu";

export const AppLayoutWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const pathname = usePathname();
  const isAuthPage = pathname?.startsWith("/login") || pathname?.startsWith("/auth");

  if (isAuthPage) {
    return (
      <div className="flex-1 flex flex-col min-h-screen w-full bg-slate-50 selection:bg-[#3D87D3] selection:text-white">
        {children}
      </div>
    );
  }

  return (
    <>
      <Sidebar />
      <CommandMenu />
      <div className="flex-1 flex flex-col min-h-screen overflow-x-hidden">
        {/* Header / Quick Action bar */}
        <header className="h-16 border-b border-slate-200/80 bg-white/80 backdrop-blur-md px-8 flex items-center justify-between sticky top-0 z-20 shadow-xs">
          <div className="flex items-center space-x-2 text-sm text-slate-500">
            <span className="font-semibold text-[#3D87D3]">StellarBlue</span>
            <span>/</span>
            <span className="text-slate-800 font-semibold">Workspace</span>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-xs text-slate-500 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center space-x-2 shadow-2xs">
              <span>Press</span>
              <kbd className="px-1.5 py-0.5 rounded-md bg-white border border-slate-200 font-sans font-semibold text-[11px] text-slate-700 shadow-2xs">⌘K</kbd>
              <span>to jump anywhere</span>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-8 max-w-7xl w-full mx-auto flex-1">
          {children}
        </main>
      </div>
    </>
  );
};
