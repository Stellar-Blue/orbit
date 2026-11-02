"use client";

import { useCallback, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { notifySuccess } from '@/lib/validation-modal';
import { buildDraftInvoicePayload, vatRateForTreatment, type BillingPeriodItem } from '@/lib/billing-periods';
import type { Contract } from '@/lib/types';

/**
 * Fast-create a draft invoice for one of a contract's due billing periods — from the dossier, the
 * revenue schedule or the Billing check. Uses the same payload builder as the Invoices Hub
 * quick-create so every path stays identical.
 */
export function useCreateDraftInvoice() {
  const { addInvoice, refreshInvoices } = useAuth();
  /** Optimistic "draft created" marks, keyed `${contractId}::${periodKey}`, so a suggestion hides at once. */
  const [draftIds, setDraftIds] = useState<Record<string, string>>({});
  /** Period currently being drafted — blocks a double click from creating two invoices. */
  const [creatingKey, setCreatingKey] = useState<string | null>(null);
  const busy = useRef(false);

  const createDraft = useCallback(async (contract: Contract, period: BillingPeriodItem) => {
    if (!addInvoice || busy.current) return;
    busy.current = true;
    setCreatingKey(period.key);
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const dueStr = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
      const invNumber = `INV-${(period.from || todayStr).slice(0, 4)}-${Math.floor(1000 + Math.random() * 9000)}`;

      const newInv = await addInvoice(buildDraftInvoicePayload({
        period,
        contractId: contract.id,
        counterpartyId: contract.counterparty_id,
        direction: contract.direction,
        currency: contract.currency,
        netAmount: period.expectedAmount,
        vatRate: vatRateForTreatment(contract.vat_treatment),
        reference: contract.reference,
        timing: period.timing,
        invoiceNumber: invNumber,
        issueDate: todayStr,
        dueDate: dueStr,
      }));

      if (newInv) {
        setDraftIds(prev => ({ ...prev, [`${contract.id}::${period.key}`]: newInv.id }));
        notifySuccess(`Draft invoice #${invNumber} created for ${contract.reference} (${period.label}).`);
        await refreshInvoices?.();
      }
    } finally {
      busy.current = false;
      setCreatingKey(null);
    }
  }, [addInvoice, refreshInvoices]);

  return { createDraft, creatingKey, draftIds };
}
