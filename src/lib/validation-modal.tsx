"use client";

import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

export interface ValidationItem { label: string; value: string; }
export interface ValidationNotice {
  type?: 'error' | 'warning' | 'success' | 'info';
  title?: string;
  message: string;
  items?: ValidationItem[];
  duration?: number; // ms auto-dismiss; 0 = sticky (requires OK)
}

type Listener = (n: ValidationNotice) => void;
const listeners = new Set<Listener>();

/** Programmatic API for structured validation notices (used by quota checks etc.). */
export function notifyValidation(n: ValidationNotice) {
  listeners.forEach(l => l({ ...n }));
}

/** Friendly, auto-dismissing green confirmation for successful saves/actions. */
export function notifySuccess(message: string, title = 'Done') {
  notifyValidation({ type: 'success', title, message, duration: 4000 });
}

/** Route every window.alert() through the validation modal (universal coverage). */
function routeAlert() {
  if (typeof window === 'undefined' || (window as any).__orbitValidationRouted) return;
  (window as any).__orbitValidationRouted = true;
  window.alert = (msg?: unknown) => {
    notifyValidation({ type: 'error', title: 'Notice', message: String(msg ?? '') });
  };
}

export function ValidationHost() {
  const [notice, setNotice] = useState<ValidationNotice | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    routeAlert();
    const listener: Listener = (n) => { setNotice(n); setVisible(true); };
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  useEffect(() => {
    if (!notice || !notice.duration) return;
    const t = setTimeout(() => setVisible(false), notice.duration);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setVisible(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible]);

  if (!notice) return null;

  const type = notice.type || 'error';
  const palette: Record<string, { bar: string; label: string; icon: React.ReactNode }> = {
    error: { bar: 'bg-rose-600', label: 'Attention required', icon: <XCircle className="w-5 h-5" /> },
    warning: { bar: 'bg-amber-500', label: 'Heads up', icon: <AlertTriangle className="w-5 h-5" /> },
    success: { bar: 'bg-emerald-600', label: 'Done', icon: <CheckCircle2 className="w-5 h-5" /> },
    info: { bar: 'bg-[#3D87D3]', label: 'Information', icon: <Info className="w-5 h-5" /> },
  };
  const p = palette[type];

  return (
    <div
      className={`fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[2px] transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      onClick={() => setVisible(false)}
    >
      <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150" onClick={e => e.stopPropagation()}>
        <div className={`${p.bar} px-5 py-3 flex items-center gap-3 text-white`}>
          <span className="shrink-0">{p.icon}</span>
          <div className="min-w-0">
            <div className="font-black text-sm leading-tight truncate">{notice.title || p.label}</div>
            <div className="text-[10px] opacity-80 font-semibold uppercase tracking-wider">{p.label}</div>
          </div>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-slate-700 leading-relaxed">{notice.message}</p>
          {notice.items && notice.items.length > 0 && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 divide-y divide-slate-100">
              {notice.items.map((it, i) => (
                <div key={i} className="px-3 py-2 flex items-center justify-between gap-3 text-xs">
                  <span className="text-slate-500 font-medium">{it.label}</span>
                  <span className="font-mono font-bold text-slate-800 text-right">{it.value}</span>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => setVisible(false)}
            className="w-full py-2.5 rounded-xl bg-[#3D87D3] hover:bg-[#3272B4] text-white text-sm font-bold cursor-pointer transition-colors"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
