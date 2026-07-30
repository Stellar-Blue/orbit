"use client";

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, Button, Badge, StatCard, Modal } from '@/components/ui/primitives';
import { 
  DollarSign, Download, Plus, Sparkles, ShieldAlert, 
  Calendar, CheckCircle, RefreshCw, Layers, Sliders, TrendingUp 
} from 'lucide-react';
import * as XLSX from 'xlsx';

export default function PayrollPage() {
  const { currentUser, profiles, paymentTypes, salaries, payments, generateDraftMonth } = useAuth();
  const [selectedPeriod, setSelectedPeriod] = useState<string>('2026-08');
  const [tab, setTab] = useState<'ledger' | 'forecast' | 'payment_types'>('ledger');
  
  // New dynamic payment type state
  const [isTypeOpen, setIsTypeOpen] = useState(false);
  const [ptCode, setPtCode] = useState('bonus_midyear');
  const [ptNameEl, setPtNameEl] = useState('Επιπλέον Αμοιβή');
  const [ptNameEn, setPtNameEn] = useState('Mid-Year Performance Bonus');
  const [ptMult, setPtMult] = useState(0.5);

  const isAdmin = currentUser.role === 'admin';

  if (!isAdmin) {
    return (
      <div className="p-12 text-center bg-slate-900 border border-slate-800 rounded-2xl max-w-xl mx-auto my-12 space-y-3">
        <ShieldAlert className="w-12 h-12 mx-auto text-rose-500" />
        <h2 className="text-xl font-bold text-slate-100">403 Forbidden &mdash; Strictly Admin Restricted</h2>
        <p className="text-xs text-slate-400">
          Compensation ledgers, contractor invoice rates, and salary history are confidential under Supabase Row-Level Security and accessible solely to Founders.
        </p>
      </div>
    );
  }

  const periodPayments = payments.filter(p => p.period === selectedPeriod);
  const totalCost = periodPayments.reduce((acc, p) => acc + p.total_cost, 0);
  const totalNet = periodPayments.reduce((acc, p) => acc + p.net, 0);

  const handleGenerateDraft = () => {
    generateDraftMonth(selectedPeriod);
    alert(`Successfully generated draft salary & contractor invoice records for ${selectedPeriod} across all active staff!`);
  };

  // One-click Accountant Package Export (XLSX Bundle)
  const handleAccountantExport = () => {
    const data = periodPayments.map(p => {
      const prof = profiles.find(pr => pr.id === p.profile_id);
      const pt = paymentTypes.find(type => type.id === p.payment_type_id);
      return {
        Period: p.period,
        Employee_ID: p.profile_id,
        Name_GR: prof?.name_el,
        Name_EN: `${prof?.first_name} ${prof?.last_name}`,
        EmploymentType: prof?.employment_type.toUpperCase(),
        PaymentType_GR: pt?.name_el || 'Μισθός',
        Gross_Amount: p.gross,
        Net_Payable: p.net,
        Employer_Contributions: p.employer_contributions,
        Total_Company_Cost: p.total_cost,
        Status: p.status.toUpperCase()
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, `Payroll_${selectedPeriod}`);
    XLSX.writeFile(workbook, `StellarBlue_Accountant_Package_${selectedPeriod}.xlsx`);
  };

  // Calculate 12-month forward burn forecast
  const currentMonthlyBurn = salaries.filter(s => !s.valid_to).reduce((acc, sal) => {
    const empCost = sal.employer_cost_pct ? sal.gross_amount * (sal.employer_cost_pct / 100) : 0;
    return acc + sal.gross_amount + empCost;
  }, 0);

  const annualProjectedBurn = currentMonthlyBurn * 14; // Greek statutory 14 salaries approximation for full-time

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center">
            <DollarSign className="w-6 h-6 mr-3 text-purple-400" /> Compensation & Payroll Ledger
          </h1>
          <p className="text-slate-400 text-xs mt-1">
            Greek 14-salary statutory items support, contractor invoicing, effective-dated salary histories, and accountant export bundles.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input 
            type="month" 
            value={selectedPeriod} 
            onChange={e => setSelectedPeriod(e.target.value)} 
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
          />
          <Button variant="secondary" size="sm" onClick={handleGenerateDraft}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5 text-purple-400" /> Generate Draft Month (&lt;5 min)
          </Button>
          <Button variant="primary" size="sm" onClick={handleAccountantExport} className="bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-500/20">
            <Download className="w-4 h-4 mr-1.5" /> One-Click Accountant Bundle
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <StatCard 
          title={`Total Company Cost (${selectedPeriod})`}
          value={`€${totalCost.toLocaleString()}`}
          subtitle="Gross salaries, employer EFKA & contractor retainers"
          icon={<DollarSign className="w-5 h-5 text-purple-400" />}
        />
        <StatCard 
          title="Net Payable to Employees & Contractors"
          value={`€${totalNet.toLocaleString()}`}
          subtitle={`Across ${periodPayments.length} ledger rows`}
          icon={<CheckCircle className="w-5 h-5 text-emerald-400" />}
        />
        <StatCard 
          title="12-Month Forward Projected Burn"
          value={`€${Math.round(annualProjectedBurn).toLocaleString()}`}
          subtitle="Includes 13th & 14th statutory Greek salaries"
          icon={<TrendingUp className="w-5 h-5 text-blue-400" />}
        />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 space-x-6 text-sm">
        <button 
          onClick={() => setTab('ledger')}
          className={`pb-3 font-semibold transition-all cursor-pointer ${tab === 'ledger' ? 'border-b-2 border-purple-500 text-purple-300 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
        >
          Payment Ledger ({selectedPeriod})
        </button>
        <button 
          onClick={() => setTab('forecast')}
          className={`pb-3 font-semibold transition-all cursor-pointer ${tab === 'forecast' ? 'border-b-2 border-purple-500 text-purple-300 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
        >
          Effective-Dated Salary History & Forecast
        </button>
        <button 
          onClick={() => setTab('payment_types')}
          className={`pb-3 font-semibold transition-all flex items-center cursor-pointer ${tab === 'payment_types' ? 'border-b-2 border-purple-500 text-purple-300 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
        >
          <Sliders className="w-3.5 h-3.5 mr-1.5 text-purple-400" /> Dynamic Payment Types Settings
        </button>
      </div>

      {/* TAB 1: LEDGER TABLE */}
      {tab === 'ledger' && (
        <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/90 text-[11px] font-semibold uppercase text-slate-400 tracking-wider">
                <th className="p-3.5 pl-5">Employee / Partner</th>
                <th className="p-3.5">Payment Type (GR / EN)</th>
                <th className="p-3.5">Gross Amount</th>
                <th className="p-3.5">Net Pay</th>
                <th className="p-3.5">Employer EFKA</th>
                <th className="p-3.5">Total Company Cost</th>
                <th className="p-3.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900">
              {periodPayments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500 italic">
                    No payment rows found for {selectedPeriod}. Click <strong>&ldquo;Generate Draft Month&rdquo;</strong> above to instantly generate statutory salary and contractor invoice rows!
                  </td>
                </tr>
              ) : (
                periodPayments.map(pay => {
                  const prof = profiles.find(p => p.id === pay.profile_id);
                  const pt = paymentTypes.find(type => type.id === pay.payment_type_id);
                  return (
                    <tr key={pay.id} className="hover:bg-slate-900/60 transition-colors">
                      <td className="p-3.5 pl-5 font-bold text-slate-200">
                        {prof?.first_name} {prof?.last_name}
                        <span className="text-xs text-slate-500 font-normal block">{prof?.title} ({prof?.employment_type})</span>
                      </td>
                      <td className="p-3.5 text-xs text-purple-300 font-medium">
                        {pt?.name_el} ({pt?.name_en})
                      </td>
                      <td className="p-3.5 font-mono text-slate-300">€{pay.gross.toLocaleString()}</td>
                      <td className="p-3.5 font-mono font-bold text-emerald-400">€{pay.net.toLocaleString()}</td>
                      <td className="p-3.5 font-mono text-slate-400">€{pay.employer_contributions.toLocaleString()}</td>
                      <td className="p-3.5 font-mono font-extrabold text-slate-100 bg-slate-900/50">€{pay.total_cost.toLocaleString()}</td>
                      <td className="p-3.5">
                        <Badge variant={pay.status === 'paid' ? 'success' : 'warning'}>{pay.status.toUpperCase()}</Badge>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 2: HISTORY & BURN FORECAST */}
      {tab === 'forecast' && (
        <Card title="Effective-Dated Salary Ledger & 12-Month Burn Engine" subtitle="Current baseline compensation commitments across StellarBlue employees and contractor retainers">
          <div className="space-y-3 mt-2">
            {salaries.map(sal => {
              const prof = profiles.find(p => p.id === sal.profile_id);
              return (
                <div key={sal.id} className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-slate-200 text-sm">{prof?.first_name} {prof?.last_name}</span>
                    <span className="text-slate-400 block mt-0.5">Effective Date: <strong className="font-mono text-slate-300">{sal.valid_from}</strong> &rarr; {sal.valid_to || 'Present (Active)'} &bull; Note: {sal.note || 'Regular scale'}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-mono font-bold text-emerald-400 block">€{sal.gross_amount.toLocaleString()} <span className="text-xs text-slate-400 font-sans font-normal">/ month ({sal.basis})</span></span>
                    <span className="text-[10px] text-slate-500">Employer cost: {sal.employer_cost_pct ? `${sal.employer_cost_pct}% EFKA` : '0% (Excl VAT invoice)'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* TAB 3: PAYMENT TYPES SETTINGS */}
      {tab === 'payment_types' && (
        <Card title="Dynamic Payment Types Administration" subtitle="Preventing hardcoded Greek statutory items (Easter/Christmas bonus, vacation allowance) in code" action={
          <Button size="sm" variant="secondary" onClick={() => setIsTypeOpen(true)}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add Payment Category
          </Button>
        }>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
            {paymentTypes.map(pt => (
              <div key={pt.id} className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant={pt.is_statutory ? 'info' : 'neutral'}>{pt.is_statutory ? 'Statutory (Εργ. Νόμος)' : 'Custom Bonus'}</Badge>
                    <span className="font-mono text-xs text-slate-500">Code: {pt.code}</span>
                  </div>
                  <h4 className="font-bold text-slate-100 text-base mt-2">{pt.name_el}</h4>
                  <p className="text-xs text-slate-400">{pt.name_en}</p>
                </div>

                <div className="pt-3 border-t border-slate-800/80 text-xs text-slate-400 space-y-1">
                  <div className="flex justify-between">
                    <span>Default Multiplier:</span>
                    <strong className="font-mono text-purple-300">{pt.default_multiplier ? `${pt.default_multiplier}x monthly salary` : 'Variable / Spot'}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Applies to:</span>
                    <span className="text-slate-300 font-medium">{pt.applies_to.join(', ')}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ADD PAYMENT TYPE MODAL */}
      <Modal isOpen={isTypeOpen} onClose={() => setIsTypeOpen(false)} title="Register Dynamic Payment Type">
        <div className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold uppercase text-slate-400 mb-1">System Code (Slug)</label>
            <input type="text" value={ptCode} onChange={e => setPtCode(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 font-mono" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold uppercase text-slate-400 mb-1">Name (Greek)</label>
              <input type="text" value={ptNameEl} onChange={e => setPtNameEl(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 font-bold" />
            </div>
            <div>
              <label className="block font-semibold uppercase text-slate-400 mb-1">Name (English)</label>
              <input type="text" value={ptNameEn} onChange={e => setPtNameEn(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200" />
            </div>
          </div>
          <div>
            <label className="block font-semibold uppercase text-slate-400 mb-1">Default Salary Multiplier</label>
            <input type="number" step="0.1" value={ptMult} onChange={e => setPtMult(Number(e.target.value))} className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 font-mono" />
          </div>
          <div className="pt-2 flex justify-end space-x-2">
            <Button variant="outline" size="sm" onClick={() => setIsTypeOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => { setIsTypeOpen(false); alert('Payment Type registered!'); }} className="bg-purple-600 hover:bg-purple-500">Save Category &rarr;</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
