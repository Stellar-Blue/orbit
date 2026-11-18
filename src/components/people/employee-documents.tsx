"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { notifySuccess, notifyValidation } from '@/lib/validation-modal';
import type { EmployeeDocument, EmployeeDocumentType } from '@/lib/types';
import {
  EMPLOYEE_DOCUMENTS_BUCKET,
  EMPLOYEE_DOCUMENT_STATUS,
  EMPLOYEE_DOCUMENT_TYPES,
  employeeDocumentTypeLabel,
  setDocumentReviewStatus,
} from '@/lib/employee-documents';
import { EmployeeDocumentPreview } from '@/components/people/employee-document-preview';
import { Badge, Button } from '@/components/ui/primitives';
import { DatePicker } from '@/components/ui/date-picker';
import { formatDate } from '@/lib/date';
import { Check, Eye, FileText, Loader2, ShieldCheck, Trash2, Upload, X } from 'lucide-react';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

const EMPTY_FORM = {
  doc_type: 'degree' as EmployeeDocumentType,
  title: '',
  issuer: '',
  issued_on: '',
  expires_on: '',
};

interface EmployeeDocumentsProps {
  profileId: string;
  /** Owner controls: upload and delete. */
  canUpload: boolean;
  /** Admin controls: verify or reject a pending document. */
  canReview: boolean;
}

/**
 * Qualifications of one employee: degrees, certifications and language certificates, stored in the
 * private `employee-documents` bucket under the uploader's auth uid. Renders the upload form for the
 * owner and the review actions for an admin; the same card is used on My Profile and the People
 * dossier.
 */
