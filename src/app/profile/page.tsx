"use client";

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { roleLabel } from '@/lib/profile-role';
import { Card, Button, Badge } from '@/components/ui/primitives';
import { BlurredReveal } from '@/components/ui/blurred-reveal';
import { formatDate, formatDateTime } from '@/lib/date';
import { Camera, Check, Edit3, Loader2, MessageSquare, RefreshCw, Trash2, UserRound, Calendar, Mail, Phone, Briefcase, CalendarDays, AlertTriangle, FileText } from 'lucide-react';

export default function MyProfilePage() {
  return (
    <Suspense fallback={<div className="text-slate-400 text-sm">Loading profile…</div>}>
      <MyProfileInner />
    </Suspense>
  );
}

function MyProfileInner() {
  const { currentUser, updateMyProfile, slackIntegration, myIntegrationExemption, revokeSlackConnection, employeeIntegrations, refreshIntegrationState, profileRoleHistory, jobRoles, seniorityLevels } = useAuth();
  const searchParams = useSearchParams();
  const msalError = searchParams.get('msal');
  // Only ever rendered as text, and clamped: the code is ours or Microsoft's AADSTS number.
  const msalCodeRaw = searchParams.get('code') || '';
  const msalCode = /^(AADSTS\d{3,7}|[a-z_]{3,40})$/i.test(msalCodeRaw) ? msalCodeRaw : '';

  // Scope to my own row — an admin loads every employee's integration rows.
  const m365Integration = employeeIntegrations.find(i => i.provider === 'm365' && i.profile_id === currentUser.id) || null;

  const MSAL_ERRORS: Record<string, string> = {
    not_configured: 'This deployment has no Microsoft Graph credentials configured (GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_TENANT_ID).',
    no_session: 'Orbit has no Supabase session in this browser, and Microsoft sign-in is tied to it. Local dev mode signs you in as a mock profile, so connect from the deployed app.',
    no_profile: 'Signed in, but there is no employee profile linked to your account yet.',
    state: 'Sign-in came back to a different address than it started from. The redirect URI in the Azure app registration must match the address you are using Orbit on.',
    identity: 'Sign-in completed for a different account than the one signed in to Orbit.',
    error: 'Microsoft sign-in failed or was interrupted.',
    cancelled: 'Microsoft sign-in was cancelled.',
    exchange_failed: 'Microsoft rejected the authorization code (check the app registration: redirect URI and delegated Calendars.ReadWrite permission).',
    store_failed: 'Orbit could not securely store your Microsoft session. Please contact an administrator.',
  };

  // A blocked consent (not a genuine cancel) means an Entra admin must approve the Orbit
  // app for the tenant. Microsoft reports it as consent_required / access_denied or an
  // AADSTS code; point the employee at the fix instead of "sign-in was cancelled".
  const consentBlocked = msalCode === 'consent_required' || msalCode === 'AADSTS65001' || msalCode === 'AADSTS90094';
  const msalErrorMessage = msalError
    ? consentBlocked
      ? 'Your organization requires an administrator to approve the Orbit app before you can connect Outlook. Ask a Microsoft admin to grant consent in Settings → Integrations → Outlook.'
      : MSAL_ERRORS[msalError]
    : null;

  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(currentUser.first_name);
  const [lastName, setLastName] = useState(currentUser.last_name);
  const [nameEl, setNameEl] = useState(currentUser.name_el);
  const [phone, setPhone] = useState(currentUser.phone || '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const team = currentUser.team?.name || '—';
  const initials = `${currentUser.first_name[0] || ''}${currentUser.last_name[0] || ''}`.toUpperCase();
  const isRevoked = slackIntegration?.status === 'revoked';
  const isConnected = slackIntegration?.status === 'connected';

  const handleUploadPhoto = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/profile/photo', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Upload failed');
      const ok = await updateMyProfile({ photo_url: data.url });
      if (!ok) throw new Error('Failed to persist photo URL');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      alert(`Photo upload failed: ${msg}`);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const ok = await updateMyProfile({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      name_el: nameEl.trim() || `${firstName.trim()} ${lastName.trim()}`,
      phone: phone.trim() || null,
    });
    setSaving(false);
    if (ok) {
      setEditing(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    }
  };

  const handleRevoke = async () => {
    if (!confirm('Disconnect Slack? Orbit will stop mirroring your leave & remote statuses, and you will be asked to reconnect at your next sign-in.')) return;
    setRevoking(true);
    await revokeSlackConnection();
    setRevoking(false);
  };

  const connectUrl = `/api/slack/connect?next=${encodeURIComponent('/profile')}`;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">My Profile</h1>
        <p className="text-xs text-slate-500 mt-0.5">Your personal information, photo and integration connections</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: identity card */}
        <Card className="p-6 flex flex-col items-center text-center">
          <div className="relative">
            <div className="w-28 h-28 rounded-full bg-gradient-to-tr from-[#3D87D3] to-indigo-600 text-white flex items-center justify-center text-3xl font-black shadow-lg shadow-blue-500/20 overflow-hidden">
              {currentUser.photo_url ? (
                <img src={currentUser.photo_url} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <span>{initials}</span>
              )}
            </div>
            {currentUser.photo_url && (
              <button
                type="button"
                onClick={async () => {
                  if (!confirm('Remove your profile photo?')) return;
                  const res = await fetch('/api/profile/photo', { method: 'DELETE' });
                  if (res.ok) {
                    await updateMyProfile({ photo_url: null });
                  } else {
                    alert('Failed to remove profile photo');
                  }
                }}
                className="absolute bottom-1 right-1 w-8 h-8 rounded-full bg-rose-500 text-white border-2 border-white shadow-md flex items-center justify-center cursor-pointer hover:bg-rose-600 transition-colors z-10"
                title="Remove profile photo"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <label
              className={`absolute top-1 right-1 w-8 h-8 rounded-full bg-white border border-slate-200 shadow-md flex items-center justify-center cursor-pointer hover:bg-slate-50 transition-colors ${uploading ? 'pointer-events-none opacity-60' : ''}`}
              title="Upload or replace profile photo"
            >
              {uploading ? <Loader2 className="w-4 h-4 text-slate-400 animate-spin" /> : <Camera className="w-4 h-4 text-slate-600" />}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleUploadPhoto(f);
                  e.target.value = '';
                }}
              />
            </label>
          </div>

          <h2 className="text-lg font-black text-slate-900 mt-4">{currentUser.first_name} {currentUser.last_name}</h2>
          <p className="text-sm text-slate-500 font-medium">{roleLabel(currentUser, profileRoleHistory, jobRoles, seniorityLevels)}</p>
          <div className="flex items-center gap-2 mt-2">
            <Badge variant="info">{currentUser.employment_type.replace('_', ' ').toUpperCase()}</Badge>
            <Badge variant={currentUser.role === 'admin' ? 'warning' : 'neutral'}>{currentUser.role.toUpperCase()}</Badge>
          </div>

          <div className="w-full mt-5 space-y-2.5 text-left">
            <div className="flex items-center gap-2.5 text-xs text-slate-600">
              <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="font-mono truncate">{currentUser.work_email}</span>
            </div>
            {currentUser.phone && (
              <div className="flex items-center gap-2.5 text-xs text-slate-600">
                <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="font-mono truncate">{currentUser.phone}</span>
              </div>
            )}
            <div className="flex items-center gap-2.5 text-xs text-slate-600">
              <Briefcase className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>{team}</span>
            </div>
            <div className="flex items-center gap-2.5 text-xs text-slate-600">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>Started {formatDate(currentUser.start_date)}</span>
            </div>
          </div>
        </Card>

        {/* Right: editable details */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <UserRound className="w-4 h-4 text-[#3D87D3]" /> Personal Information
              </h3>
              {savedFlash && <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1 flex items-center gap-1"><Check className="w-3 h-3" /> Saved</span>}
            </div>

            {editing ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-1">First Name</label>
                  <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} className="w-full p-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-1">Last Name</label>
                  <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} className="w-full p-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-1">Name (Greek)</label>
                  <input type="text" value={nameEl} onChange={e => setNameEl(e.target.value)} className="w-full p-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-1">Phone</label>
                  <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+30 ..." className="w-full p-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800" />
                </div>
                <div className="flex items-center gap-2 sm:col-span-2 pt-1">
                  <Button size="sm" variant="primary" onClick={handleSave} disabled={saving} className="bg-[#3D87D3] text-white cursor-pointer">
                    {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1.5" />}
                    {saving ? 'Saving…' : 'Save Changes'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setEditing(false); setFirstName(currentUser.first_name); setLastName(currentUser.last_name); setNameEl(currentUser.name_el); setPhone(currentUser.phone || ''); }} className="cursor-pointer">
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">First Name</div>
                  <div className="text-sm font-bold text-slate-800 mt-0.5">{currentUser.first_name}</div>
                </div>
                <div>
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Last Name</div>
                  <div className="text-sm font-bold text-slate-800 mt-0.5">{currentUser.last_name}</div>
                </div>
                <div>
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Name (Greek)</div>
                  <div className="text-sm font-bold text-slate-800 mt-0.5">{currentUser.name_el || '—'}</div>
                </div>
                <div>
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Role &amp; Seniority</div>
                  <div className="text-sm font-bold text-slate-800 mt-0.5">{roleLabel(currentUser, profileRoleHistory, jobRoles, seniorityLevels)}</div>
                </div>
                <div>
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Phone</div>
                  <div className="text-sm font-bold text-slate-800 mt-0.5 font-mono">{currentUser.phone || '—'}</div>
                </div>
                <div className="sm:col-span-2 pt-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)} className="cursor-pointer">
                    <Edit3 className="w-3.5 h-3.5 mr-1.5" /> Edit Information
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {/* Slack connection. Always rendered: hiding it on a stale/blocked integration
              read would strand a connected user with no way to disconnect. */}
          <Card className="p-6">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2 mb-1">
              <MessageSquare className="w-4 h-4 text-[#3D87D3]" /> Slack Status Mirroring
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Orbit mirrors your approved leave and remote days to Slack with self-clearing statuses. Orbit is master; Slack never writes back.
            </p>

            {isConnected ? (
              <div className="rounded-2xl bg-emerald-50/60 border border-emerald-200/80 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-200 flex items-center justify-center">
                    <MessageSquare className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      Connected
                      <Badge variant="success" className="text-[9px] px-1.5 py-0">ACTIVE</Badge>
                    </div>
                    <div className="text-xs text-slate-500 font-mono mt-0.5">
                      {slackIntegration?.external_user_id ? `Slack user: ${slackIntegration.external_user_id}` : 'User token linked'}
                      {slackIntegration?.last_synced_at && <> · last synced {formatDateTime(slackIntegration.last_synced_at)}</>}
                    </div>
                  </div>
                </div>
                <Button size="sm" variant="danger" onClick={handleRevoke} disabled={revoking} className="shrink-0 cursor-pointer">
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" /> {revoking ? 'Disconnecting…' : 'Disconnect'}
                </Button>
              </div>
            ) : (
              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-200/60 flex items-center justify-center">
                    <MessageSquare className="w-5 h-5 text-slate-500" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      {isRevoked ? 'Connection revoked' : 'Not connected'}
                      <Badge variant={isRevoked ? 'error' : 'neutral'} className="text-[9px] px-1.5 py-0">{isRevoked ? 'REVOKED' : 'OFF'}</Badge>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {!currentUser.slack_required
                        ? 'Slack mirroring is optional for your account. Connect if you want Orbit to mirror your leave & remote statuses.'
                        : myIntegrationExemption
                          ? `Temporarily exempt${myIntegrationExemption.expires_at ? ` until ${formatDateTime(myIntegrationExemption.expires_at)}` : ''} (admin-granted)`
                          : isRevoked
                            ? 'Orbit can no longer mirror your status. Reconnect to keep the mirror active.'
                            : 'Connect Slack so Orbit can mirror your leave & remote statuses.'}
                    </div>
                  </div>
                </div>
                <a href={connectUrl} className="inline-flex items-center justify-center px-4 py-2 text-xs font-bold bg-[#3D87D3] hover:bg-blue-600 text-white rounded-xl shadow-md shadow-blue-500/20 transition-all no-underline shrink-0">
                  {isRevoked ? <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> : <MessageSquare className="w-3.5 h-3.5 mr-1.5" />}
                  {isRevoked ? 'Reconnect Slack' : 'Connect Slack'}
                </a>
              </div>
            )}
          </Card>
          {msalErrorMessage && (
            <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 text-sm text-rose-800 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-bold">Microsoft connection failed</div>
                <div className="text-xs mt-0.5">{msalErrorMessage}</div>
                {msalCode && <div className="text-[11px] mt-1 font-mono">Reported: {msalCode}</div>}
              </div>
            </div>
          )}

          {/* Outlook / Microsoft 365 work plan */}
          <Card className="p-6">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2 mb-1">
              <CalendarDays className="w-4 h-4 text-blue-500" /> Outlook Work Plan & Calendar
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Orbit updates your Outlook work plan (office / remote days) and mirrors approved leave as Out of office events, so colleagues and scheduling assistants see your availability. Requires one Microsoft sign-in.
            </p>

            {(() => {
              const connected = m365Integration?.status === 'connected';
              return connected ? (
                <div className="rounded-2xl bg-emerald-50/60 border border-emerald-200/80 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-200 flex items-center justify-center">
                      <CalendarDays className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                        Connected
                        <Badge variant="success" className="text-[9px] px-1.5 py-0">ACTIVE</Badge>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {m365Integration.last_synced_at
                          ? <>Last synced {formatDateTime(m365Integration.last_synced_at)}</>
                          : 'Ready for next sync'}
                      </div>
                    </div>
                  </div>
                  <Button size="sm" variant="danger" onClick={async () => {
                    if (!confirm('Disconnect Microsoft? Orbit will stop updating your Outlook work plan and calendar.')) return;
                    const res = await fetch('/api/msal/revoke', { method: 'POST' });
                    if (res.ok) await refreshIntegrationState();
                  }} className="shrink-0 cursor-pointer">
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Disconnect
                  </Button>
                </div>
              ) : (
                <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-200/60 flex items-center justify-center">
                      <CalendarDays className="w-5 h-5 text-slate-500" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                        {m365Integration?.status === 'revoked' ? 'Connection revoked' : 'Not connected'}
                        <Badge variant={m365Integration?.status === 'revoked' ? 'error' : 'neutral'} className="text-[9px] px-1.5 py-0">{m365Integration?.status === 'revoked' ? 'REVOKED' : 'OFF'}</Badge>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {m365Integration?.status === 'revoked'
                          ? 'Reconnect to resume work plan & calendar mirroring.'
                          : 'Connect once to enable Outlook mirroring for your leave and remote days.'}
                      </div>
                    </div>
                  </div>
                  <a href={`/api/msal/connect?next=${encodeURIComponent('/profile')}`} className="inline-flex items-center justify-center px-4 py-2 text-xs font-bold bg-[#3D87D3] hover:bg-blue-600 text-white rounded-xl shadow-md shadow-blue-500/20 transition-all no-underline shrink-0">
                    <CalendarDays className="w-3.5 h-3.5 mr-1.5" />
                    {m365Integration?.status === 'revoked' ? 'Reconnect Microsoft' : 'Connect Microsoft'}
                  </a>
                </div>
              );
            })()}
          </Card>

          {/* Personal & financial data (managed by HR admins in People Directory) */}
          <Card className="p-6">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2 mb-1">
              <FileText className="w-4 h-4 text-amber-500" /> Personal & Financial Data
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Your records on file with HR. Managed by administrators in the People Directory — contact them to correct anything.
            </p>
            {currentUser.sensitive ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  ['ΑΦΜ (Tax ID)', currentUser.sensitive.afm],
                  ['ΑΜΚΑ (Social Security)', currentUser.sensitive.amka],
                  ['ΑΜΑ ΕΦΚΑ', currentUser.sensitive.ama_efka],
                  ['Bank', currentUser.sensitive.bank_name],
                  ['IBAN', currentUser.sensitive.iban],
                  ['SWIFT / BIC', currentUser.sensitive.bank_swift],
                  ['Address', currentUser.sensitive.address],
                  ['Birth Date', currentUser.sensitive.birth_date],
                  ['ID Number', currentUser.sensitive.id_number],
                ].map(([label, value]) => (
                  <div key={label as string} className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">{label}</div>
                    {['ΑΦΜ (Tax ID)', 'ΑΜΚΑ (Social Security)', 'IBAN'].includes(label as string) ? (
                      <BlurredReveal value={value as string | null} className="mt-0.5" />
                    ) : (
                      <div className={`text-sm font-bold text-slate-800 mt-0.5 ${label === 'Bank' ? '' : 'font-mono'}`}>
                        {label === 'SWIFT / BIC'
                          ? ((value as string | null)?.trim().toUpperCase() || '—')
                          : (value || '—')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                No personal records on file yet. Ask an administrator to add them in the People Directory.
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
