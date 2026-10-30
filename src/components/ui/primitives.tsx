"use client";

import React from 'react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: (string | undefined | null | boolean)[]) {
  return twMerge(clsx(inputs));
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export const Button: React.FC<ButtonProps> = ({ children, className, variant = 'primary', size = 'md', ...props }) => {
  const base = "inline-flex items-center justify-center gap-1.5 font-semibold tracking-[0.005em] rounded-[var(--radius-control)] border transition-colors duration-150 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap select-none";
  const variants = {
    primary: "bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white border-[var(--accent-hover)] active:bg-[var(--accent-ink)] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]",
    secondary: "bg-white hover:bg-[var(--surface-muted)] text-[var(--ink-2)] border-[var(--line-strong)] hover:text-[var(--ink)] hover:border-[var(--ink-4)]",
    outline: "bg-transparent hover:bg-white text-[var(--ink-3)] hover:text-[var(--ink)] border-[var(--line-strong)]",
    danger: "bg-rose-700 hover:bg-rose-800 text-white border-rose-800",
    ghost: "bg-transparent hover:bg-[var(--surface-muted)] text-[var(--ink-3)] hover:text-[var(--ink)] border-transparent"
  };
  const sizes = {
    sm: "h-7 px-2.5 text-[12px]",
    md: "h-8 px-3 text-[12px]",
    lg: "h-10 px-4 text-[13px]"
  };

  return (
    <button className={cn(base, variants[variant], sizes[size], className)} {...props}>
      {children}
    </button>
  );
};

export const Card: React.FC<{ children: React.ReactNode; className?: string; title?: string; subtitle?: string; action?: React.ReactNode }> = ({ children, className, title, subtitle, action }) => {
  const hasHead = Boolean(title || action);
  return (
    <div className={cn(
      "bg-[var(--surface)] border border-[var(--line)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)]",
      hasHead ? "overflow-hidden" : "p-4",
      className
    )}>
      {hasHead && (
        <div className="ui-panel-head">
          <div className="min-w-0">
            {title && <h3 className="ui-section-title">{title}</h3>}
            {subtitle && <p className="ui-meta mt-0.5">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {hasHead ? <div className="p-4">{children}</div> : children}
    </div>
  );
};

export const Badge: React.FC<{ children: React.ReactNode; variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral'; className?: string; style?: React.CSSProperties }> = ({ children, variant = 'neutral', className, style }) => {
  const styles = {
    success: "bg-emerald-50 text-emerald-800 border-emerald-300/70",
    warning: "bg-[var(--warning-soft)] text-[var(--warning)] border-amber-300/70",
    error: "bg-rose-50 text-rose-800 border-rose-300/70",
    info: "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-[color-mix(in_srgb,var(--accent)_35%,white)]",
    neutral: "bg-[var(--surface-muted)] text-[var(--ink-3)] border-[var(--line-strong)]"
  };
  return (
    <span
      className={cn(
        "inline-flex items-center h-[18px] px-1.5 rounded-[3px] text-[10px] font-bold uppercase tracking-[0.06em] border whitespace-nowrap",
        styles[variant],
        className
      )}
      style={style}
    >
      {children}
    </span>
  );
};

export const StatCard: React.FC<{
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  trend?: string;
  trendUp?: boolean;
  /** Optional action row under the value — e.g. a link into the detailed report behind the number. */
  footer?: React.ReactNode;
}> = ({ title, value, subtitle, icon, trend, trendUp, footer }) => (
  <Card className="relative overflow-hidden h-full flex flex-col">
    <div className="flex justify-between items-start gap-3">
      <div className="min-w-0">
        <p className="ui-label">{title}</p>
        <h4 className="ui-num text-[23px] font-semibold text-[var(--ink)] mt-1.5 leading-none tracking-[-0.025em]">{value}</h4>
        {subtitle && <p className="ui-meta mt-1.5 leading-snug">{subtitle}</p>}
      </div>
      {icon && <div className="shrink-0 p-1.5 rounded-[4px] bg-[var(--surface-muted)] border border-[var(--line)]">{icon}</div>}
    </div>
    {trend && (
      <div className="mt-4 flex items-center text-xs">
        <span className={cn("font-semibold mr-1.5", trendUp ? "text-emerald-600" : "text-amber-600")}>
          {trendUp ? "▲" : "▼"} {trend}
        </span>
        <span className="text-slate-500">vs last period</span>
      </div>
    )}
    {footer && <div className="mt-auto pt-3">{footer}</div>}
  </Card>
);

export const Modal: React.FC<{ 
  isOpen: boolean; 
  onClose: () => void; 
  title: string; 
  /** Optional stencil line above the title (screen area, record kind). */
  eyebrow?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl' | 'full';
}> = ({ isOpen, onClose, title, eyebrow, children, size = 'lg' }) => {
  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '4xl': 'max-w-4xl',
    '5xl': 'max-w-5xl',
    '6xl': 'max-w-6xl',
    '7xl': 'max-w-7xl',
    full: 'max-w-[95vw]',
  }[size];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(13,18,24,0.55)] backdrop-blur-[2px] animate-in fade-in duration-150">
      <div className={`bg-[var(--surface)] border border-[var(--line-strong)] w-full ${sizeClasses} rounded-[var(--radius-card)] shadow-[var(--shadow-pop)] overflow-hidden max-h-[92vh] flex flex-col animate-in zoom-in-95 duration-150`}>
        <div className="px-5 py-3 border-b border-[var(--line)] flex items-center justify-between gap-4 bg-[var(--surface-muted)] shrink-0">
          <div className="min-w-0">
            {eyebrow && <p className="ui-eyebrow leading-none mb-1">{eyebrow}</p>}
            <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--ink)] truncate">{title}</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-7 h-7 inline-flex items-center justify-center rounded-[4px] text-[var(--ink-3)] hover:text-[var(--ink)] hover:bg-[var(--surface-sunken)] cursor-pointer transition-colors text-xl font-medium leading-none">&times;</button>
        </div>
        <div className="p-5 overflow-y-auto space-y-4 text-[13px] text-[var(--ink-2)] flex-1">
          {children}
        </div>
      </div>
    </div>
  );
};
