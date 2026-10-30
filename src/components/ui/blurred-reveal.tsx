"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from './primitives';

interface BlurredRevealProps {
  /** The sensitive value to blur/hide. Renders a plain placeholder when empty. */
  value?: string | null;
  placeholder?: string;
  className?: string;
  /** Classes for the value text itself (size, weight, colour). */
  valueClassName?: string;
  /** Blur strength while hidden; defaults to `blur-[6px]`. */
  blurClassName?: string;
  /** Classes for the reveal button. */
  buttonClassName?: string;
  /** Non-sensitive content rendered right after the value (e.g. a unit), never blurred. */
  suffix?: React.ReactNode;
  /** Controlled reveal state, e.g. when one button reveals several values. Pair with `onToggle`. */
  revealed?: boolean;
  /** Toggle handler for controlled mode. */
  onToggle?: () => void;
  /** Set false to leave the toggle to another control. */
  showButton?: boolean;
}

/**
 * Shared reveal state (with the same auto-hide used by `BlurredReveal`) so a single
 * "View" button can control several sensitive values at once.
 */
export function useReveal(autoHideMs = 8000) {
  const [revealed, setRevealed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggle = useCallback(() => {
    setRevealed(prev => {
      const next = !prev;
      if (timer.current) clearTimeout(timer.current);
      timer.current = next && autoHideMs > 0
        ? setTimeout(() => setRevealed(false), autoHideMs)
        : null;
      return next;
    });
  }, [autoHideMs]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { revealed, toggle };
}

/**
 * Blurs a sensitive value (e.g. IBAN or salary) behind a "View" toggle.
 * Auto-hides again after 8 seconds for shoulder-surfing protection.
 */
export function BlurredReveal({
  value,
  placeholder = 'Not configured',
  className,
  valueClassName,
  blurClassName,
  buttonClassName,
  suffix,
  revealed: controlledRevealed,
  onToggle,
  showButton = true,
}: BlurredRevealProps) {
  const own = useReveal();
  const revealed = controlledRevealed ?? own.revealed;
  const toggle = onToggle ?? own.toggle;
  const text = value?.trim() || '';
  const hasValue = text.length > 0;

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {hasValue ? (
        <>
          <span
            aria-hidden={!revealed}
            className={cn(
              "font-mono font-bold tracking-wider transition-all",
              valueClassName ?? "text-[var(--accent)]",
              revealed ? "blur-none opacity-100" : cn("select-none opacity-90", blurClassName ?? "blur-[6px]")
            )}
          >
            {text}
          </span>
          {suffix}
        </>
      ) : (
        <span className="text-slate-400 font-mono font-bold">{placeholder}</span>
      )}
      {hasValue && showButton && (
        <button
          type="button"
          onClick={toggle}
          title={revealed ? 'Hide' : 'View'}
          aria-pressed={revealed}
          className={cn(
            "inline-flex items-center px-2 py-0.5 rounded-md border border-slate-200 bg-white text-[10px] font-extrabold uppercase tracking-wide text-slate-500 hover:text-[var(--accent)] hover:border-[var(--accent)]/40 cursor-pointer transition-colors",
            buttonClassName
          )}
        >
          {revealed ? 'Hide' : 'View'}
        </button>
      )}
    </span>
  );
}
