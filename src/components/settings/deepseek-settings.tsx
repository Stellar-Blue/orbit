"use client";

import React, { useEffect, useState } from 'react';
import { Card, Button, Badge } from '@/components/ui/primitives';
import { Sparkles, KeyRound, Eye, EyeOff, Trash2, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * DeepSeek API key for reading payroll documents (bank receipt + payslip) into the payment ledger.
 *
 * The key is stored in the Supabase vault and never comes back to the browser: the extraction route
 * reads it server-side. `integration_settings` is readable by every authenticated user, so the key
 * deliberately does not live there.
 */
export function DeepSeekSettings() {
  const [loaded, setLoaded] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/integrations/deepseek')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data) return;
        setConfigured(!!data.configured);
        setModel(data.model || '');
      })
      .catch(e => console.error('load deepseek settings error:', e))
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const save = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/integrations/deepseek', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setConfigured(true);
        setApiKey('');
        setMessage({ kind: 'ok', text: 'API key stored in the vault. Document extraction is now available in the payment ledger.' });
      } else {
        setMessage({ kind: 'error', text: data.error || 'Could not save the key.' });
      }
    } catch {
      setMessage({ kind: 'error', text: 'Could not reach the server.' });
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!confirm('Remove the DeepSeek API key? Payment document extraction will stop working.')) return;
    setClearing(true);
    setMessage(null);
    try {
      const res = await fetch('/api/integrations/deepseek', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear: true }),
      });
      if (res.ok) {
        setConfigured(false);
        setMessage({ kind: 'ok', text: 'API key removed.' });
      } else {
        setMessage({ kind: 'error', text: 'Could not remove the key.' });
      }
    } finally {
      setClearing(false);
    }
  };

  if (!loaded) {
    return (
      <Card className="p-5 border-t-4 border-t-violet-500 shadow-sm">
        <div className="flex flex-col items-center justify-center py-10 text-slate-400 space-y-3">
          <RefreshCw className="w-6 h-6 animate-spin text-slate-300" />
          <span className="text-xs font-medium text-slate-500">Loading DeepSeek configuration...</span>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Card className="p-5 border-t-4 border-t-violet-500 shadow-sm transition-shadow hover:shadow-md">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-500" />
            <h4 className="font-bold text-slate-900 text-sm">AI Payment Extraction — DeepSeek</h4>
          </div>
          <Badge variant={configured ? 'success' : 'warning'} className={configured ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}>
            {configured ? 'Configured' : 'Not configured'}
          </Badge>
        </div>

        <p className="text-xs text-slate-500 mb-4">
          With a key configured, the payment ledger modal gains an <strong>Extract from documents</strong> button.
          It reads the attached bank receipt and payslip and fills in the <strong>gross</strong>, <strong>net</strong>,
          <strong> payment date</strong> and <strong>bank reference</strong> for the admin to review before saving.
          Digital PDFs are read from their text layer; scans are sent as page images.
        </p>

        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-600 mb-4 space-y-1">
          <div><strong>Model:</strong> <code className="font-mono bg-white border border-slate-200 px-1 rounded">{model || 'deepseek-flash'}</code> — the only DeepSeek model with vision, needed for scanned receipts.</div>
          <div>The key is stored <strong>encrypted in the vault</strong> and never returned to the browser. Document text is sent to DeepSeek only when an admin presses the button.</div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-1">
              {configured ? 'Replace API Key' : 'DeepSeek API Key'}
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
                className="w-full pl-9 pr-10 p-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                className="absolute right-2 top-2 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                title={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {message && (
          <div className={`mt-4 p-3 rounded-xl border text-xs flex items-start gap-2 ${message.kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-rose-50 border-rose-200 text-rose-900'}`}>
            {message.kind === 'ok' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
            <span>{message.text}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-4">
          {configured ? (
            <Button size="sm" variant="outline" onClick={clear} disabled={clearing} className="text-rose-600 border-rose-200 bg-white cursor-pointer">
              <Trash2 className="w-3.5 h-3.5 mr-1.5" /> {clearing ? 'Removing…' : 'Remove Key'}
            </Button>
          ) : <span />}
          <Button size="sm" variant="primary" onClick={save} disabled={saving || !apiKey.trim()} className="bg-[var(--accent)] text-white cursor-pointer">
            {saving ? 'Saving…' : configured ? 'Replace Key' : 'Save Key'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
