import React from "react";
import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { AppLayoutWrapper } from "@/components/layout/app-layout-wrapper";
import { ValidationHost } from "@/lib/validation-modal";
import { ThemeProvider, themeInitScript } from "@/lib/theme";
import { SpeedInsights } from "@vercel/speed-insights/next";

// The brand pair: Inter for every piece of UI text, JetBrains Mono for codes, ids and figures.
// Variable axis: the UI leans on the whole weight range (400 body → 900 figures).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

// Browser chrome (mobile address bar, PWA frame) follows the page ground.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d11" },
  ],
};

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
    // The inline script writes data-theme and color-scheme onto <html> before React hydrates,
    // which React must accept rather than reconcile.
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <script
          type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased text-[var(--ink-2)] font-sans min-h-screen flex selection:bg-[var(--accent)] selection:text-[var(--accent-fg)]`}
      >
        <ThemeProvider>
          <AuthProvider>
            <AppLayoutWrapper>
              {children}
            </AppLayoutWrapper>
          </AuthProvider>
          <ValidationHost />
          {/* Real-user Web Vitals; a no-op outside a Vercel deployment. */}
          <SpeedInsights />
        </ThemeProvider>
      </body>
    </html>
  );
}
