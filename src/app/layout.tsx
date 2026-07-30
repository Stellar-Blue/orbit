import React from "react";
import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { Sidebar } from "@/components/layout/sidebar";
import { CommandMenu } from "@/components/layout/command-menu";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Orbit — StellarBlue Internal Admin",
  description: "Internal administrative platform for StellarBlue managing employees, contracts, leave, remote logs, and payroll ledgers.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${outfit.variable} antialiased bg-slate-950 text-slate-200 font-sans min-h-screen flex selection:bg-blue-600 selection:text-white`}
      >
        <AuthProvider>
          <Sidebar />
          <CommandMenu />
          <main className="flex-1 flex flex-col min-h-screen overflow-x-hidden">
            {/* Header / Quick Action bar */}
            <header className="h-16 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md px-8 flex items-center justify-between sticky top-0 z-20">
              <div className="flex items-center space-x-2 text-sm text-slate-400">
                <span>StellarBlue</span>
                <span>/</span>
                <span className="text-slate-200 font-semibold">Workspace</span>
              </div>
              <div className="flex items-center space-x-4">
                <div className="text-xs text-slate-400 px-3 py-1 rounded bg-slate-900 border border-slate-800 flex items-center space-x-2">
                  <span>Press</span>
                  <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono font-semibold text-[10px] text-slate-300">⌘K</kbd>
                  <span>to jump anywhere</span>
                </div>
              </div>
            </header>
            
            {/* Page Content */}
            <div className="p-8 max-w-7xl w-full mx-auto flex-1">
              {children}
            </div>
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}
