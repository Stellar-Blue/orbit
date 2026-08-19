import React, { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, Button, Badge } from '@/components/ui/primitives';
import { AlertTriangle, CheckCircle2, TrendingUp, TrendingDown, ArrowRight } from 'lucide-react';
import { Invoice } from '@/lib/types';
import { InvoicesGrid } from '@/components/invoices/invoices-grid';

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2
  }).format(amount);
};

interface BudgetingViewProps {
  statYear: number;
  statMonth: number;
}

export function BudgetingView({ statYear, statMonth }: BudgetingViewProps) {
  const { invoices, budgetCategories, budgetLines, recurringCommitments, budgets } = useAuth();
  
  const [showUncategorized, setShowUncategorized] = useState(false);

  const activeBudget = budgets.find(b => b.fiscal_year === statYear && b.status === 'active');
  const monthStr = statMonth > 0 ? statMonth.toString().padStart(2, '0') : null;
  const targetPeriod = monthStr ? `${statYear}-${monthStr}` : null;

  const uncategorizedInvoices = useMemo(() => {
    return invoices.filter(i => {
      if (i.status === 'cancelled') return false;
      const issueDate = i.issue_date;
      if (!issueDate.startsWith(statYear.toString())) return false;
      if (monthStr && !issueDate.startsWith(`${statYear}-${monthStr}`)) return false;
      return i.category_id == null;
    });
  }, [invoices, statYear, monthStr]);

  const uncategorizedTotal = uncategorizedInvoices.reduce((sum, inv) => sum + (inv.gross_eur || inv.net), 0);

  const categoryStats = useMemo(() => {
    return budgetCategories.map(cat => {
      // Calculate Budget
      let budgetAmount = 0;
      if (activeBudget) {
        if (targetPeriod) {
          const bl = budgetLines.find(l => l.budget_id === activeBudget.id && l.category_id === cat.id && l.period === targetPeriod);
          budgetAmount = bl?.amount || 0;
        } else {
          // YTD
          const lines = budgetLines.filter(l => l.budget_id === activeBudget.id && l.category_id === cat.id && l.period.startsWith(statYear.toString()));
          budgetAmount = lines.reduce((sum, l) => sum + l.amount, 0);
        }
      }

      // Calculate Actual
      const actualInvoices = invoices.filter(i => {
        if (i.status === 'cancelled') return false;
        if (i.category_id !== cat.id) return false;
        const issueDate = i.issue_date;
        if (!issueDate.startsWith(statYear.toString())) return false;
        if (monthStr && !issueDate.startsWith(`${statYear}-${monthStr}`)) return false;
        return true;
      });
      const actualAmount = actualInvoices.reduce((sum, inv) => sum + (inv.gross_eur || inv.net), 0);

      // Calculate Committed
      let committedAmount = 0;
      const recurrences = recurringCommitments.filter(rc => rc.category_id === cat.id);
      if (targetPeriod) {
        recurrences.forEach(rc => {
          if (rc.start_date <= `${targetPeriod}-31` && (!rc.end_date || rc.end_date >= `${targetPeriod}-01`)) {
            committedAmount += rc.amount;
          }
        });
      } else {
        // approximate YTD
        recurrences.forEach(rc => {
          if (rc.start_date.startsWith(statYear.toString())) {
            committedAmount += rc.amount * 12; // naive for now
          }
        });
      }

      // Remaining Commitment (Commitment - Actuals)
      const remainingCommitment = Math.max(0, committedAmount - actualAmount);

      const variance = cat.direction === 'expense' 
        ? budgetAmount - actualAmount 
        : actualAmount - budgetAmount;
        
      const variancePct = budgetAmount > 0 ? (variance / budgetAmount) * 100 : 0;
      const remainingBudget = budgetAmount - actualAmount - remainingCommitment;

      return {
        category: cat,
        budgetAmount,
        actualAmount,
        committedAmount: remainingCommitment,
        remainingBudget,
        variance,
        variancePct
      };
    }).sort((a, b) => a.category.sort_order - b.category.sort_order);
  }, [budgetCategories, budgetLines, activeBudget, invoices, recurringCommitments, statYear, targetPeriod, monthStr]);

  const expenses = categoryStats.filter(c => c.category.direction === 'expense');
  const incomes = categoryStats.filter(c => c.category.direction === 'income');

  const renderTable = (stats: typeof categoryStats, title: string) => (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
        <h3 className="font-semibold text-slate-900">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50/50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="px-5 py-3 font-medium">Category</th>
              <th className="px-5 py-3 font-medium text-right">Budget</th>
              <th className="px-5 py-3 font-medium text-right">Actual</th>
              <th className="px-5 py-3 font-medium text-right">Committed</th>
              <th className="px-5 py-3 font-medium text-right">Remaining</th>
              <th className="px-5 py-3 font-medium text-right">Variance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {stats.map(row => (
              <tr key={row.category.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-5 py-3 font-medium text-slate-900">{row.category.name}</td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-600">{formatCurrency(row.budgetAmount)}</td>
                <td className="px-5 py-3 text-right tabular-nums font-medium">{formatCurrency(row.actualAmount)}</td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-500">{formatCurrency(row.committedAmount)}</td>
                <td className={`px-5 py-3 text-right tabular-nums font-medium ${row.remainingBudget < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {formatCurrency(row.remainingBudget)}
                </td>
                <td className="px-5 py-3 text-right tabular-nums">
                  <div className="flex items-center justify-end gap-2">
                    <span className={row.variance < 0 ? 'text-rose-600 font-medium' : 'text-emerald-600'}>
                      {formatCurrency(row.variance)}
                    </span>
                    {Math.abs(row.variancePct) > 10 && row.budgetAmount > 0 && (
                      <Badge variant={row.variance < 0 ? 'error' : 'success'} className="text-[10px] px-1.5 py-0.5">
                        {row.variancePct > 0 ? '+' : ''}{row.variancePct.toFixed(0)}%
                      </Badge>
                    )}
                  </div>
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
      {/* Data Quality Panel */}
      {uncategorizedInvoices.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-4 shadow-sm">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-amber-900 font-semibold text-sm">Missing Categories Detected</h4>
            <p className="text-amber-700 text-xs mt-1">
              {uncategorizedInvoices.length} invoices ({formatCurrency(uncategorizedTotal)}) in this period are uncategorized. Budget figures may be incomplete.
            </p>
            <Button 
              size="sm" 
              variant="outline" 
              className="mt-3 bg-white hover:bg-amber-50 border-amber-300 text-amber-700 h-8 text-xs"
              onClick={() => setShowUncategorized(!showUncategorized)}
            >
              {showUncategorized ? 'Hide Invoices' : 'Review & Categorize'}
            </Button>
          </div>
        </div>
      )}

      {showUncategorized && (
        <Card className="p-4 border-amber-200 bg-white">
          <h4 className="text-sm font-semibold mb-3">Uncategorized Invoices ({targetPeriod || statYear})</h4>
          <InvoicesGrid invoices={uncategorizedInvoices} hideToolbar />
        </Card>
      )}

      {!activeBudget && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center">
          <h3 className="text-slate-900 font-semibold mb-2">No Active Budget</h3>
          <p className="text-slate-500 text-sm max-w-md mx-auto">
            There is no active budget set up for {statYear}. Please create and activate a budget to see variance reporting.
          </p>
        </div>
      )}

      {activeBudget && (
        <>
          {renderTable(incomes, 'Income & Revenues')}
          {renderTable(expenses, 'Operating Expenses (OpEx)')}
        </>
      )}
    </div>
  );
}
