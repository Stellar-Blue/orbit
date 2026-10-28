"use client";

import React, { useState, useMemo } from 'react';
import { Modal, Button, Badge } from '@/components/ui/primitives';
import { Invoice, Contract } from '@/lib/types';
import { formatDate } from '@/lib/date';
import { FileText, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

interface LinkageModalProps {
  invoice: Invoice;
  onClose: () => void;
}

export function LinkageModal({ invoice, onClose }: LinkageModalProps) {
  const { contracts, linkInvoiceToContract } = useAuth();
  
  const [selectedContractId, setSelectedContractId] = useState<string>('');
  const [selectedPeriods, setSelectedPeriods] = useState<string[]>([]);
  const [markAsPaid, setMarkAsPaid] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableContracts = useMemo(() => {
    return contracts.filter(c => c.counterparty_id === invoice.counterparty_id && c.status !== 'terminated');
  }, [contracts, invoice.counterparty_id]);

  const selectedContract = useMemo(() => {
    return contracts.find(c => c.id === selectedContractId);
  }, [contracts, selectedContractId]);

  const scheduleItems = useMemo(() => {
    if (!selectedContract?.schedule) return [];
    return [...selectedContract.schedule].sort((a, b) => a.period.localeCompare(b.period));
  }, [selectedContract]);

  const handleTogglePeriod = (period: string) => {
    setSelectedPeriods(prev => 
      prev.includes(period) ? prev.filter(p => p !== period) : [...prev, period].sort()
    );
  };

  const handleSubmit = async () => {
    if (!selectedContractId || selectedPeriods.length === 0) return;
    setIsSubmitting(true);
    
    // Distribute amount
    let remainingGross = invoice.gross_eur;
    const allocations: { period: string, amount: number }[] = [];
    
    for (let i = 0; i < selectedPeriods.length; i++) {
      const period = selectedPeriods[i];
      const sched = scheduleItems.find(s => s.period === period);
      const schedAmount = sched ? sched.amount : 0;
      
      let amountToAllocate = 0;
      if (i === selectedPeriods.length - 1) {
        // Last item gets the rest
        amountToAllocate = remainingGross;
      } else {
        // Cap at the schedule amount, or take what's left
        amountToAllocate = Math.min(schedAmount, remainingGross);
      }
      
      allocations.push({ period, amount: amountToAllocate });
      remainingGross -= amountToAllocate;
      if (remainingGross < 0) remainingGross = 0;
    }

    const success = await linkInvoiceToContract(invoice.id, selectedContractId, allocations, markAsPaid);
    setIsSubmitting(false);
    if (success) onClose();
  };

  return (
    <Modal isOpen={true} title="Link Invoice to Contract" onClose={onClose}>
      <div className="space-y-6">
        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
          <div className="flex justify-between items-center">
            <div>
              <div className="font-mono font-black text-slate-800">{invoice.invoice_number}</div>
              <div className="text-xs font-bold text-slate-500">{formatDate(invoice.issue_date)}</div>
            </div>
            <div className="text-right">
              <div className="font-mono font-black text-slate-900 text-lg">€{invoice.gross_eur.toLocaleString()}</div>
              <Badge variant={invoice.direction === 'outgoing' ? 'success' : 'warning'}>{invoice.direction}</Badge>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-600 uppercase">1. Select Contract</label>
          <select 
            value={selectedContractId} 
            onChange={e => { setSelectedContractId(e.target.value); setSelectedPeriods([]); }}
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#2f6fa3] focus:border-transparent"
          >
            <option value="">-- Select an active contract --</option>
            {availableContracts.map(c => (
              <option key={c.id} value={c.id}>{c.reference} (Val: €{(c.value || 0).toLocaleString()})</option>
            ))}
          </select>
          {availableContracts.length === 0 && (
            <p className="text-xs text-rose-500 font-medium">No active contracts found for this counterparty.</p>
          )}
        </div>

        {selectedContractId && (
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-600 uppercase">2. Select Scheduled Periods</label>
            <p className="text-xs text-slate-500 mb-2 leading-relaxed">
              Select which contract billing installments this invoice covers. The invoice amount (€{invoice.gross_eur.toLocaleString()}) will be distributed among them.
            </p>
            {scheduleItems.length === 0 ? (
              <div className="text-sm italic text-slate-400">This contract has no scheduled items.</div>
            ) : (
              <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-2">
                {scheduleItems.map(s => {
                  const isSelected = selectedPeriods.includes(s.period);
                  return (
                    <div 
                      key={s.period} 
                      onClick={() => handleTogglePeriod(s.period)}
                      className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                        isSelected ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-300' : 'bg-white border-slate-200 hover:border-blue-200'
                      }`}
                    >
                      <span className={`font-mono text-sm ${isSelected ? 'font-black text-blue-700' : 'font-bold text-slate-700'}`}>{s.period}</span>
                      <span className={`font-mono text-xs ${isSelected ? 'text-blue-600' : 'text-slate-500'}`}>€{s.amount.toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {selectedPeriods.length > 0 && (
          <div className="pt-4 border-t border-slate-100 flex items-center gap-3">
            <input 
              type="checkbox" 
              id="markPaid" 
              checked={markAsPaid} 
              onChange={e => setMarkAsPaid(e.target.checked)}
              className="w-4 h-4 rounded text-[#2f6fa3] focus:ring-[#2f6fa3]"
            />
            <label htmlFor="markPaid" className="text-sm font-bold text-slate-700 cursor-pointer select-none">
              Mark invoice as Paid in Full
            </label>
          </div>
        )}

        <div className="pt-4 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button 
            variant="primary" 
            onClick={handleSubmit} 
            disabled={!selectedContractId || selectedPeriods.length === 0 || isSubmitting}
            className="gap-2"
          >
            {isSubmitting ? 'Linking...' : 'Link Invoice'} <CheckCircle2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </Modal>
  );
}
