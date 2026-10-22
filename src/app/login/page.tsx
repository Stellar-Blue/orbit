"use client";

import React, { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ShieldCheck, AlertCircle, Loader2, Zap, Lock, Sparkles } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";

function LoginContent() {
  const [isLoading, setIsLoading] = useState(false);
  const searchParams = useSearchParams();
  const { isDevMode, companyProfile } = useAuth();

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
        return "Access Denied: Only authorized @stellarblue.eu or @stellarblue.gr accounts are permitted.";
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
      const nextTarget = searchParams ? searchParams.get("next") : null;
      const redirectTo = nextTarget 
        ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextTarget)}`
        : `${window.location.origin}/auth/callback`;

      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "azure",
        options: {
          scopes: "email profile offline_access",
          redirectTo,
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
    const nextTarget = searchParams ? searchParams.get("next") : null;
    // The middleware gates the workspace on a real session; this cookie is the only way it lets a
    // local prototype through, and it is only honoured while DEV_AUTH_MODE is on outside production.
    document.cookie = "orbit_dev_workspace=1; path=/; SameSite=Lax; max-age=28800";
    // Full reload, so the layout re-mounts and the provider re-reads its slices for this identity.
    window.location.assign(nextTarget || "/");
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-8 shadow-xl md:p-10"
    >
      {/* Branding & Header */}
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="mb-4 flex items-center justify-center">
          <img src={companyProfile?.logo_url || "/logo.png"} alt={companyProfile?.name || "StellarBlue"} className="h-10 object-contain drop-shadow-2xs" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-800 md:text-3xl">
          Orbit Workspace
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Internal Enterprise Operating Platform
        </p>
        <div className="mt-3 flex items-center space-x-1.5 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          <span>Single-Tenant SSO Protected</span>
        </div>
      </div>

      {/* Error Notification Badge */}
      {errorCode && (
        <motion.div 
          initial={{ opacity: 0, height: 0 }} 
          animate={{ opacity: 1, height: "auto" }}
          className="mb-6 flex items-start space-x-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
        >
          <AlertCircle className="h-5 w-5 shrink-0 text-rose-600 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-rose-900">Authentication Rejected</p>
            <p className="text-xs text-rose-700 mt-1 leading-relaxed">{getErrorMessage(errorCode)}</p>
          </div>
        </motion.div>
      )}

      {/* Authentication Options */}
      <div className="space-y-4">
        <button
          onClick={handleMicrosoftLogin}
          disabled={isLoading}
          className="group relative flex w-full items-center justify-center space-x-3 rounded-xl border border-slate-300 bg-white px-5 py-3.5 text-sm font-semibold text-slate-700 shadow-xs transition-all duration-200 hover:bg-slate-50 hover:border-slate-400 hover:text-slate-900 hover:shadow-sm active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
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
              <span className="tracking-wide">Sign in with Microsoft Entra ID</span>
            </>
          )}
        </button>

        {/* Local Dev Mode Bypass (Only displayed during local development) */}
        {isDevMode && (
          <div className="mt-6 pt-6 border-t border-slate-150">
            <div className="mb-3 flex items-center justify-between text-xs">
              <span className="flex items-center text-[#3D87D3] font-semibold">
                <Zap className="h-3.5 w-3.5 mr-1 text-[#3D87D3] fill-[#3D87D3]/20" />
                Dev Auth Mode Active
              </span>
              <span className="text-[10px] text-slate-400 font-sans">Bypasses OIDC</span>
            </div>
            <button
              onClick={handleDevModeEnter}
              disabled={isLoading}
              className="flex w-full items-center justify-center space-x-2 rounded-xl border border-[#3D87D3]/20 bg-[#3D87D3]/10 px-4 py-2.5 text-xs font-semibold text-[#3D87D3] hover:bg-[#3D87D3]/20 transition duration-200 active:scale-[0.99] cursor-pointer"
            >
              <span>Enter Workspace (Mock User Switcher)</span>
            </button>
          </div>
        )}
      </div>

      {/* Security Footer Notice */}
      <div className="mt-8 flex items-center justify-center space-x-1.5 text-center text-xs text-slate-400">
        <Lock className="h-3.5 w-3.5 text-slate-400" />
        <span>Authorized personnel only. Sessions are cryptographically audited.</span>
      </div>
    </motion.div>
  );
}

export default function LoginPage() {
  return (
    <div className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-slate-50 p-6">
      <Suspense fallback={
        <div className="relative z-10 flex h-64 w-full max-w-md items-center justify-center rounded-2xl border border-slate-200/80 bg-white shadow-xl">
          <Loader2 className="h-8 w-8 animate-spin text-[#3D87D3]" />
        </div>
      }>
        <LoginContent />
      </Suspense>
    </div>
  );
}
