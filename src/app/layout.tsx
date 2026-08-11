import React from "react";
import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { AppLayoutWrapper } from "@/components/layout/app-layout-wrapper";
import { ValidationHost } from "@/lib/validation-modal";

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
    <html lang="en">
      <body
        className={`${outfit.variable} antialiased bg-slate-50 text-slate-800 font-sans min-h-screen flex selection:bg-[#3D87D3] selection:text-white`}
      >
        <AuthProvider>
          <AppLayoutWrapper>
            {children}
          </AppLayoutWrapper>
        </AuthProvider>
        <ValidationHost />
      </body>
    </html>
  );
}
