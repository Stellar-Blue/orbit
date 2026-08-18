-- Store the AADE QR verification-page URL directly on the invoice mirror so the UI can offer
-- a fast "View on AADE" preview without joining the raw aade_documents store at load time.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS qr_url TEXT NULL;

-- Backfill existing myDATA-mirrored invoices from the raw store (mark links both).
UPDATE public.invoices i
SET qr_url = d.qr_url
FROM public.aade_documents d
WHERE d.mark::text = i.mark
  AND i.qr_url IS NULL
  AND d.qr_url IS NOT NULL
  AND d.qr_url <> '';

COMMENT ON COLUMN public.invoices.qr_url IS 'AADE myDATA QR verification-page URL (public ΑΑΔΕ Επιβεβαίωση Παραστατικού page)';
