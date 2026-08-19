import React, { useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, Badge } from '@/components/ui/primitives';

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2
  }).format(amount);
};

interface CounterpartyEvaluationViewProps {
  statYear: number;
  statMonth: number;
}

export function CounterpartyEvaluationView({ statYear, statMonth }: CounterpartyEvaluationViewProps) {
  const { counterparties, contracts, invoices } = useAuth();
  
  const monthStr = statMonth > 0 ? statMonth.toString().padStart(2, '0') : null;
  const targetPeriodPrefix = monthStr ? `${statYear}-${monthStr}` : statYear.toString();

  const evaluationStats = useMemo(() => {
    const stats = counterparties.map(cp => {
      // 1. Find all active contracts for this counterparty
      const cpContracts = contracts.filter(c => c.counterparty_id === cp.id && c.status === 'active');
      
      let expectedAmount = 0;
      cpContracts.forEach(contract => {
        const schedules = contract.schedule || [];
        if (schedules.length > 0) {
          expectedAmount += schedules
            .filter(s => s.period.startsWith(targetPeriodPrefix))
            .reduce((sum, s) => sum + s.amount, 0);
        } else {
          // Dynamic calculation for supplier/client without explicit schedules
          if (contract.value && contract.starts_on) {
            let monthlyAmount = contract.value;
            if (contract.billing_cadence === 'annual') monthlyAmount = contract.value / 12;
            if (contract.billing_cadence === 'quarterly') monthlyAmount = contract.value / 3;
            
            // If we are looking at YTD (monthStr is null), we sum up to 12 months that match the year
            // If a specific month, just 1 month
            if (monthStr) {
              if (targetPeriodPrefix >= contract.starts_on.substring(0, 7)) {
                expectedAmount += monthlyAmount;
              }
            } else {
              for (let m = 1; m <= 12; m++) {
                const periodStr = `${statYear}-${m.toString().padStart(2, '0')}`;
                if (periodStr >= contract.starts_on.substring(0, 7)) {
                  expectedAmount += monthlyAmount;
                }
              }
            }
          }
        }
      });

      // 2. Find invoices issued in the selected period
      const cpInvoices = invoices.filter(i => {
        if (i.counterparty_id !== cp.id) return false;
        if (i.status === 'cancelled') return false;
        return i.issue_date.startsWith(targetPeriodPrefix);
      });

      const invoicedAmount = cpInvoices.reduce((sum, inv) => sum + (inv.gross_eur || inv.net), 0);
      
      // 3. Find Paid Amount for those invoices
      // We look at how much of those *issued* invoices have been paid. 
      // If status === 'paid', the full net/gross is paid. If partially_paid, we'd sum payments, but for now we'll assume status 'paid' means fully paid.
      // Alternatively, we could sum the `payments` array if it exists.
      const paidAmount = cpInvoices.reduce((sum, inv) => {
        if (inv.status === 'paid') return sum + (inv.gross_eur || inv.net);
        // If we had a sum of payments, we could use that. Orbit doesn't expose `inv.payments` natively in the interface,
        // but we'll use `paid` status as a proxy for fully paid.
        return sum;
      }, 0);

      const outstandingAmount = invoicedAmount - paidAmount;
      const variance = expectedAmount - invoicedAmount;

      return {
        counterparty: cp,
        expectedAmount,
        invoicedAmount,
        paidAmount,
        outstandingAmount,
        variance,
        isSupplier: cp.derived_role === 'supplier' || cp.roles?.some(r => r.name.toLowerCase() === 'supplier'),
        isClient: cp.derived_role === 'client' || cp.roles?.some(r => r.name.toLowerCase() === 'client')
      };
    });

    // Hide counterparties without contracts and invoices in this period
    return stats.filter(s => s.expectedAmount > 0 || s.invoicedAmount > 0);
  }, [counterparties, contracts, invoices, statYear, monthStr, targetPeriodPrefix]);

  const clients = evaluationStats.filter(s => s.isClient && !s.isSupplier);
  const suppliers = evaluationStats.filter(s => s.isSupplier);
  const both = evaluationStats.filter(s => s.isClient && s.isSupplier);
  // Merge 'both' into clients for evaluation (or render separately)
  const renderClients = [...clients, ...both].sort((a, b) => b.expectedAmount - a.expectedAmount);
  const renderSuppliers = suppliers.sort((a, b) => b.expectedAmount - a.expectedAmount);

  const renderTable = (stats: typeof evaluationStats, title: string) => (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
        <h3 className="font-semibold text-slate-900">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50/50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="px-5 py-3 font-medium">Counterparty</th>
              <th className="px-5 py-3 font-medium">Tier</th>
              <th className="px-5 py-3 font-medium text-right">Expected</th>
              <th className="px-5 py-3 font-medium text-right">Invoiced</th>
              <th className="px-5 py-3 font-medium text-right">Paid</th>
              <th className="px-5 py-3 font-medium text-right">Outstanding</th>
              <th className="px-5 py-3 font-medium text-right">Variance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {stats.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-slate-500">
                  No data for this period.
                </td>
              </tr>
            )}
            {stats.map(row => (
              <tr key={row.counterparty.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-5 py-3 font-medium text-slate-900">{row.counterparty.legal_name || row.counterparty.trade_name}</td>
                <td className="px-5 py-3">
                  {row.counterparty.tier?.label ? (
                    <Badge style={{ backgroundColor: row.counterparty.tier.color, color: '#fff' }} className="text-[10px] px-1.5 py-0.5 leading-none font-medium">
                      {row.counterparty.tier.label}
                    </Badge>
                  ) : (
                    <span className="text-slate-400 text-xs">-</span>
                  )}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-600">{formatCurrency(row.expectedAmount)}</td>
                <td className="px-5 py-3 text-right tabular-nums font-medium">{formatCurrency(row.invoicedAmount)}</td>
                <td className="px-5 py-3 text-right tabular-nums text-emerald-600">{formatCurrency(row.paidAmount)}</td>
                <td className={`px-5 py-3 text-right tabular-nums font-medium ${row.outstandingAmount > 0 ? 'text-amber-600' : 'text-slate-500'}`}>
                  {formatCurrency(row.outstandingAmount)}
                </td>
                <td className="px-5 py-3 text-right tabular-nums">
                  <span className={row.variance < 0 ? 'text-rose-600 font-medium' : 'text-emerald-600'}>
                    {formatCurrency(Math.abs(row.variance))}
                  </span>
                  <span className="text-xs text-slate-400 ml-1">
                    {row.variance < 0 ? 'Over' : 'Under'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );

  return (
    <div className="space-y-6">
      {renderTable(renderClients, 'Client Evaluation')}
      {renderTable(renderSuppliers, 'Supplier Evaluation')}
    </div>
  );
}
