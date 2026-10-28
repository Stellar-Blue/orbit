"use client";

import React, { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Banknote, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import type { Receipt } from '@/lib/types';
import { Badge, Button, Card, Modal } from '@/components/ui/primitives';
import { DatePicker } from '@/components/ui/date-picker';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { InvoiceLinkPicker } from '@/components/invoices/invoice-link-picker';
import { DEFAULT_CURRENCY, INVOICE_CURRENCIES, formatMoney } from '@/lib/currency';
import { formatDate } from '@/lib/date';

const METHODS = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'intercompany', label: 'Intercompany transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'offset', label: 'Offset / netting' },
  { value: 'other', label: 'Other' },
];

const methodLabel = (method?: string | null) => METHODS.find(m => m.value === method)?.label || method || '—';

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;
const formatTotal = (value: number) =>
  `€${(Number(value) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

interface ReceiptDraft {
  id: string | null;
  direction: 'incoming' | 'outgoing';
  counterparty_id: string;
  amount: string;
  currency: string;
  fx_rate: string;
  received_on: string;
  period_from: string;
  period_to: string;
  method: string;
  bank_reference: string;
  note: string;
  contract_ids: string[];
  project_ids: string[];
  invoice_id: string;
}

const emptyDraft = (): ReceiptDraft => ({
  id: null,
  direction: 'incoming',
  counterparty_id: '',
  amount: '',
  currency: DEFAULT_CURRENCY,
  fx_rate: '1',
  received_on: new Date().toISOString().slice(0, 10),
  period_from: '',
  period_to: '',
  method: 'bank_transfer',
  bank_reference: '',
  note: '',
  contract_ids: [],
  project_ids: [],
  invoice_id: '',
});

const draftFrom = (receipt: Receipt): ReceiptDraft => ({
  id: receipt.id,
  direction: receipt.direction === 'outgoing' ? 'outgoing' : 'incoming',
  counterparty_id: receipt.counterparty_id,
  amount: String(receipt.amount ?? ''),
  currency: receipt.currency || DEFAULT_CURRENCY,
  fx_rate: String(receipt.fx_rate ?? 1),
  received_on: receipt.received_on || '',
  period_from: receipt.period_from || '',
  period_to: receipt.period_to || '',
  method: receipt.method || '',
  bank_reference: receipt.bank_reference || '',
  note: receipt.note || '',
  contract_ids: receipt.contract_ids ?? [],
  project_ids: receipt.project_ids ?? [],
  invoice_id: receipt.invoice_id || '',
});

/**
 * Money that moved without a tax document — an intercompany transfer, a deposit, a netting. It can
 * still name the contracts and change requests it settles (and the invoice it eventually covers), so
 * the revenue schedule shows those months as paid.
 */
export const ReceiptsPanel: React.FC = () => {
  const { receipts, counterparties, contracts, projects, invoices, addReceipt, updateReceipt, deleteReceipt } = useAuth();
  const [draft, setDraft] = useState<ReceiptDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const counterpartyName = useMemo(
    () => new Map(counterparties.map(cp => [cp.id, cp.legal_name])),
    [counterparties]
  );
  const contractLabel = useMemo(
    () => new Map(contracts.map(contract => [contract.id, contract.reference || contract.product || contract.id])),
    [contracts]
  );
  const projectLabel = useMemo(
    () => new Map(projects.map(project => [project.id, project.code?.trim() || project.name])),
    [projects]
  );
  const invoiceLabel = useMemo(
    () => new Map(invoices.map(invoice => [invoice.id, invoice.invoice_number || invoice.id])),
    [invoices]
  );

  const rows = useMemo(
    () => [...receipts].sort((a, b) => String(b.received_on).localeCompare(String(a.received_on))),
    [receipts]
  );

  const year = new Date().getFullYear();
  const totals = useMemo(() => {
    const incoming = rows.filter(row => row.direction !== 'outgoing');
    const outgoing = rows.filter(row => row.direction === 'outgoing');
    return {
      incoming: round2(incoming.reduce((sum, row) => sum + Number(row.amount_eur || 0), 0)),
      outgoing: round2(outgoing.reduce((sum, row) => sum + Number(row.amount_eur || 0), 0)),
      thisYear: round2(
        incoming
          .filter(row => String(row.received_on).startsWith(String(year)))
          .reduce((sum, row) => sum + Number(row.amount_eur || 0), 0)
      ),
      unlinked: incoming.filter(row => (row.contract_ids?.length ?? 0) === 0 && (row.project_ids?.length ?? 0) === 0).length,
    };
  }, [rows, year]);

  const amountEur = draft ? round2((Number(draft.amount) || 0) * (Number(draft.fx_rate) || 1)) : 0;
  const canSave = Boolean(draft && draft.counterparty_id && (Number(draft.amount) || 0) !== 0 && draft.received_on);

  const invoiceOptions = useMemo(() => {
    if (!draft) return [];
    return invoices
      .filter(invoice => invoice.direction === 'outgoing')
      .filter(invoice => !draft.counterparty_id || invoice.counterparty_id === draft.counterparty_id)
      .sort((a, b) => String(b.issue_date || '').localeCompare(String(a.issue_date || '')))
      .slice(0, 200)
      .map(invoice => ({
        value: invoice.id,
        label: invoice.invoice_number || invoice.id,
        description: `${formatDate(invoice.issue_date)} · ${formatMoney(invoice.gross, invoice.currency)}`,
        hint: invoice.status,
      }));
  }, [draft, invoices]);

  const save = async () => {
    if (!draft || !canSave) return;
    setSaving(true);
    const payload = {
      counterparty_id: draft.counterparty_id,
      direction: draft.direction,
      amount: round2(Number(draft.amount) || 0),
      currency: draft.currency,
      fx_rate: Number(draft.fx_rate) || 1,
      amount_eur: amountEur,
      received_on: draft.received_on,
      period_from: draft.period_from || null,
      period_to: draft.period_to || null,
      method: draft.method || null,
      bank_reference: draft.bank_reference.trim() || null,
      note: draft.note.trim() || null,
      contract_ids: draft.contract_ids,
      project_ids: draft.project_ids,
      invoice_id: draft.invoice_id || null,
    };
    const ok = draft.id
      ? await updateReceipt(draft.id, payload)
      : Boolean(await addReceipt(payload));
    setSaving(false);
    if (ok) setDraft(null);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="ui-label">Received without invoice</p>
          <p className="ui-num text-[22px] font-semibold text-emerald-700 mt-1.5 leading-none">{formatTotal(totals.incoming)}</p>
          <p className="ui-meta mt-1.5">All receipts recorded, excluding tax documents</p>
        </Card>
        <Card>
          <p className="ui-label">Received in {year}</p>
          <p className="ui-num text-[22px] font-semibold text-[var(--ink)] mt-1.5 leading-none">{formatTotal(totals.thisYear)}</p>
          <p className="ui-meta mt-1.5">{rows.length} receipt{rows.length === 1 ? '' : 's'} on file</p>
        </Card>
        <Card>
          <p className="ui-label">Paid out</p>
          <p className="ui-num text-[22px] font-semibold text-[var(--ink)] mt-1.5 leading-none">{formatTotal(totals.outgoing)}</p>
          <p className="ui-meta mt-1.5">
            {totals.unlinked > 0
              ? `${totals.unlinked} receipt${totals.unlinked === 1 ? '' : 's'} not linked to a contract`
              : 'Every receipt is linked to an agreement'}
          </p>
        </Card>
      </div>

      <Card
        title="Receipts"
        subtitle="Payments that arrived without a tax invoice — intercompany transfers, deposits, nettings. Link them to agreements, change requests and invoices so the revenue schedule shows the months as paid."
        action={
          <Button size="sm" variant="primary" onClick={() => setDraft(emptyDraft())}>
            <Plus className="w-4 h-4 stroke-[3]" />
            Record receipt
          </Button>
        }
      >
        {rows.length === 0 ? (
          <div className="py-10 text-center">
            <Banknote className="w-6 h-6 text-[var(--ink-4)] mx-auto" />
            <p className="text-[13px] font-semibold text-[var(--ink-2)] mt-2">No receipts yet</p>
            <p className="text-[12px] text-[var(--ink-4)] mt-1">Record a transfer that arrived without an invoice to mark those months paid.</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full min-w-[900px] text-[12px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-[0.06em] text-[var(--ink-4)] border-b border-[var(--line)]">
                  <th className="py-1.5 pr-3 font-semibold">Received</th>
                  <th className="py-1.5 pr-3 font-semibold">Counterparty</th>
                  <th className="py-1.5 pr-3 font-semibold text-right">Amount</th>
                  <th className="py-1.5 pr-3 font-semibold">Covers</th>
                  <th className="py-1.5 pr-3 font-semibold">Linked to</th>
                  <th className="py-1.5 pr-3 font-semibold">Method</th>
                  <th className="py-1.5 pr-3 font-semibold">Reference</th>
                  <th className="py-1.5 font-semibold text-right">—</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const outgoing = row.direction === 'outgoing';
                  const linkedContracts = (row.contract_ids ?? []).map(id => contractLabel.get(id) || id);
                  const linkedProjects = (row.project_ids ?? []).map(id => projectLabel.get(id) || id);
                  return (
                    <tr key={row.id} className="border-b border-[var(--line)] last:border-b-0 hover:bg-[var(--surface-muted)]">
                      <td className="py-2 pr-3 font-mono text-[11px] text-[var(--ink-2)] whitespace-nowrap">{formatDate(row.received_on)}</td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {outgoing
                            ? <ArrowUpRight className="w-3 h-3 text-rose-600 shrink-0" />
                            : <ArrowDownLeft className="w-3 h-3 text-emerald-600 shrink-0" />}
                          <span className="font-semibold text-[var(--ink)] truncate">
                            {counterpartyName.get(row.counterparty_id) || row.counterparty?.legal_name || '—'}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">
                        <span className={`font-mono font-semibold ${outgoing ? 'text-rose-700' : 'text-emerald-700'}`}>
                          {formatMoney(row.amount, row.currency)}
                        </span>
                        {row.currency !== 'EUR' && (
                          <span className="block font-mono text-[10px] text-[var(--ink-4)]">{formatMoney(row.amount_eur, 'EUR')}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-mono text-[11px] text-[var(--ink-3)] whitespace-nowrap">
                        {row.period_from || row.period_to
                          ? `${row.period_from ? formatDate(row.period_from) : '…'} → ${row.period_to ? formatDate(row.period_to) : '…'}`
                          : formatDate(row.received_on)}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap items-center gap-1">
                          {linkedContracts.map(reference => (
                            <Badge key={reference} variant="info">{reference}</Badge>
                          ))}
                          {linkedProjects.map(code => (
                            <Badge key={code} variant="warning">{code}</Badge>
                          ))}
                          {row.invoice_id && (
                            <Badge variant="success">
                              <Check className="w-2.5 h-2.5 mr-0.5" />
                              {invoiceLabel.get(row.invoice_id) || 'invoice'}
                            </Badge>
                          )}
                          {linkedContracts.length === 0 && linkedProjects.length === 0 && !row.invoice_id && (
                            <span className="text-[11px] text-[var(--ink-4)]">Unlinked</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-[11px] text-[var(--ink-3)] whitespace-nowrap">{methodLabel(row.method)}</td>
                      <td className="py-2 pr-3 text-[11px] text-[var(--ink-3)] max-w-[220px]">
                        <span className="block truncate" title={[row.bank_reference, row.note].filter(Boolean).join(' · ')}>
                          {[row.bank_reference, row.note].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setDraft(draftFrom(row))}
                          title="Edit receipt"
                          aria-label="Edit receipt"
                          className="inline-flex items-center justify-center w-6 h-6 rounded-[var(--radius-control)] text-[var(--ink-3)] hover:bg-[var(--surface-sunken)] hover:text-[var(--ink)] cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`Delete this receipt of ${formatMoney(row.amount, row.currency)}? The revenue schedule will stop showing it as paid.`)) {
                              void deleteReceipt(row.id);
                            }
                          }}
                          title="Delete receipt"
                          aria-label="Delete receipt"
                          className="inline-flex items-center justify-center w-6 h-6 rounded-[var(--radius-control)] text-[var(--ink-4)] hover:bg-rose-50 hover:text-rose-700 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        isOpen={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit receipt' : 'Record receipt'}
        eyebrow="Invoice register · money without a tax document"
        size="3xl"
      >
        {draft && (
          <div className="flex flex-col max-h-[calc(92vh-120px)]">
            <div className="overflow-y-auto px-5 py-4 space-y-4">
              <section className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="ui-segmented" role="group" aria-label="Receipt direction">
                    <button type="button" onClick={() => setDraft({ ...draft, direction: 'incoming' })} aria-pressed={draft.direction === 'incoming'}>
                      <ArrowDownLeft className="w-3 h-3" /> Received
                    </button>
                    <button type="button" onClick={() => setDraft({ ...draft, direction: 'outgoing' })} aria-pressed={draft.direction === 'outgoing'}>
                      <ArrowUpRight className="w-3 h-3" /> Paid out
                    </button>
                  </div>
                  <span className="text-[11px] text-[var(--ink-4)]">
                    Received money lands on the revenue schedule as paid; paid-out money is tracked here only.
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <span className="ui-label">Counterparty</span>
                    <SearchableSelect
                      value={draft.counterparty_id}
                      onChange={value => setDraft({ ...draft, counterparty_id: value })}
                      options={counterparties.map(cp => ({
                        value: cp.id,
                        label: cp.legal_name,
                        description: cp.trade_name || cp.vat_number || undefined,
                        keywords: `${cp.trade_name || ''} ${cp.vat_number || ''}`,
                      }))}
                      placeholder="Select the company that paid"
                    />
                  </div>
                  <label className="block">
                    <span className="ui-label">Value date</span>
                    <DatePicker value={draft.received_on} onChange={value => setDraft({ ...draft, received_on: value })} placeholder="Received on" />
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_110px_110px_auto]">
                  <label className="block">
                    <span className="ui-label">Amount</span>
                    <input
                      type="number"
                      step="0.01"
                      value={draft.amount}
                      onChange={event => setDraft({ ...draft, amount: event.target.value })}
                      placeholder="0.00"
                      className="ui-input w-full font-mono text-right"
                    />
                  </label>
                  <label className="block">
                    <span className="ui-label">Currency</span>
                    <select value={draft.currency} onChange={event => setDraft({ ...draft, currency: event.target.value })} className="ui-input w-full">
                      {INVOICE_CURRENCIES.map(currency => (
                        <option key={currency.code} value={currency.code}>{currency.code}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="ui-label">FX to EUR</span>
                    <input
                      type="number"
                      step="0.0001"
                      value={draft.fx_rate}
                      onChange={event => setDraft({ ...draft, fx_rate: event.target.value })}
                      disabled={draft.currency === 'EUR'}
                      className="ui-input w-full font-mono text-right disabled:opacity-50"
                    />
                  </label>
                  <div className="self-end pb-1.5">
                    <span className="ui-label">EUR</span>
                    <span className="block font-mono text-[13px] font-semibold text-[var(--ink)]">{formatMoney(amountEur, 'EUR')}</span>
                  </div>
                </div>
              </section>

              <section className="space-y-3 pt-4 border-t border-[var(--line)]">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h3 className="ui-section-title">What the money covers</h3>
                  <span className="text-[11px] text-[var(--ink-4)]">Months it settles — defaults to the value-date month.</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="ui-label">Period from</span>
                    <DatePicker value={draft.period_from} onChange={value => setDraft({ ...draft, period_from: value })} placeholder="Optional" />
                  </label>
                  <label className="block">
                    <span className="ui-label">Period to</span>
                    <DatePicker value={draft.period_to} onChange={value => setDraft({ ...draft, period_to: value })} placeholder="Optional" />
                  </label>
                </div>
                <div>
                  <span className="ui-label">Contracts and projects</span>
                  <InvoiceLinkPicker
                    contractIds={draft.contract_ids}
                    projectIds={draft.project_ids}
                    contracts={contracts}
                    projects={projects}
                    counterpartyId={draft.counterparty_id || undefined}
                    onChange={selection => setDraft({ ...draft, contract_ids: selection.contractIds, project_ids: selection.projectIds })}
                  />
                </div>
                <div>
                  <span className="ui-label">Invoice this settles (optional)</span>
                  <SearchableSelect
                    value={draft.invoice_id}
                    onChange={value => setDraft({ ...draft, invoice_id: value })}
                    options={invoiceOptions}
                    emptyLabel="No invoice — paid without one"
                    placeholder="Link the invoice the money pays"
                  />
                </div>
              </section>

              <section className="space-y-3 pt-4 border-t border-[var(--line)]">
                <h3 className="ui-section-title">Transfer details</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="ui-label">Method</span>
                    <select value={draft.method} onChange={event => setDraft({ ...draft, method: event.target.value })} className="ui-input w-full">
                      <option value="">Not specified</option>
                      {METHODS.map(method => (
                        <option key={method.value} value={method.value}>{method.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="ui-label">Bank reference</span>
                    <input
                      type="text"
                      value={draft.bank_reference}
                      onChange={event => setDraft({ ...draft, bank_reference: event.target.value })}
                      placeholder="e.g. GCS mass transfer 03/2026"
                      className="ui-input w-full"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="ui-label">Note</span>
                  <textarea
                    value={draft.note}
                    onChange={event => setDraft({ ...draft, note: event.target.value })}
                    rows={2}
                    placeholder="Why the money arrived without an invoice"
                    className="ui-input w-full resize-y"
                  />
                </label>
              </section>
            </div>

            <div className="px-5 py-3 border-t border-[var(--line)] bg-[var(--surface-muted)] flex flex-wrap items-center justify-between gap-3 shrink-0">
              <span className="text-[11px] text-[var(--ink-4)]">
                {draft.direction === 'incoming'
                  ? 'Linked months will show as paid in the Revenue Schedule & MRR.'
                  : 'Outgoing payments are recorded for the ledger only.'}
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => setDraft(null)}>
                  <X className="w-3.5 h-3.5" /> Cancel
                </Button>
                <Button size="sm" variant="primary" onClick={() => void save()} disabled={!canSave || saving}>
                  <Check className="w-3.5 h-3.5" /> {saving ? 'Saving…' : draft.id ? 'Save receipt' : 'Record receipt'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
