"use client";

import React, { useEffect, useState } from 'react';
import type { EmployeeDocument } from '@/lib/types';
import { Button, Modal } from '@/components/ui/primitives';
import { createDocumentSignedUrl, employeeDocumentTypeLabel } from '@/lib/employee-documents';
import { Download, ExternalLink, Loader2 } from 'lucide-react';

/** Chrome, Safari and Edge render PDFs natively; only Word files need a download fallback. */
const isPdfDocument = (document: EmployeeDocument) =>
  document.mime_type === 'application/pdf' || /\.pdf$/i.test(document.file_name);

const isImageDocument = (document: EmployeeDocument) => (document.mime_type || '').startsWith('image/');

interface EmployeeDocumentPreviewProps {
  document: EmployeeDocument;
  onClose: () => void;
}

/**
 * Preview overlay for one qualification document. Mount it with `key={document.id}` so switching
 * documents remounts the signing effect instead of resetting state from inside an effect.
 */
export function EmployeeDocumentPreview({ document, onClose }: EmployeeDocumentPreviewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void createDocumentSignedUrl(document).then(result => {
      if (cancelled) return;
      setUrl(result.url);
      setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [document]);

  const download = async () => {
    const result = await createDocumentSignedUrl(document, document.file_name);
    if (!result.url) {
      setError(result.error);
      return;
    }
    const link = window.document.createElement('a');
    link.href = result.url;
    link.download = document.file_name;
    link.rel = 'noopener';
    link.click();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={document.title}
      eyebrow={employeeDocumentTypeLabel(document.doc_type)}
      size="6xl"
    >
      {error ? (
        <p className="text-xs text-rose-700">{error}</p>
      ) : !url ? (
        <div className="flex items-center justify-center gap-2 py-12 text-xs text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Preparing preview…
        </div>
      ) : isPdfDocument(document) ? (
        <iframe
          src={url}
          title={document.title}
          className="w-full h-[72vh] rounded-lg border border-slate-200 bg-white"
        />
      ) : isImageDocument(document) ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed storage URL
        <img src={url} alt={document.title} className="max-h-[72vh] mx-auto rounded-lg border border-slate-200" />
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-xs text-slate-500">
          Word documents cannot be previewed in the browser. Download the file to read it.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
        <span className="text-[11px] font-mono text-slate-500 truncate">{document.file_name}</span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => url && window.open(url, '_blank', 'noopener')}
            disabled={!url}
            className="cursor-pointer"
          >
            <ExternalLink className="w-3 h-3 mr-1" /> Open in new tab
          </Button>
          <Button size="sm" variant="primary" onClick={download} className="cursor-pointer">
            <Download className="w-3 h-3 mr-1" /> Download
          </Button>
        </div>
      </div>
    </Modal>
  );
}
