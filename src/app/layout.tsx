import React from "react";
import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { AppLayoutWrapper } from "@/components/layout/app-layout-wrapper";

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
          <AppLayoutWrapper>
            {children}
          </AppLayoutWrapper>
        </AuthProvider>
      </body>
    </html>
  );
}
