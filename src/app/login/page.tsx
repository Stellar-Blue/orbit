"use client";

import React, { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ShieldCheck, AlertCircle, Loader2, Zap, Lock, Sparkles } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";

function LoginContent() {
  const [isLoading, setIsLoading] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isDevMode } = useAuth();

  const errorCode = searchParams ? searchParams.get("error") : null;
  const errorDesc = searchParams ? searchParams.get("error_description") : null;

  const getErrorMessage = (code: string) => {
    if (errorDesc) {
      if (errorDesc.includes("AADSTS50194") || errorDesc.includes("multi-tenant")) {
        return "Azure AD Configuration Issue: App is set to Single-Tenant, but Supabase Provider is attempting to use the multi-tenant '/common' endpoint. Please enter your Azure Tenant ID in Supabase Azure Provider settings.";
      }
      return decodeURIComponent(errorDesc.replace(/\+/g, ' '));
    }

    switch (code) {
      case "InvalidDomain":
        return "Access Denied: Only authorized @stellarblue.gr accounts are permitted.";
      case "InvalidTenant":
        return "Security Alert: Microsoft Entra Tenant (tid) mismatch. Cross-tenant sign-in rejected.";
      case "UnprovisionedUser":
        return "Unidentified Employee: Your account exists in Azure AD but is not provisioned in Orbit directory.";
      case "InactiveAccount":
        return "Account Disabled: Your employment profile is offboarded or suspended.";
      case "invalid_request":
      case "OAuthProviderError":
        return "Microsoft Entra ID rejected the sign-in request. Check your Azure AD redirect URIs and tenant settings.";
      default:
        return "Authentication error occurred during OIDC verification. Please try again or contact support.";
    }
  };

  const handleMicrosoftLogin = async () => {
    setIsLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "azure",
        options: {
          scopes: "email profile offline_access",
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        console.error("Entra ID OAuth Initiator Error:", error.message);
        setIsLoading(false);
      }
    } catch (err) {
      console.error("Login initialization exception:", err);
      setIsLoading(false);
    }
  };

  const handleDevModeEnter = () => {
    setIsLoading(true);
    router.push("/");
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="relative z-10 w-full max-w-md rounded-2xl border border-slate-800/80 bg-slate-900/60 p-8 shadow-2xl backdrop-blur-xl md:p-10"
    >
      {/* Branding & Header */}
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 shadow-lg shadow-blue-500/25 ring-1 ring-white/20">
          <Sparkles className="h-7 w-7 text-white" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">
          StellarBlue Orbit
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Internal Enterprise Operating Platform
        </p>
        <div className="mt-3 flex items-center space-x-1.5 rounded-full border border-slate-800 bg-slate-950/80 px-3 py-1 text-[11px] font-medium text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
          <span>Single-Tenant SSO Protected</span>
        </div>
      </div>

      {/* Error Notification Badge */}
      {errorCode && (
        <motion.div 
          initial={{ opacity: 0, height: 0 }} 
          animate={{ opacity: 1, height: "auto" }}
          className="mb-6 flex items-start space-x-3 rounded-xl border border-red-500/30 bg-red-950/40 p-4 text-sm text-red-200 backdrop-blur-md"
        >
          <AlertCircle className="h-5 w-5 shrink-0 text-red-400 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-red-100">Authentication Rejected</p>
            <p className="text-xs text-red-300 mt-1 leading-relaxed">{getErrorMessage(errorCode)}</p>
          </div>
        </motion.div>
      )}

      {/* Authentication Options */}
      <div className="space-y-4">
        <button
          onClick={handleMicrosoftLogin}
          disabled={isLoading}
          className="group relative flex w-full items-center justify-center space-x-3 rounded-xl border border-slate-700/80 bg-gradient-to-b from-slate-800 to-slate-900 px-5 py-3.5 text-sm font-medium text-white shadow-lg transition-all duration-200 hover:border-slate-600 hover:from-slate-750 hover:to-slate-850 hover:shadow-xl hover:shadow-blue-900/10 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          ) : (
            <>
              {/* Authentic Microsoft Logo SVG */}
              <svg className="h-5 w-5 shrink-0 transition-transform duration-200 group-hover:scale-105" viewBox="0 0 21 21">
                <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
              </svg>
              <span className="font-semibold tracking-wide">Sign in with Microsoft Entra ID</span>
            </>
          )}
        </button>

        {/* Local Dev Mode Bypass (Only displayed during local development) */}
        {isDevMode && (
          <div className="mt-6 pt-6 border-t border-slate-800/80">
            <div className="mb-3 flex items-center justify-between text-xs">
              <span className="flex items-center text-amber-400 font-medium">
                <Zap className="h-3.5 w-3.5 mr-1 text-amber-400 fill-amber-400/20" />
                Dev Auth Mode Active
              </span>
              <span className="text-[10px] text-slate-500 font-mono">Bypasses OIDC</span>
            </div>
            <button
              onClick={handleDevModeEnter}
              disabled={isLoading}
              className="flex w-full items-center justify-center space-x-2 rounded-xl border border-amber-500/20 bg-amber-950/20 px-4 py-2.5 text-xs font-semibold text-amber-300 hover:bg-amber-950/40 hover:border-amber-500/40 transition duration-200 active:scale-[0.99]"
            >
              <span>Enter Workspace (Mock User Switcher)</span>
            </button>
          </div>
        )}
      </div>

      {/* Security Footer Notice */}
      <div className="mt-8 flex items-center justify-center space-x-1.5 text-center text-xs text-slate-500">
        <Lock className="h-3.5 w-3.5 text-slate-600" />
        <span>Authorized personnel only. Sessions are cryptographically audited.</span>
      </div>
    </motion.div>
  );
}

export default function LoginPage() {
  return (
    <div className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-slate-950 p-6">
      {/* Dynamic Ambient Background Glows */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-blue-600/15 blur-3xl" />
      <div className="pointer-events-none absolute top-1/3 -right-40 h-[28rem] w-[28rem] rounded-full bg-indigo-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 left-1/3 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl" />

      {/* Grid Pattern Layer */}
      <div 
        className="pointer-events-none absolute inset-0 opacity-[0.03]" 
        style={{ 
          backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
          backgroundSize: '32px 32px' 
        }} 
      />

      <Suspense fallback={
        <div className="relative z-10 flex h-64 w-full max-w-md items-center justify-center rounded-2xl border border-slate-800/80 bg-slate-900/60 shadow-2xl backdrop-blur-xl">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      }>
        <LoginContent />
      </Suspense>
    </div>
  );
}
