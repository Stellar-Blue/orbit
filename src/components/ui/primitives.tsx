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
  const base = "inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-sm";
  const variants = {
    primary: "bg-blue-600 hover:bg-blue-500 text-white border border-blue-500/20 shadow-blue-500/25",
    secondary: "bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700",
    outline: "bg-transparent hover:bg-slate-800/60 text-slate-300 border border-slate-700",
    danger: "bg-rose-600/90 hover:bg-rose-600 text-white border border-rose-500",
    ghost: "bg-transparent hover:bg-slate-800/50 text-slate-400 hover:text-slate-200 shadow-none"
  };
  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-5 py-2.5 text-base"
  };

  return (
    <button className={cn(base, variants[variant], sizes[size], className)} {...props}>
      {children}
    </button>
  );
};

export const Card: React.FC<{ children: React.ReactNode; className?: string; title?: string; subtitle?: string; action?: React.ReactNode }> = ({ children, className, title, subtitle, action }) => (
  <div className={cn("bg-slate-900/90 border border-slate-800/80 rounded-xl p-5 shadow-xl backdrop-blur-md transition-all", className)}>
    {(title || action) && (
      <div className="flex items-center justify-between mb-4 border-b border-slate-800/60 pb-3">
        <div>
          {title && <h3 className="text-base font-semibold text-slate-100 tracking-tight">{title}</h3>}
          {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        {action && <div>{action}</div>}
      </div>
    )}
    {children}
  </div>
);

export const Badge: React.FC<{ children: React.ReactNode; variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral'; className?: string; style?: React.CSSProperties }> = ({ children, variant = 'neutral', className, style }) => {
  const styles = {
    success: "bg-emerald-950/80 text-emerald-400 border-emerald-800/60",
    warning: "bg-amber-950/80 text-amber-400 border-amber-800/60",
    error: "bg-rose-950/80 text-rose-400 border-rose-800/60",
    info: "bg-blue-950/80 text-blue-400 border-blue-800/60",
    neutral: "bg-slate-800 text-slate-300 border-slate-700"
  };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border", styles[variant], className)} style={style}>
      {children}
    </span>
  );
};

export const StatCard: React.FC<{ title: string; value: string | number; subtitle?: string; icon?: React.ReactNode; trend?: string; trendUp?: boolean }> = ({ title, value, subtitle, icon, trend, trendUp }) => (
  <Card className="hover:border-slate-700/80 transition-colors relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950">
    <div className="flex justify-between items-start">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{title}</p>
        <h4 className="text-2xl font-bold text-slate-100 mt-2 tracking-tight">{value}</h4>
        {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
      </div>
      {icon && <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">{icon}</div>}
    </div>
    {trend && (
      <div className="mt-4 flex items-center text-xs">
        <span className={cn("font-semibold mr-1.5", trendUp ? "text-emerald-400" : "text-amber-400")}>
          {trendUp ? "▲" : "▼"} {trend}
        </span>
        <span className="text-slate-400">vs last period</span>
      </div>
    )}
  </Card>
);

export const Modal: React.FC<{ isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }> = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-150">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <h3 className="font-semibold text-slate-100 text-base">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-lg">&times;</button>
        </div>
        <div className="p-6 overflow-y-auto space-y-4 text-sm text-slate-300">
          {children}
        </div>
      </div>
    </div>
  );
};
