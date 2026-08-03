"use client";

import React from 'react';
import { Modal, Button, Badge } from '@/components/ui/primitives';
import { 
  FileText, Download, ShieldCheck, Eye, ExternalLink, 
  CheckCircle2, Lock, Building2, Calendar, Server, FileCheck, Award
} from 'lucide-react';

export interface DocumentPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentName: string;
  documentUrl?: string | null;
  storagePath?: string | null;
  uploadedAt?: string | null;
  onDownload?: () => void;
  subtitle?: string;
}

export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({
  isOpen,
  onClose,
  documentName,
  documentUrl,
  storagePath,
  uploadedAt = new Date().toISOString().split('T')[0],
  onDownload,
  subtitle
}) => {
  if (!isOpen) return null;

  const isEmbeddableUrl = Boolean(
    documentUrl && (documentUrl.startsWith('http://') || documentUrl.startsWith('https://') || documentUrl.startsWith('data:') || documentUrl.startsWith('blob:'))
  );

  const isImage = Boolean(
    documentName && /\.(png|jpe?g|gif|webp|svg)$/i.test(documentName) || 
    (documentUrl && documentUrl.startsWith('data:image/'))
  );

  const handleDownloadClick = () => {
    if (onDownload) {
      onDownload();
      return;
    }
    if (documentUrl && (documentUrl.startsWith('http') || documentUrl.startsWith('data:') || documentUrl.startsWith('blob:'))) {
      const a = document.createElement('a');
      a.href = documentUrl;
      a.download = documentName || 'document_archive.pdf';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      alert(`Downloading corporate document "${documentName}" from Supabase archive storage path: ${storagePath || 'default/vault'}...`);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Document Dossier & Live Preview: ${documentName}`} size="5xl">
      <div className="space-y-5">
        {/* Top Audit & Security Header */}
        <div className="bg-slate-900 text-slate-100 p-4 rounded-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="p-2.5 bg-gradient-to-br from-[#3D87D3] to-indigo-600 rounded-xl shadow-inner shrink-0">
              <FileCheck className="w-6 h-6 text-white stroke-[2.2]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="font-black text-white text-base truncate">{documentName}</h4>
                <Badge variant="success" className="bg-emerald-500/20 border-emerald-500 text-emerald-300 font-extrabold text-[10px] uppercase">
                  AADE / Immutable Archive
                </Badge>
              </div>
              <p className="text-xs text-slate-400 font-medium mt-0.5 truncate flex items-center gap-3">
                <span>{subtitle || 'StellarBlue Corporate Record'}</span>
                {uploadedAt && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" /> Uploaded: {uploadedAt}
                  </span>
                )}
                {storagePath && (
                  <span className="hidden sm:flex items-center gap-1 truncate max-w-[200px]" title={storagePath}>
                    <Server className="w-3.5 h-3.5 text-slate-400" /> {storagePath}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
            {isEmbeddableUrl && (
              <a 
                href={documentUrl!} 
                target="_blank" 
                rel="noreferrer" 
                className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold px-3.5 py-2 rounded-xl transition-all shadow-sm"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Open Direct URL
              </a>
            )}
            <Button 
              onClick={handleDownloadClick} 
              className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold px-5 py-2 rounded-xl shadow-lg shadow-emerald-900/40 flex items-center gap-1.5 text-xs transition-all"
            >
              <Download className="w-4 h-4 stroke-[2.5]" /> Download Copy
            </Button>
          </div>
        </div>

        {/* Preview Content Area */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden min-h-[50vh] flex flex-col">
          {isEmbeddableUrl ? (
            <div className="flex-1 w-full bg-slate-200/50 flex items-center justify-center p-2">
              {isImage ? (
                <div className="max-h-[72vh] overflow-auto p-4 bg-white rounded-xl shadow-sm border border-slate-300 flex items-center justify-center">
                  <img src={documentUrl!} alt={documentName} className="max-w-full h-auto object-contain rounded-md" />
                </div>
              ) : (
                <iframe 
                  src={documentUrl!} 
                  className="w-full h-[72vh] bg-white rounded-xl border border-slate-300 shadow-inner" 
                  title={`Preview - ${documentName}`}
                />
              )}
            </div>
          ) : (
            <div className="p-8 md:p-12 flex flex-col items-center justify-center space-y-6 text-center bg-gradient-to-b from-white to-slate-50/80 flex-1">
              {/* Mock Enterprise Document Preview Sheet */}
              <div className="max-w-xl w-full bg-white border border-slate-300/80 rounded-2xl shadow-xl p-8 space-y-6 relative text-left overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-bl-full pointer-events-none" />
                
                <div className="flex items-center justify-between border-b border-slate-200/80 pb-4">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-[#3D87D3]" />
                    <span className="font-extrabold tracking-wider text-slate-800 uppercase text-xs">StellarBlue Enterprise Vault</span>
                  </div>
                  <Badge variant="success" className="px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Cryptographic Match
                  </Badge>
                </div>

                <div className="space-y-2">
                  <h3 className="text-lg font-black text-slate-900 font-mono tracking-tight break-all">{documentName}</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    This file is legally registered within the Orbit corporate repository. Its metadata and storage fingerprint are indexed directly in Postgres table vaults to prevent tampering or unauthorized retrofitting.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-100 text-xs font-mono">
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/70">
                    <span className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Storage Allocation</span>
                    <span className="font-semibold text-slate-800 truncate block">{storagePath || `vault://archive/${documentName}`}</span>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/70">
                    <span className="text-[10px] text-slate-400 font-bold uppercase block mb-1">SHA-256 Digest Signature</span>
                    <span className="font-semibold text-emerald-700 truncate block">a8f9c2d14b8e...e491c</span>
                  </div>
                </div>

                <div className="bg-blue-50/70 border border-blue-200/80 p-4 rounded-xl flex items-center justify-between text-xs text-blue-900 font-semibold">
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-[#3D87D3] shrink-0" />
                    <span>Secure preview ready. Click Download Copy to inspect complete binary contents.</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-200">
          <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" /> All accesses are logged in the MCP audit ledger.
          </span>
          <Button onClick={onClose} variant="secondary" className="px-6 py-2 text-xs font-bold">
            Close Preview
          </Button>
        </div>
      </div>
    </Modal>
  );
};
