"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { getSupabaseBrowserClient, SIGNED_URL_TTL_SECONDS } from '@/lib/supabase/client';
import { notifySuccess, notifyValidation } from '@/lib/validation-modal';
import { type Project, type ProjectDocument, type ProjectLink, type ProjectStatus } from '@/lib/types';
import { Button } from '@/components/ui/primitives';
import { formatDate } from '@/lib/date';
import { netInvoices, type NettableInvoice } from '@/lib/invoice-netting';
import { invoiceProjectIds } from '@/lib/invoice-links';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Calendar, FileText, Link2, Paperclip, Plus, Save, Trash2, Upload, ExternalLink,
  GitBranch, ListChecks, Clock, Euro
} from 'lucide-react';

const BUCKET = 'project-documents-private';
const LINK_KINDS: Array<{ id: string; label: string }> = [
  { id: 'linear', label: 'Linear issue' },
  { id: 'docs', label: 'Document / spec' },
  { id: 'repo', label: 'Repository' },
  { id: 'other', label: 'Other link' },
];

const linkIcon = (kind?: string | null) =>
  kind === 'linear' ? <ListChecks className="w-3.5 h-3.5 text-indigo-600" />
  : kind === 'repo' ? <GitBranch className="w-3.5 h-3.5 text-slate-700" />
  : kind === 'docs' ? <FileText className="w-3.5 h-3.5 text-[#2f6fa3]" />
  : <Link2 className="w-3.5 h-3.5 text-slate-400" />;

