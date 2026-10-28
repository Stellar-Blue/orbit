import React from "react";
import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { AppLayoutWrapper } from "@/components/layout/app-layout-wrapper";
import { ValidationHost } from "@/lib/validation-modal";

// Industrial sans + true monospace: the pair an operations console is set in.
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
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
        className={`${plexSans.variable} ${plexMono.variable} antialiased text-[var(--ink-2)] font-sans min-h-screen flex selection:bg-[var(--accent)] selection:text-white`}
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
