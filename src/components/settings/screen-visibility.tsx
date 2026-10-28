"use client";

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, Badge } from '@/components/ui/primitives';
import { notifySuccess } from '@/lib/validation-modal';
import { Eye, EyeOff, Info, ShieldCheck } from 'lucide-react';
import { HIDEABLE_SCREENS } from '@/lib/screens';

/**
 * Admin console for screen visibility.
 *
 * Each switch hides one screen from every non-admin: the sidebar link disappears and the
 * URL shows a "not available" card. Admins are never affected, and both "View as Employee"
 * and "Preview as …" honour the switches so the effect can be checked before telling anyone.
 *
 * This is a UI gate, not a security boundary — data access is still governed by RLS.
 */
export function ScreenVisibilityCard() {
  const { hiddenScreens, setScreenHidden } = useAuth();
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const toggle = async (key: string, label: string, currentlyHidden: boolean) => {
    setSavingKey(key);
    const ok = await setScreenHidden(key, !currentlyHidden);
    setSavingKey(null);
    if (ok) notifySuccess(`${label} is now ${currentlyHidden ? 'visible to' : 'hidden from'} everyone except administrators.`);
  };

  return (
    <Card
      title="Screen Visibility"
      subtitle="Turn whole screens off for everyone except administrators"
      className="shadow-xs border-slate-200"
      action={
        <Badge variant={hiddenScreens.length > 0 ? 'warning' : 'success'} className="text-[10px] px-2 py-0.5">
          {hiddenScreens.length > 0 ? `${hiddenScreens.length} hidden` : 'All visible'}
        </Badge>
      }
    >
      <div className="space-y-4 pt-2">
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 flex items-start space-x-3">
          <Info className="w-5 h-5 text-[#2f6fa3] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-extrabold text-slate-800">What hiding does</p>
            <p className="leading-relaxed">
              A hidden screen disappears from the sidebar and its URL is blocked for non-admins.
              Administrators keep full access, so you can still use the module yourself. Use
              &ldquo;View as Employee&rdquo; in the header to check the result.
            </p>
          </div>
        </div>

        <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white overflow-hidden">
          {HIDEABLE_SCREENS.map(screen => {
            const hidden = hiddenScreens.includes(screen.key);
            const busy = savingKey === screen.key;
            return (
              <div key={screen.key} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-extrabold text-slate-900">{screen.label}</span>
                    <span className="text-[10px] font-mono text-slate-400">{screen.path}</span>
                    {hidden && (
                      <Badge variant="warning" className="text-[10px] px-1.5 py-0">
                        <EyeOff className="w-3 h-3 mr-1" /> Hidden
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5 truncate">{screen.hint}</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => toggle(screen.key, screen.label, hidden)}
                  title={hidden ? `Show ${screen.label} to everyone` : `Hide ${screen.label} from non-admins`}
                  aria-label={hidden ? `Show ${screen.label}` : `Hide ${screen.label}`}
                  className={`relative w-11 h-6 rounded-full transition-colors shrink-0 cursor-pointer disabled:opacity-50 ${
                    hidden ? 'bg-amber-500' : 'bg-slate-300'
                  }`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${hidden ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-start gap-2 text-[11px] text-slate-500">
          {hiddenScreens.length > 0 ? (
            <EyeOff className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
          ) : (
            <Eye className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-500" />
          )}
          <span>
            {hiddenScreens.length > 0
              ? `Currently hidden from non-admins: ${HIDEABLE_SCREENS.filter(s => hiddenScreens.includes(s.key)).map(s => s.label).join(', ')}.`
              : 'Every screen is currently visible to all employees.'}
          </span>
        </div>

        <div className="flex items-start gap-2 text-[11px] text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            Hiding a screen is a display setting only — it does not change what the database allows
            anyone to read. Confidential modules stay protected by row-level security.
          </span>
        </div>
      </div>
    </Card>
  );
}
