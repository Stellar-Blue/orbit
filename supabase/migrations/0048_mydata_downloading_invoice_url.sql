-- myDATA: capture the receiver-side document download URL (if AADE ever provides one).
-- AADE fills `downloadingInvoiceUrl` only for provider-channel docs on the receiver side;
-- our ERP-channel issued docs carry none. Store it anyway so nothing is silently dropped
-- and a future real PDF can be auto-attached if it ever appears.
ALTER TABLE public.aade_documents ADD COLUMN IF NOT EXISTS downloading_invoice_url TEXT NULL;

COMMENT ON COLUMN public.aade_documents.downloading_invoice_url IS
  'AADE myDATA downloadingInvoiceUrl — URL for the receiver to download the document. Populated only for provider-channel invoices; empty for ERP-channel issued docs.';
