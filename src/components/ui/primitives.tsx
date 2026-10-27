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
  const base = "inline-flex items-center justify-center gap-1.5 font-semibold rounded-[var(--radius-control)] border transition-colors duration-150 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap select-none";
  const variants = {
    primary: "bg-[var(--accent)] hover:bg-[#3272b4] text-white border-transparent active:bg-[#2b649c]",
    secondary: "bg-white hover:bg-[var(--surface-muted)] text-[var(--ink-2)] border-[var(--line-strong)] hover:text-[var(--ink)]",
    outline: "bg-transparent hover:bg-white text-[var(--ink-3)] hover:text-[var(--ink)] border-[var(--line-strong)]",
    danger: "bg-rose-600 hover:bg-rose-700 text-white border-transparent",
    ghost: "bg-transparent hover:bg-[var(--surface-muted)] text-[var(--ink-3)] hover:text-[var(--ink)] border-transparent"
  };
  const sizes = {
    sm: "h-8 px-3 text-[12px]",
    md: "h-9 px-3.5 text-[13px]",
    lg: "h-10 px-4 text-[13px]"
  };

  return (
    <button className={cn(base, variants[variant], sizes[size], className)} {...props}>
      {children}
    </button>
  );
};

export const Card: React.FC<{ children: React.ReactNode; className?: string; title?: string; subtitle?: string; action?: React.ReactNode }> = ({ children, className, title, subtitle, action }) => (
  <div className={cn("bg-white border border-[var(--line)] rounded-[var(--radius-card)] p-5 shadow-[var(--shadow-card)]", className)}>
    {(title || action) && (
      <div className="flex items-start justify-between gap-3 mb-4 pb-3 border-b border-[var(--line)]">
        <div className="min-w-0">
          {title && <h3 className="ui-section-title">{title}</h3>}
          {subtitle && <p className="ui-meta mt-0.5">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    )}
    {children}
  </div>
);

export const Badge: React.FC<{ children: React.ReactNode; variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral'; className?: string; style?: React.CSSProperties }> = ({ children, variant = 'neutral', className, style }) => {
  const styles = {
    success: "bg-emerald-50/80 text-emerald-700 border-emerald-200/80",
    warning: "bg-amber-50/80 text-amber-800 border-amber-200/80",
    error: "bg-rose-50/80 text-rose-700 border-rose-200/80",
    info: "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-[color-mix(in_srgb,var(--accent)_28%,white)]",
    neutral: "bg-slate-50 text-slate-600 border-[var(--line-strong)]"
  };
  return (
    <span className={cn("inline-flex items-center h-5 px-1.5 rounded-md text-[11px] font-semibold border whitespace-nowrap", styles[variant], className)} style={style}>
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
  <Card className="relative overflow-hidden">
    <div className="flex justify-between items-start gap-3">
      <div className="min-w-0">
        <p className="ui-label">{title}</p>
        <h4 className="ui-num text-[24px] font-semibold text-[var(--ink)] mt-1.5 leading-none">{value}</h4>
        {subtitle && <p className="ui-meta mt-1.5 leading-snug">{subtitle}</p>}
      </div>
      {icon && <div className="shrink-0 p-2 rounded-lg bg-[var(--surface-muted)] border border-[var(--line)]">{icon}</div>}
    </div>
    {trend && (
      <div className="mt-4 flex items-center text-xs">
        <span className={cn("font-semibold mr-1.5", trendUp ? "text-emerald-600" : "text-amber-600")}>
          {trendUp ? "▲" : "▼"} {trend}
        </span>
        <span className="text-slate-500">vs last period</span>
      </div>
    )}
    {footer && <div className="mt-3">{footer}</div>}
  </Card>
);

export const Modal: React.FC<{ 
  isOpen: boolean; 
  onClose: () => void; 
  title: string; 
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl' | 'full';
}> = ({ isOpen, onClose, title, children, size = 'lg' }) => {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-150">
      <div className={`bg-white border border-slate-200 w-full ${sizeClasses} rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col animate-in zoom-in-95 duration-150`}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70 shrink-0">
          <h3 className="font-extrabold text-slate-900 text-lg">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-800 text-2xl font-bold cursor-pointer transition-colors leading-none">&times;</button>
        </div>
        <div className="p-6 overflow-y-auto space-y-4 text-sm text-slate-700 flex-1">
          {children}
        </div>
      </div>
    </div>
  );
};
