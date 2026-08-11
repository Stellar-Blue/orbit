"use client";

import React, { useEffect, useRef, useState } from 'react';
import { cn } from './primitives';

interface BlurredRevealProps {
  /** The sensitive value to blur/hide. Renders a plain placeholder when empty. */
  value?: string | null;
  placeholder?: string;
  className?: string;
}

/**
 * Blurs a sensitive value (e.g. IBAN) behind a "View" toggle.
 * Auto-hides again after 8 seconds for shoulder-surfing protection.
 */
export function BlurredReveal({ value, placeholder = 'Not configured', className }: BlurredRevealProps) {
  const [revealed, setRevealed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const text = value?.trim() || '';
  const hasValue = text.length > 0;

  const toggle = () => {
    if (!hasValue) return;
    setRevealed(prev => {
      const next = !prev;
      if (next) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setRevealed(false), 8000);
      } else if (timer.current) {
        clearTimeout(timer.current);
      }
      return next;
    });
  };

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {hasValue ? (
        <span
          aria-hidden={!revealed}
          className={cn(
            "font-mono font-bold tracking-wider transition-all",
            revealed ? "text-[#3D87D3] blur-none" : "blur-[6px] select-none text-[#3D87D3]/90"
          )}
        >
          {text}
        </span>
      ) : (
        <span className="text-slate-400 font-mono font-bold">{placeholder}</span>
      )}
      {hasValue && (
        <button
          type="button"
          onClick={toggle}
          title={revealed ? 'Hide' : 'View'}
          className="inline-flex items-center px-2 py-0.5 rounded-md border border-slate-200 bg-white text-[10px] font-extrabold uppercase tracking-wide text-slate-500 hover:text-[#3D87D3] hover:border-[#3D87D3]/40 cursor-pointer transition-colors"
        >
          {revealed ? 'Hide' : 'View'}
        </button>
      )}
    </span>
  );
}
