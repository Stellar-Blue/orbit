"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { EmployeeDocument, EmployeeDocumentStatus, EmployeeDocumentType } from '@/lib/types';
import {
  EMPLOYEE_DOCUMENT_STATUS,
  EMPLOYEE_DOCUMENT_TYPES,
  employeeDocumentTypeLabel,
  setDocumentReviewStatus,
} from '@/lib/employee-documents';
import { EmployeeDocumentPreview } from '@/components/people/employee-document-preview';
import { Badge, Button } from '@/components/ui/primitives';
import { formatDate } from '@/lib/date';
import { notifySuccess, notifyValidation } from '@/lib/validation-modal';
import { AlertTriangle, Check, Eye, Files, Loader2, RefreshCw, Search, X } from 'lucide-react';

/** Every employee's qualification documents in one register, with the review decision inline. */
export default function DocumentsPage() {
  const { currentUser, profiles } = useAuth();
  const isAdmin = currentUser.role === 'admin';

  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<EmployeeDocument | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | EmployeeDocumentStatus>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | EmployeeDocumentType>('all');

  const load = useCallback(async () => {
    const { data, error } = await getSupabaseBrowserClient()
      .from('employee_documents')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      notifyValidation({ type: 'error', title: 'Could not load documents', message: error.message });
      setDocuments([]);
    } else {
      setDocuments((data || []) as EmployeeDocument[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() only sets state after awaiting the query
    void load();
  }, [load]);

  const profileById = useMemo(() => new Map(profiles.map(profile => [profile.id, profile])), [profiles]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return documents.filter(doc => {
      if (statusFilter !== 'all' && doc.status !== statusFilter) return false;
      if (typeFilter !== 'all' && doc.doc_type !== typeFilter) return false;
      if (!term) return true;
      const person = profileById.get(doc.profile_id);
      const haystack = [
        doc.title,
        doc.issuer || '',
        doc.file_name,
        person ? `${person.first_name} ${person.last_name}` : '',
        person?.work_email || '',
      ].join(' ').toLowerCase();
      return haystack.includes(term);
    });
  }, [documents, statusFilter, typeFilter, search, profileById]);

  const counts = useMemo(() => ({
    pending: documents.filter(doc => doc.status === 'pending').length,
    verified: documents.filter(doc => doc.status === 'verified').length,
    rejected: documents.filter(doc => doc.status === 'rejected').length,
  }), [documents]);

  const review = async (doc: EmployeeDocument, status: 'verified' | 'rejected') => {
    let reviewNote: string | null = null;
    if (status === 'rejected') {
      reviewNote = window.prompt('Reason for rejection (optional)');
      if (reviewNote === null) return;
      reviewNote = reviewNote.trim() || null;
    }
    setBusyId(doc.id);
    const reviewError = await setDocumentReviewStatus(doc.id, status, currentUser.id, reviewNote);
    setBusyId(null);
    if (reviewError) {
      notifyValidation({ type: 'error', title: 'Could not save the review', message: reviewError });
      return;
    }
    notifySuccess(status === 'verified' ? 'Document verified.' : 'Document rejected.');
    await load();
  };

  if (!isAdmin) {
    return (
      <div className="p-8 max-w-4xl mx-auto text-center">
        <div className="p-8 border border-red-200 bg-red-50 text-red-900 rounded-2xl">
          <AlertTriangle className="w-12 h-12 text-red-600 mx-auto mb-3" />
          <h2 className="text-xl font-semibold">Admin Authorization Required</h2>
          <p className="text-xs text-red-700 mt-2">
            Qualification documents are visible to the employee who uploaded them and to administrators.
          </p>
        </div>
      </div>
    );
  }

  const fieldClass = 'h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[var(--accent)]';

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-3 border-b border-slate-200/80 pb-4">
        <div>
          <p className="ui-eyebrow">People · Admin</p>
          <h1 className="ui-title mt-1 flex items-center gap-2">
            <Files className="w-5 h-5 text-emerald-600" /> Documents
          </h1>
          <p className="text-[12.5px] text-slate-500 mt-1">
            Every employee&apos;s degrees, certifications and language certificates. New uploads wait here for review.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading} className="cursor-pointer">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Reload
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={counts.pending > 0 ? 'warning' : 'neutral'} className="font-extrabold">{counts.pending} pending review</Badge>
        <Badge variant="success" className="font-extrabold">{counts.verified} verified</Badge>
        <Badge variant={counts.rejected > 0 ? 'error' : 'neutral'} className="font-extrabold">{counts.rejected} rejected</Badge>
        <span className="text-[11px] text-slate-400">{documents.length} documents in total</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Find an employee or a document…"
            className="w-full h-9 pl-9 pr-3 text-xs rounded-lg border border-slate-200 bg-white text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
        </div>
        <select
          value={statusFilter}
          onChange={event => setStatusFilter(event.target.value as 'all' | EmployeeDocumentStatus)}
          className={fieldClass}
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending review</option>
          <option value="verified">Verified</option>
          <option value="rejected">Rejected</option>
        </select>
        <select
          value={typeFilter}
          onChange={event => setTypeFilter(event.target.value as 'all' | EmployeeDocumentType)}
          className={fieldClass}
        >
          <option value="all">All types</option>
          {EMPLOYEE_DOCUMENT_TYPES.map(type => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-400 py-10 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading documents…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
          {documents.length === 0
            ? 'No qualification documents have been uploaded yet.'
            : 'No documents match these filters.'}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 text-left">
                <th className="p-3 font-bold">Employee</th>
                <th className="p-3 font-bold">Document</th>
                <th className="p-3 font-bold">Type</th>
                <th className="p-3 font-bold">Issued</th>
                <th className="p-3 font-bold">Expires</th>
                <th className="p-3 font-bold">Status</th>
                <th className="p-3 font-bold">Reviewed</th>
                <th className="p-3 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(doc => {
                const person = profileById.get(doc.profile_id);
                const reviewer = doc.reviewed_by ? profileById.get(doc.reviewed_by) : null;
                const status = EMPLOYEE_DOCUMENT_STATUS[doc.status];
                const busy = busyId === doc.id;
                return (
                  <tr key={doc.id} className="hover:bg-slate-50/70 align-top">
                    <td className="p-3">
                      <Link href={`/people/${doc.profile_id}`} className="font-bold text-slate-800 hover:text-[var(--accent)]">
                        {person ? `${person.first_name} ${person.last_name}` : 'Unknown employee'}
                      </Link>
                      <div className="text-[10px] text-slate-500">{person?.work_email || '—'}</div>
                    </td>
                    <td className="p-3">
                      <button
                        type="button"
                        onClick={() => setPreviewDoc(doc)}
                        className="font-semibold text-slate-800 hover:text-[var(--accent)] text-left cursor-pointer"
                      >
                        {doc.title}
                      </button>
                      <div className="font-mono text-[10px] text-slate-400">{doc.file_name}</div>
                    </td>
                    <td className="p-3 text-slate-600">{employeeDocumentTypeLabel(doc.doc_type)}</td>
                    <td className="p-3 text-slate-600">{doc.issued_on ? formatDate(doc.issued_on) : '—'}</td>
                    <td className="p-3 text-slate-600">{doc.expires_on ? formatDate(doc.expires_on) : '—'}</td>
                    <td className="p-3">
                      <Badge variant={status.variant} className="text-[9px] px-1.5 py-0">{status.label.toUpperCase()}</Badge>
                    </td>
                    <td className="p-3 text-slate-600">
                      {reviewer && doc.reviewed_at ? (
                        <>
                          <div>{reviewer.first_name} {reviewer.last_name}</div>
                          <div className="text-[10px] text-slate-400">{formatDate(doc.reviewed_at)}</div>
                          {doc.review_note && <div className="text-[10px] text-rose-700 italic">{doc.review_note}</div>}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => setPreviewDoc(doc)} className="cursor-pointer">
                          <Eye className="w-3 h-3 mr-1" /> Preview
                        </Button>
                        {doc.status !== 'verified' && (
                          <Button size="sm" variant="secondary" onClick={() => review(doc, 'verified')} disabled={busy} className="cursor-pointer">
                            {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Check className="w-3 h-3 mr-1" />} Verify
                          </Button>
                        )}
                        {doc.status !== 'rejected' && (
                          <Button size="sm" variant="outline" onClick={() => review(doc, 'rejected')} disabled={busy} className="cursor-pointer">
                            <X className="w-3 h-3 mr-1" /> Reject
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {previewDoc && (
        <EmployeeDocumentPreview
          key={previewDoc.id}
          document={previewDoc}
          onClose={() => setPreviewDoc(null)}
        />
      )}
    </div>
  );
}
