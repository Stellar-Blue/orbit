"use client";

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, Button, Badge } from '@/components/ui/primitives';
import { MessageSquare, RefreshCw, ShieldCheck, AlertTriangle, Trash2, Plus, Clock, CheckCircle2, CalendarDays, KeyRound, Eye, EyeOff, Terminal, ChevronDown, Copy, Check } from 'lucide-react';
import { IntegrationSettings } from '@/lib/integrations/types';
import { AttioSettings } from '@/components/settings/attio-settings';

interface OutlookSettings {
  enabled: boolean;
  leave_label: string;
  remote_label: string;
  half_day_label: string;
  horizon_days: number;
}

const DEFAULT_OUTLOOK: OutlookSettings = {
  enabled: true,
  leave_label: 'Out of office',
  remote_label: 'Working remotely',
  half_day_label: 'Out of office (afternoon)',
  horizon_days: 60,
};

export function IntegrationsSettings() {
  const { profiles, integrationSettings, integrationExceptions, integrationLastReconciledAt, refreshIntegrationState } = useAuth();
  const [settings, setSettings] = useState<IntegrationSettings>(integrationSettings);
  const [outlook, setOutlook] = useState<OutlookSettings>(DEFAULT_OUTLOOK);
  const [outlookLoaded, setOutlookLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<'none' | 'saved' | 'error'>('none');
  const [savingOutlook, setSavingOutlook] = useState(false);
  const [outlookMsg, setOutlookMsg] = useState<'none' | 'saved' | 'error'>('none');
  const [exemptions, setExemptions] = useState<Array<{
    id: string;
    profile_id: string;
    provider: string;
    reason: string | null;
    expires_at: string | null;
    created_at: string;
    profile: { id: string; first_name: string; last_name: string; work_email: string } | null;
  }>>([]);
  const [grantProfileId, setGrantProfileId] = useState('');
  const [grantReason, setGrantReason] = useState('');
  const [grantDays, setGrantDays] = useState(7);
  const [granting, setGranting] = useState(false);

  // AADE myDATA issued/received invoice import
  const [mydata, setMyData] = useState<{
    configured: boolean; username: string | null; companyAfm: string | null;
    lastCompletedMark: number; lastSuccessAt: string | null; lastError: string | null;
    docCount: number; invoiceCount: number;
    logsTableAvailable: boolean; logsError: string | null;
    logs: Array<{ id: string; created_at: string; level: string; message: string; detail?: string | null; mark?: number | null; method?: string | null; url?: string | null; request_headers?: string | null; response_status?: number | null; response_body?: string | null; duration_ms?: number | null }>;
  }>({ configured: false, username: null, companyAfm: null, lastCompletedMark: 0, lastSuccessAt: null, lastError: null, docCount: 0, invoiceCount: 0, logsTableAvailable: true, logsError: null, logs: [] });
  const [showMyDataLogs, setShowMyDataLogs] = useState(true);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [copiedResponseId, setCopiedResponseId] = useState<string | null>(null);

  const copyResponseBody = (id: string, body?: string | null) => {
    if (!body) return;
    navigator.clipboard.writeText(body).catch(() => {});
    setCopiedResponseId(id);
    setTimeout(() => setCopiedResponseId(cur => (cur === id ? null : cur)), 1500);
  };
  const [mydataUsername, setMyDataUsername] = useState('');
  const [mydataKey, setMyDataKey] = useState('');
  const [mydataCompanyAfm, setMyDataCompanyAfm] = useState('');
  const [showMyDataKey, setShowMyDataKey] = useState(false);
  const [savingMyData, setSavingMyData] = useState(false);
  const [syncingMyData, setSyncingMyData] = useState(false);
  const [mydataMsg, setMyDataMsg] = useState<string | null>(null);

  const loadMyData = async () => {
    try {
      const res = await fetch('/api/integrations/mydata');
      if (res.ok) {
        const data = await res.json();
        setMyData(data);
        if (data.username) setMyDataUsername(data.username);
        if (data.companyAfm) setMyDataCompanyAfm(data.companyAfm);
      }
    } catch (e) {
      console.error('load mydata error:', e);
    }
  };

  const flashMyData = (msg: string) => {
    setMyDataMsg(msg);
    setTimeout(() => setMyDataMsg(null), 4000);
  };

  const handleSaveMyData = async () => {
    if (!mydataUsername.trim() || !mydataKey.trim()) { flashMyData('Username and Subscription Key are required.'); return; }
    setSavingMyData(true);
    try {
      const res = await fetch('/api/integrations/mydata', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: mydataUsername, subscriptionKey: mydataKey, companyAfm: mydataCompanyAfm }),
      });
      if (!res.ok) throw new Error('save failed');
      setMyDataKey('');
      flashMyData('myDATA credentials saved (stored encrypted in the vault).');
      await loadMyData();
    } catch {
      flashMyData('Failed to save myDATA credentials.');
    } finally {
      setSavingMyData(false);
    }
  };

  const handleClearMyData = async () => {
    if (!confirm('Clear the myDATA REST API credentials? Automatic import will stop until re-configured.')) return;
    try {
      await fetch('/api/integrations/mydata', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear: true }),
      });
      setMyDataUsername(''); setMyDataKey('');
      flashMyData('myDATA credentials cleared.');
      await loadMyData();
    } catch {
      flashMyData('Failed to clear myDATA credentials.');
    }
  };

  const handleSyncMyData = async () => {
    setSyncingMyData(true);
    try {
      const res = await fetch('/api/integrations/mydata/sync', { method: 'POST' });
      const data = await res.json();
      if (data.error) flashMyData(`myDATA sync failed: ${data.error}`);
      else flashMyData(`myDATA sync complete — ${data.docsImported ?? 0} imported, ${data.invoicesCreated ?? 0} invoices created, ${data.cancellations ?? 0} cancellations.`);
      await loadMyData();
    } catch {
      flashMyData('myDATA sync request failed.');
    } finally {
      setSyncingMyData(false);
    }
  };

  // Live myDATA communication log via SSE (WebSockets aren't supported on serverless; SSE streams new rows in real time)
  useEffect(() => {
    const es = new EventSource('/api/integrations/mydata/logs/stream');
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === 'logs' && Array.isArray(data.logs)) {
          setMyData(prev => {
            const seen = new Set(prev.logs.map(l => l.id));
            const merged = [...data.logs.filter((l: { id: string }) => !seen.has(l.id)), ...prev.logs];
            return { ...prev, logs: merged.slice(0, 100) };
          });
        } else if (data.type === 'error') {
          setMyData(prev => ({ ...prev, logsError: data.code === 'table' ? data.message : prev.logsError }));
        }
      } catch {
        // ignore malformed events
      }
    };
    // EventSource auto-reconnects on drop; no manual handling needed.
    return () => es.close();
  }, []);

  const loadExemptions = async () => {
    try {
      const res = await fetch('/api/integrations/exemptions');
      if (res.ok) {
        const data = await res.json();
        setExemptions(data.exemptions || []);
      }
    } catch (e) {
      console.error('loadExemptions error:', e);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => {
      loadExemptions();
      refreshIntegrationState();
      (async () => {
        try {
          const res = await fetch('/api/integrations/settings');
          if (res.ok) {
            const data = await res.json();
            if (data.outlook) {
              setOutlook({
                enabled: data.outlook.enabled ?? true,
                leave_label: data.outlook.leaveLabel,
                remote_label: data.outlook.remoteLabel,
                half_day_label: data.outlook.halfDayLabel,
                horizon_days: data.outlook.horizonDays,
              });
            }
          }
        } catch (e) {
          console.error('load outlook settings error:', e);
        } finally {
          setOutlookLoaded(true);
        }
      })();
      loadMyData();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg('none');
    try {
      const res = await fetch('/api/integrations/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error('save failed');
      await refreshIntegrationState();
      setSaveMsg('saved');
    } catch {
      setSaveMsg('error');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg('none'), 3000);
    }
  };

  const handleSaveOutlook = async () => {
    setSavingOutlook(true);
    setOutlookMsg('none');
    try {
      const res = await fetch('/api/integrations/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'm365',
          outlook: {
            leave_label: outlook.leave_label,
            remote_label: outlook.remote_label,
            half_day_label: outlook.half_day_label,
            enabled: outlook.enabled,
          },
        }),
      });
      if (!res.ok) throw new Error('save failed');
      setOutlookMsg('saved');
    } catch {
      setOutlookMsg('error');
    } finally {
      setSavingOutlook(false);
      setTimeout(() => setOutlookMsg('none'), 3000);
    }
  };

  const handleGrant = async () => {
    if (!grantProfileId) return;
    setGranting(true);
    try {
      const expiresAt = grantDays > 0 ? new Date(Date.now() + grantDays * 24 * 3600 * 1000).toISOString() : null;
      const res = await fetch('/api/integrations/exemptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: grantProfileId, provider: 'slack', reason: grantReason, expires_at: expiresAt }),
      });
      if (res.ok) {
        setGrantProfileId('');
        setGrantReason('');
        setGrantDays(7);
        await loadExemptions();
      }
    } catch (e) {
      console.error('handleGrant error:', e);
    } finally {
      setGranting(false);
    }
  };

  const handleRevokeExemption = async (id: string) => {
    if (!confirm('Revoke this exemption? The employee will be required to connect Slack again.')) return;
    try {
      await fetch(`/api/integrations/exemptions?id=${id}`, { method: 'DELETE' });
      await loadExemptions();
    } catch (e) {
      console.error('handleRevokeExemption error:', e);
    }
  };

  const field = (key: keyof IntegrationSettings, label: string, hint: string) => (
    <div>
      <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-1">{label}</label>
      <input
        type="text"
        value={settings[key]}
        onChange={e => setSettings(prev => ({ ...prev, [key]: e.target.value }))}
        className="w-full p-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 font-mono"
      />
      <span className="text-[10px] text-slate-400">{hint}</span>
    </div>
  );

  const totalExceptions = integrationExceptions.exceptions.length + integrationExceptions.revoked.length;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white p-6 border border-slate-700">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 rounded-2xl shrink-0">
            <MessageSquare className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2">Slack Status Mirroring</h3>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
              Orbit → outward only. Approved leave and remote days mirror to Slack with self-clearing statuses. Orbit is master; Slack never writes back.
              Statuses never reveal leave type — colleagues see only the configured generic labels.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-mono">
              <span className="px-2 py-1 rounded-lg bg-slate-950/60 border border-slate-800 text-emerald-400">
                Last reconciled: {integrationLastReconciledAt ? new Date(integrationLastReconciledAt).toLocaleString() : 'never'}
              </span>
              <span className="px-2 py-1 rounded-lg bg-slate-950/60 border border-slate-800 text-amber-400">
                Exceptions: {totalExceptions}
              </span>
              <span className="px-2 py-1 rounded-lg bg-slate-950/60 border border-slate-800 text-blue-400">
                Employees not connected: {integrationExceptions.notConnectedCount}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Labels */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="font-bold text-slate-900 text-sm">Status Labels & Emoji</h4>
            <p className="text-xs text-slate-500 mt-0.5">
              Privacy rule: labels must stay generic — sick leave must be indistinguishable from annual leave to colleagues.
            </p>
          </div>
          <Button size="sm" variant="primary" onClick={handleSave} disabled={saving} className="bg-[#3D87D3] text-white cursor-pointer shrink-0">
            {saving ? 'Saving…' : 'Save Labels'}
          </Button>
        </div>
        {saveMsg === 'saved' && <div className="mb-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5" /> Labels saved and pushed to the next sync.</div>}
        {saveMsg === 'error' && <div className="mb-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" /> Failed to save labels.</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('leave_label', 'Leave status text', 'Generic for every leave type')}
          {field('leave_emoji', 'Leave emoji', 'Slack emoji, e.g. :palm_tree:')}
          {field('half_day_label', 'Half-day leave text', 'Shown for half-day leave')}
          {field('remote_label', 'Remote status text', 'Shown on remote days')}
          {field('remote_emoji', 'Remote emoji', 'Slack emoji, e.g. :house:')}
        </div>
      </Card>

      {/* Outlook calendar mirroring */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-blue-500" />
            <h4 className="font-bold text-slate-900 text-sm">Outlook Calendar Mirroring</h4>
          </div>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={outlook.enabled}
              onChange={e => setOutlook(prev => ({ ...prev, enabled: e.target.checked }))}
              className="w-4 h-4 text-[#3D87D3] rounded cursor-pointer"
            />
            Mirroring {outlook.enabled ? 'enabled' : 'disabled'}
          </label>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Approved leave becomes an all-day <strong>Out of office</strong> event (show-as <code className="font-mono text-[10px] bg-slate-100 px-1 py-0.5 rounded">oof</code>) so scheduling assistants mark the person unavailable;
          remote days become <strong>Working remotely</strong> events. Only Orbit-created events (marked with an open extended property) are ever touched. Sync runs every night + immediately on approval/cancellation/edit.
        </p>
        {outlookMsg === 'saved' && <div className="mb-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5" /> Outlook settings saved — applies from the next sync.</div>}
        {outlookMsg === 'error' && <div className="mb-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" /> Failed to save Outlook settings.</div>}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-1">Leave event subject</label>
            <input
              type="text"
              value={outlook.leave_label}
              onChange={e => setOutlook(prev => ({ ...prev, leave_label: e.target.value }))}
              className="w-full p-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 font-mono"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-1">Remote event subject</label>
            <input
              type="text"
              value={outlook.remote_label}
              onChange={e => setOutlook(prev => ({ ...prev, remote_label: e.target.value }))}
              className="w-full p-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 font-mono"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-1">Half-day subject</label>
            <input
              type="text"
              value={outlook.half_day_label}
              onChange={e => setOutlook(prev => ({ ...prev, half_day_label: e.target.value }))}
              className="w-full p-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 font-mono"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-4">
          <span className="text-[10px] text-slate-400 font-mono mr-auto">
            {outlookLoaded ? `Horizon: ${outlook.horizon_days} days · Athens timezone` : 'Loading…'}
          </span>
          <Button size="sm" variant="primary" onClick={handleSaveOutlook} disabled={savingOutlook} className="bg-[#3D87D3] text-white cursor-pointer">
            {savingOutlook ? 'Saving…' : 'Save Outlook Settings'}
          </Button>
        </div>
      </Card>

      {/* Admin deferrals / exemptions */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-4 h-4 text-indigo-500" />
          <h4 className="font-bold text-slate-900 text-sm">Admin-Granted Slack Exemptions</h4>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Defer the mandatory Slack connection for an employee (e.g. invite pending). Exemptions are audited; the gate re-hardens at expiry.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
          <select
            value={grantProfileId}
            onChange={e => setGrantProfileId(e.target.value)}
            className="p-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-800"
          >
            <option value="">Select employee…</option>
            {profiles
              .filter(p => p.status === 'active' && ['full_time', 'part_time', 'intern'].includes(p.employment_type))
              .map(p => (
                <option key={p.id} value={p.id}>{p.first_name} {p.last_name} ({p.work_email})</option>
              ))}
          </select>
          <input
            type="text"
            placeholder="Reason (required for audit)"
            value={grantReason}
            onChange={e => setGrantReason(e.target.value)}
            className="p-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-800"
          />
          <select
            value={grantDays}
            onChange={e => setGrantDays(Number(e.target.value))}
            className="p-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-800"
          >
            <option value={7}>7 days (default)</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={0}>Permanent</option>
          </select>
          <Button size="sm" variant="outline" onClick={handleGrant} disabled={granting || !grantProfileId || !grantReason.trim()} className="text-indigo-700 border-indigo-200 bg-white cursor-pointer">
            <Plus className="w-3.5 h-3.5 mr-1" /> {granting ? 'Granting…' : 'Grant Exemption'}
          </Button>
        </div>

        {exemptions.length === 0 ? (
          <div className="text-center py-6 text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
            No exemptions granted. All gated employees must connect Slack.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-xl overflow-hidden bg-white">
            {exemptions.map(ex => (
              <div key={ex.id} className="p-3.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold text-slate-800 text-xs">
                    {ex.profile ? `${ex.profile.first_name} ${ex.profile.last_name}` : ex.profile_id}
                    <Badge variant="warning" className="ml-2 text-[9px] px-1.5 py-0">Slack</Badge>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {ex.reason || 'No reason'} · {ex.expires_at
                      ? <span className="flex items-center gap-1 inline-flex"><Clock className="w-3 h-3" /> expires {new Date(ex.expires_at).toLocaleString()}</span>
                      : 'permanent'}
                  </div>
                </div>
                <button
                  onClick={() => handleRevokeExemption(ex.id)}
                  className="text-[11px] font-bold text-rose-600 hover:text-rose-800 flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Exceptions */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <h4 className="font-bold text-slate-900 text-sm">Integration Exceptions</h4>
          </div>
          <button onClick={() => { refreshIntegrationState(); loadExemptions(); }} className="text-[11px] font-bold text-[#3D87D3] flex items-center gap-1 cursor-pointer">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-4">Unresolvable mirror issues (revoked tokens, delivery failures). Orbit truth is never blocked by mirror health.</p>

        {totalExceptions === 0 ? (
          <div className="text-center py-6 text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
            No integration exceptions. All mirrors healthy.
          </div>
        ) : (
          <div className="space-y-2">
            {integrationExceptions.revoked.map(r => (
              <div key={`rev-${r.id}`} className="p-3.5 bg-rose-50/60 border border-rose-200/70 rounded-xl flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                  <span className="font-bold text-slate-800 truncate">{r.profile_name || r.profile_id}</span>
                  <Badge variant="error" className="text-[9px] px-1.5 py-0 shrink-0">token revoked</Badge>
                </div>
                <span className="text-[10px] text-slate-400 font-mono shrink-0">{r.revoked_at ? new Date(r.revoked_at).toLocaleDateString() : ''}</span>
              </div>
            ))}
            {integrationExceptions.exceptions.map(e => (
              <div key={`exc-${e.id}`} className="p-3.5 bg-amber-50/60 border border-amber-200/70 rounded-xl text-xs">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span className="font-bold text-slate-800">{e.orbit_kind} · {e.operation}</span>
                  <Badge variant="warning" className="text-[9px] px-1.5 py-0">delivery exception</Badge>
                </div>
                <div className="text-[11px] text-slate-500 mt-1 font-mono">reason: {e.reason || 'unknown'} · {new Date(e.created_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Attio CRM section */}
      <AttioSettings />

      {/* AADE myDATA issued-invoice import */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-[#3D87D3]" />
            <h4 className="font-bold text-slate-900 text-sm">AADE myDATA — Automatic Invoice Import</h4>
          </div>
          <Badge variant={mydata.configured ? 'success' : 'warning'} className={mydata.configured ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}>
            {mydata.configured ? 'Configured' : 'Not configured'}
          </Badge>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Automatically imports the company&apos;s <strong>issued and received invoices</strong> transmitted to AADE myDATA
          (<code className="font-mono text-[10px] bg-slate-100 px-1 py-0.5 rounded">RequestTransmittedDocs</code>) as AR/AP records,
          keyed by AADE MARK and mirrored into the invoice registry. Your <strong>Company AFM</strong> tells the sync which side of
          each document is Orbit: issued invoices become <em>outgoing</em> (AR), received ones <em>incoming</em> (AP). Sync runs
          automatically every day and can be triggered manually below. Credentials are stored encrypted in the vault and never returned to the browser.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-1">myDATA API Username <span className="font-mono normal-case text-slate-400">(aade-user-id)</span></label>
            <input
              type="text"
              value={mydataUsername}
              onChange={e => setMyDataUsername(e.target.value)}
              placeholder="Latin-alphanumeric API username"
              className="w-full p-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 font-mono"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-1">Subscription Key <span className="font-mono normal-case text-slate-400">(ocp-apim-subscription-key)</span></label>
            <div className="flex gap-2">
              <input
                type={showMyDataKey ? 'text' : 'password'}
                value={mydataKey}
                onChange={e => setMyDataKey(e.target.value)}
                placeholder="ocp-apim-subscription-key"
                className="flex-1 p-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowMyDataKey(!showMyDataKey)}
                className="px-2.5 border border-slate-300 rounded-lg text-slate-500 hover:text-slate-800 bg-white cursor-pointer"
                title={showMyDataKey ? 'Hide key' : 'Show key'}
              >
                {showMyDataKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-1">Company AFM <span className="font-mono normal-case text-slate-400">(tax number)</span></label>
            <input
              type="text"
              value={mydataCompanyAfm}
              onChange={e => setMyDataCompanyAfm(e.target.value)}
              placeholder="e.g. 802309756"
              className="w-full p-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 font-mono"
            />
          </div>
        </div>

        {mydataMsg && (
          <div className="mt-3 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> {mydataMsg}
          </div>
        )}

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-4">
          <div className="flex flex-wrap gap-2 text-[10px] font-mono">
            <span className="px-2 py-1 rounded-lg bg-slate-100 text-slate-600">Docs: {mydata.docCount}</span>
            <span className="px-2 py-1 rounded-lg bg-slate-100 text-slate-600">Imported invoices: {mydata.invoiceCount}</span>
            <span className="px-2 py-1 rounded-lg bg-slate-100 text-slate-600">MARK cursor: {mydata.lastCompletedMark}</span>
            <span className="px-2 py-1 rounded-lg bg-slate-100 text-slate-600">Last sync: {mydata.lastSuccessAt ? new Date(mydata.lastSuccessAt).toLocaleString() : 'never'}</span>
            {mydata.lastError && (
              <span className="px-2 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200" title={mydata.lastError}>Error: {mydata.lastError.slice(0, 80)}…</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" onClick={handleClearMyData} disabled={!mydata.configured} className="text-rose-600 border-rose-200 bg-white cursor-pointer">
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Clear Credentials
            </Button>
            <Button size="sm" variant="primary" onClick={handleSyncMyData} disabled={syncingMyData || !mydata.configured} className="bg-indigo-600 text-white cursor-pointer">
              <RefreshCw className={`w-3.5 h-3.5 mr-1 ${syncingMyData ? 'animate-spin' : ''}`} /> {syncingMyData ? 'Syncing…' : 'Sync Now'}
            </Button>
            <Button size="sm" variant="primary" onClick={handleSaveMyData} disabled={savingMyData || !mydataUsername.trim() || !mydataKey.trim()} className="bg-[#3D87D3] text-white cursor-pointer">
              {savingMyData ? 'Saving…' : 'Save Credentials'}
            </Button>
          </div>
        </div>

        {/* Helper / Communication log panel */}
        {mydata.logsTableAvailable === false && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <strong className="font-bold">Log table not found.</strong> The myDATA sync log table (<code className="font-mono text-[10px]">aade_sync_logs</code>) is missing — apply migration <code className="font-mono text-[10px]">0043_mydata_sync_logs.sql</code> and redeploy. Sync itself is unaffected; only logging is disabled.
            </div>
          </div>
        )}
        <div className="mt-4 border border-slate-200 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowMyDataLogs(!showMyDataLogs)}
            className="w-full flex items-center justify-between px-3.5 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer text-left"
          >
            <span className="text-xs font-extrabold text-slate-700 uppercase tracking-wider flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-[#3D87D3]" />
              myDATA API Communication Log
            </span>
            <span className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400 font-mono">{mydata.logs.length} entries</span>
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showMyDataLogs ? 'rotate-180' : ''}`} />
            </span>
          </button>
          {showMyDataLogs && (
            <div className="max-h-64 overflow-y-auto bg-slate-950 divide-y divide-slate-800/80">
              {mydata.logs.length === 0 ? (
                <div className="p-4 text-[11px] text-slate-500 font-mono italic">No sync activity logged yet. Hit Sync Now — every request/response is recorded here (secrets are never logged).</div>
              ) : (
                mydata.logs.map((log) => {
                  const hasReq = Boolean(log.url || log.response_status != null || log.response_body);
                  const isOpen = expandedLogId === log.id;
                  return (
                    <div key={log.id} className="px-3.5 py-2 text-[11px]">
                      <div className="flex items-start gap-2.5">
                        <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${log.level === 'error' ? 'bg-rose-500' : log.level === 'warn' ? 'bg-amber-400' : 'bg-emerald-500'}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono font-bold text-slate-200">{log.message}</span>
                            {log.method && <span className="px-1.5 py-0.5 rounded bg-slate-800 text-sky-300 font-mono text-[9px] border border-slate-700">{log.method}</span>}
                            {log.response_status != null && (
                              <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] border ${log.response_status < 400 ? 'bg-emerald-900/40 text-emerald-300 border-emerald-800' : 'bg-rose-900/40 text-rose-300 border-rose-800'}`}>
                                {log.response_status}
                              </span>
                            )}
                            {log.duration_ms != null && <span className="font-mono text-[9px] text-slate-500">{log.duration_ms}ms</span>}
                            {log.mark != null && <span className="font-mono text-[10px] text-indigo-400 shrink-0">MARK {log.mark}</span>}
                          </div>
                          {log.detail && <div className="font-mono text-[10px] text-slate-400 mt-0.5 break-words">{log.detail}</div>}
                          {hasReq && (
                            <button
                              type="button"
                              onClick={() => setExpandedLogId(isOpen ? null : log.id)}
                              className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-sky-400 hover:text-sky-200 cursor-pointer"
                            >
                              <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                              {isOpen ? 'Hide request/response' : 'View request/response'}
                            </button>
                          )}
                          {isOpen && hasReq && (
                            <div className="mt-2 space-y-2">
                              {log.url && (
                                <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-2 overflow-x-auto">
                                  <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-1">Request URL</div>
                                  <pre className="font-mono text-[10px] text-slate-300 whitespace-pre-wrap break-all">{log.url}</pre>
                                </div>
                              )}
                              {log.request_headers && (
                                <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-2 overflow-x-auto">
                                  <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-1">Request Headers</div>
                                  <pre className="font-mono text-[10px] text-slate-300 whitespace-pre-wrap break-all">{log.request_headers}</pre>
                                </div>
                              )}
                              {log.response_body && (
                                <div className="rounded-lg bg-slate-950 border border-slate-800 p-2">
                                  <div className="flex items-center justify-between gap-2 mb-1">
                                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Response Body (XML)</span>
                                    <button
                                      type="button"
                                      onClick={() => copyResponseBody(log.id, log.response_body)}
                                      className="inline-flex items-center gap-1 text-[9px] font-bold text-sky-400 hover:text-sky-200 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 cursor-pointer shrink-0"
                                      title="Copy the full response to clipboard"
                                    >
                                      {copiedResponseId === log.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                      {copiedResponseId === log.id ? 'Copied' : 'Copy response'}
                                    </button>
                                  </div>
                                  <div className="overflow-x-auto max-h-64">
                                    <pre className="font-mono text-[10px] text-emerald-300/90 whitespace-pre-wrap break-all">{log.response_body}</pre>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <span className="font-mono text-[10px] text-slate-500 shrink-0">{new Date(log.created_at).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </Card>

      <div className="text-[10px] text-slate-400 font-mono">
        Scope note: Outlook calendar mirroring is designed for the next build phase (requires a Microsoft Graph app + admin consent).
      </div>
    </div>
  );
}
