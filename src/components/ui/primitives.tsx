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
  const base = "inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#3D87D3] focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-xs";
  const variants = {
    primary: "bg-[#3D87D3] hover:bg-[#3272B4] text-white border border-[#3272B4]/20 shadow-sm hover:shadow",
    secondary: "bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-xs hover:text-slate-900",
    outline: "bg-transparent hover:bg-slate-100/70 text-slate-700 border border-slate-200",
    danger: "bg-rose-600 hover:bg-rose-700 text-white border border-rose-600 shadow-sm",
    ghost: "bg-transparent hover:bg-slate-100 text-slate-600 hover:text-slate-900 shadow-none"
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
  <div className={cn("bg-white border border-slate-200/80 rounded-xl p-5 shadow-sm transition-all duration-200 hover:shadow-md", className)}>
    {(title || action) && (
      <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
        <div>
          {title && <h3 className="text-base font-semibold text-slate-800 tracking-tight">{title}</h3>}
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {action && <div>{action}</div>}
      </div>
    )}
    {children}
  </div>
);

export const Badge: React.FC<{ children: React.ReactNode; variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral'; className?: string; style?: React.CSSProperties }> = ({ children, variant = 'neutral', className, style }) => {
  const styles = {
    success: "bg-emerald-50 text-emerald-700 border-emerald-200/60",
    warning: "bg-amber-50 text-amber-700 border-amber-200/60",
    error: "bg-rose-50 text-rose-700 border-rose-200/60",
    info: "bg-blue-50 text-[#3D87D3] border-blue-200/60",
    neutral: "bg-slate-100 text-slate-700 border-slate-200/80"
  };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border", styles[variant], className)} style={style}>
      {children}
    </span>
  );
};

export const StatCard: React.FC<{ title: string; value: string | number; subtitle?: string; icon?: React.ReactNode; trend?: string; trendUp?: boolean }> = ({ title, value, subtitle, icon, trend, trendUp }) => (
  <Card className="hover:border-slate-300/80 transition-all relative overflow-hidden bg-white">
    <div className="flex justify-between items-start">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p>
        <h4 className="text-2xl font-bold text-slate-800 mt-2 tracking-tight">{value}</h4>
        {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {icon && <div className="p-2.5 rounded-xl bg-[#3D87D3]/10 border border-[#3D87D3]/15 text-[#3D87D3]">{icon}</div>}
    </div>
    {trend && (
      <div className="mt-4 flex items-center text-xs">
        <span className={cn("font-semibold mr-1.5", trendUp ? "text-emerald-600" : "text-amber-600")}>
          {trendUp ? "▲" : "▼"} {trend}
        </span>
        <span className="text-slate-500">vs last period</span>
      </div>
    )}
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
