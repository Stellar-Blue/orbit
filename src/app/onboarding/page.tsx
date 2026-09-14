"use client";

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatDateTime } from '@/lib/date';
import { Button, Card } from '@/components/ui/primitives';
import { ShieldCheck, AlertTriangle, Clock, LogOut, CheckCircle2, Loader2, MessageSquare } from 'lucide-react';
import { EmployeeIntegration, IntegrationExemption } from '@/lib/integrations/types';

const ERROR_MESSAGES: Record<string, string> = {
  slack_oauth_failed: 'Slack connection failed. Please try again.',
  slack_missing_code: 'Slack did not return an authorization code. Please try again.',
  slack_token_unusable: 'The Slack token could not be verified with a test profile read. Please reconnect.',
  token_store_failed: 'Orbit could not securely store the Slack token. Please contact an administrator.',
};

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">Loading…</div>}>
      <OnboardingInner />
    </Suspense>
  );
}

function OnboardingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/';
  const errorParam = searchParams.get('error');
  const graceParam = searchParams.get('grace') === '1';
  const { currentUser, signOut } = useAuth();

  const [loading, setLoading] = useState(true);
  const [integration, setIntegration] = useState<EmployeeIntegration | null>(null);
  const [exemption, setExemption] = useState<IntegrationExemption | null>(null);

  useEffect(() => {
    const profileId = currentUser?.id;
    if (!profileId) return; // wait for the real profile before querying (avoids the fallback profile)
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseBrowserClient();
      const [{ data: integ }, { data: ex }] = await Promise.all([
        supabase.from('employee_integrations').select('*').eq('profile_id', profileId).eq('provider', 'slack').maybeSingle(),
        supabase.from('integration_exemptions').select('*').eq('profile_id', profileId).eq('provider', 'slack').limit(1).maybeSingle(),
      ]);
      if (cancelled) return;
      setIntegration((integ as EmployeeIntegration) || null);
      setExemption((ex as IntegrationExemption) || null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  useEffect(() => {
    if (loading) return;
    const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
    // Slack isn't required for this user — never hold them on the gate.
    if (currentUser.id && !currentUser.slack_required) {
      router.replace(safeNext);
      return;
    }
    // Already fully onboarded with a live token → open the app at the intended destination
    if (currentUser.onboarding_completed_at && integration?.status === 'connected') {
      router.replace(safeNext);
    }
  }, [loading, currentUser.id, currentUser.slack_required, currentUser.onboarding_completed_at, integration, next, router]);

  const isRevoked = integration?.status === 'revoked';
  const needsConnect = !integration || integration.status !== 'connected';

  const connect = () => {
    window.location.href = `/api/slack/connect?next=${encodeURIComponent(next)}`;
  };

  const exemptionText = exemption?.expires_at
    ? `This access expires ${formatDateTime(exemption.expires_at)}`
    : 'This access is permanent (admin-granted).';

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950">
      <Card className="w-full max-w-lg p-0 overflow-hidden shadow-2xl border-slate-700/60 rounded-3xl">
        <div className="p-6 bg-gradient-to-r from-[#3D87D3] to-indigo-600 text-white">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center">
              <MessageSquare className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight">Welcome to Orbit</h1>
              <p className="text-xs text-blue-100">One quick step before you start</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Confirm your profile</div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-bold text-slate-900">{currentUser.first_name} {currentUser.last_name}</div>
                <div className="text-xs text-slate-500 font-mono">{currentUser.work_email}</div>
              </div>
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
            </div>
          </div>

          {errorParam && ERROR_MESSAGES[errorParam] && (
            <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 text-sm text-rose-800 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-bold">Connection failed</div>
                <div className="text-xs mt-0.5">{ERROR_MESSAGES[errorParam]}</div>
              </div>
            </div>
          )}

          {graceParam && exemption && (
            <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800 flex items-start gap-2.5">
              <Clock className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-bold">Temporary access granted</div>
                <div className="text-xs mt-0.5">
                  Slack had an outage during connection. {exemptionText} After this window, connect Slack to keep using Orbit.
                </div>
              </div>
            </div>
          )}

          {!graceParam && exemption && (
            <div className="rounded-2xl bg-blue-50 border border-blue-200 p-4 text-sm text-blue-800 flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-bold">Slack requirement deferred by an administrator</div>
                <div className="text-xs mt-0.5">{exemptionText}</div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8 text-slate-400 gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Checking integration status…
            </div>
          ) : needsConnect ? (
            <div className="space-y-3">
              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 text-xs text-slate-600 leading-relaxed">
                Orbit mirrors your leave and remote days to Slack so your team always sees your status.
                <strong> Connecting Slack is required</strong> — it takes one click. You can change or remove the connection later from your profile.
              </div>
              <Button
                onClick={connect}
                className="w-full bg-[#3D87D3] hover:bg-blue-600 text-white font-black py-3 shadow-lg shadow-blue-500/20 cursor-pointer"
              >
                <MessageSquare className="w-5 h-5 mr-2" />
                {isRevoked ? 'Reconnect Slack' : 'Connect Slack'}
              </Button>
            </div>
          ) : (
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-800 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-bold">Slack connected</div>
                <div className="text-xs mt-0.5">Opening Orbit…</div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <span className="text-[10px] text-slate-400 font-mono">Slack connection required by company policy</span>
            <button
              onClick={signOut}
              className="text-[11px] font-bold text-slate-500 hover:text-rose-600 flex items-center gap-1 cursor-pointer"
            >
              <LogOut className="w-3 h-3" /> Sign out
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