export function EmployeeDocuments({ profileId, canUpload, canReview }: EmployeeDocumentsProps) {
  const { currentUser, profiles } = useAuth();
  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<EmployeeDocument | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await getSupabaseBrowserClient()
      .from('employee_documents')
      .select('*')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false });
    if (error) {
      notifyValidation({ type: 'error', title: 'Could not load documents', message: error.message });
      setDocuments([]);
    } else {
      setDocuments((data || []) as EmployeeDocument[]);
    }
    setLoading(false);
  }, [profileId]);

  // One-shot load; state lands after the query resolves (same pattern as the project panel).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() only sets state after awaiting the query
    void load();
  }, [load]);

  const upload = async () => {
    if (!file) {
      notifyValidation({ type: 'warning', title: 'No file chosen', message: 'Pick the document file to upload.' });
      return;
    }
    if (!form.title.trim()) {
      notifyValidation({ type: 'warning', title: 'Title required', message: 'Give the document a name, e.g. "BSc Computer Science".' });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      notifyValidation({ type: 'warning', title: 'File too large', message: 'The limit is 20 MB per document.' });
      return;
    }

    setUploading(true);
    const supabase = getSupabaseBrowserClient();
    const { data: authData } = await supabase.auth.getUser();
    const authUserId = authData.user?.id;
    if (!authUserId) {
      setUploading(false);
      notifyValidation({ type: 'error', title: 'No session', message: 'Sign in again before uploading a document.' });
      return;
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `${authUserId}/${crypto.randomUUID()}_${safeName}`;
    const { error: uploadError } = await supabase.storage.from(EMPLOYEE_DOCUMENTS_BUCKET).upload(storagePath, file, { upsert: false });
    if (uploadError) {
      setUploading(false);
      notifyValidation({ type: 'error', title: 'Upload failed', message: uploadError.message });
      return;
    }

    const { error: insertError } = await supabase.from('employee_documents').insert({
      profile_id: profileId,
      doc_type: form.doc_type,
      title: form.title.trim(),
      issuer: form.issuer.trim() || null,
      issued_on: form.issued_on || null,
      expires_on: form.expires_on || null,
      file_name: file.name,
      storage_path: storagePath,
      file_size: file.size,
      mime_type: file.type || null,
      status: 'pending',
    });
    if (insertError) {
      // The file is already in the bucket; drop it so a failed save leaves nothing behind.
      await supabase.storage.from(EMPLOYEE_DOCUMENTS_BUCKET).remove([storagePath]);
      setUploading(false);
      notifyValidation({ type: 'error', title: 'Could not save the document', message: insertError.message });
      return;
    }

    setForm(EMPTY_FORM);
    setFile(null);
    setFileInputKey(key => key + 1);
    await load();
    setUploading(false);
    notifySuccess(`${file.name} uploaded and waiting for review.`);
  };

  const removeDocument = async (doc: EmployeeDocument) => {
    if (!confirm(`Delete "${doc.title}"? The file is removed from storage as well.`)) return;
    setBusyId(doc.id);
    const supabase = getSupabaseBrowserClient();
    const { error: storageError } = await supabase.storage.from(EMPLOYEE_DOCUMENTS_BUCKET).remove([doc.storage_path]);
    if (storageError) {
      setBusyId(null);
      notifyValidation({ type: 'error', title: 'Could not delete the file', message: storageError.message });
      return;
    }
    const { error } = await supabase.from('employee_documents').delete().eq('id', doc.id);
    setBusyId(null);
    if (error) {
      notifyValidation({ type: 'error', title: 'Could not delete the document', message: error.message });
      return;
    }
    notifySuccess('Document deleted.');
    await load();
  };

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

  const fieldClass = 'w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-[var(--accent)]';
  const labelClass = 'block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1';

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-400 py-4">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading documents…
        </div>
      ) : documents.length === 0 ? (
        <div className="text-center py-6 text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
          {canUpload
            ? 'No qualifications uploaded yet. Add your degrees, certifications and language certificates below.'
            : 'No qualification documents uploaded yet.'}
        </div>
      ) : (
        <ul className="space-y-2">
          {documents.map(doc => {
            const badge = EMPLOYEE_DOCUMENT_STATUS[doc.status];
            const reviewer = doc.reviewed_by ? profiles.find(p => p.id === doc.reviewed_by) : null;
            const busy = busyId === doc.id;
            return (
              <li key={doc.id} className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <FileText className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                      <span className="text-[13px] font-bold text-slate-800 truncate">{doc.title}</span>
                      <Badge variant={badge.variant} className="text-[9px] px-1.5 py-0">{badge.label.toUpperCase()}</Badge>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-semibold text-slate-600">{employeeDocumentTypeLabel(doc.doc_type)}</span>
                      {doc.issuer && <><span>·</span><span>{doc.issuer}</span></>}
                      {doc.issued_on && <><span>·</span><span>Issued {formatDate(doc.issued_on)}</span></>}
                      {doc.expires_on && <><span>·</span><span>Expires {formatDate(doc.expires_on)}</span></>}
                      <span>·</span>
                      <span className="font-mono">{doc.file_name}</span>
                      {doc.file_size != null && <span>({(doc.file_size / 1024 / 1024).toFixed(2)} MB)</span>}
                    </div>
                    {doc.status === 'rejected' && doc.review_note && (
                      <p className="text-[11px] text-rose-700 mt-1">Reviewer: {doc.review_note}</p>
                    )}
                    {reviewer && doc.reviewed_at && (
                      <p className="text-[10px] text-slate-400 mt-1">
                        {doc.status === 'verified' ? 'Verified' : 'Rejected'} by {reviewer.first_name} {reviewer.last_name} on {formatDate(doc.reviewed_at)}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => setPreviewDoc(doc)} className="cursor-pointer">
                      <Eye className="w-3 h-3 mr-1" /> Preview
                    </Button>
                    {canReview && doc.status !== 'verified' && (
                      <Button size="sm" variant="secondary" onClick={() => review(doc, 'verified')} disabled={busy} className="cursor-pointer">
                        {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Check className="w-3 h-3 mr-1" />} Verify
                      </Button>
                    )}
                    {canReview && doc.status !== 'rejected' && (
                      <Button size="sm" variant="outline" onClick={() => review(doc, 'rejected')} disabled={busy} className="cursor-pointer">
                        <X className="w-3 h-3 mr-1" /> Reject
                      </Button>
                    )}
                    {(canUpload || canReview) && (
                      <Button size="sm" variant="ghost" onClick={() => removeDocument(doc)} disabled={busy} className="cursor-pointer text-rose-700">
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canUpload && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-extrabold text-slate-700">
            <Upload className="w-3.5 h-3.5 text-[var(--accent)]" /> Add a qualification document
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="employee-doc-title">Title</label>
              <input
                id="employee-doc-title"
                type="text"
                value={form.title}
                onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
                placeholder="e.g. BSc Computer Science"
                className={fieldClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="employee-doc-type">Type</label>
              <select
                id="employee-doc-type"
                value={form.doc_type}
                onChange={e => setForm(prev => ({ ...prev, doc_type: e.target.value as EmployeeDocumentType }))}
                className={fieldClass}
              >
                {EMPLOYEE_DOCUMENT_TYPES.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="employee-doc-issuer">Issuing body</label>
              <input
                id="employee-doc-issuer"
                type="text"
                value={form.issuer}
                onChange={e => setForm(prev => ({ ...prev, issuer: e.target.value }))}
                placeholder="e.g. University of Athens"
                className={fieldClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="employee-doc-file">File (PDF, image or Word, max 20 MB)</label>
              <input
                id="employee-doc-file"
                key={fileInputKey}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                onChange={e => setFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-slate-600 file:mr-2 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-50 cursor-pointer"
              />
            </div>
            <div>
              <label className={labelClass}>Issued on</label>
              <DatePicker value={form.issued_on} onChange={next => setForm(prev => ({ ...prev, issued_on: next }))} placeholder="Not set" />
            </div>
            <div>
              <label className={labelClass}>Expires on</label>
              <DatePicker value={form.expires_on} onChange={next => setForm(prev => ({ ...prev, expires_on: next }))} placeholder="Never" />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-slate-500 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Visible to you and the admins only. New uploads wait for review.
            </span>
            <Button size="sm" variant="primary" onClick={upload} disabled={uploading} className="cursor-pointer">
              {uploading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1.5" />}
              {uploading ? 'Uploading…' : 'Upload document'}
            </Button>
          </div>
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
