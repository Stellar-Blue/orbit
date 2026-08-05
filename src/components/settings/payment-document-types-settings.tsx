"use client";

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, Button, Badge } from '@/components/ui/primitives';
import { FileText, Plus, Trash2, Check, X, AlertTriangle } from 'lucide-react';

export function PaymentDocumentTypesSettings() {
  const { documentTypes, addDocumentType, updateDocumentType, deleteDocumentType } = useAuth();
  const [label, setLabel] = useState('');
  const [emoji, setEmoji] = useState('📎');
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<'none' | 'saved' | 'error'>('none');

  const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

  const handleAdd = async () => {
    if (!label.trim()) return;
    setAdding(true);
    let code = slugify(label) || 'type';
    const used = new Set(documentTypes.map(d => d.code));
    let i = 2;
    while (used.has(code)) code = `${slugify(label) || 'type'}_${i++}`;
    const ok = await addDocumentType({
      code,
      label: label.trim(),
      emoji: emoji.trim() || '📎',
      is_default: false,
      active: true,
    });
    setAdding(false);
    setMsg(ok ? 'saved' : 'error');
    if (ok) { setLabel(''); setEmoji('📎'); }
    setTimeout(() => setMsg('none'), 3000);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white p-6 border border-slate-700">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 rounded-2xl shrink-0">
            <FileText className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2">Payroll Document Types</h3>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
              Categories assigned to documents uploaded against payroll payment rows. The built-in types (Bank Receipt, Payslip, Invoice, …) stay as defaults — add your own, or deactivate ones you don&apos;t use. Deactivated types stop appearing in the upload dropdown; existing documents keep their category.
            </p>
          </div>
        </div>
      </div>

      <Card className="p-5">
        <h4 className="font-bold text-slate-900 text-sm mb-4">Add a custom document type</h4>
        {msg === 'saved' && <div className="mb-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-2"><Check className="w-3.5 h-3.5" /> Document type added — it now appears in the payroll upload dropdown.</div>}
        {msg === 'error' && <div className="mb-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" /> Failed to add document type.</div>}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-1">Label</label>
            <input
              type="text"
              placeholder="e.g. Bonus Approval Memo"
              value={label}
              onChange={e => setLabel(e.target.value)}
              className="w-full p-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800"
            />
          </div>
          <div className="w-24">
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-1">Emoji</label>
            <input
              type="text"
              value={emoji}
              onChange={e => setEmoji(e.target.value)}
              className="w-full p-2 bg-white border border-slate-300 rounded-lg text-sm text-center"
            />
          </div>
          <div className="flex items-end">
            <Button size="sm" variant="primary" onClick={handleAdd} disabled={adding || !label.trim()} className="bg-[#3D87D3] text-white cursor-pointer">
              <Plus className="w-3.5 h-3.5 mr-1.5" /> {adding ? 'Adding…' : 'Add Type'}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h4 className="font-bold text-slate-900 text-sm mb-3">Active document types ({documentTypes.filter(d => d.active).length})</h4>
        <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-xl overflow-hidden bg-white">
          {documentTypes.map(dt => (
            <div key={dt.id} className="p-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-lg shrink-0">{dt.emoji}</span>
                <div className="min-w-0">
                  <div className="font-bold text-slate-800 text-xs flex items-center gap-2">
                    {dt.label}
                    {dt.is_default && <Badge variant="info" className="text-[9px] px-1.5 py-0">DEFAULT</Badge>}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">{dt.code}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {dt.active ? (
                  <Button size="sm" variant="outline" onClick={() => updateDocumentType(dt.id, { active: false })} className="text-slate-500 border-slate-200 cursor-pointer">
                    <X className="w-3 h-3 mr-1" /> Deactivate
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => updateDocumentType(dt.id, { active: true })} className="text-emerald-700 border-emerald-200 cursor-pointer">
                    <Check className="w-3 h-3 mr-1" /> Activate
                  </Button>
                )}
                {!dt.is_default && (
                  <Button size="sm" variant="danger" onClick={() => { if (confirm(`Delete "${dt.label}"? Existing documents keep their category.`)) deleteDocumentType(dt.id); }} className="cursor-pointer">
                    <Trash2 className="w-3 h-3" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-slate-400 mt-3 font-mono">
          Default types can be deactivated but not deleted — they can always be restored.
        </p>
      </Card>
    </div>
  );
}
