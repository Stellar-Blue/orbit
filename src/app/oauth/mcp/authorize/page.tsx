"use client";

import React, { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { 
  ShieldCheck, AlertTriangle, Loader2, Sparkles, Terminal, CheckCircle2, 
  XCircle, Lock, Key, ArrowRight, Building2, UserCheck, FileText, DollarSign, Database
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Card, Button, Badge } from "@/components/ui/primitives";
import { isAllowedMcpRedirectUri } from "@/lib/redirects";

function McpAuthorizeContent() {
  const { currentUser, isDevMode } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const clientId = searchParams ? searchParams.get("client_id") || "Claude (Anthropic Custom Connector)" : "Claude AI";
  const redirectUri = searchParams ? searchParams.get("redirect_uri") || "https://claude.ai/api/mcp/callback" : "https://claude.ai/api/mcp/callback";
  const stateParam = searchParams ? searchParams.get("state") || "orbit_state_val" : "orbit_state_val";
  const requestedScope = searchParams ? searchParams.get("scope") || "invoices.admin" : "invoices.admin";
  const codeChallenge = searchParams?.get("code_challenge") || "";
  const codeChallengeMethod = searchParams?.get("code_challenge_method") || "";

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [authorizedData, setAuthorizedData] = useState<{ code: string; redirect_url: string; expires_in: number } | null>(null);

  const isAdmin = currentUser?.role === "admin";

  const handleAuthorize = async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/v1/mcp/oauth/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          state: stateParam,
          scope: requestedScope,
          code_challenge: codeChallenge,
          code_challenge_method: codeChallengeMethod,
          userId: currentUser?.id || "00000000-0000-0000-0000-000000000001"
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setErrorMessage(data.error_description || "Authorization failed during policy check.");
        setIsLoading(false);
        return;
      }

      setAuthorizedData(data);

      // If redirecting to a real remote host, bounce immediately; if local simulation, allow user to view generated code
      if (!redirectUri.includes("localhost") && !redirectUri.includes("test")) {
        setTimeout(() => {
          window.location.href = data.redirect_url;
        }, 1200);
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Network error while communicating with Orbit OAuth engine.");
      setIsLoading(false);
    }
  };

  const handleDecline = () => {
    if (isAllowedMcpRedirectUri(redirectUri) && !redirectUri.includes("localhost")) {
      const rej = new URL(redirectUri);
      rej.searchParams.set("error", "access_denied");
      rej.searchParams.set("error_description", "User declined financial MCP authorization.");
      if (stateParam) rej.searchParams.set("state", stateParam);
      window.location.href = rej.toString();
    } else {
      router.push("/invoices");
    }
  };

  if (authorizedData) {
    return (
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg rounded-3xl border border-emerald-200/80 bg-white p-8 shadow-2xl text-center mx-auto my-12"
      >
        <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-6 shadow-md">
          <CheckCircle2 className="w-10 h-10 stroke-[2.5]" />
        </div>
        <h2 className="text-2xl font-black text-slate-900">OAuth Authorization Approved</h2>
        <p className="text-xs text-slate-500 mt-2 font-medium">
          Successfully authorized <span className="font-extrabold text-slate-800">{clientId}</span> to connect to your Orbit Admin profile with ≤ 8-hour token limits.
        </p>

        <div className="mt-6 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-left text-xs font-mono break-all space-y-2">
          <div>
            <span className="text-slate-400 font-bold block text-[10px] uppercase">Authorization Code:</span>
            <span className="text-emerald-700 font-black">{authorizedData.code}</span>
          </div>
          <div>
            <span className="text-slate-400 font-bold block text-[10px] uppercase">Callback Target URL:</span>
            <span className="text-slate-700 font-semibold">{authorizedData.redirect_url}</span>
          </div>
        </div>

        <div className="mt-8 flex gap-3 justify-center">
          <Button 
            onClick={() => window.location.href = authorizedData.redirect_url} 
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold px-6 py-3 rounded-2xl text-xs flex items-center gap-2"
          >
            <span>Proceed to Claude Callback</span>
            <ArrowRight className="w-4 h-4" />
          </Button>
          <Button 
            onClick={() => router.push("/invoices")} 
            variant="secondary"
            className="px-5 py-3 rounded-2xl text-xs font-bold text-slate-600"
          >
            Return to Financial Hub
          </Button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-xl rounded-3xl border border-slate-200/80 bg-white p-8 md:p-10 shadow-2xl mx-auto my-8 relative"
    >
      {/* Header & Logo */}
      <div className="flex flex-col items-center text-center pb-6 border-b border-slate-100">
        <div className="flex items-center gap-2 mb-3">
          <Badge variant="info" className="bg-slate-900 text-cyan-400 border border-slate-700 font-mono text-[11px] px-3 py-1 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            OAuth 2.0 Authorization Code Flow
          </Badge>
        </div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight md:text-3xl">
          Authorize AI Operator
        </h1>
        <p className="text-xs text-slate-500 mt-2 max-w-md">
          A client application is requesting permission to connect to Orbit&apos;s Financial Common Truth ledger and execute actions as your authenticated user profile.
        </p>
      </div>

      {/* Requester Client Details */}
      <div className="mt-6 p-5 rounded-2xl bg-gradient-to-r from-slate-900 to-indigo-950 text-white flex items-center justify-between shadow-md">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-cyan-400 flex-shrink-0">
            <Terminal className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[11px] text-slate-400 font-bold uppercase block">Requesting MCP Client</span>
            <span className="text-base font-black text-white block">{clientId}</span>
            <span className="text-[11px] text-cyan-300/80 block mt-0.5">Redirecting to: {redirectUri}</span>
          </div>
        </div>
        <Sparkles className="w-6 h-6 text-amber-400 flex-shrink-0 animate-pulse hidden sm:block" />
      </div>

      {/* Requested Scopes Card */}
      <div className="mt-6">
        <h3 className="text-xs font-black uppercase text-slate-400 tracking-wider mb-3 flex items-center gap-1.5">
          <Key className="w-3.5 h-3.5 text-slate-600" />
          Requested Financial Capabilities ({requestedScope})
        </h3>

        <div className="space-y-2.5 text-xs font-medium text-slate-700">
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 flex items-start gap-3">
            <Database className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-slate-900 block">Read & Interrogate Counterparty Registry</span>
              <span className="text-slate-500 text-[11px]">Search verified vendors via ΑΦΜ tax numbers and check active contract billing schedules.</span>
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 flex items-start gap-3">
            <FileText className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-slate-900 block">Register Verified Tax Invoices</span>
              <span className="text-slate-500 text-[11px]">Propose new incoming/outgoing invoices into Orbit with cent-exact arithmetic validation.</span>
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 flex items-start gap-3">
            <DollarSign className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-slate-900 block">Link Document Archives & Settlements</span>
              <span className="text-slate-500 text-[11px]">Upload digital tax PDF archives and record bank payment transactions against open receivables.</span>
            </div>
          </div>
        </div>
      </div>

      {/* Mapped Profile & Admin Role Security Check (§3) */}
      <div className="mt-6 pt-6 border-t border-slate-100">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
            <UserCheck className="w-4 h-4 text-slate-600" />
            Authenticating Orbit Profile:
          </span>
          <Badge variant={isAdmin ? "success" : "neutral"} className="text-xs font-extrabold">
            Role: {currentUser?.role?.toUpperCase() || "UNKNOWN"}
          </Badge>
        </div>

        <div className="p-4 rounded-2xl border border-slate-200/80 bg-slate-50/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#2f6fa3] text-white font-black flex items-center justify-center text-sm shadow-xs">
              {currentUser?.first_name?.charAt(0) || "U"}
            </div>
            <div>
              <span className="font-extrabold text-slate-900 text-xs block">{currentUser ? `${currentUser.first_name} ${currentUser.last_name}` : "Admin User"}</span>
              <span className="text-[11px] text-slate-400 block">{currentUser?.work_email || "admin@stellarblue.eu"}</span>
            </div>
          </div>

          {isAdmin ? (
            <span className="text-xs font-bold text-emerald-700 flex items-center gap-1">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Authorized Admin
            </span>
          ) : (
            <span className="text-xs font-bold text-rose-600 flex items-center gap-1">
              <XCircle className="w-4 h-4 text-rose-500" />
              Role Denied
            </span>
          )}
        </div>

        {!isAdmin && (
          <div className="mt-3 p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 text-xs font-medium flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-extrabold block">Access Denied: Admin Privilege Required</span>
              <span>
                Section 3 System Rules dictate that only verified corporate Administrators can authorize AI MCP connectors. Your current session holds standard user permissions.
              </span>
            </div>
          </div>
        )}
      </div>

      {errorMessage && (
        <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Action Buttons */}
      <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-end gap-3">
        <Button 
          onClick={handleDecline} 
          variant="secondary" 
          disabled={isLoading}
          className="px-6 py-3.5 rounded-2xl text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100"
        >
          Decline & Cancel
        </Button>
        
        <Button 
          onClick={handleAuthorize}
          disabled={!isAdmin || isLoading}
          className={`px-8 py-3.5 rounded-2xl font-black text-xs shadow-lg flex items-center gap-2 transition-all ${
            isAdmin 
              ? "bg-gradient-to-r from-slate-900 to-indigo-950 text-white hover:from-slate-800 hover:to-indigo-900 shadow-indigo-950/20" 
              : "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none"
          }`}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Verifying Policy...</span>
            </>
          ) : (
            <>
              <ShieldCheck className="w-4 h-4 stroke-[2.5] text-cyan-400" />
              <span>Authorize AI Operator Connection</span>
            </>
          )}
        </Button>
      </div>
    </motion.div>
  );
}

export default function McpAuthorizePage() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <Suspense fallback={<div className="text-center py-20 font-bold text-slate-500 animate-pulse">Loading OAuth 2.0 Consent Engine...</div>}>
        <McpAuthorizeContent />
      </Suspense>
    </div>
  );
}