const euro = (n: number) => `€${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Invoices that cover a project — billed time entries plus the ones explicitly linked to it in the
 * register (`project_ids`) — split into issued vs still in draft.
 */
export function projectBillingStatus<T extends NettableInvoice & { project_ids?: string[] | null }>(
  timeEntries: Array<{ project_id: string; invoice_id?: string | null }>,
  invoices: T[],
  projectId: string
): { issued: T[]; drafts: T[]; billedTotal: number } {
  const ids = new Set(timeEntries.filter(e => e.project_id === projectId && e.invoice_id).map(e => e.invoice_id as string));
  const linked = invoices.filter(i => ids.has(i.id) || invoiceProjectIds(i).includes(projectId));
  const drafts = linked.filter(i => i.status === 'draft');
  // A credited invoice is no longer billed, and the credit note itself is not a bill.
  const issued = netInvoices(linked.filter(i => i.status !== 'draft')).active;
  return { issued, drafts, billedTotal: issued.reduce((s, i) => s + (Number(i.gross_eur) || 0), 0) };
}

/**
 * Delivery details for one project: lifecycle status, planned vs actual window, effort budget in hours
 * and days, attachments and links. Documents/links are read and written directly (they belong to this
 * panel), while the scalar fields go through `saveProject`.
 */
export function ProjectDetailsPanel({ project, onSaved }: { project: Project; onSaved?: (p: Partial<Project>) => void }) {
  const { currentUser, timeEntries, invoices, saveProject, profiles } = useAuth();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [form, setForm] = useState({
    code: project.code || '',
    status: project.status as ProjectStatus,
    owner_profile_id: project.owner_profile_id || '',
    starts_on: project.starts_on || '',
    ends_on: project.ends_on || '',
    actual_start_on: project.actual_start_on || '',
    actual_end_on: project.actual_end_on || '',
    budget_hours: project.budget_hours != null ? String(project.budget_hours) : '',
    budget_days: project.budget_days != null ? String(project.budget_days) : '',
    budget_value: project.budget_value != null ? String(project.budget_value) : '',
    default_billable: project.default_billable !== false,
  });
  const [saving, setSaving] = useState(false);
  const [links, setLinks] = useState<ProjectLink[]>([]);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [newLink, setNewLink] = useState({ title: '', url: '', kind: 'linear' });
  const [uploading, setUploading] = useState(false);

  // Note: the panel is mounted with `key={project.id}`, so switching projects re-initialises the form
  // above — no state syncing inside an effect needed (that pattern triggers cascading renders).

  const loadRelated = useCallback(async () => {
    const [linkRes, docRes] = await Promise.all([
      supabase.from('project_links').select('*').eq('project_id', project.id).order('created_at'),
      supabase.from('project_documents').select('*').eq('project_id', project.id).order('uploaded_at', { ascending: false }),
    ]);
    setLinks((linkRes.data || []) as ProjectLink[]);
    setDocuments((docRes.data || []) as ProjectDocument[]);
  }, [supabase, project.id]);

  // One-shot load of this project's links and documents (state lands after the awaits).
  // eslint-disable-next-line react-hooks/set-state-in-effect -- loadRelated only sets state after awaiting the queries
  useEffect(() => { void loadRelated(); }, [loadRelated]);

  /** Hours actually logged on the project (everything, not just approved). */
  const loggedHours = useMemo(
    () => timeEntries.filter(e => e.project_id === project.id).reduce((s, e) => s + (Number(e.minutes) || 0), 0) / 60,
    [timeEntries, project.id]
  );

  /** Billing correlation: draft vs issued invoices covering this project's time entries. */
  const billing = useMemo(
    () => projectBillingStatus(timeEntries, invoices, project.id),
    [timeEntries, invoices, project.id]
  );

  const update = (patch: Partial<typeof form>) => setForm(prev => ({ ...prev, ...patch }));

  /** Validation mirrors the DB checks: ranges must be ordered, actual start can't precede the plan. */
  const errors: string[] = [];
  if (form.starts_on && form.ends_on && form.ends_on < form.starts_on) errors.push('Planned end is before planned start.');
  if (form.actual_start_on && form.actual_end_on && form.actual_end_on < form.actual_start_on) errors.push('Actual end is before actual start.');
  if (form.actual_start_on && form.starts_on && form.actual_start_on < form.starts_on) errors.push('Actual start is before the planned start.');

  const save = async () => {
    if (errors.length > 0) { notifyValidation({ type: 'error', title: 'Check the dates', message: errors.join(' ') }); return; }
    setSaving(true);
    try {
      const ok = await saveProject({
        ...project,
        code: form.code.trim() || null,
        status: form.status,
        owner_profile_id: form.owner_profile_id || null,
        starts_on: form.starts_on || null,
        ends_on: form.ends_on || null,
        actual_start_on: form.actual_start_on || null,
        actual_end_on: form.actual_end_on || null,
        budget_hours: form.budget_hours ? Number(form.budget_hours) : null,
        budget_days: form.budget_days ? Number(form.budget_days) : null,
        budget_value: form.budget_value ? Number(form.budget_value) : null,
        default_billable: form.default_billable,
      });
      if (ok) {
        notifySuccess('Project details saved.', 'Project updated');
        onSaved?.({
          code: form.code.trim() || null, status: form.status, owner_profile_id: form.owner_profile_id || null,
          starts_on: form.starts_on || null, ends_on: form.ends_on || null,
          actual_start_on: form.actual_start_on || null, actual_end_on: form.actual_end_on || null,
          budget_hours: form.budget_hours ? Number(form.budget_hours) : null,
          budget_days: form.budget_days ? Number(form.budget_days) : null,
          budget_value: form.budget_value ? Number(form.budget_value) : null,
          default_billable: form.default_billable,
        });
      } else {
        notifyValidation({ type: 'error', title: 'Save failed', message: 'The project could not be updated.' });
      }
    } finally {
      setSaving(false);
    }
  };

  const addLink = async () => {
    const url = newLink.url.trim();
    if (!url) return;
    const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const { error } = await supabase.from('project_links').insert({
      project_id: project.id,
      title: newLink.title.trim() || null,
      url: withScheme,
      kind: newLink.kind,
      created_by: currentUser.id || null,
    });
    if (error) { notifyValidation({ type: 'error', title: 'Could not add link', message: error.message }); return; }
    setNewLink({ title: '', url: '', kind: newLink.kind });
    await loadRelated();
    notifySuccess('Link added to the project.');
  };

  const removeLink = async (id: string) => {
    const { error } = await supabase.from('project_links').delete().eq('id', id);
    if (error) { notifyValidation({ type: 'error', title: 'Could not remove link', message: error.message }); return; }
    await loadRelated();
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const path = `projects/${project.id}/${Date.now()}_${safe}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (upErr) { notifyValidation({ type: 'error', title: 'Upload failed', message: upErr.message }); return; }
      // The bucket is private, so links are signed on read (see openDocument) instead of stored here.
      const { error: insErr } = await supabase.from('project_documents').insert({
        project_id: project.id,
        file_name: file.name,
        storage_path: path,
        url: null,
        file_size: file.size,
        mime_type: file.type || null,
        uploaded_by: currentUser.id || null,
      });
      if (insErr) { notifyValidation({ type: 'error', title: 'Upload failed', message: insErr.message }); return; }
      await loadRelated();
      notifySuccess(`${file.name} attached to the project.`);
    } finally {
      setUploading(false);
    }
  };

  const removeDocument = async (doc: ProjectDocument) => {
    if (!confirm(`Remove ${doc.file_name} from this project?`)) return;
    await supabase.storage.from(BUCKET).remove([doc.storage_path]);
    const { error } = await supabase.from('project_documents').delete().eq('id', doc.id);
    if (error) { notifyValidation({ type: 'error', title: 'Could not remove document', message: error.message }); return; }
    await loadRelated();
  };

  const openDocument = async (doc: ProjectDocument) => {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);
    const url = data?.signedUrl || doc.url;
    if (url) window.open(url, '_blank', 'noopener');
  };

  const field = 'w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-[#2f6fa3]';
  const label = 'block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1';

  return (
    <div className="space-y-4">
      {/* ── Delivery details ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-[#2f6fa3]" /> Delivery details
          </span>
          <div className="flex items-center gap-2 text-[10px] font-bold">
            {billing.issued.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                Invoiced{billing.billedTotal > 0 ? ` · ${euro(billing.billedTotal)}` : ''}
              </span>
            )}
            {billing.drafts.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                {billing.drafts.length} draft invoice{billing.drafts.length === 1 ? '' : 's'}
              </span>
            )}
            {billing.issued.length === 0 && billing.drafts.length === 0 && (
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">Not invoiced yet</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          <div>
            <label className={label}>Status</label>
            <select value={form.status} onChange={e => update({ status: e.target.value as ProjectStatus })} className={field}>
              <option value="planned">Planned</option>
              <option value="in_progress">In Progress</option>
              <option value="done">Done</option>
              <option value="on_hold">On Hold</option>
              <option value="active">Active (legacy)</option>
              <option value="completed">Completed (legacy)</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div>
            <label className={label}>Project code</label>
            <input value={form.code} onChange={e => update({ code: e.target.value })} placeholder="FI-PVPARK" className={`${field} font-mono`} />
          </div>
          <div>
            <label className={label}>Owner</label>
            <select value={form.owner_profile_id} onChange={e => update({ owner_profile_id: e.target.value })} className={field}>
              <option value="">Unassigned</option>
              {profiles.filter(p => p.status === 'active').map(p => (
                <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Billable</label>
            <button
              type="button"
              onClick={() => update({ default_billable: !form.default_billable })}
              className={`w-full px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                form.default_billable ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}
            >
              {form.default_billable ? 'Billable to client' : 'Internal (non-billable)'}
            </button>
          </div>

          <div>
            <label className={label}>Planned start</label>
            <DatePicker value={form.starts_on} onChange={next => update({ starts_on: next })} className="w-full" />
          </div>
          <div>
            <label className={label}>Planned end</label>
            <DatePicker value={form.ends_on} onChange={next => update({ ends_on: next })} className="w-full" />
          </div>
          <div>
            <label className={label}>Actual start</label>
            <DatePicker value={form.actual_start_on} onChange={next => update({ actual_start_on: next })} className="w-full" />
          </div>
          <div>
            <label className={label}>Actual end</label>
            <DatePicker value={form.actual_end_on} onChange={next => update({ actual_end_on: next })} className="w-full" />
          </div>

          <div>
            <label className={label}>Budget hours</label>
            <input
              type="number" step="0.5" value={form.budget_hours}
              onChange={e => update({
                budget_hours: e.target.value,
                // Keep the two budgets consistent (1 day = 8h) in both directions.
                budget_days: e.target.value ? String(Number((Number(e.target.value) / 8).toFixed(2))) : '',
              })}
              className={`${field} font-mono`}
              placeholder={form.budget_days ? String(Number(form.budget_days) * 8) : '0'}
            />
          </div>
          <div>
            <label className={label}>Budget days <span className="normal-case font-semibold text-slate-400">(1 day = 8h)</span></label>
            <input
              type="number" step="0.5" value={form.budget_days}
              onChange={e => update({ budget_days: e.target.value, budget_hours: e.target.value ? String(Number(e.target.value) * 8) : form.budget_hours })}
              className={`${field} font-mono`}
              placeholder={form.budget_hours ? String(Number((Number(form.budget_hours) / 8).toFixed(2))) : '0'}
            />
          </div>
          <div>
            <label className={label}>Budget value (€)</label>
            <input type="number" step="0.01" value={form.budget_value} onChange={e => update({ budget_value: e.target.value })} className={`${field} font-mono`} />
          </div>
          <div>
            <label className={label}>Logged to date</label>
            <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono text-slate-700 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              {loggedHours.toFixed(1)}h · {(loggedHours / 8).toFixed(1)}d
              {form.budget_hours && Number(form.budget_hours) > 0 && (
                <span className={`ml-auto font-bold ${loggedHours > Number(form.budget_hours) ? 'text-rose-600' : 'text-emerald-700'}`}>
                  {Math.round((loggedHours / Number(form.budget_hours)) * 100)}%
                </span>
              )}
            </div>
          </div>
        </div>

        {errors.length > 0 && (
          <div className="text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">
            {errors.join(' ')}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-500">
            {form.ends_on && form.actual_end_on && form.actual_end_on > form.ends_on
              ? <span className="text-amber-700 font-semibold">Finished {formatDate(form.actual_end_on)} — after the planned end ({formatDate(form.ends_on)}).</span>
              : 'Planned window and real dates both feed the delivery reports.'}
          </span>
          <Button variant="primary" size="sm" onClick={save} disabled={saving || errors.length > 0} className="cursor-pointer bg-[#2f6fa3] text-white disabled:opacity-50">
            <Save className="w-3.5 h-3.5 mr-1.5" /> {saving ? 'Saving…' : 'Save details'}
          </Button>
        </div>
      </div>

      {/* ── Links ────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5">
        <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
          <Link2 className="w-3.5 h-3.5 text-[#2f6fa3]" /> Links
          <span className="text-[10px] font-semibold text-slate-400">Linear issues, specs, repositories…</span>
        </span>
        {links.length > 0 && (
          <ul className="space-y-1">
            {links.map(l => (
              <li key={l.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5">
                {linkIcon(l.kind)}
                <Link href={l.url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-slate-700 hover:text-[#2f6fa3] truncate flex-1">
                  {l.title || l.url}
                </Link>
                <span className="text-[10px] font-mono text-slate-400 truncate max-w-[240px]">{l.url}</span>
                <ExternalLink className="w-3 h-3 text-slate-300" />
                <button onClick={() => removeLink(l.id)} className="text-slate-300 hover:text-rose-600 p-1 cursor-pointer" title="Remove link">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-36">
            <label className={label}>Type</label>
            <select value={newLink.kind} onChange={e => setNewLink({ ...newLink, kind: e.target.value })} className={field}>
              {LINK_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className={label}>Title</label>
            <input value={newLink.title} onChange={e => setNewLink({ ...newLink, title: e.target.value })} placeholder="ORB-123 · Fix billing export" className={field} />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className={label}>URL</label>
            <input value={newLink.url} onChange={e => setNewLink({ ...newLink, url: e.target.value })} placeholder="linear.app/…" className={`${field} font-mono`} />
          </div>
          <Button variant="outline" size="sm" onClick={addLink} disabled={!newLink.url.trim()} className="cursor-pointer disabled:opacity-50">
            <Plus className="w-3.5 h-3.5 mr-1" /> Add link
          </Button>
        </div>
      </div>

      {/* ── Documents ────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
            <Paperclip className="w-3.5 h-3.5 text-[#2f6fa3]" /> Documents
            <span className="text-[10px] font-semibold text-slate-400">{documents.length} file{documents.length === 1 ? '' : 's'}</span>
          </span>
          <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-[11px] font-bold text-slate-700 cursor-pointer hover:bg-slate-50 ${uploading ? 'opacity-50' : ''}`}>
            <Upload className="w-3.5 h-3.5 text-[#2f6fa3]" /> {uploading ? 'Uploading…' : 'Upload file'}
            <input
              type="file"
              className="hidden"
              disabled={uploading}
              onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }}
            />
          </label>
        </div>
        {documents.length === 0 ? (
          <div className="text-[11px] text-slate-400 italic">No documents attached yet.</div>
        ) : (
          <ul className="space-y-1">
            {documents.map(d => (
              <li key={d.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5">
                <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <button onClick={() => openDocument(d)} className="text-xs font-semibold text-slate-700 hover:text-[#2f6fa3] truncate flex-1 text-left cursor-pointer">
                  {d.file_name}
                </button>
                <span className="text-[10px] text-slate-400 font-mono">
                  {d.file_size ? `${(d.file_size / 1024).toFixed(0)} KB` : ''} {d.uploaded_at ? `· ${formatDate(d.uploaded_at)}` : ''}
                </span>
                <button onClick={() => removeDocument(d)} className="text-slate-300 hover:text-rose-600 p-1 cursor-pointer" title="Remove document">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Billing correlation ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2">
        <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
          <Euro className="w-3.5 h-3.5 text-emerald-600" /> Billing status
        </span>
        {billing.issued.length === 0 && billing.drafts.length === 0 ? (
          <div className="text-[11px] text-slate-400 italic">No invoice covers this project yet — create one from the billing bar above.</div>
        ) : (
          <ul className="space-y-1">
            {[...billing.issued, ...billing.drafts].map(i => (
              <li key={i.id} className="flex items-center gap-2 text-xs">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${
                  i.status === 'draft' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                }`}>
                  {i.status === 'draft' ? 'Draft' : 'Issued'}
                </span>
                <Link href={`/invoices?contract=${project.contract_id || ''}`} className="font-mono font-bold text-slate-700 hover:text-[#2f6fa3]">
                  {i.invoice_number}
                </Link>
                <span className="text-slate-400">{i.reference_period || ''}</span>
                <span className="ml-auto font-mono font-bold text-slate-700">{euro(Number(i.gross_eur) || 0)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
